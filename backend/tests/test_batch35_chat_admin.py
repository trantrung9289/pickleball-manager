"""Trò chuyện — quản trị (đợt 2): xem, ghim, xoá tin, tắt tiếng, khoá kênh, xoá theo khoảng ngày (xoá cứng kèm bình chọn), admin tạo bình chọn."""
from datetime import datetime, timedelta

import main
import models
from conftest import World


def _join(client, slug, name):
    r = client.post(f"/api/public/report/{slug}/chat/join", json={"display_name": name})
    return r.json()["device_id"], r.json()["participant"]["id"]


def test_admin_moderation_flow(client, world, db, monkeypatch):
    monkeypatch.setattr(main, "CHAT_MIN_INTERVAL_S", 0)
    slug = world.token1.slug
    h1, hv, h2 = World.headers(world.admin1, world.club1), World.headers(world.viewer1, world.club1), World.headers(world.admin2, world.club2)
    dev_a, id_a = _join(client, slug, "An")
    H = {"X-Chat-Device": dev_a}
    m1 = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "Tin 1"}, headers=H).json()["id"]
    m2 = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "Tin 2", "reply_to_id": m1}, headers=H).json()["id"]
    # xem (viewer được), tổng số
    r = client.get("/api/chat/messages", headers=hv)
    assert r.status_code == 200 and r.json()["total"] == 2 and r.json()["participants"] == 1
    assert client.get("/api/chat/messages", headers=h2).json()["total"] == 0   # cách ly CLB
    # ghim: viewer 403; admin toggle; public thấy trong pinned
    assert client.patch(f"/api/chat/messages/{m1}/pin", headers=hv).status_code == 403
    assert client.patch(f"/api/chat/messages/{m1}/pin", headers=h1).json()["pinned"] is True
    assert [p["id"] for p in client.get(f"/api/public/report/{slug}/chat/messages").json()["pinned"]] == [m1]
    assert client.patch(f"/api/chat/messages/{m1}/pin", headers=h2).status_code == 404
    # admin xoá tin → xoá mềm + bỏ ghim
    assert client.delete(f"/api/chat/messages/{m1}", headers=h1).json()["ok"] is True
    pub = client.get(f"/api/public/report/{slug}/chat/messages").json()
    assert pub["pinned"] == [] and pub["messages"][0]["deleted"] is True
    # tắt tiếng → public gửi 403; bật lại
    assert client.patch(f"/api/chat/participants/{id_a}/mute", headers=h1).json()["muted"] is True
    assert client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "x"}, headers=H).status_code == 403
    assert client.get("/api/chat/participants", headers=h1).json()[0]["muted"] is True
    assert client.patch(f"/api/chat/participants/{id_a}/mute", headers=h1).json()["muted"] is False
    # khoá kênh
    assert client.put("/api/chat/settings", json={"locked": True}, headers=h1).json()["locked"] is True
    assert client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "x"}, headers=H).status_code == 403
    assert client.get(f"/api/public/report/{slug}/chat/me", headers=H).json()["locked"] is True
    client.put("/api/chat/settings", json={"locked": False}, headers=h1)
    # admin tạo bình chọn → tên "Ban quản trị", ghim sẵn; admin đóng
    r = client.post("/api/chat/polls", json={"question": "Sân nào?", "options": ["A", "B"]}, headers=h1)
    assert r.status_code == 200 and r.json()["name"] == "Ban quản trị" and r.json()["pinned"] is True
    pid = r.json()["poll"]["id"]
    assert client.get(f"/api/public/report/{slug}/chat/messages").json()["messages"][-1]["poll"]["creator_name"] == "Ban quản trị"
    assert client.patch(f"/api/chat/polls/{pid}/close", headers=h1).json()["closed"] is True
    assert client.post("/api/chat/polls", json={"question": "Sân nào?", "options": ["A", "B"]}, headers=hv).status_code == 403


def test_admin_purge_by_date_range(client, world, db, monkeypatch):
    monkeypatch.setattr(main, "CHAT_MIN_INTERVAL_S", 0)
    slug = world.token1.slug
    h1, hv = World.headers(world.admin1, world.club1), World.headers(world.viewer1, world.club1)
    dev_a, id_a = _join(client, slug, "An")
    H = {"X-Chat-Device": dev_a}
    old_ids = [client.post(f"/api/public/report/{slug}/chat/messages", json={"body": f"cũ {i}"}, headers=H).json()["id"] for i in range(3)]
    poll_msg = client.post(f"/api/public/report/{slug}/chat/polls", json={"question": "Cũ?", "options": ["1", "2"]}, headers=H).json()
    client.post(f"/api/public/report/{slug}/chat/polls/{poll_msg['poll']['id']}/vote", json={"option_ids": [poll_msg["poll"]["options"][0]["id"]]}, headers=H)
    new_id = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "mới, trả lời cũ", "reply_to_id": old_ids[0]}, headers=H).json()["id"]
    # đẩy tin cũ + bình chọn về 40 ngày trước
    for m in db.query(models.ChatMessage).filter(models.ChatMessage.id.in_(old_ids + [poll_msg["id"]])).all():
        m.created_at = datetime.utcnow() - timedelta(days=40)
    db.commit()
    cutoff = (datetime.utcnow() - timedelta(days=30)).date()
    assert client.post("/api/chat/purge", json={"before": cutoff.isoformat()}, headers=hv).status_code == 403
    r = client.post("/api/chat/purge", json={"before": cutoff.isoformat()}, headers=h1)
    assert r.status_code == 200 and r.json()["deleted"] == 4
    assert db.query(models.ChatPoll).count() == 0 and db.query(models.ChatVote).count() == 0
    left = client.get("/api/chat/messages", headers=h1).json()["messages"]
    assert [m["id"] for m in left] == [new_id] and left[0]["reply_to_id"] is None
    # khoảng ngày không có gì → 0; CLB khác không bị ảnh hưởng (không có dữ liệu để xoá)
    assert client.post("/api/chat/purge", json={"before": "2020-01-31", "after": "2020-01-01"}, headers=h1).json()["deleted"] == 0
