"""
Migration: reminder_log ghi log theo TỪNG chat_id, không theo cả CLB.

Trước đây UNIQUE(club_id, fee_type_id, month, year, send_date) khiến admin thứ 2 trở đi
của cùng một CLB bị coi là "đã gửi hôm nay" ngay sau khi admin thứ nhất nhận được tin,
nên chỉ một admin mỗi CLB nhận được nhắc phí.

SQLite không hỗ trợ ALTER TABLE để đổi UNIQUE constraint → tạo bảng mới, copy dữ liệu,
đổi tên. Dữ liệu cũ (không có chat_id) giữ nguyên với chat_id=NULL — SQLite coi NULL là
duy nhất với nhau nên không chặn các lần gửi mới ghi kèm chat_id thật.

An toàn: idempotent, không mất dữ liệu cũ.
"""
import os
import sqlite3
import sys


def _get_db_path() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:////data/clb.db")
    if url.startswith("sqlite:////"):
        return "/" + url[len("sqlite:////"):]
    if url.startswith("sqlite:///"):
        return url[len("sqlite:///"):]
    return url


def _column_exists(cursor, table: str, col: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == col for row in cursor.fetchall())


def _table_exists(cursor, name: str) -> bool:
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cursor.fetchone() is not None


def migrate():
    db_path = _get_db_path()
    if not os.path.exists(db_path):
        print("[migration/reminder_chat_id] DB chưa tồn tại — bỏ qua (SQLAlchemy sẽ tạo)")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        if not _table_exists(cursor, "reminder_log"):
            print("[migration/reminder_chat_id] Chưa có bảng reminder_log — bỏ qua (create_all sẽ tạo)")
            return
        if _column_exists(cursor, "reminder_log", "chat_id"):
            print("[migration/reminder_chat_id] chat_id đã tồn tại — bỏ qua")
            return

        cursor.execute("""
            CREATE TABLE reminder_log_new (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                club_id     INTEGER NOT NULL,
                fee_type_id INTEGER NOT NULL,
                month       INTEGER NOT NULL,
                year        INTEGER NOT NULL,
                send_date   DATE NOT NULL,
                chat_id     INTEGER,
                sent_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(club_id, fee_type_id, month, year, send_date, chat_id)
            )
        """)
        cursor.execute("""
            INSERT INTO reminder_log_new (id, club_id, fee_type_id, month, year, send_date, sent_at)
            SELECT id, club_id, fee_type_id, month, year, send_date, sent_at FROM reminder_log
        """)
        cursor.execute("DROP TABLE reminder_log")
        cursor.execute("ALTER TABLE reminder_log_new RENAME TO reminder_log")
        conn.commit()
        print("[migration/reminder_chat_id] ✅ reminder_log giờ ghi log theo từng chat_id")
    except Exception as exc:
        conn.rollback()
        print(f"[migration/reminder_chat_id] ❌ Thất bại: {exc}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
