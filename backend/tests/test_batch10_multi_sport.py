"""Hệ thống đa CLB, đa bộ môn: trang đăng nhập không hiện CLB đầu tiên; môn thể thao phải nhập rõ."""
import models
from auth import hash_password
from conftest import World


def _superuser(world):
    su = models.User(username="su", full_name="Super", password_hash=hash_password("pw"),
                     role=models.UserRole.admin, is_superuser=True)
    world.db.add(su); world.db.commit(); world.db.refresh(su)
    return World.headers(su, world.club1)


def test_club_status_only_reports_initialized(client, world):
    """Endpoint public của trang đăng nhập không được lộ tên/bộ môn/địa chỉ của CLB đầu tiên."""
    r = client.get("/api/club/status")
    assert r.status_code == 200
    assert r.json() == {"initialized": True}


def test_club_status_uninitialized_when_no_club(client):
    assert client.get("/api/club/status").json() == {"initialized": False}


def test_admin_create_club_requires_explicit_sport(client, world):
    h = _superuser(world)
    # Thiếu môn thể thao → 400, không được ngầm gán "Pickleball" từ default của model
    r = client.post("/api/admin/clubs", json={"name": "CLB Tennis Sài Gòn"}, headers=h)
    assert r.status_code == 400, r.text
    r = client.post("/api/admin/clubs", json={"name": "CLB Tennis Sài Gòn", "sport": "  "}, headers=h)
    assert r.status_code == 400
    r = client.post("/api/admin/clubs", json={"sport": "Tennis"}, headers=h)
    assert r.status_code == 400  # thiếu tên → 400 rõ ràng thay vì IntegrityError 500
    r = client.post("/api/admin/clubs", json={"name": "CLB Tennis Sài Gòn", "sport": "Tennis"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["sport"] == "Tennis"
    # Không phải superuser → vẫn 403 như trước
    r = client.post("/api/admin/clubs", json={"name": "X", "sport": "Y"},
                    headers=World.headers(world.admin1, world.club1))
    assert r.status_code == 403


def test_first_time_setup_requires_sport(client):
    base = {"club_name": "CLB Cầu Lông ABC", "admin_username": "root1",
            "admin_password": "pw123456", "admin_full_name": "Root"}
    assert client.post("/api/club/setup", json=base).status_code == 422
    r = client.post("/api/club/setup", json={**base, "sport": "Cầu lông"})
    assert r.status_code == 200, r.text
