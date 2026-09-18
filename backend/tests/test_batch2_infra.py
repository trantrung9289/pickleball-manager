"""Đợt 2: health endpoint, script backup, gỡ tài khoản bot, entrypoint hợp lệ."""
import gzip
import os
import shutil
import sqlite3
import subprocess
from pathlib import Path

import backup_db
import main


def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True}
    # docs-only route: không lộ dữ liệu CLB
    assert "club" not in r.text


def test_privileged_bot_account_bootstrap_removed():
    assert not hasattr(main, "_setup_bot_user")
    src = Path(main.__file__).read_text()
    assert "BOT_USERNAME" not in src and "BOT_PASSWORD" not in src


def _seed_db(path: Path, rows: int):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)")
    con.executemany("INSERT INTO t(v) VALUES (?)", [(f"row{i}",) for i in range(rows)])
    con.commit(); con.close()


def test_backup_is_consistent_and_restorable(tmp_path):
    db = tmp_path / "clb.db"
    _seed_db(db, 25)
    out = backup_db.make_backup(db, tmp_path / "backups", tag="test")
    assert out.exists() and out.name.startswith("clb-") and out.name.endswith("-test.db.gz")
    restored = tmp_path / "restored.db"
    with gzip.open(out, "rb") as f_in, open(restored, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    con = sqlite3.connect(restored)
    assert con.execute("SELECT count(*) FROM t").fetchone()[0] == 25
    assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    con.close()
    # không để lại file tạm
    assert not list((tmp_path / "backups").glob(".tmp-*"))


def test_backup_rotation_keeps_newest(tmp_path):
    out = tmp_path / "backups"; out.mkdir()
    names = [f"clb-2026090{i}-000000-daily.db.gz" for i in range(1, 6)]
    for n in names:
        (out / n).write_bytes(b"x")
    deleted = backup_db.rotate(out, keep=2)
    assert sorted(p.name for p in deleted) == names[:3]
    assert sorted(p.name for p in out.glob("*.db.gz")) == names[3:]


def test_backup_cli_skips_when_db_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/nope.db")
    assert backup_db.main(["--no-telegram"]) == 0


def test_backup_cli_end_to_end(tmp_path, monkeypatch):
    db = tmp_path / "clb.db"; _seed_db(db, 3)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db}")
    monkeypatch.delenv("BACKUP_TELEGRAM_CHAT_ID", raising=False)
    assert backup_db.main(["--tag", "manual", "--keep", "1"]) == 0
    assert backup_db.main(["--tag", "manual", "--keep", "1"]) == 0
    files = list((tmp_path / "backups").glob("clb-*.db.gz"))
    assert len(files) == 1  # xoay vòng keep=1


def test_db_path_from_url():
    assert str(backup_db.db_path_from_url("sqlite:////data/clb.db")) == "/data/clb.db"
    assert str(backup_db.db_path_from_url("sqlite:///./clb.db")) == "clb.db"


def test_entrypoint_shell_syntax_and_no_wget():
    root = Path(main.__file__).resolve().parents[1]
    ep = root / "docker-entrypoint.sh"
    assert subprocess.run(["sh", "-n", str(ep)]).returncode == 0
    body = ep.read_text()
    code_lines = [l for l in body.splitlines() if not l.strip().startswith("#")]
    code = "\n".join(l.split(" #")[0] for l in code_lines)
    assert "wget" not in code and "curl" not in code  # image slim không có 2 lệnh này
    assert "/api/health" in body and "backup_db.py" in body
    assert "trap shutdown TERM INT" in body
