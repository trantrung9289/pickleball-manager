"""Đợt 18: id CLB không bao giờ được cấp lại + dọn dữ liệu mồ côi lúc khởi động (sự cố 2026-10-08: CLB mới
"kế thừa" thành viên/khoản/giao dịch/giải đấu/bot_config của CLB thử nghiệm đã xoá vì trùng id)."""
import importlib.util
import os
import sqlite3
from datetime import date

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


def test_admin_delete_club_with_bot_config_and_all_related_data(client, world, db):
    """Tái hiện sự cố không xoá được CLB "Pick Newborn": CLB có bot_config (FK clubs.id, không ON DELETE) +
    đủ loại dữ liệu khác → trước đây 500 IntegrityError; nay 200 và không còn dòng nào tham chiếu CLB."""
    h = _superuser(world)
    cid = client.post("/api/admin/clubs", json={"name": "Pick Newborn", "sport": "Pickleball"}, headers=h).json()["id"]
    m = models.Member(club_id=cid, member_code="TV0001", full_name="Trần Trung", status="active")
    db.add(m); db.flush()
    ft = db.query(models.FeeType).filter_by(club_id=cid).first()          # 1 trong 7 danh mục mặc định
    db.add(models.Transaction(club_id=cid, fee_type_id=ft.id, member_id=m.id, type="income", amount=1000, transaction_date=date(2026, 10, 8)))
    for k, v in (("welcome_message", "xin chào"), ("enable_thu", "true"), ("menu_config", "{}")):
        db.add(models.BotConfig(club_id=cid, key=k, value=v))
    db.add(models.PublicReportToken(token="tok-pn", slug="pick-newborn-x", club_id=cid, label="pub", is_active=True))
    db.add(models.ClubMembership(user_id=world.admin1.id, club_id=cid, role=models.UserRole.admin,
                                 can_view=True, can_create=True, can_edit=True, can_delete=True))
    db.add(models.Player(name="Khách", club_id=cid, rank="C"))
    db.commit()
    hc = World.headers(world.admin1, type("C", (), {"id": cid})())
    t = client.post("/api/tournaments", json={"name": "Test giải", "format": "round_robin", "member_ids": [m.id]}, headers=hc)
    assert t.status_code == 201, t.text
    pe = client.post("/api/point-events", json={"name": "Mini", "member_ids": [m.id]}, headers=hc)
    assert pe.status_code == 201, pe.text

    r = client.delete(f"/api/admin/clubs/{cid}", headers=h)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(models.Club).filter_by(id=cid).first() is None
    for model in (models.Member, models.FeeType, models.Transaction, models.BotConfig, models.PublicReportToken,
                  models.ClubMembership, models.Player, models.Tournament, models.PointEvent):
        assert db.query(model).filter(model.club_id == cid).count() == 0, model.__tablename__
    raw = sqlite3.connect(str(engine.url.database))
    assert raw.execute("PRAGMA foreign_key_check").fetchall() == []
    # CLB khác không bị ảnh hưởng
    assert db.query(models.Member).filter_by(club_id=world.club1.id).count() == len(world.members1)
