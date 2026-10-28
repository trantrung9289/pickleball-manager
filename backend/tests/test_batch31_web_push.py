"""Web Push cho người xem public (2026-10-28): cấu hình VAPID, đăng ký/huỷ theo link public, manifest theo CLB,
cron gửi đúng ngày + chống trùng + dọn subscription chết, "Gửi ngay" không chống trùng."""
from datetime import date, timedelta

import main
import models
from conftest import World

SUB = {"endpoint": "https://push.example.com/sub/abc123def456", "keys": {"p256dh": "BPkeypkeypkeypkey", "auth": "authauth"}, "user_agent": "UA"}
SUB2 = {"endpoint": "https://push.example.com/sub/second000000", "keys": {"p256dh": "BPkeypkeypkeypkey2", "auth": "authauth2"}}


def _fake_push(monkeypatch, results=None):
    """Thay webpush_service.send_push: ghi lại (endpoint, payload), trả theo bảng results[endpoint] hoặc 'ok'."""
    sent = []

    def fake(sub, payload, ttl=86400):
        sent.append((sub["endpoint"], payload))
        return (results or {}).get(sub["endpoint"], "ok")
    monkeypatch.setattr(main._wp, "send_push", fake)
    monkeypatch.setattr(main, "_INTERNAL_SECRET", "s3cr3t")
    return sent


def _today(client, world):
    return date.fromisoformat(client.get("/api/announcements/feed", headers=World.headers(world.admin1, world.club1)).json()["today"])


def test_config_subscribe_unsubscribe_and_manifest(client, world, db):
    cfg = client.get("/api/public/push/config").json()
    assert cfg["enabled"] is True and cfg["public_key"] and len(cfg["public_key"]) == 87   # khoá tạm dev/test
    slug = world.token1.slug
    r = client.post(f"/api/public/report/{slug}/push/subscribe", json=SUB)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    sub = db.query(models.PushSubscription).get(sid)
    assert sub.club_id == world.club1.id and sub.token_id == world.token1.id and sub.user_agent == "UA"
    # Đăng ký lại cùng endpoint → upsert, không tạo dòng mới; endpoint không https → 422; slug sai → 404
    assert client.post(f"/api/public/report/{slug}/push/subscribe", json=SUB).json()["id"] == sid
    assert db.query(models.PushSubscription).count() == 1
    assert client.post(f"/api/public/report/{slug}/push/subscribe", json={**SUB, "endpoint": "http://x.example.com/aaaaaaaaaaaaaaa"}).status_code == 422
    assert client.post("/api/public/report/no-such/push/subscribe", json=SUB).status_code == 404
    # Manifest theo CLB: start_url = trang public, icon mặc định khi chưa có logo, theme = màu thương hiệu
    world.club1.brand_color = "#EC671C"; db.commit()
    m = client.get(f"/api/public/report/{slug}/manifest.webmanifest")
    assert m.status_code == 200 and m.headers["content-type"].startswith("application/manifest+json")
    mj = m.json()
    assert mj["start_url"] == f"/public/report/{slug}" and mj["display"] == "standalone" and mj["theme_color"] == "#EC671C"
    assert mj["name"] == "Club One" and mj["icons"][0]["src"] == "/icon-192.png"
    # Huỷ → xoá
    assert client.post(f"/api/public/report/{slug}/push/unsubscribe", json={"endpoint": SUB["endpoint"]}).json()["ok"] is True
    assert db.query(models.PushSubscription).count() == 0


def test_cron_sends_web_push_once_and_removes_gone(client, world, db, monkeypatch):
    sent = _fake_push(monkeypatch, results={SUB2["endpoint"]: "gone"})
    h1 = World.headers(world.admin1, world.club1)
    today = _today(client, world)
    slug = world.token1.slug
    client.post(f"/api/public/report/{slug}/push/subscribe", json=SUB)
    client.post(f"/api/public/report/{slug}/push/subscribe", json=SUB2)
    # A: hôm nay là ngày đầu cửa sổ; B: không push_telegram → không gửi; E: phí hôm nay
    client.post("/api/announcements", json={"title": "A", "recurrence": "none", "start_date": (today + timedelta(days=2)).isoformat(), "lead_days": 2, "push_telegram": True, "start_time": "19:00", "body": "Sân A"}, headers=h1)
    client.post("/api/announcements", json={"title": "B", "recurrence": "none", "start_date": today.isoformat(), "lead_days": 0, "push_telegram": False}, headers=h1)
    client.post("/api/announcements", json={"kind": "fee", "title": "E", "fee_type_id": world.fee1.id, "recurrence": "monthly", "day_of_month": today.day, "lead_days": 0, "push_telegram": True}, headers=h1)

    r = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r.status_code == 200, r.text
    wp = r.json()["web_push"]
    assert wp["sent"] == 2 and wp["removed"] == 1 and wp["skipped"] == 0   # SUB nhận A + E; SUB2 "gone" ngay tin đầu → xoá
    assert r.json()["sent"] == 0   # không có Telegram (chưa liên kết) nhưng Web Push vẫn chạy
    payloads = {p["title"].split(" — ")[0]: p for e, p in sent if e == SUB["endpoint"]}
    assert set(payloads) == {"A", "E"}
    assert payloads["A"]["url"] == f"/public/report/{slug}" and "19:00" in payloads["A"]["body"] and "Sân A" in payloads["A"]["body"]
    assert "Còn 8 người chưa đóng" in payloads["E"]["body"] and payloads["E"]["tag"].startswith("ann-")
    assert db.query(models.PushSubscription).count() == 1 and db.query(models.WebPushLog).count() == 2
    # Gọi lại trong ngày → bỏ qua
    sent.clear()
    r2 = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r2.json()["web_push"] == {"sent": 0, "skipped": 2, "removed": 0, "errors": 0} and sent == []


def test_cron_counts_errors_and_removes_after_5_failures(client, world, db, monkeypatch):
    sent = _fake_push(monkeypatch, results={SUB["endpoint"]: "error"})
    h1 = World.headers(world.admin1, world.club1)
    today = _today(client, world)
    client.post(f"/api/public/report/{world.token1.slug}/push/subscribe", json=SUB)
    for i in range(6):   # 6 thông báo hôm nay → lỗi liên tiếp, tới lần 5 thì xoá subscription
        client.post("/api/announcements", json={"title": f"T{i}", "recurrence": "none", "start_date": today.isoformat(), "lead_days": 0, "push_telegram": True}, headers=h1)
    r = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r.json()["web_push"]["errors"] == 5 and r.json()["web_push"]["removed"] == 1 and len(sent) == 5
    assert db.query(models.PushSubscription).count() == 0


def test_manual_push_uses_web_push_without_telegram(client, world, db, monkeypatch):
    sent = _fake_push(monkeypatch)
    h1 = World.headers(world.admin1, world.club1)
    today = _today(client, world)
    aid = client.post("/api/announcements", json={"title": "Sinh hoạt", "recurrence": "weekly", "weekdays": [today.weekday()], "lead_days": 1}, headers=h1).json()["id"]
    # Chưa kênh nào → 400
    assert client.post(f"/api/announcements/{aid}/push", headers=h1).status_code == 400
    client.post(f"/api/public/report/{world.token1.slug}/push/subscribe", json=SUB)
    r = client.post(f"/api/announcements/{aid}/push", headers=h1)
    assert r.status_code == 200, r.text
    assert r.json()["web_push_sent"] == 1 and r.json()["sent"] == 0 and r.json()["date"] == today.isoformat()
    # Gửi tay không chống trùng
    assert client.post(f"/api/announcements/{aid}/push", headers=h1).json()["web_push_sent"] == 1 and len(sent) == 2
    assert db.query(models.WebPushLog).count() == 0


def test_public_page_html_has_club_manifest_and_icon_server_side(client, world, db):
    """Safari đọc manifest lúc tải trang → HTML trang public phải chèn sẵn manifest theo CLB (không dựa vào JS đổi href)."""
    import pytest
    if not main.STATIC_DIR.exists() or not (main.STATIC_DIR / "index.html").exists():
        pytest.skip("chưa build frontend")
    slug = world.token1.slug
    html = client.get(f"/public/report/{slug}").text
    assert f'href="/api/public/report/{slug}/manifest.webmanifest"' in html
    assert 'content="Club One"' in html and 'href="/apple-touch-icon.png"' in html   # chưa có logo → icon chung
    # Có logo + màu → icon iPhone theo CLB, theme-color theo màu
    import io
    from PIL import Image
    buf = io.BytesIO(); Image.new("RGB", (64, 64), (1, 2, 3)).save(buf, format="PNG")
    h1 = World.headers(world.admin1, world.club1)
    client.put("/api/club/appearance", json={"brand_color": "#EC671C"}, headers=h1)
    client.post("/api/club/logo", files={"file": ("l.png", buf.getvalue(), "image/png")}, headers=h1)
    html = client.get(f"/public/report/{slug}").text
    assert f'/api/public/club-logo/{world.club1.id}/apple-touch-icon.png?v=' in html and 'content="#EC671C"' in html
    # Slug sai hoặc đường dẫn khác → index mặc định
    assert 'href="/manifest.webmanifest"' in client.get("/public/report/no-such-slug").text
    assert 'href="/manifest.webmanifest"' in client.get("/").text
