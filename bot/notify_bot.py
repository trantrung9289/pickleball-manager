"""
Script cron: đẩy thông báo (lịch sinh hoạt / khoản thu) qua Telegram + Web Push — gọi backend mỗi 15 phút.
Backend tự chọn ngày (ngày đầu cửa sổ, đúng ngày, hoặc mỗi ngày nếu "nhắc lại hằng ngày") và chống trùng theo ngày.
Nhắc đóng phí Telegram cũ đã gỡ (2026-10-28) — khoản thu đã chuyển thành quy tắc thông báo. Cờ --announcements-only giữ để tương thích.
"""
import json
import os
import sys
import urllib.request

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
INTERNAL_SECRET = os.environ.get("INTERNAL_SECRET", "")


def _post_internal(path: str) -> dict:
    req = urllib.request.Request(
        f"{BACKEND_URL}{path}",
        method="POST",
        headers={"X-Internal-Secret": INTERNAL_SECRET, "Content-Length": "0"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def main():
    if not INTERNAL_SECRET:
        print("[notify_bot] ❌ INTERNAL_SECRET chưa cấu hình — dừng")
        sys.exit(1)
    try:
        body = _post_internal("/api/internal/send-announcements")
        print(f"[notify_bot] ✅ thông báo sent={body.get('sent')} skipped={body.get('skipped')} clubs={body.get('clubs')} "
              f"web_push={body.get('web_push')} errors={body.get('errors')}")
    except Exception as exc:
        print(f"[notify_bot] ❌ thông báo thất bại: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
