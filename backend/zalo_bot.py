"""Zalo Bot Platform (2026-10-30) — client thuần + mã hoá token + cắt tin. Không phụ thuộc DB/FastAPI để test riêng.

Kênh CHÍNH THỨC của Zalo (bot.zaloplatforms.com), gói BASIC miễn phí: bot được thêm vào nhóm, gửi chủ động vào nhóm bằng chat_id
dạng "zgr-…", tin ≤ 2000 ký tự, parse_mode markdown. Bot chỉ nhận tin nhóm khi được @nhắc tên → dùng để hệ thống "nhận diện nhóm".
Đã kiểm chứng thực tế 2026-10-30 (xem handoff). KHÔNG dùng giả lập Zalo Web (vi phạm chính sách, khoá tài khoản).
"""
import base64
import hashlib
import json
import os
import urllib.error
import urllib.request
from typing import List, Optional

from cryptography.fernet import Fernet, InvalidToken

API_BASE = "https://bot-api.zaloplatforms.com/bot{token}/{method}"
MAX_TEXT = 2000
GROUP_PREFIX = "zgr-"


class ZaloError(Exception):
    """Lỗi API Zalo: code (int, mã HTTP hoặc error_code của Zalo: 400 sai yêu cầu, 401 token sai/hết hạn, 410 chat_id hỏng, 429 quota)."""

    def __init__(self, code: int, description: str = ""):
        super().__init__(f"Zalo {code}: {description}")
        self.code = int(code or 0)
        self.description = description or ""


def call(token: str, method: str, payload: Optional[dict] = None, timeout: int = 15) -> dict:
    """POST JSON tới Bot API. Trả `result` khi ok; ném ZaloError khi ok=false hoặc HTTP lỗi."""
    req = urllib.request.Request(API_BASE.format(token=token, method=method), data=json.dumps(payload or {}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            body = json.loads(raw)
        except Exception:   # noqa: BLE001
            raise ZaloError(e.code, raw[:200]) from e
        raise ZaloError(body.get("error_code") or e.code, body.get("description") or raw[:200]) from e
    except urllib.error.URLError as e:
        raise ZaloError(0, f"Không kết nối được Zalo: {e.reason}") from e
    if not body.get("ok"):
        raise ZaloError(body.get("error_code") or 0, body.get("description") or "Zalo trả lỗi")
    return body.get("result") or {}


def get_me(token: str) -> dict:
    return call(token, "getMe")


def send_text(token: str, chat_id: str, text: str, markdown: bool = True) -> dict:
    payload = {"chat_id": chat_id, "text": text}
    if markdown:
        payload["parse_mode"] = "markdown"
    return call(token, "sendMessage", payload)


def set_webhook(token: str, url: str, secret: str) -> dict:
    return call(token, "setWebhook", {"url": url, "secret_token": secret})


def delete_webhook(token: str) -> dict:
    return call(token, "deleteWebhook")


def get_updates(token: str, timeout_s: int = 5) -> List[dict]:
    """Long-poll một lần; hết `timeout_s` không có tin → Zalo trả 408 → []. Không dùng được khi webhook đang bật."""
    try:
        res = call(token, "getUpdates", {"timeout": str(timeout_s)}, timeout=timeout_s + 10)
    except ZaloError as e:
        if e.code == 408:
            return []
        raise
    return res if isinstance(res, list) else [res]


def is_group_chat(chat_id: str) -> bool:
    return str(chat_id or "").startswith(GROUP_PREFIX)


def chunk_text(text: str, limit: int = MAX_TEXT) -> List[str]:
    """Cắt tin dài theo dòng, mỗi phần ≤ limit (dòng đơn dài hơn limit thì cắt cứng). Chuỗi rỗng → []."""
    text = (text or "").strip()
    if not text:
        return []
    parts, cur = [], ""
    for line in text.split("\n"):
        while len(line) > limit:
            if cur:
                parts.append(cur); cur = ""
            parts.append(line[:limit]); line = line[limit:]
        cand = f"{cur}\n{line}" if cur else line
        if len(cand) > limit:
            parts.append(cur); cur = line
        else:
            cur = cand
    if cur:
        parts.append(cur)
    return parts


# ── Mã hoá token bot trong DB ─────────────────────────────────────────────────
# Khoá: ZALO_TOKEN_KEY (ưu tiên) hoặc SECRET_KEY của JWT; băm SHA-256 → khoá Fernet. Dev không set env → khoá ngẫu nhiên theo phiên
# (auth.py) → sau khi khởi động lại không giải mã được → UI báo nhập lại token (chấp nhận được cho dev; prod có SECRET_KEY).
def _fernet() -> Fernet:
    secret = os.environ.get("ZALO_TOKEN_KEY") or os.environ.get("SECRET_KEY")
    if not secret:
        import auth   # noqa: PLC0415 — lấy khoá ngẫu nhiên theo phiên của dev
        secret = auth.SECRET_KEY
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def decrypt_token(enc: Optional[str]) -> Optional[str]:
    """None khi chưa có hoặc không giải mã được (đổi khoá) → coi như chưa kết nối, UI yêu cầu nhập lại."""
    if not enc:
        return None
    try:
        return _fernet().decrypt(enc.encode()).decode()
    except (InvalidToken, ValueError):
        return None


def token_tail(token: Optional[str]) -> str:
    return f"…{token[-4:]}" if token and len(token) >= 8 else ""
