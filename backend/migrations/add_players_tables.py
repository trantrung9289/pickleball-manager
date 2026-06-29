"""
Migration: Thêm bảng players + mở rộng tournament_participants để hỗ trợ khách mời.

An toàn: idempotent (chạy nhiều lần không bị lỗi), không mất dữ liệu cũ.
"""
import sqlite3
import os
import sys


def _get_db_path() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:////data/clb.db")
    # Strip SQLAlchemy prefix: "sqlite:////data/..." -> "/data/..."
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
        print(f"[migration] Database not found at {db_path} — skipping (first-run, SQLAlchemy will create tables)")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # ── 1. Bảng players ─────────────────────────────────────────────────────
        if _table_exists(cursor, "players"):
            print("[migration] Table 'players' already exists — skip")
        else:
            cursor.execute("""
                CREATE TABLE players (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    name            VARCHAR(100) NOT NULL,
                    phone           VARCHAR(20),
                    email           VARCHAR(100),
                    member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
                    club_id         INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
                    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Unique: 1 member chỉ có 1 player record trong cùng CLB
            cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_club_member ON players(club_id, member_id) WHERE member_id IS NOT NULL")
            print("[migration] ✅ Table 'players' created")

        # ── 2. Mở rộng tournament_participants ──────────────────────────────────
        # Cần: member_id nullable + thêm player_id, partner_player_id
        need_recreate = (
            _table_exists(cursor, "tournament_participants")
            and not _column_exists(cursor, "tournament_participants", "player_id")
        )

        if not need_recreate:
            if _table_exists(cursor, "tournament_participants"):
                print("[migration] tournament_participants already has player_id — skip")
        else:
            print("[migration] Recreating tournament_participants (add player_id, partner_player_id, nullable member_id)...")

            # Tắt FK enforcement trong SQLite để tránh lỗi khi DROP/RENAME
            cursor.execute("PRAGMA foreign_keys=OFF")

            cursor.execute("""
                CREATE TABLE tournament_participants_new (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    tournament_id       INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
                    member_id           INTEGER REFERENCES members(id),           -- nullable (guest = NULL)
                    player_id           INTEGER REFERENCES players(id),           -- NEW: khách mời
                    partner_member_id   INTEGER REFERENCES members(id),
                    partner_player_id   INTEGER REFERENCES players(id),           -- NEW: đối tác khách mời (đôi)
                    team_name           VARCHAR(200),
                    seed                INTEGER,
                    group_name          VARCHAR(10)
                )
            """)

            # Copy toàn bộ dữ liệu cũ — player_id/partner_player_id mặc định NULL
            cursor.execute("""
                INSERT INTO tournament_participants_new
                    (id, tournament_id, member_id, partner_member_id, team_name, seed, group_name)
                SELECT id, tournament_id, member_id, partner_member_id, team_name, seed, group_name
                FROM tournament_participants
            """)

            cursor.execute("DROP TABLE tournament_participants")
            cursor.execute("ALTER TABLE tournament_participants_new RENAME TO tournament_participants")
            cursor.execute("PRAGMA foreign_keys=ON")
            print("[migration] ✅ tournament_participants recreated, data preserved")

        conn.commit()
        print("[migration] ✅ All migrations completed successfully")

    except Exception as exc:
        conn.rollback()
        print(f"[migration] ❌ Failed: {exc}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
