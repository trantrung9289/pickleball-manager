"""Báo cáo định kỳ đợt 2 (2026-10-30): Đóng góp thành viên + Theo dõi phí theo khoảng ngày tuỳ ý — số liệu, ẩn tên, cắt danh sách, khoản đã xoá,
kỳ rỗng, ràng buộc khoản thu (đúng CLB, chỉ khoản thu, bắt buộc với Theo dõi phí), chặn xoá khoản đang dùng, gửi qua cron/Web Push."""
from datetime import date

import main
import models
import report_notify as rn
from conftest import World
from test_batch42_push_history import _setup, _clock


def _tx(db, club, fee, amount, d, member=None, player=None):
    db.add(models.Transaction(club_id=club.id, fee_type_id=fee.id, type="income", amount=amount, transaction_date=d,
                              member_id=member.id if member else None, player_id=player.id if player else None, payment_method="Tiền mặt"))


def _seed(db, world):
    """Tháng 10/2026 CLB 1 (7 thành viên đang hoạt động, M8 đã nghỉ). Phí tháng: M1 500.000 (2 lần), M2 400.000, khách 250.000; M3 đóng NGOÀI kỳ;
    Quỹ giải: M4 150.000. CLB 2 có giao dịch cùng kỳ không được tính."""
    fee_q = models.FeeType(club_id=world.club1.id, name="Quỹ giải", type="income", default_amount=0)
    exp = models.FeeType(club_id=world.club1.id, name="Thuê sân", type="expense", default_amount=0)
    db.add_all([fee_q, exp]); db.flush()
    world.members1[7].status = "inactive"
    m = world.members1
    _tx(db, world.club1, world.fee1, 300000, date(2026, 10, 3), m[0])
    _tx(db, world.club1, world.fee1, 200000, date(2026, 10, 20), m[0])
    _tx(db, world.club1, world.fee1, 400000, date(2026, 10, 10), m[1])
    _tx(db, world.club1, world.fee1, 100000, date(2026, 9, 30), m[2])                       # ngoài kỳ
    _tx(db, world.club1, world.fee1, 250000, date(2026, 10, 12), None, world.guest1)
    _tx(db, world.club1, fee_q, 150000, date(2026, 10, 15), m[3])
    _tx(db, world.club2, world.fee2, 999000, date(2026, 10, 5), world.members2[0])          # CLB khác
    db.commit()
    return fee_q, exp


OCT = (date(2026, 10, 1), date(2026, 10, 31))


def test_contributions_numbers_filter_hide_cap_and_empty(client, world, db, monkeypatch):
    fee_q, _ = _seed(db, world)
    d = rn.build_report(db, world.club1.id, "contributions", *OCT)
    assert [(r["name"], r["is_guest"], r["count"], r["amount"]) for r in d["contributors"]] == \
        [("M Member 1", False, 2, 500000), ("M Member 2", False, 1, 400000), ("Guest One", True, 1, 250000), ("M Member 4", False, 1, 150000)]
    assert (d["count"], d["contrib_members"], d["contrib_guests"], d["contrib_total"], d["contrib_count"]) == (4, 3, 1, 1300000, 5)
    item = {"title": "Đóng góp tháng", "report_range": "last_month", "announcement_id": 1}
    t = rn.render_text(d, item, "CLB Test")
    for line in ("Đóng góp thành viên · Tháng trước", "Kỳ: 01/10/2026 – 31/10/2026", "Số người đóng góp: 4 (3 thành viên, 1 khách mời)",
                 "Tổng đóng góp: 1.300.000 ₫ (5 giao dịch)", "Đóng góp nhiều nhất:", "  1. M Member 1: 500.000 ₫ (2)", "  3. Guest One (khách): 250.000 ₫ (1)"):
        assert line in t, line
    # lọc một khoản: chỉ Phí tháng
    d = rn.build_report(db, world.club1.id, "contributions", *OCT, fee_type_id=world.fee1.id)
    assert (d["count"], d["contrib_total"]) == (3, 1150000) and d["fee_name"] == "Phí tháng"
    assert "Khoản thu: Phí tháng" in rn.render_text(d, item, "C")
    d = rn.build_report(db, world.club1.id, "contributions", *OCT, fee_type_id=fee_q.id)
    assert [r["name"] for r in d["contributors"]] == ["M Member 4"]
    # ẩn tên: còn số liệu tổng, không còn tên
    d = rn.build_report(db, world.club1.id, "contributions", *OCT, hide_names=True)
    t = rn.render_text(d, item, "C")
    assert "Số người đóng góp: 4" in t and "Tổng đóng góp: 1.300.000 ₫" in t and "M Member" not in t and "Guest One" not in t and "Đóng góp nhiều nhất" not in t
    # cắt danh sách
    monkeypatch.setattr(rn, "MAX_CONTRIBUTORS", 2)
    d = rn.build_report(db, world.club1.id, "contributions", *OCT)
    assert len(d["contributors"]) == 2 and "  … và 2 người nữa" in rn.render_text(d, item, "C")
    # kỳ không có đóng góp, kỳ rỗng, khoản đã xoá
    d = rn.build_report(db, world.club1.id, "contributions", date(2025, 1, 1), date(2025, 1, 31))
    assert "Không có khoản đóng góp nào trong kỳ." in rn.render_text(d, item, "C") and d["count"] == 0
    s, e = rn.resolve_range("this_month", date(2026, 11, 1))
    assert "chưa có ngày nào trọn vẹn" in rn.render_text(rn.build_report(db, world.club1.id, "contributions", s, e), item, "C")
    assert "không còn tồn tại" in rn.render_text(rn.build_report(db, world.club1.id, "contributions", *OCT, fee_type_id=99999), item, "C")


def test_fee_status_numbers_hide_cap_and_edge_cases(client, world, db, monkeypatch):
    _seed(db, world)
    d = rn.build_report(db, world.club1.id, "fee_status", *OCT, fee_type_id=world.fee1.id)
    assert (d["members_total"], d["paid"], d["unpaid"]) == (7, 2, 5)                       # M8 đã nghỉ không tính; M3 đóng ngoài kỳ nên chưa đóng
    assert d["unpaid_names"] == [f"M Member {i}" for i in range(3, 8)]
    assert (d["guest_paid"], d["fee_amount"], d["fee_tx_count"]) == (1, 1150000, 4)
    item = {"title": "Theo dõi phí", "report_range": "last_month", "announcement_id": 1}
    t = rn.render_text(d, item, "CLB Test")
    for line in ("Theo dõi phí · Tháng trước", "Khoản thu: Phí tháng", "Đã đóng: 2/7 thành viên (29%)", "Chưa đóng: 5 người", "  • M Member 3", "  • M Member 7",
                 "Khách mời đã đóng: 1 người", "Đã thu trong kỳ: 1.150.000 ₫ (4 giao dịch)"):
        assert line in t, line
    assert "M Member 8" not in t and "M Member 1" not in t and "M Member 2" not in t         # người đã nghỉ, người đã đóng không có trong danh sách chưa đóng
    # ẩn tên: còn số đếm
    ht = rn.render_text(d, {**item, "hide_names": True}, "C")
    assert "Chưa đóng: 5 người" in ht and "M Member 3" not in ht and "Đã đóng: 2/7" in ht
    # cắt danh sách chưa đóng
    monkeypatch.setattr(rn, "MAX_UNPAID", 3)
    assert "  … và 2 người nữa" in rn.render_text(d, item, "C") and "M Member 6" not in rn.render_text(d, item, "C")
    # tất cả đã đóng: không liệt kê
    for m in world.members1[2:7]:
        _tx(db, world.club1, world.fee1, 1000, date(2026, 10, 25), m)
    db.commit()
    t = rn.render_text(rn.build_report(db, world.club1.id, "fee_status", *OCT, fee_type_id=world.fee1.id), item, "C")
    assert "Đã đóng: 7/7 thành viên (100%)" in t and "Tất cả thành viên đã đóng." in t and "  • " not in t
    # kỳ rỗng / khoản đã xoá / CLB chưa có thành viên hoạt động / không có khoản
    s, e = rn.resolve_range("this_month", date(2026, 11, 1))
    assert "chưa có ngày nào trọn vẹn" in rn.render_text(rn.build_report(db, world.club1.id, "fee_status", s, e, fee_type_id=world.fee1.id), item, "C")
    assert "không còn tồn tại" in rn.render_text(rn.build_report(db, world.club1.id, "fee_status", *OCT, fee_type_id=99999), item, "C")
    assert "không còn tồn tại" in rn.render_text(rn.build_report(db, world.club1.id, "fee_status", *OCT), item, "C")
    # tóm tắt Web Push ≤ 200 ký tự
    title, body = rn.render_web(rn.build_report(db, world.club1.id, "fee_status", *OCT, fee_type_id=world.fee1.id), {"title": "Theo dõi phí"}, "CLB Test")
    assert title == "📊 Theo dõi phí — CLB Test" and body == "01/10/2026 – 31/10/2026: Phí tháng, đã đóng 7/7, chưa đóng 0" and len(body) <= 200
    title, body = rn.render_web(rn.build_report(db, world.club1.id, "contributions", *OCT), {"title": "Đóng góp"}, "C")
    assert "8 người đóng góp, tổng 1.305.000 ₫" in body                                          # 7 thành viên (có M4 đã đóng sẵn) + 1 khách; thêm 5 lần 1.000


def test_validation_fee_type_rules_delete_guard_and_names(client, world, db):
    fee_q, exp = _seed(db, world)
    h1 = World.headers(world.admin1, world.club1)
    base = {"kind": "report", "title": "BC", "recurrence": "monthly", "day_of_month": 1, "push_telegram": True, "push_time": "08:00", "report_range": "last_month"}
    post = lambda **kw: client.post("/api/announcements", json={**base, **kw}, headers=h1)
    assert post(report_type="fee_status").status_code == 422                                                   # bắt buộc chọn khoản
    assert post(report_type="fee_status", report_fee_type_id=world.fee2.id).status_code == 400                # khoản của CLB khác
    assert post(report_type="fee_status", report_fee_type_id=exp.id).status_code == 400                       # khoản chi
    r = post(report_type="fee_status", report_fee_type_id=world.fee1.id)
    assert r.status_code == 201 and r.json()["report_fee_type_id"] == world.fee1.id and r.json()["report_fee_type_name"] == "Phí tháng"
    c = post(report_type="contributions")                                                                       # lọc khoản là tuỳ chọn
    assert c.status_code == 201 and c.json()["report_fee_type_id"] is None and c.json()["report_fee_type_name"] is None
    s = post(report_type="summary", report_fee_type_id=world.fee1.id).json()                                   # loại khác bỏ khoản
    assert s["report_fee_type_id"] is None
    # PUT: đổi sang loại không dùng khoản thì xoá khoản; đổi sang fee_status mà thiếu khoản → 422
    aid = r.json()["id"]
    assert client.put(f"/api/announcements/{aid}", json={"report_type": "summary"}, headers=h1).json()["report_fee_type_id"] is None
    assert client.put(f"/api/announcements/{aid}", json={"report_type": "fee_status"}, headers=h1).status_code == 422
    ok = client.put(f"/api/announcements/{aid}", json={"report_type": "fee_status", "report_fee_type_id": fee_q.id}, headers=h1)
    assert ok.status_code == 200 and ok.json()["report_fee_type_name"] == "Quỹ giải"
    assert client.put(f"/api/announcements/{aid}", json={"report_type": "contributions", "report_fee_type_id": world.fee2.id}, headers=h1).status_code == 400
    # chặn xoá khoản đang được báo cáo dùng (khoản chưa có giao dịch nên không bị chặn vì lý do khác)
    spare = models.FeeType(club_id=world.club1.id, name="Khoản rỗng", type="income", default_amount=0)
    db.add(spare); db.commit(); db.refresh(spare)
    rr = post(report_type="contributions", report_fee_type_id=spare.id)
    assert rr.status_code == 201
    d = client.delete(f"/api/fee-types/{spare.id}", headers=h1)
    assert d.status_code == 400 and "quy tắc báo cáo" in d.json()["detail"]
    client.delete(f"/api/announcements/{rr.json()['id']}", headers=h1)
    assert client.delete(f"/api/fee-types/{spare.id}", headers=h1).status_code == 204


def test_cron_sends_new_report_types_and_channels(client, world, db, monkeypatch):
    h1, fz, web, tele = _setup(client, world, db, monkeypatch)
    _seed(db, world)
    _clock(monkeypatch, date(2026, 11, 12), "08:00")
    rep = {"kind": "report", "recurrence": "monthly", "day_of_month": 12, "push_telegram": True, "push_time": "07:00", "report_range": "last_month"}
    client.post("/api/announcements", json={**rep, "title": "Theo dõi phí tháng", "report_type": "fee_status", "report_fee_type_id": world.fee1.id}, headers=h1)
    client.post("/api/announcements", json={**rep, "title": "Đóng góp tháng", "report_type": "contributions", "report_hide_names": True,
                                            "report_channels": ["telegram", "web"]}, headers=h1)
    assert len(tele) == 2
    fee_txt = next(t for _, t in tele if t.startswith("📊 *Theo dõi phí tháng*"))
    assert "Đã đóng: 2/7 thành viên (29%)" in fee_txt and "  • M Member 3" in fee_txt
    con_txt = next(t for _, t in tele if t.startswith("📊 *Đóng góp tháng*"))
    assert "Số người đóng góp: 4" in con_txt and "M Member" not in con_txt                                  # công tắc ẩn tên áp dụng cho Đóng góp
    assert len(web) == 1 and web[0]["title"] == "📊 Đóng góp tháng — Club One" and "4 người đóng góp" in web[0]["body"]
    client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert len(tele) == 2 and len(web) == 1                                                                   # chống trùng
    kinds = sorted((r["title"], r["channel"]) for r in client.get("/api/announcements/push-history", headers=h1).json()["items"])
    assert kinds == [("Theo dõi phí tháng", "telegram"), ("Đóng góp tháng", "telegram"), ("Đóng góp tháng", "web")]
