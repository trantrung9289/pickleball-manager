"""Báo cáo định kỳ qua thông báo (2026-10-30): khoảng thời gian tương đối (kết thúc hết hôm qua), số liệu thu chi (tồn đầu/cuối kỳ, theo khoản,
danh sách giao dịch cắt dòng, ẩn tên), chỉ đẩy qua kênh đã chọn (mặc định Telegram), không hiện chuông/public, kỳ rỗng vẫn gửi toàn số 0."""
from datetime import date, datetime

import main
import models
import report_notify as rn
import zalo_bot
from conftest import World
from test_batch42_push_history import _setup, _clock


def _tx(db, club, fee, typ, amount, d, member=None, desc=None):
    db.add(models.Transaction(club_id=club.id, fee_type_id=fee.id, type=typ, amount=amount, transaction_date=d,
                              member_id=member.id if member else None, description=desc, payment_method="Tiền mặt"))


def _seed(db, world):
    """Tháng 10/2026 của CLB 1: thu 800.000 (2), chi 200.000 (2), tồn đầu 800.000; giao dịch ngoài kỳ và của CLB 2 không được tính."""
    exp = models.FeeType(club_id=world.club1.id, name="Thuê sân", type="expense", default_amount=0)
    exp2 = models.FeeType(club_id=world.club2.id, name="Thuê sân", type="expense", default_amount=0)
    db.add_all([exp, exp2]); db.commit()
    m1, m2 = world.members1[0], world.members1[1]
    _tx(db, world.club1, world.fee1, "income", 1000000, date(2026, 9, 20))
    _tx(db, world.club1, exp, "expense", 200000, date(2026, 9, 25))
    _tx(db, world.club1, world.fee1, "income", 300000, date(2026, 10, 2), m1, "Đóng phí T10")
    _tx(db, world.club1, world.fee1, "income", 500000, date(2026, 10, 15), m2)
    _tx(db, world.club1, exp, "expense", 150000, date(2026, 10, 20), None, "Sân 3 tuần 3")
    _tx(db, world.club1, exp, "expense", 50000, date(2026, 10, 31))
    _tx(db, world.club1, world.fee1, "income", 700000, date(2026, 11, 1))          # sau kỳ
    _tx(db, world.club2, world.fee2, "income", 9999999, date(2026, 10, 10))        # CLB khác
    db.commit()
    return exp


def test_validation_and_normalization(client, world):
    h1 = World.headers(world.admin1, world.club1)
    base = {"kind": "report", "title": "Báo cáo tuần", "recurrence": "weekly", "weekdays": [0], "push_telegram": True, "push_time": "08:00",
            "report_type": "summary", "report_range": "last_week"}
    post = lambda **kw: client.post("/api/announcements", json={**base, **kw}, headers=h1)
    assert post(report_type=None).status_code == 422
    assert post(report_range=None).status_code == 422
    assert post(report_range="last_n").status_code == 422                                   # thiếu số ngày
    assert post(report_range="fixed").status_code == 422                                    # thiếu từ/đến
    assert post(report_range="fixed", report_from="2026-10-05", report_to="2026-10-01", recurrence="none", start_date="2026-11-01", weekdays=None).status_code == 422
    assert post(report_range="fixed", report_from="2026-10-01", report_to="2026-10-31").status_code == 422   # fixed + lặp tuần
    assert post(push_channels=["sms"]).status_code == 422
    assert post(report_type="chart").status_code == 422
    assert post(push_time=None).status_code == 422                                          # bật đẩy phải có giờ đẩy
    r = post(lead_days=5, show_public=True, start_time="19:00", remind_before_min=30, fee_type_id=world.fee1.id, repeat_daily=True)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["kind"] == "report" and a["lead_days"] == 0 and a["show_public"] is False and a["start_time"] is None \
        and a["remind_before_min"] is None and a["fee_type_id"] is None and a["repeat_daily"] is False and a["push_channels"] == ["telegram"]
    # PUT cũng chuẩn hoá, kênh được khử trùng + sắp xếp
    r = client.put(f"/api/announcements/{a['id']}", json={"lead_days": 4, "show_public": True, "push_channels": ["zalo", "telegram", "zalo"]}, headers=h1).json()
    assert r["lead_days"] == 0 and r["show_public"] is False and r["push_channels"] == ["telegram", "zalo"]
    # last_n hợp lệ khi có số ngày; fixed hợp lệ khi gửi một lần
    assert post(report_range="last_n", report_range_days=30).status_code == 201
    assert post(report_range="fixed", report_from="2026-10-01", report_to="2026-10-31", recurrence="none", start_date="2026-11-12", weekdays=None).status_code == 201
    # loại thông báo khác không bị ảnh hưởng
    assert client.post("/api/announcements", json={"title": "Sinh hoạt", "recurrence": "weekly", "weekdays": [1], "lead_days": 3}, headers=h1).status_code == 201


def test_report_hidden_from_bell_public_and_preview(client, world, db, monkeypatch):
    h1 = World.headers(world.admin1, world.club1)
    _clock(monkeypatch, date(2026, 11, 12), "08:00")
    r = client.post("/api/announcements", json={"kind": "report", "title": "Báo cáo ẩn", "recurrence": "none", "start_date": "2026-11-12", "push_telegram": False,
                                                "report_type": "summary", "report_range": "yesterday"}, headers=h1)
    assert r.status_code == 201
    assert [a["kind"] for a in client.get("/api/announcements", headers=h1).json()] == ["report"]     # trang quản lý vẫn liệt kê
    for q in ("", "?include_later=true&days=60"):
        assert client.get(f"/api/announcements/feed{q}", headers=h1).json()["items"] == []
    assert client.get(f"/api/public/report/{world.token1.slug}/announcements").json()["items"] == []


def test_build_report_numbers_render_cap_and_hide_names(client, world, db):
    _seed(db, world)
    start, end = rn.resolve_range("last_month", date(2026, 11, 12))
    d = rn.build_report(db, world.club1.id, "summary", start, end)
    assert (d["opening"], d["income"], d["expense"], d["closing"], d["count"]) == (800000, 800000, 200000, 1400000, 4)
    assert [(b["name"], b["count"], b["amount"]) for b in d["income_breakdown"]] == [("Phí tháng", 2, 800000)]
    assert [(b["name"], b["count"], b["amount"]) for b in d["expense_breakdown"]] == [("Thuê sân", 2, 200000)]
    item = {"title": "Báo cáo tháng", "report_range": "last_month", "body": "Gửi ban chủ nhiệm", "announcement_id": 1}
    txt = rn.render_text(d, item, "CLB Test")
    for line in ("📊 *Báo cáo tháng*", "CLB: CLB Test", "Tổng hợp thu chi · Tháng trước", "Kỳ: 01/10/2026 – 31/10/2026", "Gửi ban chủ nhiệm",
                 "Tồn đầu kỳ: 800.000 ₫", "Tổng thu: 800.000 ₫", "Tổng chi: 200.000 ₫", "Chênh lệch: +600.000 ₫", "Tồn cuối kỳ: 1.400.000 ₫",
                 "Số giao dịch: 4", "  • Phí tháng: 800.000 ₫ (2)", "  • Thuê sân: 200.000 ₫ (2)"):
        assert line in txt, line
    # báo cáo giao dịch: mới nhất trước, có tên + ghi chú; ẩn tên thì không có tên người và ghi chú
    d = rn.build_report(db, world.club1.id, "transactions", start, end)
    tx = rn.render_text(d, item, "CLB Test")
    lines = [l for l in tx.splitlines() if l.startswith("  • ")]
    assert lines[0] == "  • 31/10 Chi -50.000 ₫ · Thuê sân" and "M Member 1 · Đóng phí T10" in lines[-1] and "Chi -150.000 ₫ · Thuê sân · Sân 3 tuần 3" in lines[1]
    hidden = rn.render_text(rn.build_report(db, world.club1.id, "transactions", start, end, hide_names=True), item, "CLB Test")
    assert "M Member" not in hidden and "Đóng phí" not in hidden and "Sân 3" not in hidden and "Thu +300.000 ₫ · Phí tháng" in hidden
    # quá 15 dòng: cắt và báo số còn lại, tổng không đổi
    exp = db.query(models.FeeType).filter_by(club_id=world.club1.id, name="Thuê sân").first()
    for i in range(20):
        _tx(db, world.club1, exp, "expense", 1000, date(2026, 10, 5))
    db.commit()
    d = rn.build_report(db, world.club1.id, "transactions", start, end)
    assert d["count"] == 24 and len(d["transactions"]) == rn.MAX_TX_LINES
    assert "  … và 9 giao dịch nữa" in rn.render_text(d, item, "CLB Test") and len(rn.render_text(d, item, "CLB Test")) < 2000
    # kỳ rỗng (Tháng này gửi đúng mùng 1) và kỳ không có giao dịch: vẫn ra bản toàn số 0
    s, e = rn.resolve_range("this_month", date(2026, 11, 1))
    d = rn.build_report(db, world.club1.id, "summary", s, e)
    t = rn.render_text(d, {"title": "T", "report_range": "this_month"}, "C")
    assert d["empty_period"] and d["opening"] == 1380000 and "chưa có ngày nào trọn vẹn" in t and "Tổng thu: 0 ₫" in t
    d = rn.build_report(db, world.club1.id, "summary", date(2025, 1, 1), date(2025, 1, 31))
    t = rn.render_text(d, {"title": "T", "report_range": "last_n", "report_range_days": 31}, "C")
    assert d["count"] == 0 and "Không có giao dịch trong kỳ." in t and "Tổng thu: 0 ₫" in t and "Tồn cuối kỳ: 0 ₫" in t
    # markdown trong dữ liệu động bị bỏ để không vỡ định dạng
    assert "*" not in rn.render_text(d, {"title": "Thu *chi* _tuần_", "report_range": "yesterday"}, "CLB [A]").replace("📊 *", "").replace("Thu chi tuần*", "")


def test_cron_push_channels_default_dedupe_history_and_manual(client, world, db, monkeypatch):
    h1, fz, web, tele = _setup(client, world, db, monkeypatch)
    zsent = []                                       # ghi lại tin Zalo thật sự gửi đi
    inner = zalo_bot.call
    monkeypatch.setattr(zalo_bot, "call", lambda tok, method, payload=None, timeout=15: (zsent.append(payload) if method == "sendMessage" else None, inner(tok, method, payload, timeout))[1])
    _seed(db, world)
    today = date(2026, 11, 12)
    _clock(monkeypatch, today, "08:00")
    cron = lambda: client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"}).json()
    # monthly ngày 12, giờ đẩy 07:00, mặc định kênh = chỉ Telegram quản trị viên
    rep = {"kind": "report", "title": "Báo cáo tháng", "recurrence": "monthly", "day_of_month": 12, "push_telegram": True, "push_time": "07:00",
           "report_type": "summary", "report_range": "last_month"}
    aid = client.post("/api/announcements", json=rep, headers=h1).json()["id"]
    assert len(tele) == 1 and web == [] and zsent == []                                  # mặc định chỉ Telegram quản trị viên
    chat, text = tele[0]
    assert chat == 555 and text.startswith("📊 *Báo cáo tháng*") and "Tổng thu: 800.000 ₫" in text and "Kỳ: 01/10/2026 – 31/10/2026" in text
    cron(); assert len(tele) == 1                                                       # chống trùng trong ngày
    hist = client.get("/api/announcements/push-history", headers=h1).json()["items"]
    assert [(r["channel"], r["source"]) for r in hist] == [("telegram", "save")]
    assert db.query(models.AnnouncementPushHistory).filter_by(announcement_id=aid).first().kind == "report"
    # bật thêm Zalo + thiết bị → lưu lại gửi bổ sung cho kênh mới (Telegram đã gửi nên bỏ qua)
    client.put(f"/api/announcements/{aid}", json={"push_channels": ["telegram", "web", "zalo"]}, headers=h1)
    assert len(tele) == 1 and len(web) == 1 and web[0]["title"] == "📊 Báo cáo tháng — Club One" and "tồn cuối 1.400.000 ₫" in web[0]["body"] and len(web[0]["body"]) <= 200
    assert len(zsent) == 1 and zsent[0]["chat_id"] == "zgr-A" and zsent[0]["text"] == text      # Zalo nhận đúng bản như Telegram
    channels = sorted(r["channel"] for r in client.get("/api/announcements/push-history", headers=h1).json()["items"])
    assert channels == ["telegram", "web", "zalo"]
    # báo cáo giao dịch + ẩn tên, chỉ Telegram
    tele.clear()
    client.post("/api/announcements", json={**rep, "title": "Giao dịch tháng", "report_type": "transactions", "report_hide_names": True}, headers=h1)
    assert len(tele) == 1 and "M Member" not in tele[0][1] and "Đóng phí" not in tele[0][1] and "Giao dịch (mới nhất trước):" in tele[0][1]
    # không đúng ngày (ngày 13) → không gửi; trước giờ đẩy → không gửi
    tele.clear(); db.query(models.AnnouncementPushHistory).delete(); db.query(models.AnnouncementPushLog).delete(); db.commit()
    _clock(monkeypatch, date(2026, 11, 13), "09:00"); cron(); assert tele == []
    _clock(monkeypatch, today, "06:30"); cron(); assert tele == []
    _clock(monkeypatch, today, "07:00"); cron(); assert len(tele) == 2                    # hai báo cáo (đã xoá log chống trùng)
    # quy tắc tắt (is_active=False) → không gửi
    tele.clear(); db.query(models.AnnouncementPushLog).delete(); db.commit()
    client.put(f"/api/announcements/{aid}", json={"is_active": False}, headers=h1)
    cron(); assert len(tele) == 1                                                       # chỉ còn báo cáo giao dịch
    # Gửi ngay: báo cáo MỘT LẦN đã qua ngày (không còn lần xuất hiện nào) vẫn gửi được, khoảng tính theo hôm nay
    tele.clear()
    pid = client.post("/api/announcements", json={"kind": "report", "title": "Một lần", "recurrence": "none", "start_date": "2026-11-01", "push_telegram": False,
                                                  "report_type": "summary", "report_range": "last7"}, headers=h1).json()["id"]
    assert tele == []
    r = client.post(f"/api/announcements/{pid}/push", headers=h1)
    assert r.status_code == 200 and r.json()["sent"] == 1 and "Kỳ: 05/11/2026 – 11/11/2026" in tele[0][1]
    # kênh không được chọn thì Gửi ngay báo 400 (báo cáo chỉ Zalo nhưng admin chỉ có Telegram → Zalo vẫn có nhóm nên OK; chọn web-only khi không có thiết bị)
    client.put(f"/api/announcements/{pid}", json={"push_channels": ["web"]}, headers=h1)
    db.query(models.WebPushLog).delete(); db.query(models.AnnouncementPreRemindLog).delete(); db.query(models.PushSubscription).delete(); db.commit()
    assert client.post(f"/api/announcements/{pid}/push", headers=h1).status_code == 400
    # khoảng cố định gửi đúng một lần
    tele.clear()
    client.post("/api/announcements", json={"kind": "report", "title": "Quý 3", "recurrence": "none", "start_date": "2026-11-12", "push_telegram": True, "push_time": "07:00",
                                            "report_type": "summary", "report_range": "fixed", "report_from": "2026-10-01", "report_to": "2026-10-31"}, headers=h1)
    assert len(tele) == 1 and "Khoảng cố định" in tele[0][1] and "Kỳ: 01/10/2026 – 31/10/2026" in tele[0][1]
