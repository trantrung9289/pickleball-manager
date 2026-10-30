"""Zalo Bot Platform theo CLB (2026-10-30): kết nối token (getMe + webhook), nhận diện nhóm qua webhook/poll, gửi vào nhóm trong cron
(giờ đẩy, chống trùng, cắt 2000 ký tự, bỏ SĐT, tắt tên chưa đóng), 410 tắt nhóm, Gửi ngay, ngắt kết nối dọn sạch, cách ly CLB."""
from datetime import date, datetime

import main
import models
import zalo_bot
from conftest import World


class FakeZalo:
    """Giả lập Bot API: ghi lại mọi lời gọi; results[(method)] hoặc fail_chat → ZaloError."""

    def __init__(self):
        self.calls = []
        self.fail_chat = {}      # chat_id → code lỗi
        self.updates = []        # trả cho getUpdates
        self.webhook_fail = False

    def __call__(self, token, method, payload=None, timeout=15):
        self.calls.append((method, payload or {}))
        if method == "getMe":
            if token.startswith("bad"):
                raise zalo_bot.ZaloError(401, "Unauthorized")
            return {"id": "331", "display_name": "Bot CLB Test", "account_type": "BASIC", "can_join_groups": True}
        if method == "setWebhook":
            if self.webhook_fail:
                raise zalo_bot.ZaloError(400, "url must be https")
            return {}
        if method == "deleteWebhook":
            return {}
        if method == "getUpdates":
            if not self.updates:
                raise zalo_bot.ZaloError(408, "Request timeout")
            return self.updates.pop(0)
        if method == "sendMessage":
            code = self.fail_chat.get(payload["chat_id"])
            if code:
                raise zalo_bot.ZaloError(code, "The chat_id is invaild")
            assert len(payload["text"]) <= 2000
            return {"message_id": "m"}
        raise AssertionError(method)

    def sent(self, chat_id=None):
        return [p["text"] for m, p in self.calls if m == "sendMessage" and (chat_id is None or p["chat_id"] == chat_id)]


def _fake(monkeypatch):
    fz = FakeZalo()
    monkeypatch.setattr(zalo_bot, "call", fz)
    monkeypatch.setattr(main, "_INTERNAL_SECRET", "s3cr3t")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    return fz


def _ev(chat_id, text, chat_type="GROUP", name="Trần Trung"):
    return {"event_name": "message.text.received", "message": {"chat": {"id": chat_id, "chat_type": chat_type}, "text": text,
                                                               "from": {"id": "u1", "display_name": name, "is_bot": False}}}


def _clock(monkeypatch, d: date, hhmm: str):
    h, m = (int(x) for x in hhmm.split(":"))
    monkeypatch.setattr(main, "_now_vn", lambda: datetime(d.year, d.month, d.day, h, m))


def test_connect_webhook_identify_groups_and_disconnect(client, world, db, monkeypatch):
    fz = _fake(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    assert client.get("/api/club/zalo", headers=h1).json()["connected"] is False
    assert client.put("/api/club/zalo/token", json={"token": "bad-token-000000"}, headers=h1).status_code == 400
    r = client.put("/api/club/zalo/token", json={"token": "123456789:abcdefghijklmnop"}, headers=h1)
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["connected"] and st["bot_name"] == "Bot CLB Test" and st["webhook_ok"] is True and st["token_tail"] == "…mnop"
    hook = [p for m, p in fz.calls if m == "setWebhook"][0]
    assert hook["url"].endswith(f"/api/zalo/webhook/{world.club1.id}") and len(hook["secret_token"]) >= 20
    club = db.query(models.Club).get(world.club1.id); db.refresh(club)
    assert club.zalo_bot_token_enc and "123456789" not in club.zalo_bot_token_enc   # mã hoá, không lưu thô
    # webhook: sai secret → 403; đúng → nhóm được ghi nhận; tin riêng → trả lời hướng dẫn, không tạo nhóm
    url = f"/api/zalo/webhook/{world.club1.id}"
    assert client.post(url, json=_ev("zgr-abc", "@Bot hello"), headers={"X-Bot-Api-Secret-Token": "sai"}).status_code == 403
    assert client.post(url, json=_ev("zgr-abc", "@Bot hello")).status_code == 403
    ok = {"X-Bot-Api-Secret-Token": club.zalo_webhook_secret}
    assert client.post(url, json=_ev("zgr-abc", "@Bot CLB hello"), headers=ok).json()["handled"] == "group"
    assert client.post(url, json=_ev("zgr-abc", "lần 2"), headers=ok).json()["handled"] == "group"   # không nhân đôi
    assert client.post(url, json=_ev("u1", "hi", chat_type="PRIVATE"), headers=ok).json()["handled"] == "private"
    assert fz.sent("u1") and "vào nhóm" in fz.sent("u1")[0]
    st = client.get("/api/club/zalo", headers=h1).json()
    assert len(st["groups"]) == 1 and st["groups"][0]["chat_id"] == "zgr-abc" and st["groups"][0]["added_by"] == "Trần Trung" \
        and st["groups"][0]["first_text"] == "@Bot CLB hello" and st["groups"][0]["enabled"] is True
    gid = st["groups"][0]["id"]
    # đặt nhãn, tắt/bật, gửi thử
    r = client.patch(f"/api/club/zalo/groups/{gid}", json={"label": "Nhóm CLB chính", "enabled": False}, headers=h1).json()
    assert r["groups"][0]["label"] == "Nhóm CLB chính" and r["groups"][0]["enabled"] is False
    client.patch(f"/api/club/zalo/groups/{gid}", json={"enabled": True}, headers=h1)
    assert client.post(f"/api/club/zalo/groups/{gid}/test", headers=h1).json()["ok"] is True and "Tin thử" in fz.sent("zgr-abc")[-1]
    # CLB khác không thấy, không sửa được
    h2 = World.headers(world.admin2, world.club2)
    assert client.get("/api/club/zalo", headers=h2).json()["groups"] == []
    assert client.patch(f"/api/club/zalo/groups/{gid}", json={"enabled": False}, headers=h2).status_code == 404
    # viewer không sửa được
    assert client.put("/api/club/zalo/settings", json={"show_unpaid_names": False}, headers=World.headers(world.viewer1, world.club1)).status_code == 403
    # ngắt kết nối → gỡ webhook, xoá token + nhóm
    r = client.delete("/api/club/zalo/token", headers=h1).json()
    assert r["connected"] is False and r["groups"] == [] and any(m == "deleteWebhook" for m, _ in fz.calls)
    assert db.query(models.ZaloGroup).count() == 0


def test_poll_fallback_when_webhook_fails(client, world, db, monkeypatch):
    fz = _fake(monkeypatch); fz.webhook_fail = True
    h1 = World.headers(world.admin1, world.club1)
    r = client.put("/api/club/zalo/token", json={"token": "123456789:abcdefghijklmnop"}, headers=h1).json()
    assert r["connected"] and r["webhook_ok"] is False and "webhook" in r["warning"].lower()
    fz.updates = [_ev("zgr-poll", "@Bot CLB Test xin chào")]
    r = client.post("/api/club/zalo/poll", headers=h1).json()
    assert r["events"] == 1 and r["groups_seen"] == 1 and r["groups"][0]["chat_id"] == "zgr-poll"
    assert client.post("/api/club/zalo/poll", headers=h1).json()["events"] == 0   # 408 → không có tin


def test_cron_sends_to_groups_with_dedupe_chunks_and_410(client, world, db, monkeypatch):
    fz = _fake(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    client.put("/api/club/zalo/token", json={"token": "123456789:abcdefghijklmnop"}, headers=h1)
    club = db.query(models.Club).get(world.club1.id); db.refresh(club)
    ok = {"X-Bot-Api-Secret-Token": club.zalo_webhook_secret}
    client.post(f"/api/zalo/webhook/{world.club1.id}", json=_ev("zgr-A", "@Bot a"), headers=ok)
    client.post(f"/api/zalo/webhook/{world.club1.id}", json=_ev("zgr-B", "@Bot b"), headers=ok)
    d = date(2026, 11, 10)
    _clock(monkeypatch, d, "06:00")
    # khoản thu hôm nay, giờ đẩy 07:00 → 06:00 không gửi; 07:00 gửi 2 nhóm; 07:15 skipped
    client.post("/api/announcements", json={"kind": "fee", "title": "Hội phí", "fee_type_id": world.fee1.id, "recurrence": "monthly",
                                            "day_of_month": d.day, "lead_days": 0, "push_telegram": True, "push_time": "07:00"}, headers=h1)
    assert fz.sent("zgr-A") == []
    cron = lambda: client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"}).json()["zalo"]
    assert cron()["sent"] == 0
    _clock(monkeypatch, d, "07:00")
    assert cron() == {"sent": 2, "skipped": 0, "errors": 0, "disabled": 0}
    txt = fz.sent("zgr-A")[0]
    assert txt.startswith("🔔 *Hội phí*") and "Chưa đóng (8 người):" in txt and "M Member 1" in txt
    assert all("(" not in l for l in txt.splitlines() if l.startswith("  • "))   # không kèm SĐT trong nhóm
    _clock(monkeypatch, d, "07:15")
    assert cron() == {"sent": 0, "skipped": 2, "errors": 0, "disabled": 0}
    # tắt hiện tên → tin không liệt kê tên (ngày khác)
    client.put("/api/club/zalo/settings", json={"show_unpaid_names": False}, headers=h1)
    client.post("/api/announcements", json={"title": "Tối nay", "recurrence": "none", "start_date": d.isoformat(), "lead_days": 0,
                                            "push_telegram": True, "push_time": "07:00", "body": "x" * 2500}, headers=h1)   # tạo sau giờ đẩy → gửi ngay, cắt 2 phần
    assert len(fz.sent("zgr-A")) == 4 and all(len(t) <= 2000 for t in fz.sent("zgr-A"))   # phí + (đầu tin, 2000 x, 500 x)
    db.query(models.ZaloPushLog).delete(); db.commit()
    fz.calls.clear()
    assert cron()["sent"] == 4
    fee_txt = [t for t in fz.sent("zgr-B") if t.startswith("🔔")][0]
    assert "Chưa đóng (" not in fee_txt and "Còn 8 người chưa đóng" in fee_txt
    # nhóm B hỏng (410) → tắt, báo disabled; nhóm A vẫn nhận
    db.query(models.ZaloPushLog).delete(); db.commit(); fz.calls.clear()
    fz.fail_chat["zgr-B"] = 410
    r = cron()
    assert r["sent"] == 2 and r["errors"] == 1 and r["disabled"] == 1
    gB = db.query(models.ZaloGroup).filter_by(chat_id="zgr-B").first(); db.refresh(gB)
    assert gB.enabled is False and gB.last_error.startswith("410")
    # Gửi ngay thủ công: có nhóm Zalo là đủ kênh, không chống trùng
    aid = db.query(models.Announcement).filter_by(title="Hội phí").first().id
    fz.calls.clear()
    r = client.post(f"/api/announcements/{aid}/push", headers=h1).json()
    assert r["zalo_sent"] == 1 and r["sent"] == 0 and fz.sent("zgr-A")
    # xoá quy tắc dọn log zalo
    client.delete(f"/api/announcements/{aid}", headers=h1)
    assert db.query(models.ZaloPushLog).filter_by(announcement_id=aid).count() == 0
