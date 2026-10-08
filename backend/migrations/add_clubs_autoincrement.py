"""
Migration: bảng `clubs` dùng AUTOINCREMENT để id CLB đã xoá KHÔNG bao giờ được cấp lại.

Lý do (sự cố 2026-10-08): CLB thử nghiệm id=2 bị xoá khi khoá ngoại còn tắt → thành viên/danh mục/giao dịch/
giải đấu/bot_config của nó thành dữ liệu mồ côi mang club_id=2; CLB mới tạo sau đó được SQLite cấp lại id=2
(bảng không AUTOINCREMENT thì rowid lớn nhất đã xoá được dùng lại) và "kế thừa" toàn bộ dữ liệu cũ.

An toàn: idempotent (đã AUTOINCREMENT thì bỏ qua), giữ nguyên dữ liệu và id, tắt khoá ngoại trong lúc tạo lại
bảng (thủ tục chuẩn của SQLite: tạo bảng mới → copy → drop cũ → đổi tên). sqlite_sequence tự ghi max(id) khi copy.
"""
import os
import sqlite3


def _get_db_path() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:////data/clb.db")
    if url.startswith("sqlite:////"):
        return "/" + url[len("sqlite:////"):]
    if url.startswith("sqlite:///"):
        return url[len("sqlite:///"):]
    return url


def migrate(db_path: str = None) -> bool:
    """Trả về True nếu đã tạo lại bảng, False nếu bỏ qua."""
    db_path = db_path or _get_db_path()
    if not os.path.exists(db_path):
        print(f"[migration] Database not found at {db_path} — skipping (first-run, SQLAlchemy will create tables)")
        return False
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    try:
        row = cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='clubs'").fetchone()
        if row is None:
            print("[migration] Table 'clubs' not found — skip")
            return False
        if "AUTOINCREMENT" in row[0].upper():
            print("[migration] 'clubs' already AUTOINCREMENT — skip")
            return False

        cols = cur.execute("PRAGMA table_info(clubs)").fetchall()   # (cid, name, type, notnull, dflt, pk)
        defs = []
        for _cid, name, ctype, notnull, dflt, pk in cols:
            if pk:
                defs.append(f"{name} INTEGER PRIMARY KEY AUTOINCREMENT")
                continue
            d = f"{name} {ctype}"
            if notnull:
                d += " NOT NULL"
            if dflt is not None:
                d += f" DEFAULT {dflt}"
            defs.append(d)
        names = ", ".join(c[1] for c in cols)

        cur.execute("PRAGMA foreign_keys=OFF")
        cur.execute("BEGIN")
        cur.execute(f"CREATE TABLE clubs_new ({', '.join(defs)})")
        cur.execute(f"INSERT INTO clubs_new ({names}) SELECT {names} FROM clubs")
        cur.execute("DROP TABLE clubs")
        cur.execute("ALTER TABLE clubs_new RENAME TO clubs")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_clubs_id ON clubs (id)")
        conn.commit()
        cur.execute("PRAGMA foreign_keys=ON")
        n = cur.execute("SELECT COUNT(*) FROM clubs").fetchone()[0]
        seq = cur.execute("SELECT seq FROM sqlite_sequence WHERE name='clubs'").fetchone()
        print(f"[migration] ✅ 'clubs' recreated with AUTOINCREMENT ({n} rows, next id > {seq[0] if seq else 0})")
        return True
    except Exception as e:
        conn.rollback()
        print(f"[migration] ❌ add_clubs_autoincrement failed: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
