"""Trò chuyện trang public (2026-10-28, đợt 1): vào bằng biệt danh theo thiết bị, tin nhắn + trả lời + nhắc tên, bình chọn kiểu Zalo,
giới hạn tần suất, khoá kênh / tắt tiếng, PIN áp dụng, đẩy Web Push khi có bình chọn mới và khi được nhắc tên."""
from datetime import datetime, timedelta

import main
import models
from conftest import World


def _join(client, slug, name):
    r = client.post(f"/api/public/report/{slug}/chat/join", json={"display_name": name})
    assert r.status_code == 200, r.text
    return r.json()["device_id"], r.json()["participant"]["id"]


def _h(dev):
    return {"X-Chat-Device": dev}


def _fake_push(monkeypatch):
    sent = []
    monkeypatch.setattr(main._wp, "send_push", lambda sub, payload, ttl=86400: (sent.append((sub["endpoint"], payload)), "ok")[1])
    return sent


def test_join_rename_and_message_flow(client, world, db):
    slug = world.token1.slug
    dev_a, id_a = _join(client, slug, "  An   Nguyễn ")
    dev_b, id_b = _join(client, slug, "Bình")
    assert client.get(f"/api/public/report/{slug}/chat/me", headers=_h(dev_a)).json()["participant"]["display_name"] == "An Nguyễn"
    assert client.get(f"/api/public/report/{slug}/chat/me").json()["participant"] is None
    # đổi tên giữ cùng device
    r = client.post(f"/api/public/report/{slug}/chat/join", json={"display_name": "An"}, headers=_h(dev_a))
    assert r.json()["device_id"] == dev_a and r.json()["participant"]["id"] == id_a
    # chưa vào → không gửi được
    assert client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "hi"}).status_code == 401
    m1 = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "Chào cả nhà"}, headers=_h(dev_a))
    assert m1.status_code == 200 and m1.json()["mine"] is True and m1.json()["name"] == "An"
    # gửi quá nhanh → 429
    assert client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "nữa"}, headers=_h(dev_a)).status_code == 429
    # trả lời + nhắc tên (B)
    r = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "@An ok nhé", "reply_to_id": m1.json()["id"], "mention_ids": [id_a, id_b, 9999]}, headers=_h(dev_b))
    assert r.status_code == 200 and r.json()["reply_to"]["body"] == "Chào cả nhà" and r.json()["mention_ids"] == [id_a]
    # liệt kê: mặc định 50 mới nhất, có pinned list; after_id chỉ tin mới
    lst = client.get(f"/api/public/report/{slug}/chat/messages", headers=_h(dev_a)).json()
    assert [m["name"] for m in lst["messages"]] == ["An", "Bình"] and lst["pinned"] == [] and lst["me_id"] == id_a
    assert lst["messages"][0]["mine"] is True and lst["messages"][1]["mine"] is False
    inc = client.get(f"/api/public/report/{slug}/chat/messages", params={"after_id": m1.json()["id"]}).json()
    assert len(inc["messages"]) == 1 and inc["pinned"] is None
    # thu hồi tin của mình; của người khác → 404
    assert client.post(f"/api/public/report/{slug}/chat/messages/{m1.json()['id']}/delete", headers=_h(dev_b)).status_code == 404
    assert client.post(f"/api/public/report/{slug}/chat/messages/{m1.json()['id']}/delete", headers=_h(dev_a)).json()["ok"] is True
    first = client.get(f"/api/public/report/{slug}/chat/messages").json()["messages"][0]
    assert first["deleted"] is True and first["body"] is None
    # participants cho gợi ý @
    assert [p["display_name"] for p in client.get(f"/api/public/report/{slug}/chat/participants").json()] == ["An", "Bình"]
    # CLB khác không thấy gì; device của CLB 1 không dùng được ở CLB 2
    tok2 = models.PublicReportToken(token="tok-club2", slug="clubtwo-xyz", club_id=world.club2.id, label="p2", is_active=True)
    db.add(tok2); db.commit()
    assert client.get("/api/public/report/clubtwo-xyz/chat/messages").json()["messages"] == []
    assert client.post("/api/public/report/clubtwo-xyz/chat/messages", json={"body": "x"}, headers=_h(dev_a)).status_code == 401


def test_poll_create_vote_add_option_close_and_push(client, world, db, monkeypatch):
    sent = _fake_push(monkeypatch)
    monkeypatch.setattr(main, "CHAT_MIN_INTERVAL_S", 0)   # test gửi liên tiếp, bỏ giãn 2s
    slug = world.token1.slug
    dev_a, id_a = _join(client, slug, "An")
    dev_b, id_b = _join(client, slug, "Bình")
    sub = lambda n, dev=None: client.post(f"/api/public/report/{slug}/push/subscribe", json={"endpoint": f"https://push.example.com/sub/{n}xxxxxxxxxxxxxx", "keys": {"p256dh": "BPkeypkeypkeypkey", "auth": "authauth"}}, headers=_h(dev) if dev else {})
    assert sub("a", dev_a).status_code == 200 and sub("b", dev_b).status_code == 200 and sub("c").status_code == 200
    # validate
    assert client.post(f"/api/public/report/{slug}/chat/polls", json={"question": "Sân?", "options": ["A"]}, headers=_h(dev_a)).status_code == 422
    assert client.post(f"/api/public/report/{slug}/chat/polls", json={"question": "Sân?", "options": ["A", "a"]}, headers=_h(dev_a)).status_code == 422
    r = client.post(f"/api/public/report/{slug}/chat/polls", json={"question": "Tối nay đánh sân nào?", "options": ["Sân A", "Sân B"], "multi": False, "allow_add": True}, headers=_h(dev_a))
    assert r.status_code == 200, r.text
    msg = r.json(); poll = msg["poll"]; pid = poll["id"]
    assert msg["kind"] == "poll" and poll["total_voters"] == 0 and len(poll["options"]) == 2
    # đẩy bình chọn mới tới mọi thiết bị trừ người tạo (b + c = 2)
    assert msg["pushed"] == 2 and all("Bình chọn mới" in p["title"] for _, p in sent) and sorted(e[-20:-14] for e, _ in sent) == ["/sub/b", "/sub/c"]
    sent.clear()
    opts = [o["id"] for o in poll["options"]]
    # chọn một: 2 lựa chọn → 400; hợp lệ → đếm; đổi phiếu → thay thế; rút phiếu
    assert client.post(f"/api/public/report/{slug}/chat/polls/{pid}/vote", json={"option_ids": opts}, headers=_h(dev_a)).status_code == 400
    r = client.post(f"/api/public/report/{slug}/chat/polls/{pid}/vote", json={"option_ids": [opts[0]]}, headers=_h(dev_a)).json()
    assert r["options"][0]["count"] == 1 and r["my_votes"] == [opts[0]] and r["options"][0]["voters"] == ["An"]
    client.post(f"/api/public/report/{slug}/chat/polls/{pid}/vote", json={"option_ids": [opts[1]]}, headers=_h(dev_b))
    r = client.post(f"/api/public/report/{slug}/chat/polls/{pid}/vote", json={"option_ids": [opts[1]]}, headers=_h(dev_a)).json()
    assert [o["count"] for o in r["options"]] == [0, 2] and r["total_voters"] == 2
    r = client.post(f"/api/public/report/{slug}/chat/polls/{pid}/vote", json={"option_ids": []}, headers=_h(dev_a)).json()
    assert r["total_voters"] == 1 and r["my_votes"] == []
    # thêm lựa chọn (allow_add) + trùng → 400
    r = client.post(f"/api/public/report/{slug}/chat/polls/{pid}/options", json={"text": "Sân C"}, headers=_h(dev_b)).json()
    assert [o["text"] for o in r["options"]] == ["Sân A", "Sân B", "Sân C"]
    assert client.post(f"/api/public/report/{slug}/chat/polls/{pid}/options", json={"text": "sân c"}, headers=_h(dev_b)).status_code == 400
    # đóng: chỉ người tạo; sau đóng không bỏ phiếu
    assert client.post(f"/api/public/report/{slug}/chat/polls/{pid}/close", headers=_h(dev_b)).status_code == 403
    assert client.post(f"/api/public/report/{slug}/chat/polls/{pid}/close", headers=_h(dev_a)).json()["closed"] is True
    assert client.post(f"/api/public/report/{slug}/chat/polls/{pid}/vote", json={"option_ids": [opts[0]]}, headers=_h(dev_b)).status_code == 400
    # bình chọn ẩn danh + nhiều lựa chọn + hết hạn
    r = client.post(f"/api/public/report/{slug}/chat/polls", json={"question": "Mang gì?", "options": ["Nước", "Bóng", "Vợt"], "multi": True, "anonymous": True,
                                                                    "closes_at": (datetime.utcnow() + timedelta(hours=10)).isoformat()}, headers=_h(dev_b))
    p2 = r.json()["poll"]; o2 = [o["id"] for o in p2["options"]]
    r = client.post(f"/api/public/report/{slug}/chat/polls/{p2['id']}/vote", json={"option_ids": [o2[0], o2[2]]}, headers=_h(dev_a)).json()
    assert sorted(r["my_votes"]) == sorted([o2[0], o2[2]]) and r["options"][0]["voters"] == [] and r["closed"] is False
    pl = db.query(models.ChatPoll).get(p2["id"]); pl.closes_at = datetime(2020, 1, 1); db.commit()
    assert client.get(f"/api/public/report/{slug}/chat/messages").json()["messages"][-1]["poll"]["closed"] is True
    # nhắc tên → đẩy tới thiết bị của người được nhắc (a), không tới người khác
    r = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "@An đi không?", "mention_ids": [id_a]}, headers=_h(dev_b))
    assert r.json()["pushed"] == 1
    mention = [p for e, p in sent if e.endswith("/sub/axxxxxxxxxxxxxx") and "nhắc đến bạn" in p["title"]]
    assert len(mention) == 1   # a nhận nhắc tên riêng; tin thường chỉ đẩy nền tới c (a đã nhận, b là người gửi)
    assert [e[-15:-14] for e, p in sent if p["tag"].startswith("chat-new-")] == ["c"]


def test_lock_mute_and_pin_gate(client, world, db):
    slug = world.token1.slug
    dev_a, id_a = _join(client, slug, "An")
    world.club1.chat_locked = True; db.commit()
    assert client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "x"}, headers=_h(dev_a)).status_code == 403
    assert client.get(f"/api/public/report/{slug}/chat/messages").json()["locked"] is True
    world.club1.chat_locked = False
    db.query(models.ChatParticipant).get(id_a).muted = True; db.commit()
    assert client.post(f"/api/public/report/{slug}/chat/polls", json={"question": "abc?", "options": ["1", "2"]}, headers=_h(dev_a)).status_code == 403
    # PIN áp dụng cho trò chuyện
    client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": "1234"}, headers=World.headers(world.admin1, world.club1))
    assert client.get(f"/api/public/report/{slug}/chat/messages").status_code == 401
    assert client.get(f"/api/public/report/{slug}/chat/messages", headers={"X-Public-Pin": "1234"}).status_code == 200
