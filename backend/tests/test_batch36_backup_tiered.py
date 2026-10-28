"""Đợt 3 trò chuyện (2026-10-28): xoay sao lưu theo bậc 7 ngày + 4 tuần + 3 tháng (thay 14 bản ngày), endpoint dung lượng ổ cho superuser."""
from datetime import date, timedelta
from pathlib import Path

import backup_db
from conftest import World, models, create_access_token


def _names(days_back, today):
    return [f"clb-{(today - timedelta(days=d)).strftime('%Y%m%d')}-010000-daily.db.gz" for d in days_back]


def test_tiered_keep_daily_weekly_monthly():
    today = date(2026, 10, 28)   # Thứ 4
    names = _names(range(0, 120), today)   # 120 bản ngày liên tiếp
    keep = backup_db.tiered_keep(names, today, daily=7, weekly=4, monthly=3)
    kept_dates = sorted(date.fromisoformat(f"{n[4:8]}-{n[8:10]}-{n[10:12]}") for n in keep)
    # 7 bản mới nhất
    assert all((today - timedelta(days=d)) in kept_dates for d in range(7))
    # mỗi tuần ISO trong 4 tuần gần đây giữ bản SỚM NHẤT (thứ Hai): 26/10, 19/10, 12/10, 5/10
    for d in [date(2026, 10, 26), date(2026, 10, 19), date(2026, 10, 12), date(2026, 10, 5)]:
        assert d in kept_dates, d
    # mỗi tháng trong 3 tháng gần đây giữ bản đầu tháng: 1/10, 1/9, 1/8; 1/7 (4 tháng trước) bị xoá
    for d in [date(2026, 10, 1), date(2026, 9, 1), date(2026, 8, 1)]:
        assert d in kept_dates, d
    assert date(2026, 7, 1) not in kept_dates
    assert len(keep) <= 7 + 4 + 3
    # file tên lạ → giữ nguyên
    assert "clb-manual.db.gz" in backup_db.tiered_keep(names + ["clb-manual.db.gz"], today)


def test_rotate_tiered_deletes_files(tmp_path):
    today = date(2026, 10, 28)
    for n in _names(range(0, 40), today):
        (tmp_path / n).write_bytes(b"x")
    deleted = backup_db.rotate_tiered(tmp_path, today=today)
    left = sorted(p.name for p in tmp_path.glob("clb-*.db.gz"))
    assert len(deleted) + len(left) == 40 and len(left) <= 14 and len(left) >= 7
    assert f"clb-{today.strftime('%Y%m%d')}-010000-daily.db.gz" in left


def test_admin_storage_endpoint(client, world, db):
    su = models.User(username="root36", full_name="Root", password_hash="x", role=models.UserRole.admin, is_superuser=True)
    db.add(su); db.commit()
    h = {"Authorization": f"Bearer {create_access_token({'sub': su.username})}"}
    assert client.get("/api/admin/storage", headers=World.headers(world.admin1, world.club1)).status_code == 403
    r = client.get("/api/admin/storage", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["level"] in ("ok", "warn", "danger") and d["db_bytes"] > 0 and d["total_bytes"] > 0 and "backup_count" in d
