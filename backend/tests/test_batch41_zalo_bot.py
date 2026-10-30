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


def _ev(chat_id, text, chat_type="GROUP", name="Trần Trung", sender_id="u1"):
    return {"event_name": "message.text.received", "message": {"chat": {"id": chat_id, "chat_type": chat_type}, "text": text,
                                                               "from": {"id": sender_id, "display_name": name, "is_bot": False}}}


def _hook(client, club, chat_id, text="@Bot hi", sender_id="u1", name="Trần Trung", **kw):
    """Gửi sự kiện webhook đúng secret của CLB; trả JSON."""
    return client.post(f"/api/zalo/webhook/{club.id}", json=_ev(chat_id, text, sender_id=sender_id, name=name, **kw),
                       headers={"X-Bot-Api-Secret-Token": club.zalo_webhook_secret}).json()


def _groups(client, h):
    return {g["chat_id"]: g for g in client.get("/api/club/zalo", headers=h).json()["groups"]}


def _approve_all(client, h):
    for g in _groups(client, h).values():
        client.post(f"/api/club/zalo/groups/{g['id']}/approve", headers=h)


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
        and st["groups"][0]["first_text"] == "@Bot CLB hello" and st["groups"][0]["added_by_id"] == "u1"
    # nhóm mới LUÔN chờ duyệt, tắt sẵn, im lặng (không phản hồi vào nhóm lạ); chưa bật/gửi thử được
    assert st["groups"][0]["status"] == "pending" and st["groups"][0]["enabled"] is False and st["pending_count"] == 1
    assert fz.sent("zgr-abc") == []
    gid = st["groups"][0]["id"]
    assert client.patch(f"/api/club/zalo/groups/{gid}", json={"enabled": True}, headers=h1).status_code == 400
    assert client.post(f"/api/club/zalo/groups/{gid}/test", headers=h1).status_code == 400
    st = client.post(f"/api/club/zalo/groups/{gid}/approve", headers=h1).json()
    assert st["groups"][0]["status"] == "approved" and st["groups"][0]["enabled"] is True and st["pending_count"] == 0
    # đặt nhãn, tắt/bật, gửi thử
    r = client.patch(f"/api/club/zalo/groups/{gid}", json={"label": "Nhóm CLB chính", "enabled": False}, headers=h1).json()
    assert r["groups"][0]["label"] == "Nhóm CLB chính" and r["groups"][0]["enabled"] is False
    client.patch(f"/api/club/zalo/groups/{gid}", json={"enabled": True}, headers=h1)
    assert client.post(f"/api/club/zalo/groups/{gid}/test", headers=h1).json()["ok"] is True and "Tin thử" in fz.sent("zgr-abc")[-1]
    # CLB khác không thấy, không sửa được
    h2 = World.headers(world.admin2, world.club2)
    assert client.get("/api/club/zalo", headers=h2).json()["groups"] == []
    assert client.patch(f"/api/club/zalo/groups/{gid}", json={"enabled": False}, headers=h2).status_code == 404
    for path in (f"approve", "reject", "trust"):
        assert client.post(f"/api/club/zalo/groups/{gid}/{path}", headers=h2).status_code == 404
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
    assert r["events"] == 1 and r["groups_seen"] == 1 and r["groups"][0]["chat_id"] == "zgr-poll" and r["groups"][0]["status"] == "pending"
    assert client.post("/api/club/zalo/poll", headers=h1).json()["events"] == 0   # 408 → không có tin


def test_cron_sends_to_groups_with_dedupe_chunks_and_410(client, world, db, monkeypatch):
    fz = _fake(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    client.put("/api/club/zalo/token", json={"token": "123456789:abcdefghijklmnop"}, headers=h1)
    club = db.query(models.Club).get(world.club1.id); db.refresh(club)
    ok = {"X-Bot-Api-Secret-Token": club.zalo_webhook_secret}
    client.post(f"/api/zalo/webhook/{world.club1.id}", json=_ev("zgr-A", "@Bot a"), headers=ok)
    client.post(f"/api/zalo/webhook/{world.club1.id}", json=_ev("zgr-B", "@Bot b"), headers=ok)
    client.post(f"/api/zalo/webhook/{world.club1.id}", json=_ev("zgr-P", "@Bot p", sender_id="u9"), headers=ok)   # nhóm lạ, KHÔNG duyệt
    for chat in ("zgr-A", "zgr-B"):
        client.post(f"/api/club/zalo/groups/{_groups(client, h1)[chat]['id']}/approve", headers=h1)
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
    assert fz.sent("zgr-P") == []   # nhóm chờ duyệt không nhận thông báo (kể cả tin nhắc phí có tên người chưa đóng)
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


def test_pending_allowlist_block_and_trust(client, world, db, monkeypatch):
    """Duyệt nhóm: mọi thành viên nhóm nhắc được bot → nhóm mới chờ duyệt; người được phép tự duyệt; từ chối = chặn; ngắt kết nối xoá danh sách."""
    fz = _fake(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    client.put("/api/club/zalo/token", json={"token": "123456789:abcdefghijklmnop"}, headers=h1)
    club = db.query(models.Club).get(world.club1.id); db.refresh(club)
    # 1) chủ nhiệm (u1) nhắc trong nhóm A → chờ duyệt; "Duyệt và tin cậy" → duyệt + thêm u1 vào danh sách
    _hook(client, club, "zgr-A", "@Bot a", sender_id="u1", name="Trần Trung")
    ga = _groups(client, h1)["zgr-A"]
    assert ga["status"] == "pending" and fz.sent("zgr-A") == []
    st = client.post(f"/api/club/zalo/groups/{ga['id']}/approve?trust=true", headers=h1).json()
    assert st["groups"][0]["status"] == "approved" and [(a["sender_id"], a["display_name"]) for a in st["allowed"]] == [("u1", "Trần Trung")]
    client.post(f"/api/club/zalo/groups/{ga['id']}/trust", headers=h1)   # tin cậy lặp lại không nhân đôi
    assert len(client.get("/api/club/zalo", headers=h1).json()["allowed"]) == 1
    # 2) u1 thêm nhóm B → tự duyệt + bot báo trong nhóm; u2 (lạ) thêm nhóm C → chờ duyệt, im lặng
    _hook(client, club, "zgr-B", "@Bot b", sender_id="u1")
    gb = _groups(client, h1)["zgr-B"]
    assert gb["status"] == "approved" and gb["enabled"] is True and "đã được thêm" in fz.sent("zgr-B")[0]
    _hook(client, club, "zgr-C", "@Bot c", sender_id="u2", name="Người lạ")
    gc = _groups(client, h1)["zgr-C"]
    assert gc["status"] == "pending" and gc["enabled"] is False and fz.sent("zgr-C") == []
    # 3) nhóm C đang chờ: u2 nhắc lại không duyệt; u1 nhắc trong nhóm C thì được duyệt
    _hook(client, club, "zgr-C", "lại", sender_id="u2")
    assert _groups(client, h1)["zgr-C"]["status"] == "pending"
    _hook(client, club, "zgr-C", "mình đây", sender_id="u1")
    gc = _groups(client, h1)["zgr-C"]
    assert gc["status"] == "approved" and gc["enabled"] is True
    # 4) từ chối nhóm D → chặn: sự kiện sau bị bỏ qua (trả blocked, không đổi trạng thái); bỏ chặn = xoá dòng → nhắc lại lên hàng chờ
    _hook(client, club, "zgr-D", "@Bot d", sender_id="u3")
    gd = _groups(client, h1)["zgr-D"]
    st = client.post(f"/api/club/zalo/groups/{gd['id']}/reject", headers=h1).json()
    assert _groups(client, h1)["zgr-D"]["status"] == "blocked" and st["pending_count"] == 0
    assert _hook(client, club, "zgr-D", "lại", sender_id="u1")["handled"] == "blocked"   # kể cả người được phép
    assert _groups(client, h1)["zgr-D"]["status"] == "blocked" and fz.sent("zgr-D") == []
    assert client.patch(f"/api/club/zalo/groups/{gd['id']}", json={"enabled": True}, headers=h1).status_code == 400
    client.delete(f"/api/club/zalo/groups/{gd['id']}", headers=h1)
    _hook(client, club, "zgr-D", "@Bot d", sender_id="u3")
    assert _groups(client, h1)["zgr-D"]["status"] == "pending"
    # 5) nhóm không có mã người gửi không tin cậy được; quyền: viewer không thao tác, CLB khác không thấy
    gid_no_sender = db.query(models.ZaloGroup).filter_by(chat_id="zgr-D").first()
    gid_no_sender.added_by_id = None; db.commit()
    assert client.post(f"/api/club/zalo/groups/{gid_no_sender.id}/trust", headers=h1).status_code == 400
    hv = World.headers(world.viewer1, world.club1)
    allowed_id = client.get("/api/club/zalo", headers=h1).json()["allowed"][0]["id"]
    assert client.post(f"/api/club/zalo/groups/{ga['id']}/approve", headers=hv).status_code == 403
    assert client.delete(f"/api/club/zalo/allowed/{allowed_id}", headers=hv).status_code == 403
    h2 = World.headers(world.admin2, world.club2)
    assert client.delete(f"/api/club/zalo/allowed/{allowed_id}", headers=h2).status_code == 404
    assert client.get("/api/club/zalo", headers=h2).json()["allowed"] == []
    # 6) xoá người được phép → u1 thêm nhóm mới thì phải chờ duyệt
    assert client.delete(f"/api/club/zalo/allowed/{allowed_id}", headers=h1).json()["allowed"] == []
    _hook(client, club, "zgr-E", "@Bot e", sender_id="u1")
    assert _groups(client, h1)["zgr-E"]["status"] == "pending"
    # 7) ngắt kết nối xoá cả danh sách người được phép
    client.post(f"/api/club/zalo/groups/{_groups(client, h1)['zgr-E']['id']}/approve?trust=true", headers=h1)
    assert len(client.get("/api/club/zalo", headers=h1).json()["allowed"]) == 1
    client.delete("/api/club/zalo/token", headers=h1)
    assert db.query(models.ZaloAllowedSender).count() == 0 and db.query(models.ZaloGroup).count() == 0


def test_legacy_groups_default_approved(client, world, db):
    """Nhóm tạo trước đợt duyệt (cột status mới có default 'approved') vẫn nhận thông báo như cũ."""
    g = models.ZaloGroup(club_id=world.club1.id, chat_id="zgr-old")
    db.add(g); db.commit(); db.refresh(g)
    assert g.status == "approved" and g.enabled is True
