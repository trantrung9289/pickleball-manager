"""Gỡ "Nhắc đóng phí qua Telegram" (2026-10-28): endpoint cũ không còn, cờ remind_enabled chuyển thành quy tắc thông báo phí,
tuỳ chọn nhắc lại hằng ngày, tin Telegram kèm số điện thoại + khách mời đã đóng; public không lộ số điện thoại."""
from datetime import date, timedelta

import main
import models
from conftest import World


def _fake_tg(monkeypatch):
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


def _today(client, world):
    return date.fromisoformat(client.get("/api/announcements/feed", headers=World.headers(world.admin1, world.club1)).json()["today"])


def test_old_endpoints_removed_and_flag_ignored(client, world):
    h1 = World.headers(world.admin1, world.club1)
    r = client.get("/api/fee-reminders/preview", params={"month": 1, "year": 2030}, headers=h1)
    assert r.status_code != 200 or r.headers["content-type"].startswith("text/html")   # GET lạ rơi vào catch-all SPA (index.html), không còn JSON
    assert client.post("/api/fee-reminders/send", params={"month": 1, "year": 2030}, headers=h1).status_code in (404, 405)
    assert client.post("/api/internal/send-fee-reminder", params={"month": 1, "year": 2030}, headers={"X-Internal-Secret": "x"}).status_code in (401, 403, 404, 405)
    # API khoản thu không còn trường remind_enabled (gửi lên bị bỏ qua, không lỗi)
    r = client.put(f"/api/fee-types/{world.fee1.id}", json={"remind_enabled": True}, headers=h1)
    assert r.status_code == 200 and "remind_enabled" not in r.json()


def test_migration_converts_remind_enabled_to_fee_rule_once(world, db):
    world.fee1.remind_enabled = True
    world.fee2.remind_enabled = True
    db.commit()
    main._migrate_fee_reminders_to_announcements()
    db.expire_all()
    rules = db.query(models.Announcement).filter(models.Announcement.kind == "fee").order_by(models.Announcement.club_id).all()
    assert [(a.club_id, a.fee_type_id, a.recurrence, a.day_of_month, a.lead_days, a.repeat_daily, a.push_telegram, a.show_public, a.is_active) for a in rules] == [
        (world.club1.id, world.fee1.id, "monthly", 5, 9, True, True, True, True),
        (world.club2.id, world.fee2.id, "monthly", 5, 9, True, True, True, True),
    ]
    assert rules[0].title == "Nhắc đóng Phí tháng"
    assert not world.fee1.remind_enabled and not world.fee2.remind_enabled
    # Chạy lại → không tạo thêm; bật lại cờ khi đã có quy tắc → chỉ tắt cờ
    main._migrate_fee_reminders_to_announcements()
    world.fee1.remind_enabled = True; db.commit()
    main._migrate_fee_reminders_to_announcements()
    db.expire_all()
    assert db.query(models.Announcement).filter(models.Announcement.kind == "fee").count() == 2 and not world.fee1.remind_enabled


def test_repeat_daily_sends_every_day_in_window_once_per_day(client, world, db, monkeypatch):
    sent = _fake_tg(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    today = _today(client, world)
    # Cả 2 quy tắc: d = hôm nay + 2, lead 4 → hôm nay ở GIỮA cửa sổ. Chỉ quy tắc nhắc hằng ngày được gửi.
    client.post("/api/announcements", json={"title": "Hằng ngày", "recurrence": "none", "start_date": (today + timedelta(days=2)).isoformat(), "lead_days": 4, "repeat_daily": True, "push_telegram": True, "push_time": "00:00"}, headers=h1)
    client.post("/api/announcements", json={"title": "Hai mốc", "recurrence": "none", "start_date": (today + timedelta(days=2)).isoformat(), "lead_days": 4, "repeat_daily": False, "push_telegram": True, "push_time": "00:00"}, headers=h1)
    m = db.query(models.ClubMembership).filter(models.ClubMembership.user_id == world.admin1.id).first()
    m.telegram_chat_id = 111; db.commit()
    r = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r.json()["sent"] == 1 and [t["text"].splitlines()[0] for t in sent] == ["📅 *Hằng ngày*"]
    # Trong ngày gọi lại → bỏ qua (một lần/ngày)
    r = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r.json()["sent"] == 0 and r.json()["skipped"] == 1


def test_fee_telegram_has_phone_and_guests_but_public_has_no_phone(client, world, db, monkeypatch):
    sent = _fake_tg(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    today = _today(client, world)
    # Khách mời đã đóng khoản này tháng nay
    db.add(models.Transaction(club_id=world.club1.id, fee_type_id=world.fee1.id, player_id=world.guest1.id, type="income", amount=100000, transaction_date=today))
    db.commit()
    aid = client.post("/api/announcements", json={"kind": "fee", "title": "Hội phí", "fee_type_id": world.fee1.id, "recurrence": "monthly", "day_of_month": today.day, "lead_days": 0}, headers=h1).json()["id"]
    m = db.query(models.ClubMembership).filter(models.ClubMembership.user_id == world.admin1.id).first()
    m.telegram_chat_id = 111; db.commit()
    assert client.post(f"/api/announcements/{aid}/push", headers=h1).status_code == 200
    text = sent[0]["text"]
    assert "  • M Member 1 (0900000001)" in text and "Khách mời đã đóng (1 người): Guest One" in text
    # Feed admin có phone + khách mời; feed public chỉ tên
    adm = client.get("/api/announcements/feed", headers=h1).json()["items"][0]
    assert adm["unpaid_members"][0]["phone"] == "0900000001" and adm["guest_paid_count"] == 1
    pub = client.get(f"/api/public/report/{world.token1.slug}/announcements").json()["items"][0]
    assert "phone" not in pub["unpaid_members"][0] and pub["guests_paid"][0]["full_name"] == "Guest One"
