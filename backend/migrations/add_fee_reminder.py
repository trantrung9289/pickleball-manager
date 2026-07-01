"""
Migration: Thêm hỗ trợ nhắc đóng phí qua Telegram.

Thay đổi:
- club_memberships: thêm cột telegram_chat_id (lưu Telegram user_id của admin khi login bot)
- fee_types: thêm cột remind_enabled (bật/tắt nhắc tự động cho khoản thu)
- Tạo bảng reminder_log (chống gửi trùng trong cùng ngày)

An toàn: idempotent, không mất dữ liệu cũ.
"""
import sqlite3
import os
import sys


def _get_db_path() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:////data/clb.db")
    if url.startswith("sqlite:////"):
        return "/" + url[len("sqlite:////"):]
    if url.startswith("sqlite:///"):
        return url[len("sqlite:///"):]
    return url


def _table_exists(cursor, name: str) -> bool:
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cursor.fetchone() is not None


def _column_exists(cursor, table: str, col: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == col for row in cursor.fetchall())


def migrate():
    db_path = _get_db_path()
    if not os.path.exists(db_path):
        print("[migration/fee_reminder] DB chưa tồn tại — bỏ qua (SQLAlchemy sẽ tạo)")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # ── 1. telegram_chat_id vào club_memberships ─────────────────────────────
        if not _column_exists(cursor, "club_memberships", "telegram_chat_id"):
            cursor.execute("ALTER TABLE club_memberships ADD COLUMN telegram_chat_id INTEGER")
            print("[migration/fee_reminder] ✅ Thêm cột telegram_chat_id vào club_memberships")
        else:
            print("[migration/fee_reminder] telegram_chat_id đã tồn tại — bỏ qua")

        # ── 2. remind_enabled vào fee_types ──────────────────────────────────────
        if not _column_exists(cursor, "fee_types", "remind_enabled"):
            cursor.execute("ALTER TABLE fee_types ADD COLUMN remind_enabled INTEGER DEFAULT 0")
            print("[migration/fee_reminder] ✅ Thêm cột remind_enabled vào fee_types")
        else:
            print("[migration/fee_reminder] remind_enabled đã tồn tại — bỏ qua")

        # ── 3. Bảng reminder_log ─────────────────────────────────────────────────
        if not _table_exists(cursor, "reminder_log"):
            cursor.execute("""
                CREATE TABLE reminder_log (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    club_id     INTEGER NOT NULL,
                    fee_type_id INTEGER NOT NULL,
                    month       INTEGER NOT NULL,
                    year        INTEGER NOT NULL,
                    send_date   DATE NOT NULL,
                    sent_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(club_id, fee_type_id, month, year, send_date)
                )
            """)
            print("[migration/fee_reminder] ✅ Tạo bảng reminder_log")
        else:
            print("[migration/fee_reminder] reminder_log đã tồn tại — bỏ qua")

        conn.commit()
        print("[migration/fee_reminder] ✅ Hoàn tất")

    except Exception as exc:
        conn.rollback()
        print(f"[migration/fee_reminder] ❌ Thất bại: {exc}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
