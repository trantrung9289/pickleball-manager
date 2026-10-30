"""Báo cáo định kỳ qua thông báo (2026-10-30): khoảng thời gian tương đối, tính số liệu thu chi, soạn nội dung theo kênh.

Quy ước (người dùng chốt): khoảng tương đối KẾT THÚC Ở HẾT HÔM QUA (chỉ lấy các ngày trọn vẹn); kỳ không có giao dịch vẫn gửi bản toàn số 0;
báo cáo chỉ đẩy qua kênh đã chọn (không hiện chuông, không hiện trang public). Thuần: không phụ thuộc FastAPI; chỉ build_report cần db.
"""
import re
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func

RANGE_LABELS = {
    "yesterday": "Hôm qua",
    "last7": "7 ngày gần nhất",
    "last_week": "Tuần trước",
    "this_month": "Tháng này (đến hết hôm qua)",
    "last_month": "Tháng trước",
    "last_quarter": "Quý trước",
    "this_year": "Năm nay (đến hết hôm qua)",
    "last_n": "N ngày gần nhất",
    "fixed": "Khoảng cố định",
}
TYPE_LABELS = {"summary": "Tổng hợp thu chi", "transactions": "Giao dịch"}
CHANNELS = ("telegram", "zalo", "web")
MAX_TX_LINES = 15        # danh sách giao dịch trong tin (Zalo ≤ 2000 ký tự/tin)
MAX_BREAKDOWN = 5        # số khoản thu / khoản chi liệt kê


def _d(v) -> Optional[date]:
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def resolve_range(preset: str, today: date, days: Optional[int] = None, fixed_from=None, fixed_to=None):
    """(start, end) theo ngày gửi `today`. Kết thúc hết hôm qua. end < start nghĩa là kỳ chưa có ngày nào trọn vẹn
    (vd "Tháng này" gửi đúng ngày mùng 1) → báo cáo vẫn gửi, toàn số 0 + ghi chú."""
    y = today - timedelta(days=1)
    if preset == "yesterday":
        return y, y
    if preset == "last7":
        return today - timedelta(days=7), y
    if preset == "last_week":
        this_monday = today - timedelta(days=today.weekday())
        return this_monday - timedelta(days=7), this_monday - timedelta(days=1)
    if preset == "this_month":
        return today.replace(day=1), y
    if preset == "last_month":
        last_prev = today.replace(day=1) - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    if preset == "last_quarter":
        q = (today.month - 1) // 3                      # 0..3 = quý hiện tại − 1
        year, qq = (today.year - 1, 4) if q == 0 else (today.year, q)
        nm, ny = 3 * qq + 1, year
        if nm > 12:
            nm, ny = nm - 12, ny + 1
        return date(year, 3 * (qq - 1) + 1, 1), date(ny, nm, 1) - timedelta(days=1)
    if preset == "this_year":
        return date(today.year, 1, 1), y
    if preset == "last_n":
        n = max(1, min(int(days or 7), 366))
        return today - timedelta(days=n), y
    if preset == "fixed":
        return _d(fixed_from), _d(fixed_to)
    raise ValueError(f"Khoảng thời gian không hợp lệ: {preset}")


def range_label(item: dict) -> str:
    p = item.get("report_range")
    if p == "last_n":
        return f"{int(item.get('report_range_days') or 7)} ngày gần nhất"
    return RANGE_LABELS.get(p, str(p or ""))


# ── định dạng ────────────────────────────────────────────────────────────────
def md_clean(s) -> str:
    """Bỏ ký tự Markdown (* _ ` [ ]) khỏi dữ liệu động để không làm vỡ định dạng Telegram/Zalo."""
    return re.sub(r"[*_`\[\]]", "", str(s or "")).strip()


def fmt_vnd(x, signed: bool = False) -> str:
    n = int(round(float(x or 0)))
    s = f"{abs(n):,}".replace(",", ".") + " ₫"
    if n < 0:
        return "-" + s
    return ("+" + s) if signed and n > 0 else s


def fmt_date(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def period_text(data: dict) -> str:
    if data["empty_period"]:
        return "chưa có ngày nào trọn vẹn trong kỳ"
    a, b = data["start"], data["end"]
    return fmt_date(a) if a == b else f"{fmt_date(a)} – {fmt_date(b)}"


# ── dữ liệu ──────────────────────────────────────────────────────────────────
def build_report(db, club_id: int, report_type: str, start: date, end: date, hide_names: bool = False) -> dict:
    """Số liệu thu chi của CLB trong [start, end] + tồn đầu kỳ (mọi giao dịch trước start). Dùng kiểu date (không datetime) để so với
    cột Date trong SQLite (xem ghi chú ở report_monthly_detail). hide_names: danh sách giao dịch không kèm tên người và ghi chú."""
    import models   # nhập muộn: module này được test thuần không cần DB
    T, FT = models.Transaction, models.FeeType
    empty = end < start
    data = {"type": report_type, "start": start, "end": end, "empty_period": empty, "opening": 0.0, "income": 0.0, "expense": 0.0,
            "closing": 0.0, "count": 0, "income_count": 0, "expense_count": 0, "income_breakdown": [], "expense_breakdown": [],
            "transactions": []}
    oi = db.query(func.sum(T.amount)).filter(T.club_id == club_id, T.transaction_date < start, T.type == "income").scalar() or 0
    oe = db.query(func.sum(T.amount)).filter(T.club_id == club_id, T.transaction_date < start, T.type == "expense").scalar() or 0
    data["opening"] = float(oi) - float(oe)
    if not empty:
        rows = db.query(T.type, FT.name, func.count(T.id), func.sum(T.amount)).join(FT, FT.id == T.fee_type_id).filter(
            T.club_id == club_id, T.transaction_date >= start, T.transaction_date <= end).group_by(T.type, FT.name).all()
        for typ, name, cnt, amt in rows:
            kind = getattr(typ, "value", typ)
            if kind not in ("income", "expense"):
                continue
            data[kind] += float(amt or 0)
            data[f"{kind}_count"] += int(cnt or 0)
            data[f"{kind}_breakdown"].append({"name": name, "count": int(cnt or 0), "amount": float(amt or 0)})
        data["income_breakdown"].sort(key=lambda x: -x["amount"])
        data["expense_breakdown"].sort(key=lambda x: -x["amount"])
        data["count"] = data["income_count"] + data["expense_count"]
        if report_type == "transactions" and data["count"]:
            base = [T.transaction_date, T.type, T.amount, FT.name]
            if hide_names:
                q = db.query(*base).join(FT, FT.id == T.fee_type_id)
            else:
                q = db.query(*base, T.description, models.Member.full_name, models.Player.name).join(FT, FT.id == T.fee_type_id) \
                    .outerjoin(models.Member, models.Member.id == T.member_id).outerjoin(models.Player, models.Player.id == T.player_id)
            q = q.filter(T.club_id == club_id, T.transaction_date >= start, T.transaction_date <= end) \
                .order_by(T.transaction_date.desc(), T.id.desc()).limit(MAX_TX_LINES)
            for r in q.all():
                data["transactions"].append({
                    "date": r[0], "type": getattr(r[1], "value", r[1]), "amount": float(r[2] or 0), "fee_type": r[3],
                    "note": (r[4] if not hide_names else None), "who": ((r[5] or r[6]) if not hide_names else None)})
    data["closing"] = data["opening"] + data["income"] - data["expense"]
    return data


# ── nội dung ─────────────────────────────────────────────────────────────────
def render_text(data: dict, item: dict, club_name: str) -> str:
    """Tin Telegram/Zalo (Markdown, ≤ 2000 ký tự với giới hạn dòng ở trên)."""
    lines = [f"📊 *{md_clean(item.get('title')) or 'Báo cáo'}*", f"CLB: {md_clean(club_name)}",
             f"{TYPE_LABELS.get(data['type'], data['type'])} · {range_label(item)}", f"Kỳ: {period_text(data)}"]
    note = md_clean(item.get("body"))
    if note:
        lines.append(note[:300])
    net = data["income"] - data["expense"]
    lines += ["", f"Tồn đầu kỳ: {fmt_vnd(data['opening'])}", f"Tổng thu: {fmt_vnd(data['income'])}", f"Tổng chi: {fmt_vnd(data['expense'])}",
              f"Chênh lệch: {fmt_vnd(net, signed=True)}", f"Tồn cuối kỳ: {fmt_vnd(data['closing'])}", f"Số giao dịch: {data['count']}"]
    if not data["count"]:
        lines += ["", "Không có giao dịch trong kỳ."]
    elif data["type"] == "summary":
        for title, key in (("Thu theo khoản", "income_breakdown"), ("Chi theo khoản", "expense_breakdown")):
            rows = data[key]
            if not rows:
                continue
            lines += ["", f"{title}:"]
            lines += [f"  • {md_clean(r['name'])}: {fmt_vnd(r['amount'])} ({r['count']})" for r in rows[:MAX_BREAKDOWN]]
            if len(rows) > MAX_BREAKDOWN:
                lines.append(f"  … và {len(rows) - MAX_BREAKDOWN} khoản khác")
    else:
        lines += ["", "Giao dịch (mới nhất trước):"]
        for t in data["transactions"]:
            sign = "Thu +" if t["type"] == "income" else "Chi -"
            extra = " · ".join(x for x in (md_clean(t.get("who")), md_clean(t.get("note"))[:30]) if x)
            lines.append(f"  • {t['date'].strftime('%d/%m')} {sign}{fmt_vnd(t['amount'])} · {md_clean(t['fee_type'])}" + (f" · {extra}" if extra else ""))
        if data["count"] > len(data["transactions"]):
            lines.append(f"  … và {data['count'] - len(data['transactions'])} giao dịch nữa")
    return "\n".join(lines)


def render_web(data: dict, item: dict, club_name: str) -> tuple:
    """(tiêu đề, nội dung ≤ 200 ký tự) cho Web Push."""
    head = f"{TYPE_LABELS.get(data['type'], '')}"
    if data["type"] == "transactions":
        head = f"{data['count']} giao dịch"
    body = f"{period_text(data)}: {head}, thu {fmt_vnd(data['income'])}, chi {fmt_vnd(data['expense'])}, tồn cuối {fmt_vnd(data['closing'])}"
    return f"📊 {md_clean(item.get('title')) or 'Báo cáo'} — {md_clean(club_name)}", body[:200]
