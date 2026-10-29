"""Đẩy thông báo khi có tin nhắn (2026-10-29, phương án A): nền, trừ người gửi, trừ người đang mở app, giờ yên tĩnh theo thiết bị,
chống dồn 30s, chế độ all|mentions|off tách riêng khỏi nhắc nhở; endpoint tuỳ chọn theo thiết bị."""
from datetime import datetime, timedelta

import main
import models
from conftest import World


def _join(client, slug, name):
    r = client.post(f"/api/public/report/{slug}/chat/join", json={"display_name": name})
    return r.json()["device_id"], r.json()["participant"]["id"]


def _sub(client, slug, n, dev=None):
    body = {"endpoint": f"https://push.example.com/sub/{n}xxxxxxxxxxxxxx", "keys": {"p256dh": "BPkeypkeypkeypkey", "auth": "authauth"}}
    r = client.post(f"/api/public/report/{slug}/push/subscribe", json=body, headers={"X-Chat-Device": dev} if dev else {})
    assert r.status_code == 200
    return body["endpoint"]


def _setup(client, world, monkeypatch, hour=12):
    sent = []
    monkeypatch.setattr(main._wp, "send_push", lambda sub, payload, ttl=86400: (sent.append((sub["endpoint"][-15:-14], payload)), "ok")[1])
    monkeypatch.setattr(main, "CHAT_MIN_INTERVAL_S", 0)
    monkeypatch.setattr(main, "_now_vn", lambda: datetime(2026, 10, 29, hour, 0, 0))
    main._CHAT_ACTIVE.clear()
    slug = world.token1.slug
    dev_a, id_a = _join(client, slug, "An")
    dev_b, id_b = _join(client, slug, "Bình")
    return sent, slug, (dev_a, id_a), (dev_b, id_b)


def test_text_message_pushes_to_all_mode_except_sender_active_and_throttled(client, world, db, monkeypatch):
    sent, slug, (dev_a, id_a), (dev_b, id_b) = _setup(client, world, monkeypatch)
    ea = _sub(client, slug, "a", dev_a); eb = _sub(client, slug, "b", dev_b); ec = _sub(client, slug, "c")   # c: chưa vào chat
    # mặc định all; prefs đọc được
    assert client.get(f"/api/public/report/{slug}/push/prefs", params={"endpoint": ea}).json() == {"chat_mode": "all", "quiet_enabled": True, "quiet_start": 22, "quiet_end": 7}
    # A gửi → B và C nhận (A là người gửi, bị loại); tag chung theo link
    r = client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "Chào"}, headers={"X-Chat-Device": dev_a})
    assert r.status_code == 200
    assert sorted(e for e, _ in sent) == ["b", "c"] and all(p["tag"] == f"chat-new-{slug}" and p["body"] == "An: Chào" for _, p in sent)
    # chống dồn 30s: A gửi tiếp → không ai nhận thêm
    sent.clear()
    client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "nữa"}, headers={"X-Chat-Device": dev_a})
    assert sent == []
    # qua 30s (lùi chat_pushed_at), B đang mở app (vừa tải tin) → chỉ C nhận
    for sb in db.query(models.PushSubscription).all():
        sb.chat_pushed_at = datetime.utcnow() - timedelta(seconds=40)
    db.commit()
    client.get(f"/api/public/report/{slug}/chat/messages", headers={"X-Chat-Device": dev_b})
    client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "ba"}, headers={"X-Chat-Device": dev_a})
    assert [e for e, _ in sent] == ["c"]


def test_modes_quiet_hours_and_mentions(client, world, db, monkeypatch):
    sent, slug, (dev_a, id_a), (dev_b, id_b) = _setup(client, world, monkeypatch, hour=23)   # 23h: trong giờ yên tĩnh mặc định
    ea = _sub(client, slug, "a", dev_a); eb = _sub(client, slug, "b", dev_b); ec = _sub(client, slug, "c")
    # giờ yên tĩnh → tin thường không đẩy; nhắc tên vẫn đẩy
    client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "khuya", "mention_ids": [id_b]}, headers={"X-Chat-Device": dev_a})
    assert [e for e, _ in sent] == ["b"] and "nhắc đến bạn" in sent[0][1]["title"]
    sent.clear()
    # C tắt giờ yên tĩnh → nhận tin thường; B chế độ mentions → không nhận tin thường
    assert client.put(f"/api/public/report/{slug}/push/prefs", json={"endpoint": ec, "quiet_enabled": False}).json()["quiet_enabled"] is False
    assert client.put(f"/api/public/report/{slug}/push/prefs", json={"endpoint": eb, "chat_mode": "mentions", "quiet_enabled": False}).json()["chat_mode"] == "mentions"
    for sb in db.query(models.PushSubscription).all():
        sb.chat_pushed_at = None
    db.commit()
    client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "tin thường"}, headers={"X-Chat-Device": dev_a})
    assert [e for e, _ in sent] == ["c"]
    sent.clear()
    # B chế độ off → không nhận cả nhắc tên lẫn bình chọn; C vẫn nhận bình chọn (bình chọn không theo giờ yên tĩnh)
    client.put(f"/api/public/report/{slug}/push/prefs", json={"endpoint": eb, "chat_mode": "off"})
    client.post(f"/api/public/report/{slug}/chat/messages", json={"body": "@Bình", "mention_ids": [id_b]}, headers={"X-Chat-Device": dev_a})
    r = client.post(f"/api/public/report/{slug}/chat/polls", json={"question": "Đi?", "options": ["Có", "Không"]}, headers={"X-Chat-Device": dev_a})
    assert r.json()["pushed"] == 1 and [e for e, _ in sent] == ["c"]
    # validate + cách ly: endpoint CLB khác → 404; giờ sai → 422
    assert client.put(f"/api/public/report/{slug}/push/prefs", json={"endpoint": "https://push.example.com/sub/zzzzzzzzzzzzzzzz", "chat_mode": "all"}).status_code == 404
    assert client.put(f"/api/public/report/{slug}/push/prefs", json={"endpoint": ea, "quiet_start": 25}).status_code == 422


def test_quiet_hours_helper():
    class S: quiet_enabled = True; quiet_start = 22; quiet_end = 7
    assert main._in_quiet_hours(S(), datetime(2026, 1, 1, 23)) and main._in_quiet_hours(S(), datetime(2026, 1, 1, 3))
    assert not main._in_quiet_hours(S(), datetime(2026, 1, 1, 7)) and not main._in_quiet_hours(S(), datetime(2026, 1, 1, 12))
    S.quiet_start, S.quiet_end = 12, 14
    assert main._in_quiet_hours(S(), datetime(2026, 1, 1, 13)) and not main._in_quiet_hours(S(), datetime(2026, 1, 1, 15))
    S.quiet_enabled = False
    assert not main._in_quiet_hours(S(), datetime(2026, 1, 1, 13))
