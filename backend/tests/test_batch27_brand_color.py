"""Lớp 1 đổi giao diện (2026-10-26): màu thương hiệu từng CLB (clubs.brand_color)."""
from conftest import World


def test_club_admin_sets_brand_color_for_selected_club_only(client, world):
    h1 = World.headers(world.admin1, world.club1)
    r = client.put("/api/club/appearance", json={"brand_color": "#ec671c"}, headers=h1)
    assert r.status_code == 200 and r.json()["brand_color"] == "#EC671C"
    # /api/my-memberships mang club.brand_color → frontend đọc theo CLB đang chọn
    mine = client.get("/api/my-memberships", headers=h1).json()
    assert next(m for m in mine if m["club_id"] == world.club1.id)["club"]["brand_color"] == "#EC671C"
    # CLB 2 không bị ảnh hưởng
    mine2 = client.get("/api/my-memberships", headers=World.headers(world.admin2, world.club2)).json()
    assert mine2[0]["club"]["brand_color"] is None
    # Sai định dạng → 422; về mặc định bằng null
    assert client.put("/api/club/appearance", json={"brand_color": "orange"}, headers=h1).status_code == 422
    assert client.put("/api/club/appearance", json={"brand_color": None}, headers=h1).json()["brand_color"] is None
    # Quyền xem không đổi được
    assert client.put("/api/club/appearance", json={"brand_color": "#112233"},
                      headers=World.headers(world.viewer1, world.club1)).status_code == 403
