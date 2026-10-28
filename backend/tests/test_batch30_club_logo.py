"""Logo CLB (2026-10-28): upload chuẩn hoá PNG ≤512px bằng Pillow, lưu trong DB, phục vụ public kèm cache theo hash, xoá, phân quyền."""
import io

from PIL import Image

import models
from conftest import World


def _img_bytes(w, h, fmt="JPEG", color=(200, 30, 30)):
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def test_upload_normalizes_and_serves_with_cache(client, world, db):
    h1 = World.headers(world.admin1, world.club1)
    r = client.post("/api/club/logo", files={"file": ("logo.jpg", _img_bytes(1600, 800), "image/jpeg")}, headers=h1)
    assert r.status_code == 200, r.text
    src = r.json()["logo_src"]
    assert src and src.startswith(f"/api/public/club-logo/{world.club1.id}?v=")
    db.refresh(world.club1)
    img = Image.open(io.BytesIO(world.club1.logo_png))
    assert img.format == "PNG" and img.size == (512, 256)   # thu nhỏ giữ tỉ lệ, cạnh dài 512
    # Public: đúng hash → cache dài; không có v → no-cache; 404 CLB chưa có logo
    g = client.get(src)
    assert g.status_code == 200 and g.headers["content-type"] == "image/png"
    assert "max-age=31536000" in g.headers["cache-control"] and g.headers["etag"] == f'"{world.club1.logo_hash}"'
    assert client.get(f"/api/public/club-logo/{world.club1.id}").headers["cache-control"] == "no-cache"
    assert client.get(f"/api/public/club-logo/{world.club2.id}").status_code == 404
    # logo_src chảy vào /api/my-memberships (admin) và meta public
    mine = client.get("/api/my-memberships", headers=h1).json()
    assert next(m for m in mine if m["club_id"] == world.club1.id)["club"]["logo_src"] == src
    assert client.get(f"/api/public/report/{world.token1.slug}").json()["club_logo_src"] == src
    # Đổi logo → hash đổi
    r2 = client.post("/api/club/logo", files={"file": ("l.png", _img_bytes(100, 100, "PNG", (0, 0, 255)), "image/png")}, headers=h1)
    assert r2.json()["logo_src"] != src
    db.refresh(world.club1)
    assert Image.open(io.BytesIO(world.club1.logo_png)).size == (100, 100)   # ảnh nhỏ không phóng to


def test_upload_validation_and_permissions(client, world):
    h1, hv, h2 = World.headers(world.admin1, world.club1), World.headers(world.viewer1, world.club1), World.headers(world.admin2, world.club2)
    assert client.post("/api/club/logo", files={"file": ("x.jpg", _img_bytes(50, 50), "image/jpeg")}, headers=hv).status_code == 403
    assert client.post("/api/club/logo", files={"file": ("x.txt", b"hello", "text/plain")}, headers=h1).status_code == 400
    assert client.post("/api/club/logo", files={"file": ("x.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml")}, headers=h1).status_code == 400
    assert client.post("/api/club/logo", files={"file": ("e.png", b"", "image/png")}, headers=h1).status_code == 400
    # admin CLB 2 upload → chỉ CLB 2 có logo
    assert client.post("/api/club/logo", files={"file": ("x.jpg", _img_bytes(50, 50), "image/jpeg")}, headers=h2).status_code == 200
    assert client.get(f"/api/public/club-logo/{world.club1.id}").status_code == 404
    assert client.get(f"/api/public/club-logo/{world.club2.id}").status_code == 200


def test_delete_logo(client, world):
    h1, hv = World.headers(world.admin1, world.club1), World.headers(world.viewer1, world.club1)
    client.post("/api/club/logo", files={"file": ("x.jpg", _img_bytes(50, 50), "image/jpeg")}, headers=h1)
    assert client.delete("/api/club/logo", headers=hv).status_code == 403
    r = client.delete("/api/club/logo", headers=h1)
    assert r.status_code == 200 and r.json()["logo_src"] is None
    assert client.get(f"/api/public/club-logo/{world.club1.id}").status_code == 404


def test_apple_touch_icon_from_logo_and_manifest_id(client, world, db):
    h1 = World.headers(world.admin1, world.club1)
    assert client.get(f"/api/public/club-logo/{world.club1.id}/apple-touch-icon.png").status_code == 404
    client.put("/api/club/appearance", json={"brand_color": "#EC671C"}, headers=h1)
    client.post("/api/club/logo", files={"file": ("l.png", _img_bytes(400, 200, "PNG", (0, 0, 255)), "image/png")}, headers=h1)
    meta = client.get(f"/api/public/report/{world.token1.slug}").json()
    assert meta["club_apple_icon_src"].startswith(f"/api/public/club-logo/{world.club1.id}/apple-touch-icon.png?v=") and "&c=EC671C" in meta["club_apple_icon_src"]
    r = client.get(meta["club_apple_icon_src"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and "immutable" in r.headers["cache-control"]
    img = Image.open(io.BytesIO(r.content))
    assert img.size == (180, 180) and img.mode == "RGB"
    assert img.getpixel((2, 2)) == (236, 103, 28)        # góc: nền màu thương hiệu
    assert img.getpixel((20, 20)) == (255, 255, 255)     # ô trắng bên trong
    assert img.getpixel((90, 90)) == (0, 0, 255)         # logo ở giữa
    m = client.get(f"/api/public/report/{world.token1.slug}/manifest.webmanifest").json()
    assert m["id"] == f"/public/report/{world.token1.slug}" and m["icons"][0]["src"].startswith("/api/public/club-logo/")
