"""
Thông báo trang public / chuông (đợt 1, 2026-10-27): logic thuần, không chạm DB — test đối chiếu được.

- occurrence_dates(rule, start, end): các ngày quy tắc "nổ" trong [start, end] (kể cả 2 đầu).
- visible_window(d, lead_days): thông báo cho ngày d hiện từ d - lead_days đến hết ngày d.
- build_feed_items(rules, today, horizon_days): lần xuất hiện trong [today, today + horizon] kèm trạng thái:
  "today" (d == today) | "upcoming" (hiện vì đã vào cửa sổ lead_days) | "later" (chưa tới cửa sổ — chỉ trả khi include_later).
Giờ tính theo ngày VN do caller đưa vào (main._now_vn()).
"""
from calendar import monthrange
from datetime import date, timedelta

KINDS = ("schedule", "fee")
RECURRENCES = ("none", "weekly", "monthly")
WEEKDAY_LABELS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"]


def _clamp_day(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, monthrange(year, month)[1]))


def _in_range(rule, d: date) -> bool:
    sd, ed = getattr(rule, "start_date", None), getattr(rule, "end_date", None)
    if sd and d < sd:
        return False
    if ed and d > ed:
        return False
    return True


def occurrence_dates(rule, start: date, end: date) -> list:
    """Ngày quy tắc xuất hiện trong [start, end]. rule cần: recurrence, start_date, end_date, weekdays, day_of_month."""
    if end < start:
        return []
    rec = rule.recurrence
    out = []
    if rec == "none":
        d = rule.start_date
        if d and start <= d <= end:
            out.append(d)
        return out
    if rec == "weekly":
        days = set(int(x) for x in (rule.weekdays or []))
        if not days:
            return []
        d = start
        while d <= end:
            if d.weekday() in days and _in_range(rule, d):
                out.append(d)
            d += timedelta(days=1)
        return out
    if rec == "monthly":
        dom = rule.day_of_month
        if not dom:
            return []
        y, m = start.year, start.month
        while (y, m) <= (end.year, end.month):
            d = _clamp_day(y, m, dom)
            if start <= d <= end and _in_range(rule, d):
                out.append(d)
            m += 1
            if m > 12:
                m, y = 1, y + 1
        return out
    return []


def is_visible(d: date, today: date, lead_days: int) -> bool:
    """Trong cửa sổ hiển thị: từ d - lead_days đến hết ngày d."""
    return (d - timedelta(days=max(0, int(lead_days or 0)))) <= today <= d


def build_feed_items(rules, today: date, horizon_days: int = 14, include_later: bool = False) -> list:
    """Danh sách lần xuất hiện (dict) sắp xếp theo ngày rồi giờ. Mỗi dict: announcement_id, kind, title, body, date,
    start_time, duration_min, status, days_left, fee_type_id. Caller bổ sung nội dung phí (cần DB)."""
    end = today + timedelta(days=max(0, int(horizon_days)))
    items = []
    for r in rules:
        if not getattr(r, "is_active", True):
            continue
        for d in occurrence_dates(r, today, end):
            visible = is_visible(d, today, r.lead_days)
            if not visible and not include_later:
                continue
            items.append({
                "announcement_id": r.id,
                "kind": r.kind,
                "title": r.title,
                "body": r.body,
                "date": d.isoformat(),
                "start_time": r.start_time,
                "duration_min": r.duration_min,
                "status": "today" if d == today else ("upcoming" if visible else "later"),
                "days_left": (d - today).days,
                "fee_type_id": r.fee_type_id,
                "recurrence": r.recurrence,
            })
    items.sort(key=lambda x: (x["date"], x["start_time"] or "", x["announcement_id"]))
    return items


def recurrence_label(rule) -> str:
    """Chữ mô tả quy tắc cho admin, vd "Hàng tuần: Thứ 3, Thứ 5 · 19:00" / "Hàng tháng ngày 5"."""
    if rule.recurrence == "weekly":
        days = ", ".join(WEEKDAY_LABELS[int(i)] for i in sorted(set(int(x) for x in (rule.weekdays or []))) if 0 <= int(i) <= 6)
        s = f"Hàng tuần: {days}" if days else "Hàng tuần"
    elif rule.recurrence == "monthly":
        s = f"Hàng tháng ngày {rule.day_of_month}"
    else:
        s = f"Một lần: {rule.start_date.strftime('%d/%m/%Y')}" if rule.start_date else "Một lần"
    if rule.start_time:
        s += f" · {rule.start_time}"
    return s
