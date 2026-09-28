"""Thứ tự danh sách thành viên: Hoạt động → Tạm nghỉ → Đình chỉ, trong nhóm theo mã TV tăng dần."""
from conftest import World

STATUS_RANK = {"active": 0, "inactive": 1, "suspended": 2}


def _h(world):
    return World.headers(world.admin1, world.club1)


def _create(client, world, code, status, name="X"):
    r = client.post("/api/members", json={"full_name": f"{name} {code}", "member_code": code, "status": status}, headers=_h(world))
    assert r.status_code == 201, r.text
    return r.json()


def _assert_ordered(rows):
    ranks = [STATUS_RANK[m["status"]] for m in rows]
    assert ranks == sorted(ranks), [(m["member_code"], m["status"]) for m in rows]
    for a, b in zip(rows, rows[1:]):
        if a["status"] == b["status"]:
            assert (a["member_code"] or "") <= (b["member_code"] or ""), (a["member_code"], b["member_code"])


def test_members_sorted_by_status_then_code(client, world):
    # Tạo xen kẽ trạng thái với mã cố ý ngược thứ tự để chắc chắn không phải sort theo id
    _create(client, world, "TV0900", "suspended")
    _create(client, world, "TV0500", "inactive")
    _create(client, world, "TV0300", "active")
    _create(client, world, "TV0100", "active")
    _create(client, world, "TV0400", "inactive")
    _create(client, world, "TV0800", "suspended")

    rows = client.get("/api/members", headers=_h(world)).json()
    assert len(rows) >= 6
    _assert_ordered(rows)

    codes_active = [m["member_code"] for m in rows if m["status"] == "active"]
    assert codes_active.index("TV0100") < codes_active.index("TV0300")
    # Nhóm active (kể cả members có sẵn trong fixture) phải nằm trọn trước nhóm inactive/suspended
    first_non_active = next(i for i, m in enumerate(rows) if m["status"] != "active")
    assert all(m["status"] == "active" for m in rows[:first_non_active])
    assert [m["member_code"] for m in rows if m["status"] == "inactive"] == ["TV0400", "TV0500"]
    assert [m["member_code"] for m in rows if m["status"] == "suspended"] == ["TV0800", "TV0900"]


def test_members_status_filter_keeps_code_order(client, world):
    _create(client, world, "TV0700", "inactive")
    _create(client, world, "TV0600", "inactive")
    rows = client.get("/api/members", params={"status": "inactive"}, headers=_h(world)).json()
    assert [m["member_code"] for m in rows] == ["TV0600", "TV0700"]


def test_members_export_uses_same_order(client, world):
    _create(client, world, "TV0950", "suspended")
    _create(client, world, "TV0050", "active")
    r = client.get("/api/members/export", headers=_h(world))
    assert r.status_code == 200
    import io, openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
    codes = [row[0] for row in ws.iter_rows(min_row=2, values_only=True) if row and row[0]]
    # mã TV ở cột đầu — active TV0050 phải xuất hiện trước suspended TV0950
    assert codes.index("TV0050") < codes.index("TV0950")
