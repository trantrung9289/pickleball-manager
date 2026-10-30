"""Kênh gửi dùng chung mọi loại thông báo (2026-10-30): schedule/fee/report đều có push_channels (telegram|zalo|web);
chưa chọn → báo cáo chỉ Telegram, loại khác đủ ba kênh (hành vi cũ); cron / lưu / Gửi ngay chỉ đi kênh đã chọn; PUT chuẩn hoá."""
from datetime import date

import main
from test_batch42_push_history import _setup, _clock

D = date(2026, 11, 12)


def _rule(**kw):
    base = {"title": "Đánh tối", "recurrence": "weekly", "weekdays": [D.weekday()], "lead_days": 0, "start_time": "18:00",
            "push_telegram": True, "push_time": "07:00"}
    base.update(kw)
    return base


def _channels_sent(h1, client):
    rows = client.get("/api/announcements/push-history", headers=h1).json()["items"]
    return sorted({r["channel"] for r in rows})


def test_default_all_three_and_normalise(client, world, db, monkeypatch):
    h1, fz, web, tele = _setup(client, world, db, monkeypatch)
    _clock(monkeypatch, D, "06:00")
    a = client.post("/api/announcements", json=_rule(), headers=h1).json()
    assert a["push_channels"] == ["telegram", "web", "zalo"]                       # không gửi trường → đủ ba kênh như cũ
    a = client.post("/api/announcements", json=_rule(push_channels=["zalo", "zalo"]), headers=h1).json()
    assert a["push_channels"] == ["zalo"]
    assert client.post("/api/announcements", json=_rule(push_channels=["sms"]), headers=h1).status_code == 422
    r = client.put(f"/api/announcements/{a['id']}", json={"title": "Đổi tên"}, headers=h1).json()
    assert r["push_channels"] == ["zalo"]                                          # PUT không gửi kênh → giữ nguyên
    r = client.put(f"/api/announcements/{a['id']}", json={"push_channels": []}, headers=h1).json()
    assert r["push_channels"] == ["telegram", "web", "zalo"]                       # rỗng → mặc định theo loại


def test_cron_and_save_only_selected_channels(client, world, db, monkeypatch):
    h1, fz, web, tele = _setup(client, world, db, monkeypatch)
    cron = lambda: client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"}).json()
    # chỉ Zalo: lưu sau giờ đẩy → gửi ngay, chỉ vào nhóm Zalo
    _clock(monkeypatch, D, "08:00")
    client.post("/api/announcements", json=_rule(push_channels=["zalo"]), headers=h1)
    assert len(tele) == 0 and len(web) == 0 and _channels_sent(h1, client) == ["zalo"]
    cron()
    assert len(tele) == 0 and len(web) == 0                                        # cron cũng không đụng kênh khác


def test_telegram_and_web_only_skip_zalo_and_pre_remind(client, world, db, monkeypatch):
    h1, fz, web, tele = _setup(client, world, db, monkeypatch)
    _clock(monkeypatch, D, "08:00")
    client.post("/api/announcements", json=_rule(push_channels=["telegram", "web"], remind_before_min=90), headers=h1)
    assert _channels_sent(h1, client) == ["telegram", "web"]
    _clock(monkeypatch, D, "16:30")
    client.post("/api/internal/send-announcements", headers={"X-Internal-Secret": "s3cr3t"})
    assert _channels_sent(h1, client) == ["telegram", "web"]   # nhắc trước giờ cũng theo kênh đã chọn


def test_push_now_follows_channels_and_fee_kind(client, world, db, monkeypatch):
    h1, fz, web, tele = _setup(client, world, db, monkeypatch)
    _clock(monkeypatch, D, "06:00")
    a = client.post("/api/announcements", json=_rule(push_telegram=False, push_time=None, push_channels=["web"]), headers=h1).json()
    r = client.post(f"/api/announcements/{a['id']}/push", headers=h1)
    assert r.status_code == 200 and r.json()["web_push_sent"] == 1 and r.json()["sent"] == 0 and r.json()["zalo_sent"] == 0
    # khoản thu cũng có kênh riêng
    fee = client.post("/api/announcements", json={"kind": "fee", "title": "Nhắc phí", "fee_type_id": world.fee1.id, "recurrence": "monthly",
                                                    "day_of_month": 12, "lead_days": 0, "push_channels": ["telegram"]}, headers=h1).json()
    assert fee["push_channels"] == ["telegram"]


def test_legacy_report_channels_copied_by_migration(db):
    """Cột cũ report_channels đã được sao sang push_channels bởi migration (UPDATE ... WHERE kind='report'); hàm chuẩn hoá giữ hành vi cũ."""
    assert main._rule_channels("report", None) == ["telegram"]
    assert main._rule_channels("schedule", None) == ["telegram", "web", "zalo"]
    assert main._rule_channels("fee", ["zalo", "zalo"]) == ["zalo"]
