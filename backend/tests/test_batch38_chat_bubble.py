"""Nút trò chuyện nổi (2026-10-29): GET chat/unread — đếm sau after_id, bỏ tin của mình/đã thu hồi, trần 99, tin mới nhất để xem trước,
lần đầu (không after_id) chỉ trả last_id, đánh dấu đang mở app, PIN áp dụng."""
import main
import models


def _join(client, slug, name):
    r = client.post(f"/api/public/report/{slug}/chat/join", json={"display_name": name})
    assert r.status_code == 200, r.text
    return r.json()["device_id"], r.json()["participant"]["id"]


def _h(dev):
    return {"X-Chat-Device": dev}


def test_unread_count_latest_and_first_visit(client, world, db, monkeypatch):
    monkeypatch.setattr(main, "CHAT_MIN_INTERVAL_S", 0)
    slug = world.token1.slug
    url = f"/api/public/report/{slug}/chat/unread"
    dev_a, id_a = _join(client, slug, "An")
    dev_b, id_b = _join(client, slug, "Bình")
    # chưa có tin: lần đầu → count 0, last_id 0
    assert client.get(url, headers=_h(dev_a)).json() == {"count": 0, "last_id": 0, "latest": None}
    m1 = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "Chào"}, headers=_h(dev_a)).json()
    m2 = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "Tối nay đánh nhé " * 10}, headers=_h(dev_b)).json()
    m3 = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "sẽ thu hồi"}, headers=_h(dev_b)).json()
    client.post(f"/api/public/report/{slug}/chat/messages/{m3['id']}/delete", headers=_h(dev_b))
    # lần đầu (không after_id) → chỉ mốc
    r = client.get(url, headers=_h(dev_a)).json()
    assert r == {"count": 0, "last_id": m3["id"], "latest": None}
    # A đọc tới 0 → chỉ tính tin của B chưa thu hồi (m2); latest cắt 120 ký tự
    r = client.get(url, params={"after_id": 0}, headers=_h(dev_a)).json()
    assert r["count"] == 1 and r["last_id"] == m3["id"] and r["latest"]["id"] == m2["id"] and r["latest"]["name"] == "Bình" and len(r["latest"]["body"]) == 120
    # B đọc tới 0 → tin của A (m1)
    assert client.get(url, params={"after_id": 0}, headers=_h(dev_b)).json()["count"] == 1
    # đã đọc hết → 0
    assert client.get(url, params={"after_id": m3["id"]}, headers=_h(dev_a)).json()["count"] == 0
    # thiết bị chưa vào (không header) → tính mọi tin chưa thu hồi
    assert client.get(url, params={"after_id": 0}).json()["count"] == 2
    # bình chọn → latest "Bình chọn: câu hỏi"; tin quản trị tên "Ban quản trị"
    client.post(f"/api/public/report/{slug}/chat/polls", json={"question": "Sân nào?", "options": ["A", "B"]}, headers=_h(dev_b))
    r = client.get(url, params={"after_id": m3["id"]}, headers=_h(dev_a)).json()
    assert r["count"] == 1 and r["latest"]["kind"] == "poll" and r["latest"]["body"] == "Bình chọn: Sân nào?"
    # gọi unread → đánh dấu đang mở app (không đẩy tin thường tới A)
    assert id_a in main._CHAT_ACTIVE


def test_unread_cap_99_and_pin_gate(client, world, db):
    slug = world.token1.slug
    url = f"/api/public/report/{slug}/chat/unread"
    dev_a, id_a = _join(client, slug, "An")
    db.add_all([models.ChatMessage(club_id=world.club1.id, participant_id=id_a, kind="text", body=f"t{i}") for i in range(120)])
    db.commit()
    assert client.get(url, params={"after_id": 0}).json()["count"] == 99
    assert client.get(url, params={"after_id": 0}, headers=_h(dev_a)).json()["count"] == 0   # toàn tin của mình
    client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": "1234"}, headers=__import__("conftest").World.headers(world.admin1, world.club1))
    assert client.get(url, params={"after_id": 0}).status_code == 401
    assert client.get(url, params={"after_id": 0}, headers={"X-Public-Pin": "1234"}).status_code == 200
