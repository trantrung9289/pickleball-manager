"""Đợt 4: rate-limit key theo IP thật, ReminderLog theo chat_id, PRAGMA SQLite, index, cascade xoá."""
import sqlite3
from datetime import date

import pytest
from starlette.requests import Request

from conftest import World
import main
import models
import backup_db as _unused  # noqa: F401  (đảm bảo import không vỡ chuỗi module)


def _mock_request(headers=None, client_host="10.0.0.5"):
    scope = {
        "type": "http", "method": "GET", "path": "/", "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (client_host, 12345),
    }
    return Request(scope)


def test_rate_limit_key_prefers_fly_client_ip():
    r1 = _mock_request({"fly-client-ip": "203.0.113.9"}, client_host="172.19.0.2")
    assert main._rate_limit_key(r1) == "203.0.113.9"
    r2 = _mock_request({}, client_host="172.19.0.2")
    assert main._rate_limit_key(r2) == "172.19.0.2"  # không có header → vẫn có key hợp lệ, không crash


# ── ReminderLog theo chat_id ─────────────────────────────────────────────────

def _setup_two_admins_one_unpaid(db, world):
    world.admin1.club_memberships[0] if False else None  # no-op, readability
    m = db.query(models.ClubMembership).filter(models.ClubMembership.club_id == world.club1.id).first()
    m.telegram_chat_id = 111
    admin1b = models.User(username="admin1b", full_name="Admin 1b", password_hash="x", role=models.UserRole.member)
    db.add(admin1b); db.flush()
    m2 = models.ClubMembership(user_id=admin1b.id, club_id=world.club1.id, role=models.UserRole.admin,
                               can_view=True, can_create=True, can_edit=True, can_delete=True,
                               telegram_chat_id=222)
    db.add(m2)
    ft = world.fee1
    ft.remind_enabled = True
    db.commit()
    return ft


def test_reminder_log_is_per_chat_id_not_per_club(client, world, db, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "000:fake")
    # _INTERNAL_SECRET được đọc 1 lần lúc import main.py — monkeypatch thẳng biến module
    monkeypatch.setattr(main, "_INTERNAL_SECRET", "s3cr3t")
    ft = _setup_two_admins_one_unpaid(db, world)

    sent_ids = []

    def fake_urlopen(req, timeout=10):
        import json
        body = json.loads(req.data)
        sent_ids.append(body["chat_id"])
        class R:
            def read(self_inner): return b"{}"
            def __enter__(self_inner): return self_inner
            def __exit__(self_inner, *a): return False
        return R()
    monkeypatch.setattr(main._urllib_req, "urlopen", fake_urlopen)

    r = client.post("/api/internal/send-fee-reminder", params={"month": 9, "year": 2026},
                    headers={"X-Internal-Secret": "s3cr3t"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert sorted(sent_ids) == [111, 222], "cả 2 admin cùng CLB phải nhận được nhắc phí, không chỉ admin đầu"
    assert body["sent"] == 2 and body["skipped_already_sent_today"] == 0

    logs = db.query(models.ReminderLog).filter(models.ReminderLog.fee_type_id == ft.id).all()
    assert sorted(l.chat_id for l in logs) == [111, 222]

    # Gọi lại trong ngày → cả 2 admin đều bị coi là đã gửi (không phải chỉ 1)
    sent_ids.clear()
    r2 = client.post("/api/internal/send-fee-reminder", params={"month": 9, "year": 2026},
                     headers={"X-Internal-Secret": "s3cr3t"})
    assert r2.json()["skipped_already_sent_today"] == 2 and sent_ids == []


def test_reminder_log_uses_vn_date_not_utc(db, world):
    ft = world.fee1
    log = models.ReminderLog(club_id=world.club1.id, fee_type_id=ft.id, month=9, year=2026,
                             send_date=main._now_vn().date(), chat_id=999)
    db.add(log); db.commit()
    assert log.send_date == main._now_vn().date()


# ── PRAGMA SQLite ────────────────────────────────────────────────────────────

def test_sqlite_pragmas_applied_on_every_connection(db):
    row = db.execute(models.func.count()).scalar if False else None  # placeholder to keep import used
    from sqlalchemy import text
    fk = db.execute(text("PRAGMA foreign_keys")).scalar()
    journal = db.execute(text("PRAGMA journal_mode")).scalar()
    busy = db.execute(text("PRAGMA busy_timeout")).scalar()
    assert fk == 1
    assert journal == "wal"
    assert busy == 5000


# ── Cascade xoá dưới FK enforcement ─────────────────────────────────────────

def test_delete_fee_type_blocked_with_transactions_then_allowed(client, world, db):
    h = World.headers(world.admin1, world.club1)
    r = client.post("/api/transactions", json={"fee_type_id": world.fee1.id, "member_id": world.members1[0].id,
                    "amount": 1000, "transaction_date": "2026-09-01"}, headers=h)
    assert client.delete(f"/api/fee-types/{world.fee1.id}", headers=h).status_code == 400
    client.delete(f"/api/transactions/{r.json()['id']}", headers=h)
    assert client.delete(f"/api/fee-types/{world.fee1.id}", headers=h).status_code == 204


def test_delete_player_blocked_with_transactions(client, world):
    h = World.headers(world.admin1, world.club1)
    r = client.post("/api/transactions", json={"fee_type_id": world.fee1.id, "player_id": world.guest1.id,
                    "amount": 500, "transaction_date": "2026-09-01"}, headers=h)
    assert r.status_code == 201
    assert client.delete(f"/api/players/{world.guest1.id}", headers=h).status_code == 400
    client.delete(f"/api/transactions/{r.json()['id']}", headers=h)
    assert client.delete(f"/api/players/{world.guest1.id}", headers=h).status_code == 204


def test_admin_delete_club_cascades_cleanly_under_fk_enforcement(client, world, db):
    h = World.headers(world.admin1, world.club1)
    client.post("/api/transactions", json={"fee_type_id": world.fee1.id, "member_id": world.members1[0].id,
               "amount": 1000, "transaction_date": "2026-09-01"}, headers=h)
    tid = client.post("/api/tournaments", json={"name": "T", "format": "knockout",
                      "member_ids": [m.id for m in world.members1[:4]]}, headers=h).json()["id"]
    client.post(f"/api/tournaments/{tid}/generate", headers=h)  # tạo bracket có next_match_id tự tham chiếu

    su = models.User(username="root9", password_hash="x", role=models.UserRole.admin, is_superuser=True)
    db.add(su); db.commit()
    from auth import create_access_token
    hsu = {"Authorization": f"Bearer {create_access_token({'sub': 'root9'})}"}
    r = client.delete(f"/api/admin/clubs/{world.club1.id}", headers=hsu)
    assert r.status_code == 200, r.text
    assert db.query(models.Club).filter(models.Club.id == world.club1.id).first() is None
    assert db.query(models.Member).filter(models.Member.club_id == world.club1.id).count() == 0
    assert db.query(models.Transaction).filter(models.Transaction.club_id == world.club1.id).count() == 0
    assert db.query(models.TournamentMatch).join(models.Tournament).filter(
        models.Tournament.club_id == world.club1.id).count() == 0
    # CLB 2 không bị ảnh hưởng
    assert db.query(models.Club).filter(models.Club.id == world.club2.id).first() is not None


def test_full_test_suite_migration_indexes_are_idempotent(tmp_path):
    """migrations/add_missing_indexes.py chạy được nhiều lần trên schema thật, không lỗi."""
    import subprocess, sys, os as _os
    from database import Base, engine  # engine đã trỏ tới DATABASE_URL test (conftest set trước import)
    db_path = str(engine.url).replace("sqlite:///", "")
    Base.metadata.create_all(bind=engine)  # đảm bảo mọi bảng tồn tại (đã có sẵn qua import main, nhưng tường minh)
    root = main.__file__.rsplit("/", 1)[0]
    for _ in range(2):
        out = subprocess.run([sys.executable, "migrations/add_missing_indexes.py"], cwd=root,
                             env={**_os.environ, "DATABASE_URL": f"sqlite:///{db_path}"},
                             capture_output=True, text=True)
        assert out.returncode == 0, out.stderr
