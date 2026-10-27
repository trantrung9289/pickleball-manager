"""Sinh khoá VAPID cho Web Push và in lệnh `fly secrets set` để người vận hành tự chạy (không dán khoá vào chat/mã nguồn).
Chạy: ./venv/bin/python scripts/gen_vapid.py"""
import base64
from py_vapid import Vapid

v = Vapid(); v.generate_keys()
raw = v.private_key.private_numbers().private_value.to_bytes(32, "big")
priv = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
print("Chạy lệnh sau (thay email liên hệ của CLB):")
print(f'fly secrets set VAPID_PRIVATE_KEY="{priv}" VAPID_SUBJECT="mailto:admin@example.com"')
