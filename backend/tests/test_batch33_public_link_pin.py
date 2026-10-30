"""Link công khai (2026-10-28): mỗi CLB 1 link; mã PIN 4/6 số qua header X-Public-Pin; manifest không cần PIN; Web Push không bị ảnh hưởng."""
import models
from conftest import World


def test_one_public_link_per_club(client, world, db):
    h1 = World.headers(world.admin1, world.club1)
    # CLB 1 đã có token1 (conftest) → tạo thêm bị chặn; xoá rồi tạo được; CLB 2 chưa có → tạo được
    r = client.post("/api/report-links", json={"label": "Thứ hai"}, headers=h1)
    assert r.status_code == 400 and "một link" in r.json()["detail"]
    assert client.delete(f"/api/report-links/{world.token1.id}", headers=h1).status_code == 200
    r = client.post("/api/report-links", json={"label": "Mới"}, headers=h1)
    assert r.status_code == 200 and r.json()["has_pin"] is False
    assert client.post("/api/report-links", json={"label": "CLB2"}, headers=World.headers(world.admin2, world.club2)).status_code == 200


def test_pin_gates_public_endpoints_but_not_manifest(client, world, db):
    h1, hv = World.headers(world.admin1, world.club1), World.headers(world.viewer1, world.club1)
    slug = world.token1.slug
    assert client.get(f"/api/public/report/{slug}").status_code == 200   # chưa PIN → vào tự do
    # Đặt PIN: quyền sửa; định dạng 4 hoặc 6 số
    assert client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": "1234"}, headers=hv).status_code == 403
    assert client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": "12345"}, headers=h1).status_code == 422
    assert client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": "12ab"}, headers=h1).status_code == 422
    r = client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": "1234"}, headers=h1)
    assert r.status_code == 200 and r.json()["has_pin"] is True
    assert client.get("/api/report-links", headers=h1).json()[0]["has_pin"] is True
    # Không PIN → 401 pin_required; sai → 401 pin_invalid; đúng → 200 kèm has_pin
    r = client.get(f"/api/public/report/{slug}")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "pin_required" and r.json()["detail"]["pin_length"] == 4
    r = client.get(f"/api/public/report/{slug}", headers={"X-Public-Pin": "0000"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "pin_invalid"
    r = client.get(f"/api/public/report/{slug}", headers={"X-Public-Pin": "1234"})
    assert r.status_code == 200 and r.json()["has_pin"] is True
    # Mọi endpoint public khác cũng bị chặn: announcements, summary, push subscribe
    assert client.get(f"/api/public/report/{slug}/announcements").status_code == 401
    assert client.get(f"/api/public/report/{slug}/summary", params={"year": 2026}).status_code == 401
    sub = {"endpoint": "https://push.example.com/sub/abc123def456", "keys": {"p256dh": "BPkeypkeypkeypkey", "auth": "authauth"}}
    assert client.post(f"/api/public/report/{slug}/push/subscribe", json=sub).status_code == 401
    assert client.post(f"/api/public/report/{slug}/push/subscribe", json=sub, headers={"X-Public-Pin": "1234"}).status_code == 200
    # Manifest (Safari tải không kèm header) và logo không cần PIN
    assert client.get(f"/api/public/report/{slug}/manifest.webmanifest").status_code == 200
    # Bỏ PIN → vào tự do lại
    assert client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": None}, headers=h1).json()["has_pin"] is False
    assert client.get(f"/api/public/report/{slug}").status_code == 200
    # PIN 6 số, và admin CLB khác không đặt được
    r = client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": "123456"}, headers=h1)
    assert r.status_code == 200 and r.json()["pin_length"] == 6
    assert client.get(f"/api/public/report/{slug}").json()["detail"]["pin_length"] == 6
    assert client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": "1234"}, headers=World.headers(world.admin2, world.club2)).status_code == 404


def test_web_push_cron_still_sends_with_pin(client, world, db, monkeypatch):
    """Đẩy từ server tới thiết bị không đi qua PIN: đăng ký trước khi đặt PIN vẫn nhận."""
    import main
    sent = []
    monkeypatch.setattr(main._wp, "send_push", lambda sub, payload, ttl=86400: (sent.append(payload), "ok")[1])
    monkeypatch.setattr(main, "_INTERNAL_SECRET", "s3cr3t")
    h1 = World.headers(world.admin1, world.club1)
    from datetime import date
    today = date.fromisoformat(client.get("/api/announcements/feed", headers=h1).json()["today"])
    client.post("/api/announcements", json={"title": "Hôm nay", "recurrence": "none", "start_date": today.isoformat(), "lead_days": 0, "push_telegram": True, "push_time": "00:00"}, headers=h1)
    sub = {"endpoint": "https://push.example.com/sub/abc123def456", "keys": {"p256dh": "BPkeypkeypkeypkey", "auth": "authauth"}}
    assert client.post(f"/api/public/report/{world.token1.slug}/push/subscribe", json=sub).status_code == 200
    client.put(f"/api/report-links/{world.token1.id}/pin", json={"pin": "9999"}, headers=h1)
    r = client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert r.json()["web_push"]["sent"] == 1 and sent[0]["url"] == f"/public/report/{world.token1.slug}"
