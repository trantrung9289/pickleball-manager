"""
Script cron: Gửi nhắc đóng phí qua Telegram.

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


def main():
    today = date.today()
    result = _determine_reminder_month(today)
    if result is None:
        print(f"[notify_bot] {today}: không trong khoảng nhắc — bỏ qua")
        sys.exit(0)

    month, year = result
    print(f"[notify_bot] {today}: gửi nhắc tháng {month}/{year}")

    if not INTERNAL_SECRET:
        print("[notify_bot] ❌ INTERNAL_SECRET chưa cấu hình — dừng")
        sys.exit(1)

    url = f"{BACKEND_URL}/api/internal/send-fee-reminder?month={month}&year={year}"
    req = urllib.request.Request(
        url,
        method="POST",
        headers={
            "X-Internal-Secret": INTERNAL_SECRET,
            "Content-Length": "0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read())
        print(f"[notify_bot] ✅ sent={body.get('sent')} skipped={body.get('skipped_already_sent_today')} errors={body.get('errors')}")
    except Exception as exc:
        print(f"[notify_bot] ❌ Thất bại: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
