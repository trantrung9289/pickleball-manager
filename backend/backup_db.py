"""
Sao lưu SQLite an toàn.

Nguyên lý: KHÔNG copy file thô (có thể bắt file giữa lúc ghi → bản sao hỏng),
mà dùng Online Backup API của SQLite (`Connection.backup`) để tạo bản chụp nhất quán,
kiểm tra `PRAGMA integrity_check`, nén gzip, xoay vòng giữ N bản mới nhất,
và (tuỳ chọn) gửi file qua Telegram tới một chat riêng để bản sao không nằm cùng volume.

Chỉ dùng thư viện chuẩn — chạy được trong image slim lẫn local.

Biến môi trường:
  DATABASE_URL              sqlite:////data/clb.db (mặc định ./clb.db)
  BACKUP_DIR                thư mục đích (mặc định <thư mục DB>/backups)
  BACKUP_KEEP               số bản giữ lại (mặc định 14)
  TELEGRAM_BOT_TOKEN        + BACKUP_TELEGRAM_CHAT_ID → gửi file .db.gz tới chat đó
                            (file chứa PII toàn hệ thống — chỉ dùng chat riêng của quản trị viên)

Cách dùng:
  python backup_db.py                 # backup hằng ngày (cron)
  python backup_db.py --tag pre-migrate --no-telegram
"""
import argparse
import gzip
import json
import os
import shutil
import sqlite3
import sys
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import urllib.request

_VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
DEFAULT_KEEP = 14


def db_path_from_url(url: str) -> Path:
    """sqlite:////data/clb.db → /data/clb.db ; sqlite:///./clb.db → ./clb.db"""
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        raise ValueError(f"Chỉ hỗ trợ SQLite, nhận: {url!r}")
    return Path(url[len(prefix):])


def make_backup(db_path: Path, out_dir: Path, tag: str = "daily") -> Path:
    """Tạo bản chụp nhất quán, kiểm tra toàn vẹn, nén gzip. Trả về đường dẫn file .db.gz."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(_VN_TZ).strftime("%Y%m%d-%H%M%S")
    tmp = out_dir / f".tmp-{uuid.uuid4().hex}.db"
    final = out_dir / f"clb-{stamp}-{tag}.db.gz"

    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    dst = sqlite3.connect(tmp)
    try:
        src.backup(dst)          # Online Backup API: nhất quán kể cả khi app đang ghi
        check = dst.execute("PRAGMA integrity_check").fetchone()[0]
        if check != "ok":
            raise RuntimeError(f"integrity_check thất bại: {check}")
    finally:
        dst.close()
        src.close()

    with open(tmp, "rb") as f_in, gzip.open(final, "wb", compresslevel=6) as f_out:
        shutil.copyfileobj(f_in, f_out)
    tmp.unlink()
    return final


def rotate(out_dir: Path, keep: int) -> list:
    """Giữ lại `keep` bản mới nhất (theo tên file = theo thời gian), xoá phần còn lại."""
    files = sorted(out_dir.glob("clb-*.db.gz"))
    to_delete = files[:-keep] if keep > 0 and len(files) > keep else []
    for f in to_delete:
        f.unlink()
    return to_delete


def send_telegram(token: str, chat_id: str, path: Path, caption: str) -> None:
    """Gửi file qua Bot API sendDocument (multipart/form-data, không cần thư viện ngoài)."""
    boundary = f"----clb{uuid.uuid4().hex}"
    body = bytearray()

    def field(name, value):
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())

    field("chat_id", chat_id)
    field("caption", caption)
    field("disable_notification", "true")
    body.extend(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{path.name}\"\r\n"
        f"Content-Type: application/gzip\r\n\r\n".encode()
    )
    body.extend(path.read_bytes())
    body.extend(f"\r\n--{boundary}--\r\n".encode())

    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendDocument",
        data=bytes(body), method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())
    if not result.get("ok"):
        raise RuntimeError(f"Telegram trả lỗi: {result}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Sao lưu SQLite nhất quán")
    ap.add_argument("--tag", default="daily", help="nhãn trong tên file (daily, pre-migrate, manual)")
    ap.add_argument("--keep", type=int, default=int(os.environ.get("BACKUP_KEEP", DEFAULT_KEEP)))
    ap.add_argument("--out-dir", default=os.environ.get("BACKUP_DIR"))
    ap.add_argument("--no-telegram", action="store_true")
    args = ap.parse_args(argv)

    db_path = db_path_from_url(os.environ.get("DATABASE_URL", "sqlite:///./clb.db"))
    if not db_path.exists():
        print(f"[backup] DB chưa tồn tại ({db_path}) — bỏ qua")
        return 0
    out_dir = Path(args.out_dir) if args.out_dir else db_path.parent / "backups"

    try:
        final = make_backup(db_path, out_dir, args.tag)
    except Exception as exc:  # noqa: BLE001
        print(f"[backup] ❌ Thất bại: {exc}")
        return 1
    size_kb = final.stat().st_size / 1024
    print(f"[backup] ✅ {final} ({size_kb:.1f} KB)")

    deleted = rotate(out_dir, args.keep)
    if deleted:
        print(f"[backup] Đã xoá {len(deleted)} bản cũ, giữ {args.keep} bản mới nhất")

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("BACKUP_TELEGRAM_CHAT_ID")
    if token and chat_id and not args.no_telegram:
        try:
            send_telegram(token, chat_id, final, f"Backup DB {args.tag} {datetime.now(_VN_TZ):%d/%m/%Y %H:%M} ({size_kb:.0f} KB)")
            print(f"[backup] ✅ Đã gửi bản sao tới Telegram chat {chat_id}")
        except Exception as exc:  # noqa: BLE001
            print(f"[backup] ⚠️ Gửi Telegram thất bại: {exc}")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
