"""
Migration: thêm index còn thiếu trên các cột lọc nóng nhất.

Nguyên nhân: models.py khai báo index=True cho nhiều cột (club_id, member_code...) nhưng
đó chỉ là ý định của SQLAlchemy khi CHẠY create_all lần đầu trên bảng CHƯA tồn tại. Các
cột được thêm sau bằng ALTER TABLE (players.club_id, transactions.player_id, ...) hoặc các
bảng cũ đã tồn tại từ trước khi thêm index=True vào model thì không tự có index — SQLAlchemy
không retro-fit index cho bảng đã tồn tại. `CREATE INDEX IF NOT EXISTS` an toàn để chạy nhiều lần.
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


INDEXES = [
    ("ix_transactions_club_id",       "transactions",           "club_id"),
    ("ix_transactions_member_id",     "transactions",           "member_id"),
    ("ix_transactions_player_id",     "transactions",           "player_id"),
    ("ix_transactions_fee_type_id",   "transactions",           "fee_type_id"),
    ("ix_transactions_date",          "transactions",           "transaction_date"),
    ("ix_players_club_id",            "players",                "club_id"),
    ("ix_players_member_id",          "players",                "member_id"),
    ("ix_tournaments_club_id",        "tournaments",             "club_id"),
    ("ix_tournament_participants_tid", "tournament_participants", "tournament_id"),
    ("ix_tournament_matches_tid",     "tournament_matches",      "tournament_id"),
    ("ix_club_memberships_user_id",   "club_memberships",        "user_id"),
    ("ix_club_memberships_club_id",   "club_memberships",        "club_id"),
    ("ix_public_report_tokens_club_id", "public_report_tokens",  "club_id"),
    ("ix_reminder_log_lookup",        "reminder_log",  "club_id, fee_type_id, month, year, send_date"),
]


def _table_exists(cursor, name: str) -> bool:
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cursor.fetchone() is not None


def migrate():
    db_path = _get_db_path()
    if not os.path.exists(db_path):
        print("[migration/indexes] DB chưa tồn tại — bỏ qua (create_all sẽ tạo bảng, index=True sẽ áp dụng)")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        created = 0
        for idx_name, table, cols in INDEXES:
            if not _table_exists(cursor, table):
                continue
            cursor.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({cols})")
            created += 1
        conn.commit()
        print(f"[migration/indexes] ✅ Đã đảm bảo {created} index tồn tại")
    except Exception as exc:
        conn.rollback()
        print(f"[migration/indexes] ❌ Thất bại: {exc}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
