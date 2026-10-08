"""Đợt 18: id CLB không bao giờ được cấp lại + dọn dữ liệu mồ côi lúc khởi động (sự cố 2026-10-08: CLB mới
"kế thừa" thành viên/khoản/giao dịch/giải đấu/bot_config của CLB thử nghiệm đã xoá vì trùng id)."""
import importlib.util
import os
import sqlite3

import models
from auth import hash_password
from conftest import World
from database import engine
import main


def _superuser(world):
    su = models.User(username="su", full_name="Super", password_hash=hash_password("pw"),
                     role=models.UserRole.admin, is_superuser=True)
    world.db.add(su); world.db.commit(); world.db.refresh(su)
    return World.headers(su, world.club1)


def test_deleted_club_id_is_never_reused(client, world):
    h = _superuser(world)
    a = client.post("/api/admin/clubs", json={"name": "A", "sport": "S"}, headers=h).json()["id"]
    assert client.delete(f"/api/admin/clubs/{a}", headers=h).status_code == 200
    b = client.post("/api/admin/clubs", json={"name": "B", "sport": "S"}, headers=h).json()["id"]
    assert b > a, "id CLB đã xoá bị cấp lại → CLB mới sẽ kế thừa dữ liệu mồ côi (nếu có)"
    ddl = sqlite3.connect(str(engine.url.database)).execute(
        "select sql from sqlite_master where name='clubs'").fetchone()[0]
    assert "AUTOINCREMENT" in ddl.upper()


def test_migration_recreates_clubs_with_autoincrement(tmp_path):
    spec = importlib.util.spec_from_file_location(
        "add_clubs_autoincrement", os.path.join(os.path.dirname(__file__), "..", "migrations", "add_clubs_autoincrement.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    p = str(tmp_path / "old.db")
    c = sqlite3.connect(p)
    c.executescript("""
        CREATE TABLE clubs (id INTEGER NOT NULL, name VARCHAR(200) NOT NULL, sport VARCHAR(100), description TEXT,
            rank_levels JSON, created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), PRIMARY KEY (id));
        CREATE INDEX ix_clubs_id ON clubs (id);
        CREATE TABLE members (id INTEGER PRIMARY KEY, club_id INTEGER REFERENCES clubs(id), full_name TEXT);
        INSERT INTO clubs (id, name, sport) VALUES (1, 'CLB 1', 'P'), (2, 'CLB 2', 'P'), (3, 'CLB 3', 'P');
        INSERT INTO members (club_id, full_name) VALUES (1, 'M1'), (3, 'M3');
        DELETE FROM clubs WHERE id = 3;
    """); c.commit(); c.close()
    assert mod.migrate(p) is True
    assert mod.migrate(p) is False                     # idempotent
    c = sqlite3.connect(p)
    assert "AUTOINCREMENT" in c.execute("select sql from sqlite_master where name='clubs'").fetchone()[0].upper()
    assert c.execute("select id, name, sport from clubs order by id").fetchall() == [(1, "CLB 1", "P"), (2, "CLB 2", "P")]
    # id đã xoá TRƯỚC migration không thể biết (đó chính là lỗi gốc) → startup purge dọn mồ côi của chúng;
    # từ sau migration, mọi id đã xoá không bao giờ được cấp lại:
    c.execute("insert into clubs (name) values ('CLB 3')")
    assert c.execute("select max(id) from clubs").fetchone()[0] == 3
    c.execute("delete from clubs where id = 3")
    c.execute("insert into clubs (name) values ('CLB 4')")
    assert c.execute("select max(id) from clubs").fetchone()[0] == 4   # không cấp lại id 3 vừa xoá
    assert c.execute("select count(*) from members").fetchone()[0] == 2  # dữ liệu bảng khác giữ nguyên
    assert c.execute("select name from sqlite_master where name='ix_clubs_id'").fetchone() is not None


def test_purge_orphan_club_rows_removes_only_orphans(world, db):
    """Giả lập mồ côi (tắt FK như thời xưa): dòng club_id=999 ở members/fee_types/transactions/tournaments/bot_config
    → startup purge xoá hết; dữ liệu CLB thật giữ nguyên; user trỏ tới member mồ côi được gỡ liên kết."""
    raw = sqlite3.connect(str(engine.url.database)); raw.execute("PRAGMA foreign_keys=OFF")
    raw.executescript("""
        INSERT INTO fee_types (club_id, name, type, default_amount, is_recurring, remind_enabled) VALUES (999, 'Nước uống', 'expense', 0, 0, 0);
        INSERT INTO members (club_id, member_code, full_name, status) VALUES (999, 'TV0001', 'Người lạ', 'active');
        INSERT INTO transactions (club_id, fee_type_id, member_id, type, amount, transaction_date)
            VALUES (999, (SELECT id FROM fee_types WHERE club_id=999), (SELECT id FROM members WHERE club_id=999), 'income', 1, '2026-07-01');
        INSERT INTO tournaments (club_id, name, format, status, team_type, num_groups) VALUES (999, 'Test giải', 'round_robin', 'active', 'singles', 2);
        INSERT INTO tournament_participants (tournament_id, member_id) VALUES ((SELECT id FROM tournaments WHERE club_id=999), (SELECT id FROM members WHERE club_id=999));
        INSERT INTO bot_config (club_id, key, value) VALUES (999, 'enable_thu', 'true');
    """); raw.commit()
    orphan_member = raw.execute("select id from members where club_id=999").fetchone()[0]
    raw.execute("update users set member_id=? where username='admin1'", (orphan_member,)); raw.commit(); raw.close()
    before_club1 = (db.query(models.Member).filter_by(club_id=world.club1.id).count(),
                    db.query(models.FeeType).filter_by(club_id=world.club1.id).count())

    removed = main._purge_orphan_club_rows()
    assert removed.get("tournaments") == 1 and removed.get("members") == 1 and removed.get("fee_types") == 1
    assert removed.get("transactions") == 1 and removed.get("bot_config") == 1
    db.expire_all()
    for model in (models.Member, models.FeeType, models.Transaction, models.Tournament, models.BotConfig):
        assert db.query(model).filter(model.club_id == 999).count() == 0, model.__tablename__
    assert db.query(models.TournamentParticipant).filter_by(member_id=orphan_member).count() == 0
    assert db.query(models.User).filter_by(username="admin1").first().member_id is None
    assert (db.query(models.Member).filter_by(club_id=world.club1.id).count(),
            db.query(models.FeeType).filter_by(club_id=world.club1.id).count()) == before_club1
    assert main._purge_orphan_club_rows() == {}   # lần 2 không còn gì
