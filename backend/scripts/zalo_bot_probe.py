#!/usr/bin/env python3
"""Thử nghiệm Zalo Bot Platform (2026-10-30) — KHÔNG phải mã sản phẩm. Kiểm chứng 3 điểm trước khi tích hợp:
(1) bot gửi chủ động được cho người đã nhắn bot; (2) hạn mức/lỗi khi gửi nhiều; (3) có cuộc trò chuyện kiểu nhóm không.

Token đọc từ biến môi trường ZALO_BOT_TOKEN hoặc file (mặc định backend/.zalo_test_token, đã gitignore). Không in token ra màn hình.
Dùng:
  python scripts/zalo_bot_probe.py me                      # getMe
  python scripts/zalo_bot_probe.py updates                 # getUpdates: in chat_id, loại chat, tên người gửi
  python scripts/zalo_bot_probe.py send <chat_id> "nội dung"   # sendMessage chủ động
  python scripts/zalo_bot_probe.py burst <chat_id> 5       # gửi N tin liên tiếp để xem giới hạn/mã lỗi
"""
import json
from typing import Optional
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://bot-api.zaloplatforms.com/bot{token}/{method}"


def _token() -> str:
    tok = os.environ.get("ZALO_BOT_TOKEN", "").strip()
    if not tok:
        f = Path(__file__).resolve().parent.parent / ".zalo_test_token"
        if f.exists():
            tok = f.read_text().strip()
    if not tok:
        sys.exit("Thiếu token: đặt ZALO_BOT_TOKEN hoặc ghi vào backend/.zalo_test_token")
    return tok


def call(method: str, payload: Optional[dict] = None) -> dict:
    url = API.format(token=_token(), method=method)
    data = json.dumps(payload or {}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        return {"ok": False, "http": e.code, "body": body[:500]}


def main(argv: list[str]) -> None:
    if not argv:
        sys.exit(__doc__)
    cmd = argv[0]
    if cmd == "me":
        print(json.dumps(call("getMe"), ensure_ascii=False, indent=2))
    elif cmd == "updates":
        res = call("getUpdates")
        print(json.dumps(res, ensure_ascii=False, indent=2))
        for u in (res.get("result") or []):
            msg = u.get("message") or {}
            chat = msg.get("chat") or {}
            print(f"- chat_id={chat.get('id')} chat_type={chat.get('chat_type') or chat.get('type')} from={(msg.get('from') or {}).get('display_name')} text={msg.get('text')!r}")
    elif cmd == "send" and len(argv) >= 3:
        print(json.dumps(call("sendMessage", {"chat_id": argv[1], "text": argv[2]}), ensure_ascii=False, indent=2))
    elif cmd == "burst" and len(argv) >= 3:
        n = int(argv[2])
        for i in range(n):
            r = call("sendMessage", {"chat_id": argv[1], "text": f"Tin thử {i + 1}/{n} lúc {time.strftime('%H:%M:%S')}"})
            print(i + 1, "ok" if r.get("ok") else r)
            time.sleep(0.5)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
