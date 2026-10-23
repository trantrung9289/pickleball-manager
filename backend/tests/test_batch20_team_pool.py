"""Đợt 20 (2026-10-22): VĐV tham dự chung chưa phân đội (pool), phân đội tay, tạo nhanh đội, hạng VĐV chụp lúc thêm,
trận thành phần + VĐV nhúng trong dữ liệu giải (admin & public), migration dựng lại bảng."""
import pytest
from sqlalchemy import text

import models
from tests.conftest import World
from tests.test_batch19_team_format import _create_team_tournament, _set_genders, _h, _lineup_slots


def _pool(client, world, tid):
    r = client.get(f"/api/tournaments/{tid}/team-players", headers=_h(world))
    assert r.status_code == 200, r.text
    return [x for x in r.json() if x["participant_id"] is None]


def test_pool_add_assign_unassign_delete(client, world, db):
    t = _create_team_tournament(client, world)
    tid = t["id"]
    h = _h(world)
    _set_genders(db, world)
    world.members1[0].rank = "A"; db.commit()
    # Thêm vào danh sách tham dự (không đội)
    r = client.post(f"/api/tournaments/{tid}/team-players/bulk",
                    json={"member_ids": [m.id for m in world.members1[:4]], "player_ids": [world.guest1.id]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["added"] == 5 and r.json()["team"] is None and r.json()["pool_count"] == 5
    pool = _pool(client, world, tid)
    assert len(pool) == 5
    first = next(x for x in pool if x["member_id"] == world.members1[0].id)
    assert first["rank"] == "A" and first["gender"] == "male"           # chụp hạng + giới tính lúc thêm
    guest = next(x for x in pool if x["player_id"] == world.guest1.id)
    assert guest["rank"] == "C"
    # Thêm trùng → skipped
    r = client.post(f"/api/tournaments/{tid}/team-players/bulk", json={"member_ids": [world.members1[0].id]}, headers=h)
    assert r.json()["added"] == 0 and "đã trong danh sách" in r.json()["skipped"][0]
    # TournamentOut có team_players + team_pool_count
    tt = client.get(f"/api/tournaments/{tid}", headers=h).json()
    assert tt["team_pool_count"] == 5 and len(tt["team_players"]) == 5
    assert all(p["participant_id"] is None for p in tt["team_players"])
    assert tt["team_players"][0]["rank"] == "A" and tt["team_players"][0]["gender"] == "male"

    # Tạo nhanh 2 đội
    r = client.post(f"/api/tournaments/{tid}/teams/bulk", json={"count": 2}, headers=h)
    assert r.status_code == 201, r.text
    teams = r.json()
    assert [x["participant"]["team_name"] for x in teams] == ["Đội 1", "Đội 2"]
    p1, p2 = teams[0]["participant"]["id"], teams[1]["participant"]["id"]
    # Phân VĐV đầu vào Đội 1
    r = client.patch(f"/api/tournaments/{tid}/team-players/{first['id']}", json={"participant_id": p1}, headers=h)
    assert r.status_code == 200 and r.json()["participant_id"] == p1
    # Thêm thẳng vào đội người đang ở danh sách chờ → phân luôn (added), người đã ở đội 1 → skipped
    r = client.post(f"/api/tournaments/{tid}/teams/{p2}/players/bulk",
                    json={"member_ids": [world.members1[1].id, world.members1[0].id]}, headers=h)
    assert r.json()["added"] == 1 and "đã ở đội Đội 1" in r.json()["skipped"][0]
    assert len(_pool(client, world, tid)) == 3
    # Chuyển đội qua PATCH cấp giải; sửa hạng; đặt đội trưởng khi chưa phân đội → 400
    second = next(x for x in client.get(f"/api/tournaments/{tid}/teams", headers=h).json()
                  if x["participant"]["id"] == p2)["players"][0]
    r = client.patch(f"/api/tournaments/{tid}/team-players/{second['id']}", json={"participant_id": p1, "rank": "B"}, headers=h)
    assert r.status_code == 200 and r.json()["participant_id"] == p1 and r.json()["rank"] == "B"
    some_pool = _pool(client, world, tid)[0]
    r = client.patch(f"/api/tournaments/{tid}/team-players/{some_pool['id']}", json={"is_captain": True}, headers=h)
    assert r.status_code == 400
    # Gỡ khỏi đội (endpoint theo đội) → về danh sách chờ, không rời giải
    r = client.delete(f"/api/tournaments/{tid}/teams/{p1}/players/{second['id']}", headers=h)
    assert r.status_code == 204
    assert any(x["id"] == second["id"] for x in _pool(client, world, tid))
    # Xoá hẳn khỏi giải
    r = client.delete(f"/api/tournaments/{tid}/team-players/{second['id']}", headers=h)
    assert r.status_code == 204
    assert not any(x["id"] == second["id"] for x in _pool(client, world, tid))
    # Xoá đội → VĐV của đội về danh sách chờ
    r = client.delete(f"/api/tournaments/{tid}/teams/{p1}", headers=h)
    assert r.status_code == 204
    pool = _pool(client, world, tid)
    assert any(x["id"] == first["id"] for x in pool) and all(not x["is_captain"] for x in pool)
    # Đổi loại giải khi còn VĐV tham dự (chưa có đội) → 400
    client.delete(f"/api/tournaments/{tid}/teams/{p2}", headers=h)
    r = client.put(f"/api/tournaments/{tid}", json={"team_type": "doubles"}, headers=h)
    assert r.status_code == 400 and "xoá hết" in r.json()["detail"]


def test_start_allowed_with_pool_and_pool_players_do_not_play(client, world, db):
    """2B: còn VĐV chưa phân đội vẫn bắt đầu được; họ không có trong đội nào nên không xếp được vào biên bản."""
    t = _create_team_tournament(client, world, rubbers=[{"code": "MD"}])
    tid = t["id"]; h = _h(world)
    _set_genders(db, world)
    teams = client.post(f"/api/tournaments/{tid}/teams/bulk", json={"count": 2, "prefix": "Team"}, headers=h).json()
    p1, p2 = teams[0]["participant"]["id"], teams[1]["participant"]["id"]
    client.post(f"/api/tournaments/{tid}/teams/{p1}/players/bulk", json={"member_ids": [m.id for m in world.members1[:2]]}, headers=h)
    client.post(f"/api/tournaments/{tid}/teams/{p2}/players/bulk", json={"member_ids": [m.id for m in world.members1[4:6]]}, headers=h)
    client.post(f"/api/tournaments/{tid}/team-players/bulk", json={"member_ids": [world.members1[7].id]}, headers=h)
    spare = _pool(client, world, tid)[0]
    g = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h)
    assert g.status_code == 200, g.text
    assert g.json()["status"] == "active" and g.json()["team_pool_count"] == 1
    mid = g.json()["matches"][0]["id"]
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    rid = tie["rubbers"][0]["id"]
    men1 = [p["id"] for p in tie["team1"]["players"]]
    r = client.put(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rid}", json={"side1_players": [men1[0], spare["id"]]}, headers=h)
    assert r.status_code == 400   # VĐV chưa phân đội không thuộc đội → không xếp được
    # Bổ sung VĐV chờ vào đội khi giải đang diễn ra → xếp được
    r = client.patch(f"/api/tournaments/{tid}/team-players/{spare['id']}", json={"participant_id": p1}, headers=h)
    assert r.status_code == 200
    r = client.put(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rid}", json={"side1_players": [men1[0], spare["id"]]}, headers=h)
    assert r.status_code == 200, r.text
    # Đã có tên trong biên bản → không gỡ về danh sách chờ / không xoá
    assert client.delete(f"/api/tournaments/{tid}/teams/{p1}/players/{spare['id']}", headers=h).status_code == 400
    assert client.patch(f"/api/tournaments/{tid}/team-players/{spare['id']}", json={"participant_id": None}, headers=h).status_code == 400
    assert client.delete(f"/api/tournaments/{tid}/team-players/{spare['id']}", headers=h).status_code == 400
    # Sửa hạng vẫn được khi giải đang diễn ra
    assert client.patch(f"/api/tournaments/{tid}/team-players/{spare['id']}", json={"rank": "B"}, headers=h).json()["rank"] == "B"


def test_match_out_embeds_rubbers_and_team_players_admin_and_public(client, world, db):
    from tests.test_batch19_team_format import _started_tie
    tid, mid, team1, team2 = _started_tie(client, world, db)
    h = _h(world)
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    rid = tie["rubbers"][0]["id"]
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rid}/score", json={"score1": 11, "score2": 5}, headers=h).status_code == 200
    tt = client.get(f"/api/tournaments/{tid}", headers=h).json()
    m = next(x for x in tt["matches"] if x["id"] == mid)
    assert len(m["rubbers"]) == 3
    r0 = next(x for x in m["rubbers"] if x["id"] == rid)
    assert r0["score1"] == 11 and r0["score2"] == 5 and r0["status"] == "completed"
    assert len(r0["side1_players"]) == 2
    by_id = {p["id"]: p for p in tt["team_players"]}
    assert all(pid in by_id for pid in r0["side1_players"] + r0["side2_players"])
    assert by_id[r0["side1_players"][0]]["participant_id"] == team1["participant"]["id"]
    assert tt["team_pool_count"] == 0
    # Public: cùng dữ liệu, không SĐT
    slug = world.token1.slug
    pt = client.get(f"/api/public/report/{slug}/tournaments/{tid}")
    assert pt.status_code == 200, pt.text
    pm = next(x for x in pt.json()["matches"] if x["id"] == mid)
    assert len(pm["rubbers"]) == 3 and pm["rubbers"][0]["label"]
    assert len(pt.json()["team_players"]) == 8
    assert "phone" not in pt.json()["team_players"][0]
    # Giải thường: rubbers rỗng, team_players rỗng
    r = client.post("/api/tournaments", json={"name": "Đơn", "format": "round_robin", "team_type": "singles"}, headers=h)
    assert r.json()["team_players"] == [] and r.json()["team_pool_count"] == 0


def test_migration_rebuilds_table_when_participant_not_null(tmp_path):
    """Bảng cũ (participant_id NOT NULL, chưa có rank_snapshot) → sau migration: NULL được phép, dữ liệu giữ nguyên."""
    import sqlite3
    from sqlalchemy import create_engine
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE clubs (id INTEGER PRIMARY KEY);
        CREATE TABLE tournaments (id INTEGER PRIMARY KEY);
        CREATE TABLE tournament_participants (id INTEGER PRIMARY KEY);
        CREATE TABLE tournament_team_players (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            participant_id INTEGER NOT NULL REFERENCES tournament_participants(id) ON DELETE CASCADE,
            member_id INTEGER, player_id INTEGER, display_name VARCHAR(200) NOT NULL,
            gender_snapshot VARCHAR(10), is_captain BOOLEAN NOT NULL, created_at DATETIME,
            CONSTRAINT uq_ttp_tournament_member UNIQUE (tournament_id, member_id),
            CONSTRAINT uq_ttp_tournament_player UNIQUE (tournament_id, player_id));
        CREATE INDEX ix_tournament_team_players_tournament_id ON tournament_team_players (tournament_id);
        INSERT INTO tournaments VALUES (1); INSERT INTO tournament_participants VALUES (5);
        INSERT INTO tournament_team_players (id, tournament_id, participant_id, member_id, display_name, gender_snapshot, is_captain)
            VALUES (7, 1, 5, 3, 'An', 'male', 1);
    """)
    con.commit(); con.close()
    import main
    eng = create_engine(f"sqlite:///{path}")
    orig = main.engine
    try:
        main.engine = eng
        main._run_migration()               # thêm rank_snapshot
        main._migrate_team_players_pool()   # dựng lại bảng
        main._migrate_team_players_pool()   # idempotent
    finally:
        main.engine = orig
    con = sqlite3.connect(path)
    info = {r[1]: r for r in con.execute("PRAGMA table_info(tournament_team_players)")}
    assert info["participant_id"][3] == 0 and "rank_snapshot" in info
    rows = con.execute("SELECT id, tournament_id, participant_id, member_id, display_name, gender_snapshot, is_captain FROM tournament_team_players").fetchall()
    assert rows == [(7, 1, 5, 3, "An", "male", 1)]
    con.execute("INSERT INTO tournament_team_players (tournament_id, participant_id, display_name, is_captain) VALUES (1, NULL, 'B', 0)")
    assert con.execute("SELECT seq FROM sqlite_sequence WHERE name='tournament_team_players'").fetchone()[0] >= 8
    idx = {r[1] for r in con.execute("PRAGMA index_list(tournament_team_players)")}
    assert "ix_tournament_team_players_tournament_id" in idx
    con.close()


def test_manual_bulk_assign_is_atomic(client, world, db):
    """Bảng phân đội thủ công (2026-10-23): POST /team-players/assign — nhiều VĐV → đội / gỡ trong một request;
    một mục sai → cả lô bị từ chối, không ghi gì."""
    t = _create_team_tournament(client, world)
    tid = t["id"]; h = _h(world)
    _set_genders(db, world)
    client.post(f"/api/tournaments/{tid}/team-players/bulk",
                json={"member_ids": [m.id for m in world.members1[:4]]}, headers=h)
    teams = client.post(f"/api/tournaments/{tid}/teams/bulk", json={"count": 2}, headers=h).json()
    p1, p2 = teams[0]["participant"]["id"], teams[1]["participant"]["id"]
    pool = _pool(client, world, tid)
    a, b, c, d = [x["id"] for x in pool]

    r = client.post(f"/api/tournaments/{tid}/team-players/assign",
                    json={"assignments": [{"tpid": a, "participant_id": p1}, {"tpid": b, "participant_id": p1},
                                          {"tpid": c, "participant_id": p2}, {"tpid": a, "participant_id": p1}]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["pool_count"] == 1 and len(r.json()["updated"]) == 3     # tpid trùng chỉ tính một lần
    assert {u["id"]: u["participant_id"] for u in r.json()["updated"]} == {a: p1, b: p1, c: p2}

    # Lô có một mục không thuộc giải → 404 và KHÔNG đổi gì (d vẫn chờ, a vẫn ở đội 1)
    r = client.post(f"/api/tournaments/{tid}/team-players/assign",
                    json={"assignments": [{"tpid": d, "participant_id": p2}, {"tpid": 999999, "participant_id": p2}]}, headers=h)
    assert r.status_code == 404
    assert [x["id"] for x in _pool(client, world, tid)] == [d]
    # Chuyển đội + gỡ về danh sách trong cùng lô
    r = client.post(f"/api/tournaments/{tid}/team-players/assign",
                    json={"assignments": [{"tpid": a, "participant_id": p2}, {"tpid": b, "participant_id": None}]}, headers=h)
    assert r.status_code == 200 and r.json()["pool_count"] == 2
    by_team = {x["participant"]["id"]: [y["id"] for y in x["players"]]
               for x in client.get(f"/api/tournaments/{tid}/teams", headers=h).json()}
    assert by_team[p1] == [] and sorted(by_team[p2]) == sorted([a, c])
    # Rỗng → 422; không có quyền sửa → 403
    assert client.post(f"/api/tournaments/{tid}/team-players/assign", json={"assignments": []}, headers=h).status_code == 422
    assert client.post(f"/api/tournaments/{tid}/team-players/assign",
                       json={"assignments": [{"tpid": d, "participant_id": p1}]},
                       headers=World.headers(world.viewer1, world.club1)).status_code == 403
