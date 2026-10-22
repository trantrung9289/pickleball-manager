"""Đợt 22 (2026-10-22): thành viên nhập Excel để trống cột Mã TV → trước đây lưu NULL → GET /api/members 500
(ResponseValidationError). Nay: nhập Excel tự cấp mã; khởi động backfill mã thiếu; MemberOut chịu được NULL."""
import io

import openpyxl

import main
import models
from tests.conftest import World


def _h(world):
    return World.headers(world.admin1, world.club1)


def _xlsx(rows):
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(["Mã TV", "Họ và tên", "Ngày sinh", "SĐT", "Email", "Ngày gia nhập", "Trạng thái", "Hạng", "Địa chỉ", "Ghi chú", "Giới tính"])
    for r in rows:
        ws.append(r)
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return buf


def test_import_excel_without_codes_assigns_unique_codes(client, world, db):
    h = _h(world)
    before = {m.member_code for m in db.query(models.Member).filter(models.Member.club_id == world.club1.id)}
    f = _xlsx([[None, "Nhập Một", None, "0900000001", None, None, "active", "B", None, None, "Nam"],
               ["", "Nhập Hai", None, None, None, None, None, None, None, None, "Nữ"],
               ["TV9999", "Nhập Ba", None, None, None, None, None, None, None, None, None]])
    r = client.post("/api/members/import", files={"file": ("tv.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 3 and not r.json().get("errors")
    news = db.query(models.Member).filter(models.Member.full_name.in_(["Nhập Một", "Nhập Hai", "Nhập Ba"])).all()
    codes = {m.full_name: m.member_code for m in news}
    assert codes["Nhập Ba"] == "TV9999"
    assert codes["Nhập Một"] and codes["Nhập Hai"] and codes["Nhập Một"] != codes["Nhập Hai"]
    assert codes["Nhập Một"].startswith("TV") and codes["Nhập Một"] not in before
    r = client.get("/api/members", headers=h)
    assert r.status_code == 200 and all(x["member_code"] for x in r.json())


def test_startup_backfill_fills_null_codes_and_list_survives(client, world, db):
    h = _h(world)
    m1 = models.Member(club_id=world.club1.id, member_code=None, full_name="Không mã 1", status=models.MemberStatus.active)
    m2 = models.Member(club_id=world.club1.id, member_code="", full_name="Không mã 2", status=models.MemberStatus.active)
    db.add_all([m1, m2]); db.commit()
    # MemberOut chịu được NULL → danh sách không 500 ngay cả trước backfill
    r = client.get("/api/members", headers=h)
    assert r.status_code == 200
    n = main._backfill_member_codes()
    assert n == 2
    db.refresh(m1); db.refresh(m2)
    assert m1.member_code != m2.member_code and m1.member_code.startswith("TV") and m2.member_code.startswith("TV")
    assert main._backfill_member_codes() == 0   # idempotent
