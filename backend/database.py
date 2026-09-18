import os
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./clb.db")

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _record):
    """Áp dụng cho MỌI connection mới trong pool (không chỉ connection đầu tiên).

    - foreign_keys=ON: các ON DELETE CASCADE/SET NULL khai báo trong models.py mới thực sự
      có tác dụng (mặc định SQLite tắt, khai báo suông không làm gì).
    - journal_mode=WAL: cho phép đọc đồng thời trong lúc đang ghi — cần thiết vì backend
      (nhiều thread trong threadpool) + bot + cron cùng truy cập một file DB.
    - busy_timeout: chờ thay vì "database is locked" ngay khi có ghi đè tạm thời.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
