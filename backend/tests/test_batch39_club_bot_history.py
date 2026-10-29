"""BOT CLB — lịch sử hội thoại lưu máy chủ (2026-10-29): ghi lô, đọc cũ→mới, cách ly theo (CLB, tài khoản), trần 2000, xoá của chính mình."""
import main
import models
from conftest import World


def test_append_list_scope_and_clear(client, world, db):
    h1 = World.headers(world.admin1, world.club1)
    hv = World.headers(world.viewer1, world.club1)
    h2 = World.headers(world.admin2, world.club2)
    assert client.get("/api/club-bot/history", headers=h1).json() == {"messages": [], "has_more": False}
    r = client.post("/api/club-bot/history", json={"messages": [
        {"role": "me", "text": "💰 Thu tiền"},
        {"role": "bot", "text": "① Chọn khoản thu:"},
        {"role": "bot", "text": "✅ Đã ghi Thu!", "rows": [["Khoản", "Phí tháng"], ["Số tiền", "150.000 ₫"]], "kind": "result"},
    ]}, headers=h1)
    assert r.status_code == 200, r.text
    out = r.json()["messages"]
    assert [m["role"] for m in out] == ["me", "bot", "bot"] and out[2]["rows"] == [["Khoản", "Phí tháng"], ["Số tiền", "150.000 ₫"]]
    assert out[0]["created_at"].endswith("Z") and out[0]["id"] < out[1]["id"] < out[2]["id"]
    # đọc: cũ → mới; before_id lấy tin cũ hơn
    lst = client.get("/api/club-bot/history", headers=h1).json()
    assert [m["text"] for m in lst["messages"]] == ["💰 Thu tiền", "① Chọn khoản thu:", "✅ Đã ghi Thu!"] and lst["has_more"] is False
    older = client.get("/api/club-bot/history", params={"before_id": out[2]["id"], "limit": 1}, headers=h1).json()
    assert [m["text"] for m in older["messages"]] == ["① Chọn khoản thu:"] and older["has_more"] is True
    # cách ly: tài khoản khác cùng CLB và CLB khác không thấy
    assert client.get("/api/club-bot/history", headers=hv).json()["messages"] == []
    assert client.get("/api/club-bot/history", headers=h2).json()["messages"] == []
    # validate
    assert client.post("/api/club-bot/history", json={"messages": []}, headers=h1).status_code == 422
    assert client.post("/api/club-bot/history", json={"messages": [{"role": "x", "text": "a"}]}, headers=h1).status_code == 422
    # xoá: chỉ của mình
    client.post("/api/club-bot/history", json={"messages": [{"role": "me", "text": "của viewer"}]}, headers=hv)
    assert client.delete("/api/club-bot/history", headers=h1).json()["deleted"] == 3
    assert client.get("/api/club-bot/history", headers=h1).json()["messages"] == []
    assert len(client.get("/api/club-bot/history", headers=hv).json()["messages"]) == 1


def test_cap_trims_oldest(client, world, db, monkeypatch):
    monkeypatch.setattr(main, "CLUB_BOT_HISTORY_CAP", 5)
    h1 = World.headers(world.admin1, world.club1)
    client.post("/api/club-bot/history", json={"messages": [{"role": "bot", "text": f"t{i}"} for i in range(4)]}, headers=h1)
    client.post("/api/club-bot/history", json={"messages": [{"role": "bot", "text": f"t{i}"} for i in range(4, 7)]}, headers=h1)
    lst = client.get("/api/club-bot/history", headers=h1).json()["messages"]
    assert [m["text"] for m in lst] == ["t2", "t3", "t4", "t5", "t6"]
    assert db.query(models.ClubBotMessage).count() == 5


def test_client_ts_used_when_close_else_server_time(client, world, db):
    from datetime import datetime, timedelta
    h1 = World.headers(world.admin1, world.club1)
    near = (datetime.utcnow() - timedelta(seconds=3)).replace(microsecond=0)
    far = datetime.utcnow() - timedelta(hours=5)
    r = client.post("/api/club-bot/history", json={"messages": [
        {"role": "me", "text": "gần", "ts": near.isoformat() + "Z"},
        {"role": "me", "text": "xa", "ts": far.isoformat() + "Z"},
    ]}, headers=h1).json()["messages"]
    assert r[0]["created_at"].startswith(near.isoformat())
    assert not r[1]["created_at"].startswith(far.isoformat()[:16]) and abs((datetime.fromisoformat(r[1]["created_at"][:-1]) - datetime.utcnow()).total_seconds()) < 5
