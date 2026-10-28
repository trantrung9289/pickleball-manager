"""Đợt 3 thông báo (2026-10-27): đẩy Telegram qua cron (ngày đầu cửa sổ + đúng ngày, chống trùng) và nút "Gửi ngay"."""
from datetime import date, timedelta

import main
import models
from conftest import World


def _fake_telegram(monkeypatch):
    sent = []

    def fake_urlopen(req, timeout=10):
        import json
        sent.append(json.loads(req.data))

        class R:
            def read(self_inner): return b"{}"
            def __enter__(self_inner): return self_inner
            def __exit__(self_inner, *a): return False
        return R()
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "000:fake")
    monkeypatch.setattr(main, "_INTERNAL_SECRET", "s3cr3t")
    monkeypatch.setattr(main._urllib_req, "urlopen", fake_urlopen)
    return sent


def _link_admin(db, world, chat_id=111):
    m = db.query(models.ClubMembership).filter(models.ClubMembership.user_id == world.admin1.id).first()
    m.telegram_chat_id = chat_id
    db.commit()


def _today(client, world):
    return date.fromisoformat(client.get("/api/announcements/feed", headers=World.headers(world.admin1, world.club1)).json()["today"])


def test_cron_pushes_on_first_window_day_and_on_day_with_dedupe(client, world, db, monkeypatch):
    sent = _fake_telegram(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    today = _today(client, world)
    # (liên kết Telegram SAU khi tạo quy tắc — từ phương án C, lưu quy tắc đến ngày sẽ gửi ngay nếu đã có kênh)
    # A: hôm nay là ngày đầu cửa sổ (d = today + 2, lead 2) → gửi; B: lead 0, d = hôm nay → gửi; C: d = today + 1, lead 3 → giữa cửa sổ → KHÔNG gửi
    # D: push_telegram tắt → không gửi; E: khoản thu hôm nay, kèm tên chưa đóng
    client.post("/api/announcements", json={"title": "A", "recurrence": "none", "start_date": (today + timedelta(days=2)).isoformat(), "lead_days": 2, "push_telegram": True, "start_time": "19:00"}, headers=h1)
    client.post("/api/announcements", json={"title": "B", "recurrence": "none", "start_date": today.isoformat(), "lead_days": 0, "push_telegram": True}, headers=h1)
    client.post("/api/announcements", json={"title": "C", "recurrence": "none", "start_date": (today + timedelta(days=1)).isoformat(), "lead_days": 3, "push_telegram": True}, headers=h1)
    client.post("/api/announcements", json={"title": "D", "recurrence": "none", "start_date": today.isoformat(), "lead_days": 0, "push_telegram": False}, headers=h1)
    client.post("/api/announcements", json={"kind": "fee", "title": "E", "fee_type_id": world.fee1.id, "recurrence": "monthly", "day_of_month": today.day, "lead_days": 0, "push_telegram": True}, headers=h1)
    _link_admin(db, world)

    assert client.post("/api/internal/send-announcements").status_code in (401, 403)
    r = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == 3 and r.json()["skipped"] == 0 and r.json()["clubs"] == 1
    titles = sorted(t["text"].splitlines()[0] for t in sent)
    assert titles == ["📅 *A*", "📅 *B*", "🔔 *E*"]
    fee_msg = next(t["text"] for t in sent if "*E*" in t["text"])
    assert "Chưa đóng (8 người):" in fee_msg and "  • M Member 1" in fee_msg
    a_msg = next(t["text"] for t in sent if "*A*" in t["text"])
    assert "19:00" in a_msg and (today + timedelta(days=2)).strftime("%d/%m/%Y") in a_msg
    assert all(t["chat_id"] == 111 for t in sent)
    assert db.query(models.AnnouncementPushLog).count() == 3

    # Gọi lại trong ngày → bỏ qua hết
    sent.clear()
    r2 = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r2.json()["sent"] == 0 and r2.json()["skipped"] == 3 and sent == []


def test_cron_respects_club_bot_flag_and_membership_flag(client, world, db, monkeypatch):
    sent = _fake_telegram(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    today = _today(client, world)
    client.post("/api/announcements", json={"title": "B", "recurrence": "none", "start_date": today.isoformat(), "lead_days": 0, "push_telegram": True}, headers=h1)
    _link_admin(db, world)
    world.club1.bot_enabled = False
    db.commit()
    r = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r.json()["sent"] == 0 and sent == []
    world.club1.bot_enabled = True
    m = db.query(models.ClubMembership).filter(models.ClubMembership.user_id == world.admin1.id).first()
    m.bot_enabled = False
    db.commit()
    r = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r.json()["sent"] == 0 and sent == []


def test_manual_push_sends_next_occurrence_without_dedupe(client, world, db, monkeypatch):
    sent = _fake_telegram(monkeypatch)
    h1, hv = World.headers(world.admin1, world.club1), World.headers(world.viewer1, world.club1)
    today = _today(client, world)
    aid = client.post("/api/announcements", json={"title": "Sinh hoạt", "recurrence": "weekly", "weekdays": [today.weekday()], "lead_days": 1, "push_telegram": False, "start_time": "18:00"}, headers=h1).json()["id"]
    # chưa liên kết Telegram → 400
    assert client.post(f"/api/announcements/{aid}/push", headers=h1).status_code == 400
    _link_admin(db, world, 222)
    assert client.post(f"/api/announcements/{aid}/push", headers=hv).status_code == 403
    assert client.post("/api/announcements/9999/push", headers=h1).status_code == 404
    r = client.post(f"/api/announcements/{aid}/push", headers=h1)
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == 1 and r.json()["date"] == today.isoformat()   # hôm nay đúng thứ → lần gần nhất là hôm nay
    assert sent[0]["chat_id"] == 222 and "18:00" in sent[0]["text"]
    # Gửi tay không chống trùng: lần 2 vẫn gửi; CLB khác không gửi được
    r = client.post(f"/api/announcements/{aid}/push", headers=h1)
    assert r.json()["sent"] == 1 and len(sent) == 2
    assert client.post(f"/api/announcements/{aid}/push", headers=World.headers(world.admin2, world.club2)).status_code == 404
