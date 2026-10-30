"""Lịch sử đẩy (2026-10-30): mỗi lượt gửi thật ghi một dòng/kênh (Telegram, thiết bị, Zalo) với nguồn tự động/khi lưu/gửi ngay,
không ghi lượt bị bỏ qua vì đã gửi, tự xoá quá 7 ngày VN (giữ hôm nay + 6 ngày trước), xoá quy tắc vẫn giữ dòng, cách ly CLB."""
from datetime import date, datetime, timedelta

import main
import models
import zalo_bot
from conftest import World

SUB = {"endpoint": "https://push.example.com/sub/hist00000000", "keys": {"p256dh": "BPkeypkeypkeypkey", "auth": "authauth"}}


class FakeZalo:
    def __init__(self):
        self.fail = {}

    def __call__(self, token, method, payload=None, timeout=15):
        if method == "getMe":
            return {"id": "331", "display_name": "Bot Test"}
        if method == "setWebhook":
            return {}
        if method == "sendMessage":
            if payload["chat_id"] in self.fail:
                raise zalo_bot.ZaloError(self.fail[payload["chat_id"]], "lỗi giả")
            return {"message_id": "m"}
        return {}


def _setup(client, world, db, monkeypatch):
    """Dựng đủ 3 kênh: 1 thiết bị Web Push, 1 admin Telegram, 1 nhóm Zalo đã duyệt."""
    web, tele = [], []
    monkeypatch.setattr(main._wp, "send_push", lambda sub, payload, ttl=86400: (web.append(payload), "ok")[1])
    monkeypatch.setattr(main, "_telegram_send", lambda tok, chat, text: tele.append((chat, text)))
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "000:fake")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    monkeypatch.setattr(main, "_INTERNAL_SECRET", "s3cr3t")
    fz = FakeZalo(); monkeypatch.setattr(zalo_bot, "call", fz)
    h1 = World.headers(world.admin1, world.club1)
    client.put("/api/club/zalo/token", json={"token": "123456789:abcdefghijklmnop"}, headers=h1)
    club = db.query(models.Club).get(world.club1.id); db.refresh(club)
    client.post(f"/api/zalo/webhook/{club.id}", headers={"X-Bot-Api-Secret-Token": club.zalo_webhook_secret},
                json={"message": {"chat": {"id": "zgr-A", "chat_type": "GROUP"}, "text": "@Bot", "from": {"id": "u1", "display_name": "Trung", "is_bot": False}}})
    gid = db.query(models.ZaloGroup).filter_by(chat_id="zgr-A").first().id
    client.post(f"/api/club/zalo/groups/{gid}/approve", headers=h1)
    client.patch(f"/api/club/zalo/groups/{gid}", json={"label": "Nhóm chính"}, headers=h1)
    client.post(f"/api/public/report/{world.token1.slug}/push/subscribe", json=SUB)
    m = db.query(models.ClubMembership).filter(models.ClubMembership.user_id == world.admin1.id).first(); m.telegram_chat_id = 555; db.commit()
    return h1, fz, web, tele


def _clock(monkeypatch, d: date, hhmm: str):
    h, m = (int(x) for x in hhmm.split(":"))
    monkeypatch.setattr(main, "_now_vn", lambda: datetime(d.year, d.month, d.day, h, m))


def _hist(client, h, **params):
    return client.get("/api/announcements/push-history", params=params, headers=h).json()


def test_history_rows_per_channel_source_skip_and_pre(client, world, db, monkeypatch):
    h1, fz, web, tele = _setup(client, world, db, monkeypatch)
    d = date(2026, 11, 12)
    _clock(monkeypatch, d, "08:00")
    # lưu sau giờ đẩy → gửi ngay: 3 dòng nguồn "save"
    aid = client.post("/api/announcements", json={"title": "Đánh tối", "recurrence": "weekly", "weekdays": [d.weekday()], "lead_days": 0,
                                                  "start_time": "18:00", "remind_before_min": 90, "push_telegram": True, "push_time": "07:00"}, headers=h1).json()["id"]
    h = _hist(client, h1)
    assert h["retention_days"] == 7
    rows = h["items"]
    assert sorted((r["channel"], r["source"], r["pre"], r["sent_count"], r["error_count"]) for r in rows) == \
        [("telegram", "save", False, 1, 0), ("web", "save", False, 1, 0), ("zalo", "save", False, 1, 0)]
    z = [r for r in rows if r["channel"] == "zalo"][0]
    assert z["title"] == "Đánh tối" and z["detail"] == "✔ Nhóm chính" and z["sent_at"].endswith("Z") and z["announcement_id"] == aid
    # cron lại: tất cả đã gửi → KHÔNG thêm dòng (không ghi lượt bị bỏ qua)
    cron = lambda: client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"}).json()
    cron()
    assert len(_hist(client, h1)["items"]) == 3
    # nhắc trước giờ bắt đầu (16:30): 3 dòng pre=True nguồn "cron"
    _clock(monkeypatch, d, "16:30"); cron()
    pre = [r for r in _hist(client, h1)["items"] if r["pre"]]
    assert sorted((r["channel"], r["source"]) for r in pre) == [("telegram", "cron"), ("web", "cron"), ("zalo", "cron")]
    # Gửi ngay thủ công: 3 dòng "manual", mỗi lần bấm thêm dòng mới
    client.post(f"/api/announcements/{aid}/push", headers=h1); client.post(f"/api/announcements/{aid}/push", headers=h1)
    manual = [r for r in _hist(client, h1)["items"] if r["source"] == "manual"]
    assert len(manual) == 6
    # thứ tự mới → cũ; lọc kênh; kênh sai → 422
    items = _hist(client, h1)["items"]
    assert [r["sent_at"] for r in items] == sorted((r["sent_at"] for r in items), reverse=True)
    assert {r["channel"] for r in _hist(client, h1, channel="zalo")["items"]} == {"zalo"}
    assert client.get("/api/announcements/push-history", params={"channel": "sms"}, headers=h1).status_code == 422
    # xoá quy tắc: dòng lịch sử vẫn còn (title chụp lại)
    client.delete(f"/api/announcements/{aid}", headers=h1)
    assert len(_hist(client, h1)["items"]) == len(items) and all(r["title"] == "Đánh tối" for r in _hist(client, h1)["items"])
    # viewer xem được; CLB khác không thấy
    assert client.get("/api/announcements/push-history", headers=World.headers(world.viewer1, world.club1)).status_code == 200
    assert _hist(client, World.headers(world.admin2, world.club2))["items"] == []


def test_history_records_errors_and_zalo_group_failures(client, world, db, monkeypatch):
    h1, fz, web, tele = _setup(client, world, db, monkeypatch)
    d = date(2026, 11, 12)
    _clock(monkeypatch, d, "08:00")
    fz.fail["zgr-A"] = 410
    monkeypatch.setattr(main, "_telegram_send", lambda tok, chat, text: (_ for _ in ()).throw(RuntimeError("telegram sập")))
    client.post("/api/announcements", json={"title": "Lỗi thử", "recurrence": "none", "start_date": d.isoformat(), "lead_days": 0,
                                            "push_telegram": True, "push_time": "07:00"}, headers=h1)
    rows = {r["channel"]: r for r in _hist(client, h1)["items"]}
    assert rows["zalo"]["sent_count"] == 0 and rows["zalo"]["error_count"] == 1 and rows["zalo"]["detail"] == "✖ Nhóm chính (410)"
    assert rows["telegram"]["error_count"] == 1 and "telegram sập" in rows["telegram"]["detail"]
    assert rows["web"]["sent_count"] == 1


def test_history_retention_keeps_last_7_vn_days(client, world, db, monkeypatch):
    h1, *_ = _setup(client, world, db, monkeypatch)
    today = date(2026, 11, 20)
    _clock(monkeypatch, today, "10:00")

    def add(vn_dt, title):
        db.add(models.AnnouncementPushHistory(club_id=world.club1.id, announcement_id=None, title=title, kind="schedule", channel="web",
                                              source="cron", pre=False, sent_count=1, error_count=0, sent_at=main._utc_from_vn(vn_dt)))
    add(datetime(2026, 11, 13, 23, 59, 59), "hết hạn: 7 ngày trước 23:59")     # ngày xa nhất, đã quá 7 ngày → xoá
    add(datetime(2026, 11, 14, 0, 0, 0), "giữ: 6 ngày trước 00:00")             # đầu ngày của ngày thứ 7 → giữ
    add(datetime(2026, 11, 17, 12, 0, 0), "giữ: 3 ngày trước")
    add(datetime(2026, 11, 20, 9, 0, 0), "giữ: hôm nay")
    # dòng của CLB khác cũng bị dọn theo cùng quy tắc
    db.add(models.AnnouncementPushHistory(club_id=world.club2.id, announcement_id=None, title="CLB2 cũ", kind="schedule", channel="web", source="cron",
                                          pre=False, sent_count=1, error_count=0, sent_at=main._utc_from_vn(datetime(2026, 11, 1, 8, 0))))
    db.commit()
    titles = [r["title"] for r in _hist(client, h1)["items"]]     # đọc cũng dọn
    assert titles == ["giữ: hôm nay", "giữ: 3 ngày trước", "giữ: 6 ngày trước 00:00"]
    assert db.query(models.AnnouncementPushHistory).filter_by(club_id=world.club2.id).count() == 0
    # sang ngày hôm sau: cron dọn tiếp, ngày xa nhất (14/11) rơi ra ngoài
    _clock(monkeypatch, today + timedelta(days=1), "00:15")
    client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert [r.title for r in db.query(models.AnnouncementPushHistory).order_by(models.AnnouncementPushHistory.sent_at.desc()).all()] == \
        ["giữ: hôm nay", "giữ: 3 ngày trước"]
