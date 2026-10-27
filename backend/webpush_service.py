"""
Web Push (VAPID) cho người xem trang public — 2026-10-28.
- Khoá riêng VAPID lấy từ env VAPID_PRIVATE_KEY (chuỗi base64url raw, sinh bằng scripts/gen_vapid.py). Khoá công khai suy ra từ khoá riêng.
- Ngoài Fly (dev/test) thiếu env → sinh khoá tạm cho phiên (subscription sẽ vô hiệu sau khi restart — chấp nhận ở dev).
- send_push(sub, payload) trả "ok" | "gone" (404/410 → xoá subscription) | "error".
"""
import base64
import json
import os

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import WebPushException, webpush

_PRIV = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
_SUBJECT = os.environ.get("VAPID_SUBJECT", "").strip() or "https://pickleball-manager.fly.dev"
_EPHEMERAL = False
if not _PRIV and not os.environ.get("FLY_APP_NAME"):
    _v = Vapid(); _v.generate_keys()
    _raw = _v.private_key.private_numbers().private_value.to_bytes(32, "big")
    _PRIV = base64.urlsafe_b64encode(_raw).rstrip(b"=").decode()
    _EPHEMERAL = True
    print("[webpush] CẢNH BÁO: VAPID_PRIVATE_KEY chưa set — dùng khoá tạm cho phiên dev")


def enabled() -> bool:
    return bool(_PRIV)


def is_ephemeral() -> bool:
    return _EPHEMERAL


def public_key():
    """Khoá công khai base64url (uncompressed point) để pushManager.subscribe(applicationServerKey)."""
    if not _PRIV:
        return None
    v = Vapid.from_string(_PRIV)
    raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def send_push(sub: dict, payload: dict, ttl: int = 86400) -> str:
    """sub = {"endpoint", "keys": {"p256dh", "auth"}}; payload → JSON. Trả "ok" | "gone" | "error"."""
    if not _PRIV:
        return "error"
    try:
        webpush(subscription_info=sub, data=json.dumps(payload, ensure_ascii=False), vapid_private_key=_PRIV,
                vapid_claims={"sub": _SUBJECT}, ttl=ttl, timeout=10)
        return "ok"
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        return "gone" if status in (404, 410) else "error"
    except Exception:
        return "error"
