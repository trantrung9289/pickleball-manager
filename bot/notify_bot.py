"""
Script cron: Gửi nhắc đóng phí qua Telegram + đẩy thông báo (lịch sinh hoạt / khoản thu, đợt 3 2026-10-27).

Logic tháng cần nhắc:
- 5 ngày cuối tháng M  → nhắc phí tháng M+1
- 5 ngày đầu tháng M   → nhắc phí tháng M
- Ngoài khoảng này     → không gửi

Chạy mỗi ngày lúc 14h UTC+7 (7h UTC).
Anti-spam: backend kiểm tra reminder_log, không gửi 2 lần/ngày.
"""
import os
import sys
import urllib.request
import urllib.parse
import json
from datetime import date
from calendar import monthrange
from zoneinfo import ZoneInfo

_VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
INTERNAL_SECRET = os.environ.get("INTERNAL_SECRET", "")


def _determine_reminder_month(today: date):
    """Trả về (month, year) cần nhắc, hoặc None nếu không trong khoảng."""
    _, last_day = monthrange(today.year, today.month)
    if today.day >= last_day - 4:
        # 5 ngày cuối tháng M → nhắc tháng M+1
        if today.month == 12:
            return 1, today.year + 1
        return today.month + 1, today.year
    if today.day <= 5:
        # 5 ngày đầu tháng M → nhắc tháng M
        return today.month, today.year
    return None


def _post_internal(path: str) -> dict:
    req = urllib.request.Request(
        f"{BACKEND_URL}{path}",
        method="POST",
        headers={"X-Internal-Secret": INTERNAL_SECRET, "Content-Length": "0"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def main():
    today = date.today()
    if not INTERNAL_SECRET:
        print("[notify_bot] ❌ INTERNAL_SECRET chưa cấu hình — dừng")
        sys.exit(1)
    failed = False
    announcements_only = "--announcements-only" in sys.argv   # cron 15 phút: chỉ bước thông báo (backend chống trùng theo ngày)

    # 1) Nhắc phí (chỉ trong cửa sổ đầu/cuối tháng; bỏ qua ở chế độ --announcements-only)
    result = None if announcements_only else _determine_reminder_month(today)
    if announcements_only:
        pass
    elif result is None:
        print(f"[notify_bot] {today}: không trong khoảng nhắc phí — bỏ qua bước nhắc phí")
    else:
        month, year = result
        print(f"[notify_bot] {today}: gửi nhắc tháng {month}/{year}")
        try:
            body = _post_internal(f"/api/internal/send-fee-reminder?month={month}&year={year}")
            print(f"[notify_bot] ✅ nhắc phí sent={body.get('sent')} skipped={body.get('skipped_already_sent_today')} errors={body.get('errors')}")
        except Exception as exc:
            print(f"[notify_bot] ❌ nhắc phí thất bại: {exc}")
            failed = True

    # 2) Thông báo có bật đẩy Telegram (mỗi ngày; backend tự chọn ngày đầu cửa sổ / đúng ngày, chống trùng)
    try:
        body = _post_internal("/api/internal/send-announcements")
        print(f"[notify_bot] ✅ thông báo sent={body.get('sent')} skipped={body.get('skipped')} clubs={body.get('clubs')} errors={body.get('errors')}")
    except Exception as exc:
        print(f"[notify_bot] ❌ thông báo thất bại: {exc}")
        failed = True

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
