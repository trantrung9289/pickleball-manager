"""Giờ đẩy theo quy tắc + nhắc trước giờ bắt đầu (2026-10-30): bật đẩy phải đặt push_time (không mặc định), cron 15 phút chỉ gửi
khi đã qua giờ đẩy (không còn gửi lúc 00:00), nhắc trước giờ bắt đầu một lần/lần xuất hiện, log riêng, xoá quy tắc dọn log."""
from datetime import date, datetime, timedelta

import main
import models
from conftest import World

SUB = {"endpoint": "https://push.example.com/sub/pt0000000000", "keys": {"p256dh": "BPkeypkeypkeypkey", "auth": "authauth"}}


def _fake(monkeypatch):
    sent = []
    monkeypatch.setattr(main._wp, "send_push", lambda sub, payload, ttl=86400: (sent.append(payload), "ok")[1])
    monkeypatch.setattr(main, "_INTERNAL_SECRET", "s3cr3t")
    return sent


def _clock(monkeypatch, d: date, hhmm: str):
    h, m = (int(x) for x in hhmm.split(":"))
    monkeypatch.setattr(main, "_now_vn", lambda: datetime(d.year, d.month, d.day, h, m))


def _cron(client):
    return client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"}).json()["web_push"]


def test_push_requires_push_time_and_remind_rules(client, world):
    h1 = World.headers(world.admin1, world.club1)
    base = {"title": "X", "recurrence": "none", "start_date": "2026-11-05", "lead_days": 0}
    r = client.post("/api/announcements", json={**base, "push_telegram": True}, headers=h1)
    assert r.status_code == 422 and "Giờ đẩy" in r.text
    assert client.post("/api/announcements", json={**base, "push_telegram": True, "push_time": "7:00"}, headers=h1).status_code == 422
    aid = client.post("/api/announcements", json={**base, "push_telegram": False}, headers=h1).json()["id"]
    # bật đẩy qua PUT mà chưa có giờ → 422; đặt giờ rồi bật → OK
    assert client.put(f"/api/announcements/{aid}", json={"push_telegram": True}, headers=h1).status_code == 422
    r = client.put(f"/api/announcements/{aid}", json={"push_telegram": True, "push_time": "07:30"}, headers=h1)
    assert r.status_code == 200 and r.json()["push_time"] == "07:30"
    # nhắc trước: cần start_time; không được lùi sang hôm trước
    assert client.put(f"/api/announcements/{aid}", json={"remind_before_min": 30}, headers=h1).status_code == 422
    assert client.put(f"/api/announcements/{aid}", json={"start_time": "06:00", "remind_before_min": 400}, headers=h1).status_code == 422
    r = client.put(f"/api/announcements/{aid}", json={"start_time": "18:00", "remind_before_min": 90}, headers=h1)
    assert r.status_code == 200 and r.json()["remind_before_min"] == 90


def test_cron_waits_for_push_time_not_midnight(client, world, db, monkeypatch):
    sent = _fake(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    d = date(2026, 11, 10)
    _clock(monkeypatch, d, "00:05")
    client.post(f"/api/public/report/{world.token1.slug}/push/subscribe", json=SUB)
    # tạo lúc 00:05, giờ đẩy 07:00 → không gửi ngay khi lưu, cron 00:05 / 06:45 bỏ qua, 07:00 gửi, 07:15 chống trùng
    r = client.post("/api/announcements", json={"title": "Sáng", "recurrence": "none", "start_date": d.isoformat(), "lead_days": 0,
                                                "push_telegram": True, "push_time": "07:00"}, headers=h1)
    assert r.status_code == 201 and sent == []
    assert _cron(client)["sent"] == 0
    _clock(monkeypatch, d, "06:45"); assert _cron(client)["sent"] == 0 and sent == []
    _clock(monkeypatch, d, "07:00"); assert _cron(client)["sent"] == 1 and sent[0]["title"].startswith("Sáng")
    _clock(monkeypatch, d, "07:15"); assert _cron(client) == {"sent": 0, "skipped": 1, "removed": 0, "errors": 0}
    # quy tắc cũ bật đẩy nhưng chưa có giờ (dữ liệu trước 2026-10-30) → không gửi
    old = models.Announcement(club_id=world.club1.id, kind="schedule", title="Cũ", recurrence="none", start_date=d, lead_days=0,
                              push_telegram=True, push_time=None)
    db.add(old); db.commit()
    _clock(monkeypatch, d, "23:50"); assert _cron(client)["sent"] == 0
    # lưu quy tắc khi ĐÃ qua giờ đẩy → gửi ngay
    sent.clear()
    client.post("/api/announcements", json={"title": "Tối", "recurrence": "none", "start_date": d.isoformat(), "lead_days": 0,
                                            "push_telegram": True, "push_time": "20:00"}, headers=h1)
    assert len(sent) == 1 and sent[0]["title"].startswith("Tối")


def test_pre_start_reminder_once_with_grace_and_cleanup(client, world, db, monkeypatch):
    sent = _fake(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    d = date(2026, 11, 12)
    _clock(monkeypatch, d, "08:00")
    client.post(f"/api/public/report/{world.token1.slug}/push/subscribe", json=SUB)
    aid = client.post("/api/announcements", json={"title": "Đánh tối", "recurrence": "weekly", "weekdays": [d.weekday()], "lead_days": 0,
                                                  "start_time": "18:00", "remind_before_min": 90, "push_telegram": True, "push_time": "07:00",
                                                  "body": "Sân 3"}, headers=h1).json()["id"]
    assert len(sent) == 1   # 08:00 đã qua giờ đẩy 07:00 → bản tin ngày gửi ngay khi lưu
    sent.clear()
    _clock(monkeypatch, d, "16:15"); assert _cron(client)["sent"] == 0          # chưa tới 16:30
    _clock(monkeypatch, d, "16:30"); wp = _cron(client)
    assert wp["sent"] == 1 and wp["skipped"] == 1                                # nhắc trước gửi; bản tin ngày đã gửi → skipped
    assert sent[0]["title"].startswith("⏰ Sắp đến giờ: Đánh tối") and "còn 1 giờ 30 phút" in sent[0]["body"] and "Sân 3" in sent[0]["body"]
    assert sent[0]["tag"] == f"ann-pre-{aid}-{d.isoformat()}"
    _clock(monkeypatch, d, "16:45"); assert _cron(client)["sent"] == 0          # một lần cho mỗi lần xuất hiện
    assert db.query(models.AnnouncementPreRemindLog).filter_by(announcement_id=aid, channel="wp").count() == 1
    # tuần sau: quá hạn ân hạn (18:00 + 30 phút) → không nhắc nữa
    d2 = d + timedelta(days=7)
    _clock(monkeypatch, d2, "18:31"); wp = _cron(client)
    assert all(not p["title"].startswith("⏰") for p in sent[1:]) and wp["sent"] == 1   # chỉ bản tin ngày (07:00 đã qua)
    # Telegram: nhắc trước cũng chỉ một lần, nội dung "Sắp đến giờ"
    tg = []
    class R:
        def read(self): return b"{}"
        def __enter__(self): return self
        def __exit__(self, *a): return False
    import json
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "000:fake")
    monkeypatch.setattr(main._urllib_req, "urlopen", lambda req, timeout=10: (tg.append(json.loads(req.data)), R())[1])
    m = db.query(models.ClubMembership).filter(models.ClubMembership.user_id == world.admin1.id).first(); m.telegram_chat_id = 555; db.commit()
    d3 = d + timedelta(days=14)
    _clock(monkeypatch, d3, "16:40")
    r = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"}).json()
    assert r["sent"] == 2   # Telegram: bản tin ngày + nhắc trước (lần đầu có chat_id)
    assert sum(1 for t in tg if "Sắp đến giờ" in t["text"] and "còn 1 giờ 30 phút" in t["text"]) == 1
    _clock(monkeypatch, d3, "16:55")
    assert client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"}).json()["sent"] == 0
    # xoá quy tắc → dọn cả 3 log
    assert client.delete(f"/api/announcements/{aid}", headers=h1).status_code == 204
    assert db.query(models.AnnouncementPreRemindLog).filter_by(announcement_id=aid).count() == 0
    assert db.query(models.WebPushLog).filter_by(announcement_id=aid).count() == 0
    assert db.query(models.AnnouncementPushLog).filter_by(announcement_id=aid).count() == 0
