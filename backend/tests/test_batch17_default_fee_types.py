"""Đợt 17: CLB mới được tạo sẵn 7 danh mục khoản mặc định (cả wizard khởi tạo lần đầu lẫn trang quản trị)."""
from decimal import Decimal

import main
import models
from auth import hash_password
from conftest import World

EXPECTED = {
    ("Liên hoan", "expense", Decimal("0"), False),
    ("Đồ ăn/uống", "expense", Decimal("0"), False),
    ("Thuê sân", "expense", Decimal("0"), True),
    ("Tổ chức sự kiện", "expense", Decimal("0"), False),
    ("Chi phí tham gia giải", "income", Decimal("0"), False),
    ("Quỹ CLB hàng tháng", "income", Decimal("0"), True),
    ("Xé vé - Giao lưu", "income", Decimal("0"), False),
}


def _rows(db, club_id):
    return {
        (ft.name, ft.type.value, Decimal(ft.default_amount or 0), bool(ft.is_recurring))
        for ft in db.query(models.FeeType).filter(models.FeeType.club_id == club_id).all()
    }


def _superuser(world):
    su = models.User(username="su", full_name="Super", password_hash=hash_password("pw"),
                     role=models.UserRole.admin, is_superuser=True)
    world.db.add(su); world.db.commit(); world.db.refresh(su)
    return su


def test_first_time_setup_creates_default_fee_types(client, db):
    r = client.post("/api/club/setup", json={
        "club_name": "CLB Mới", "sport": "Pickleball", "admin_username": "root1",
        "admin_password": "pw123456", "admin_full_name": "Root"})
    assert r.status_code == 200, r.text
    club = db.query(models.Club).first()
    rows = _rows(db, club.id)
    assert rows == EXPECTED and len(rows) == 7
    # thứ tự tạo đúng như bảng yêu cầu (id tăng dần), không bật nhắc phí
    names = [ft.name for ft in db.query(models.FeeType).filter(models.FeeType.club_id == club.id)
             .order_by(models.FeeType.id).all()]
    assert names == [n for n, *_ in main.DEFAULT_FEE_TYPES]
    assert not any(ft.remind_enabled for ft in db.query(models.FeeType).all())
    # Quản trị CLB (tài khoản thành viên có membership — superuser không vào chế độ CLB) thấy đủ 7 danh mục qua API
    ca = models.User(username="ca", full_name="CA", password_hash=hash_password("pw"),
                     role=models.UserRole.member, is_superuser=False)
    db.add(ca); db.flush()
    db.add(models.ClubMembership(user_id=ca.id, club_id=club.id, role=models.UserRole.admin,
                                 can_view=True, can_create=True, can_edit=True, can_delete=True))
    db.commit()
    r2 = client.get("/api/fee-types", headers=World.headers(ca, club))
    assert r2.status_code == 200, r2.text
    assert len(r2.json()) == 7
    assert {(x["name"], x["type"], bool(x["is_recurring"])) for x in r2.json()} == {(n, t, rc) for n, t, _, rc in EXPECTED}


def test_admin_create_club_gets_defaults_only_for_that_club(client, world, db):
    su = _superuser(world)
    h = World.headers(su, world.club1)
    before_club1 = _rows(db, world.club1.id)
    r = client.post("/api/admin/clubs", json={"name": "CLB Tennis Sài Gòn", "sport": "Tennis"}, headers=h)
    assert r.status_code == 200, r.text
    new_id = r.json()["id"]
    assert _rows(db, new_id) == EXPECTED
    assert _rows(db, world.club1.id) == before_club1          # CLB cũ không bị thêm
    assert _rows(db, world.club2.id) == {("Phí tháng", "income", Decimal("100000"), False)}
    # Xoá CLB mới → danh mục mặc định của nó cũng bị dọn
    assert client.delete(f"/api/admin/clubs/{new_id}", headers=h).status_code == 200
    assert _rows(db, new_id) == set()


def test_default_fee_types_helper_is_idempotent(world, db):
    cid = world.club1.id
    assert len(_rows(db, cid)) == 1                              # "Phí tháng" có sẵn từ fixture
    assert main._create_default_fee_types(db, cid) == 7
    db.commit()
    assert len(_rows(db, cid)) == 8
    assert main._create_default_fee_types(db, cid) == 0         # gọi lại không nhân đôi
    # trùng tên không phân biệt hoa thường/khoảng trắng
    db.add(models.FeeType(club_id=world.club2.id, name="  thuê sân ", type=models.FeeTypeCategory.expense))
    db.commit()
    assert main._create_default_fee_types(db, world.club2.id) == 6
