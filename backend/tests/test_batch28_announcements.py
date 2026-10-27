"""Thông báo trang public / chuông — đợt 1 (2026-10-27): logic lặp thuần, CRUD + cách ly CLB, feed admin/public, nội dung phí."""
from datetime import date, timedelta
from types import SimpleNamespace as NS

import announcements as ann
import models
from conftest import World


def _rule(**kw):
    base = dict(id=1, kind="schedule", title="t", body=None, fee_type_id=None, recurrence="none", weekdays=None,
                day_of_month=None, start_time=None, duration_min=None, lead_days=3, start_date=None, end_date=None, is_active=True)
    base.update(kw)
    return NS(**base)


# ── logic thuần ──────────────────────────────────────────────────────────────

def test_weekly_occurrences_respect_weekdays_and_range():
    r = _rule(recurrence="weekly", weekdays=[1, 3], start_date=date(2026, 10, 7), end_date=date(2026, 10, 20))
    got = ann.occurrence_dates(r, date(2026, 10, 1), date(2026, 10, 31))
    # 2026-10-07 là Thứ 4 (weekday 2) → tuần đó chỉ còn Thứ 5 (8/10); 13 (T3), 15 (T5), 20 (T3)
    assert got == [date(2026, 10, 8), date(2026, 10, 13), date(2026, 10, 15), date(2026, 10, 20)]
    assert ann.occurrence_dates(_rule(recurrence="weekly", weekdays=[]), date(2026, 10, 1), date(2026, 10, 31)) == []


def test_monthly_clamps_to_last_day_and_once_rule():
    r = _rule(recurrence="monthly", day_of_month=31)
    got = ann.occurrence_dates(r, date(2026, 1, 15), date(2026, 4, 30))
    assert got == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]
    once = _rule(recurrence="none", start_date=date(2026, 5, 5))
    assert ann.occurrence_dates(once, date(2026, 5, 1), date(2026, 5, 31)) == [date(2026, 5, 5)]
    assert ann.occurrence_dates(once, date(2026, 6, 1), date(2026, 6, 30)) == []


def test_visibility_window_and_feed_status():
    today = date(2026, 10, 27)
    assert ann.is_visible(today + timedelta(days=3), today, 3)
    assert not ann.is_visible(today + timedelta(days=4), today, 3)
    assert not ann.is_visible(today - timedelta(days=1), today, 3)
    rules = [
        _rule(id=1, recurrence="none", start_date=today, lead_days=0),
        _rule(id=2, recurrence="none", start_date=today + timedelta(days=2), lead_days=3, start_time="19:00"),
        _rule(id=3, recurrence="none", start_date=today + timedelta(days=10), lead_days=3),
        _rule(id=4, recurrence="none", start_date=today, is_active=False),
    ]
    items = ann.build_feed_items(rules, today, 14)
    assert [(i["announcement_id"], i["status"], i["days_left"]) for i in items] == [(1, "today", 0), (2, "upcoming", 2)]
    later = ann.build_feed_items(rules, today, 14, include_later=True)
    assert [i["announcement_id"] for i in later] == [1, 2, 3]
    assert later[-1]["status"] == "later"
    assert ann.recurrence_label(_rule(recurrence="weekly", weekdays=[0, 6], start_time="19:00")) == "Hàng tuần: Thứ 2, Chủ nhật · 19:00"
    assert ann.recurrence_label(_rule(recurrence="monthly", day_of_month=5)) == "Hàng tháng ngày 5"


# ── API ──────────────────────────────────────────────────────────────────────

def test_crud_validation_and_club_isolation(client, world):
    h1, h2, hv = World.headers(world.admin1, world.club1), World.headers(world.admin2, world.club2), World.headers(world.viewer1, world.club1)
    body = {"kind": "schedule", "title": "Sinh hoạt tối", "recurrence": "weekly", "weekdays": [1, 3], "start_time": "19:00", "duration_min": 120, "lead_days": 2}
    assert client.post("/api/announcements", json=body, headers=hv).status_code == 403
    r = client.post("/api/announcements", json=body, headers=h1)
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    assert r.json()["recurrence_label"] == "Hàng tuần: Thứ 3, Thứ 5 · 19:00"
    # ràng buộc chéo
    assert client.post("/api/announcements", json={**body, "weekdays": []}, headers=h1).status_code == 422
    assert client.post("/api/announcements", json={"kind": "fee", "title": "x", "recurrence": "monthly", "day_of_month": 5}, headers=h1).status_code == 422
    assert client.post("/api/announcements", json={"kind": "schedule", "title": "x", "recurrence": "none"}, headers=h1).status_code == 422
    assert client.post("/api/announcements", json={"title": "x", "recurrence": "none", "start_date": "2026-11-01", "start_time": "25:00"}, headers=h1).status_code == 422
    # khoản thu của CLB khác → 400
    assert client.post("/api/announcements", json={"kind": "fee", "title": "Phí", "fee_type_id": world.fee2.id, "recurrence": "monthly", "day_of_month": 5}, headers=h1).status_code == 400
    # cách ly CLB
    assert [a["id"] for a in client.get("/api/announcements", headers=h1).json()] == [aid]
    assert client.get("/api/announcements", headers=h2).json() == []
    assert client.put(f"/api/announcements/{aid}", json={"title": "hack"}, headers=h2).status_code == 404
    assert client.delete(f"/api/announcements/{aid}", headers=h2).status_code == 404
    # update: đổi sang monthly mà không có day_of_month → 422; hợp lệ → 200
    assert client.put(f"/api/announcements/{aid}", json={"recurrence": "monthly"}, headers=h1).status_code == 422
    r = client.put(f"/api/announcements/{aid}", json={"recurrence": "monthly", "day_of_month": 10, "title": "Họp tháng"}, headers=h1)
    assert r.status_code == 200 and r.json()["recurrence_label"] == "Hàng tháng ngày 10 · 19:00"
    assert client.delete(f"/api/announcements/{aid}", headers=hv).status_code == 403
    assert client.delete(f"/api/announcements/{aid}", headers=h1).status_code == 204
    assert client.get("/api/announcements", headers=h1).json() == []


def test_fee_feed_public_shows_unpaid_names_and_hides_private_or_inactive(client, world, db):
    h1 = World.headers(world.admin1, world.club1)
    today = date.fromisoformat(client.get("/api/announcements/feed", headers=h1).json()["today"])
    # Phí hàng tháng, hạn = hôm nay → xuất hiện ngay, lead 0
    r = client.post("/api/announcements", json={"kind": "fee", "title": "Hội phí", "fee_type_id": world.fee1.id, "body": "Đóng cho thủ quỹ.",
                                                 "recurrence": "monthly", "day_of_month": today.day, "lead_days": 0}, headers=h1)
    assert r.status_code == 201, r.text
    assert r.json()["fee_type_name"] == "Phí tháng"
    # Lịch sinh hoạt hôm nay nhưng không hiện public; một quy tắc tắt
    client.post("/api/announcements", json={"title": "Nội bộ", "recurrence": "none", "start_date": today.isoformat(), "show_public": False}, headers=h1)
    client.post("/api/announcements", json={"title": "Đã tắt", "recurrence": "none", "start_date": today.isoformat(), "is_active": False}, headers=h1)

    pub = client.get(f"/api/public/report/{world.token1.slug}/announcements").json()
    assert [i["title"] for i in pub["items"]] == ["Hội phí"]
    fee = pub["items"][0]
    assert fee["status"] == "today" and fee["unpaid_count"] == 8 and fee["fee_month"] == today.month
    assert [m["full_name"] for m in fee["unpaid_members"]][:2] == ["M Member 1", "M Member 2"]
    assert fee["body"].startswith("Đóng cho thủ quỹ.\nPhí tháng tháng") and "Còn 8 người chưa đóng." in fee["body"]
    assert fee["amount"] == 100000.0

    # Thành viên 1 đóng trong tháng → còn 7
    db.add(models.Transaction(club_id=world.club1.id, fee_type_id=world.fee1.id, member_id=world.members1[0].id,
                              type="income", amount=100000, transaction_date=today))
    db.commit()
    fee = client.get(f"/api/public/report/{world.token1.slug}/announcements").json()["items"][0]
    assert fee["unpaid_count"] == 7 and all(m["full_name"] != "M Member 1" for m in fee["unpaid_members"])

    # Feed admin thấy cả thông báo không public, không thấy quy tắc tắt
    adm = client.get("/api/announcements/feed", headers=h1).json()
    assert sorted(i["title"] for i in adm["items"]) == ["Hội phí", "Nội bộ"]
    # Link public của CLB khác không thấy gì; slug sai → 404
    tok2 = models.PublicReportToken(token="tok-club2", slug="clubtwo-xyz", club_id=world.club2.id, label="p2", is_active=True)
    db.add(tok2); db.commit()
    assert client.get("/api/public/report/clubtwo-xyz/announcements").json()["items"] == []
    assert client.get("/api/public/report/no-such/announcements").status_code == 404


def test_schedule_lead_window_in_feed(client, world):
    h1 = World.headers(world.admin1, world.club1)
    today = date.fromisoformat(client.get("/api/announcements/feed", headers=h1).json()["today"])
    client.post("/api/announcements", json={"title": "Xa", "recurrence": "none", "start_date": (today + timedelta(days=5)).isoformat(), "lead_days": 2}, headers=h1)
    client.post("/api/announcements", json={"title": "Gần", "recurrence": "none", "start_date": (today + timedelta(days=2)).isoformat(), "lead_days": 2, "start_time": "18:30"}, headers=h1)
    items = client.get("/api/announcements/feed", headers=h1).json()["items"]
    assert [(i["title"], i["status"], i["days_left"]) for i in items] == [("Gần", "upcoming", 2)]
    allitems = client.get("/api/announcements/feed?days=30&include_later=true", headers=h1).json()["items"]
    assert [(i["title"], i["status"]) for i in allitems] == [("Gần", "upcoming"), ("Xa", "later")]
    assert client.get(f"/api/public/report/{world.token1.slug}/announcements").json()["items"][0]["title"] == "Gần"
