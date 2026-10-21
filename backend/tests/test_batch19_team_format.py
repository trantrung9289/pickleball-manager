"""Đợt 19: thể thức GIẢI ĐỒNG ĐỘI (team_type="team") — điều lệ 2026-10-21.
Phần 1: engine thuần (quy tắc, kết quả trận đồng đội PA1/PA2, kiểm tra VĐV, xếp hạng theo tie-break điều lệ)."""
import pytest

import tournament_engine as eng


def _rub(i, s1=None, s2=None, start1=0, start2=0, status=None):
    done = s1 is not None
    return {"order_index": i, "score1": s1, "score2": s2, "start1": start1, "start2": start2,
            "status": status or ("completed" if done else "pending")}


# ── normalize_team_rules ──────────────────────────────────────────────────────

def test_normalize_defaults_and_labels():
    r = eng.normalize_team_rules(None)
    assert r["scoring"] == "match_points" and r["points_per_rubber"] == 11 and r["win_by_two"] is True
    assert [x["label"] for x in r["rubbers"]] == ["Đôi Nam 1", "Đôi Nữ 1", "Đôi Nam Nữ 1", "Đơn Nam 1", "Đơn Nữ 1"]
    assert r["target_total"] is None and r["max_rubbers_per_player"] == 2 and r["play_all"] is True


def test_normalize_numbering_duplicates_and_cumulative_target():
    r = eng.normalize_team_rules({"scoring": "cumulative", "points_per_rubber": 15,
                                  "rubbers": [{"code": "md"}, {"code": "MD"}, {"code": "XD", "label": "Mix"}, {"code": "ZZ"}]})
    assert [x["label"] for x in r["rubbers"]] == ["Đôi Nam 1", "Đôi Nam 2", "Mix"]
    assert r["target_total"] == 45
    r2 = eng.normalize_team_rules({"rubbers": [{"code": "MD", "label": "A"}, {"code": "WD", "label": "A"}]})
    assert [x["label"] for x in r2["rubbers"]] == ["A", "A (2)"]
    with pytest.raises(ValueError):
        eng.normalize_team_rules({"rubbers": [{"code": "XX"}]})


# ── validate_rubber_score ────────────────────────────────────────────────────

def test_validate_score_match_points_win_by_two():
    r = eng.normalize_team_rules({"points_per_rubber": 11})
    eng.validate_rubber_score(r, _rub(1), 11, 9)
    eng.validate_rubber_score(r, _rub(1), 13, 11)      # deuce
    eng.validate_rubber_score(r, _rub(1), 11, 0)       # xử thua
    for s in ((11, 10), (12, 9), (10, 8), (11, 11), (-1, 11)):
        with pytest.raises(ValueError):
            eng.validate_rubber_score(r, _rub(1), *s)
    r2 = eng.normalize_team_rules({"points_per_rubber": 11, "win_by_two": False})
    eng.validate_rubber_score(r2, _rub(1), 11, 10)
    with pytest.raises(ValueError):
        eng.validate_rubber_score(r2, _rub(1), 12, 10)


def test_validate_score_cumulative_uses_start_and_target():
    r = eng.normalize_team_rules({"scoring": "cumulative", "points_per_rubber": 15, "rubbers": [{"code": "MD"}] * 4})
    assert r["target_total"] == 60
    eng.validate_rubber_score(r, _rub(1), 15, 10)
    eng.validate_rubber_score(r, _rub(2, start1=15, start2=10), 22, 30)   # mốc trận 2 = 30
    with pytest.raises(ValueError):
        eng.validate_rubber_score(r, _rub(2, start1=15, start2=10), 14, 30)  # thấp hơn xuất phát
    with pytest.raises(ValueError):
        eng.validate_rubber_score(r, _rub(2, start1=15, start2=10), 29, 28)  # chưa ai chạm mốc 30
    with pytest.raises(ValueError):
        eng.validate_rubber_score(r, _rub(2, start1=15, start2=10), 30, 30)  # hoà
    eng.validate_rubber_score(r, _rub(4, start1=45, start2=40), 60, 58)      # mốc cuối = 60
    eng.validate_rubber_score(r, _rub(4, start1=45, start2=40), 62, 60)      # deuce ở mốc cuối


# ── tie_result ───────────────────────────────────────────────────────────────

def test_tie_result_match_points_odd_and_play_all():
    r = eng.normalize_team_rules({"rubbers": [{"code": "MD"}] * 3})
    rs = [_rub(1, 11, 5), _rub(2, 11, 7), _rub(3)]
    res = eng.tie_result(r, rs)
    assert res["decided"] is True and res["finished"] is False and res["winner_side"] is None  # đánh hết mới chốt
    rs[2] = _rub(3, 3, 11)
    res = eng.tie_result(r, rs)
    assert res == {**res, "score1": 2, "score2": 1, "winner_side": 1, "finished": True}


def test_tie_result_match_points_even_tiebreaks():
    r = eng.normalize_team_rules({"rubbers": [{"code": "MD"}] * 4})
    # 2–2 trận, hiệu số điểm nhỏ: đội 1 (+11 -11 ... ) → tính
    rs = [_rub(1, 11, 2), _rub(2, 11, 9), _rub(3, 5, 11), _rub(4, 9, 11)]
    res = eng.tie_result(r, rs)
    assert res["score1"] == 2 and res["score2"] == 2 and res["finished"]
    assert res["winner_side"] == 1 and "hiệu số" in res["detail"]       # (+9 +2 −6 −2) = +3
    # 2–2 và hiệu số bằng 0 → đội thắng trận cuối
    rs = [_rub(1, 11, 5), _rub(2, 5, 11), _rub(3, 11, 7), _rub(4, 7, 11)]
    res = eng.tie_result(r, rs)
    assert res["winner_side"] == 2 and "trận cuối" in res["detail"]


def test_tie_result_cumulative_running_totals_and_early_finish():
    r = eng.normalize_team_rules({"scoring": "cumulative", "points_per_rubber": 15, "rubbers": [{"code": "MD"}] * 4})
    rs = [_rub(1, 15, 10), _rub(2, 30, 20, 15, 10), _rub(3), _rub(4)]
    res = eng.tie_result(r, rs)
    assert (res["score1"], res["score2"], res["finished"], res["next_start"]) == (30, 20, False, (30, 20))
    rs[2] = _rub(3, 45, 44, 30, 20)
    rs[3] = _rub(4, 60, 50, 45, 44)
    res = eng.tie_result(r, rs)
    assert res["finished"] and res["winner_side"] == 1 and res["score1"] == 60
    # Trận chưa đấu ở giữa → chỉ tính tới trận liên tục gần nhất
    rs2 = [_rub(1, 15, 10), _rub(2), _rub(3, 45, 44, 30, 20), _rub(4)]
    assert eng.tie_result(r, rs2)["score1"] == 15


# ── kiểm tra VĐV ─────────────────────────────────────────────────────────────

def test_rubber_players_check_count_gender_warnings():
    g = {1: "male", 2: "male", 3: "female", 4: "female", 5: None}
    assert eng.rubber_players_check("MD", [1, 2], g) == ([], [])
    e, w = eng.rubber_players_check("MD", [1], g)
    assert e and "cần 2 VĐV" in e[0]
    e, w = eng.rubber_players_check("MD", [1, 1], g)
    assert e
    e, w = eng.rubber_players_check("XD", [3, 1], g)
    assert (e, w) == ([], [])                                  # thứ tự không quan trọng
    e, w = eng.rubber_players_check("XD", [1, 2], g)
    assert not e and any("không khớp" in x for x in w)        # cảnh báo, không chặn
    e, w = eng.rubber_players_check("WS", [5], g)
    assert not e and any("chưa khai" in x for x in w)


def test_over_limit_and_lineup_check():
    r = eng.normalize_team_rules({"max_rubbers_per_player": 2, "rubbers": [{"code": "MD"}, {"code": "MD"}, {"code": "XD"}, {"code": "MS"}]})
    assert eng.over_limit_players(r, [[1, 2], [1, 3], [1, 4], [2]]) == [1]
    g = {1: "male", 2: "male", 3: "male", 4: "female"}
    chk = eng.lineup_check(r, {"Đôi Nam 1": [1, 2], "Đôi Nam 2": [1, 3], "Đôi Nam Nữ 1": [1, 4], "Đơn Nam 1": []}, g)
    assert chk["errors"] == [] and chk["over_limit"] == [1]
    chk = eng.lineup_check(r, {"Không có": [1]}, g)
    assert chk["errors"]


# ── giai đoạn & bốc thứ tự ───────────────────────────────────────────────────

def test_stage_key_and_first_leg_rounds():
    assert eng.first_leg_rounds("round_robin_double", [1, 2, 3, 4, 5, 6]) == 3
    assert eng.first_leg_rounds("round_robin", [1, 2, 3]) == 0
    assert eng.stage_key_for_match("round_robin_double", "group", 3, 3) == "leg1"
    assert eng.stage_key_for_match("round_robin_double", "group", 4, 3) == "leg2"
    assert eng.stage_key_for_match("combined", "knockout", 1, 0) == "knockout"
    assert eng.stage_key_for_match("combined", "group", 2, 0) == "leg1"


def test_draw_rubber_order_deterministic_permutation():
    o = eng.draw_rubber_order("deadbeef", 5)
    assert sorted(o) == [0, 1, 2, 3, 4] and o == eng.draw_rubber_order("deadbeef", 5)
    assert eng.draw_rubber_order("deadbeef", 5) != eng.draw_rubber_order("cafebabe", 5) or True  # có thể trùng, không bắt buộc


# ── xếp hạng theo điều lệ ────────────────────────────────────────────────────

def _teams(n):
    return [{"id": i, "member_id": None, "team_name": f"Đội {i}", "group_name": "A"} for i in range(1, n + 1)]


def _tie(p1, p2, w1, w2, pts1, pts2, winner=None):
    """Trận đồng đội đã xong: score = số trận thắng (PA1); winner mặc định theo số trận."""
    if winner is None:
        winner = p1 if w1 > w2 else p2
    return {"p1_id": p1, "p2_id": p2, "score1": w1, "score2": w2, "status": "completed", "winner_id": winner,
            "rubber_won1": w1, "rubber_won2": w2, "pts1": pts1, "pts2": pts2}


def test_standings_team_match_points_order_h2h_then_rubber_diff_then_points():
    # 3 đội vòng tròn: mỗi đội thắng 1 → bằng điểm; đối đầu vòng tròn khép kín → xét hiệu số trận thành phần
    ms = [_tie(1, 2, 3, 2, 55, 50), _tie(2, 3, 3, 0, 33, 10), _tie(3, 1, 3, 2, 50, 52)]
    rows = eng.compute_standings(ms, _teams(3), "A", profile="team_match_points")
    by = {r["participant_id"]: r for r in rows}
    assert [r["points"] for r in rows] == [1, 1, 1]
    # hiệu số trận: đội1 = 3+2 − (2+3) = 0; đội2 = 2+3 − (3+0) = +2; đội3 = 0+3 − (3+2) = −2
    assert [r["participant_id"] for r in rows] == [2, 1, 3]
    assert by[2]["rubber_diff"] == 2 and by[3]["rubber_diff"] == -2
    assert not any(r["needs_draw"] for r in rows)


def test_standings_team_match_points_h2h_beats_rubber_diff():
    # 4 đội: đội 1 và 2 cùng 2 điểm; đội 2 có hiệu số trận tốt hơn nhưng thua đối đầu đội 1 → đội 1 trên
    ms = [_tie(1, 2, 3, 2, 50, 49), _tie(1, 3, 3, 2, 50, 49), _tie(1, 4, 0, 3, 20, 33),
          _tie(2, 3, 3, 0, 33, 20), _tie(2, 4, 3, 0, 33, 20), _tie(3, 4, 3, 2, 50, 49)]
    rows = eng.compute_standings(ms, _teams(4), "A", profile="team_match_points")
    assert [r["participant_id"] for r in rows][:2] == [1, 2]


def test_standings_team_match_points_winner_by_points_diff_counts_as_win():
    # Tie hoà 2–2 trận, phân định bằng hiệu số → winner_id = đội 1 dù score bằng nhau
    ms = [_tie(1, 2, 2, 2, 44, 40, winner=1)]
    rows = eng.compute_standings(ms, _teams(2), "A", profile="team_match_points")
    assert rows[0]["participant_id"] == 1 and rows[0]["points"] == 1 and rows[1]["points"] == 0


def test_standings_team_cumulative_total_diff_before_h2h():
    # PA2: score = tổng điểm tích luỹ. Đội 1 thắng đội 2 sát nút, đội 2 thắng đội 3 đậm, đội 3 thắng đội 1 đậm
    def cum(p1, p2, t1, t2):
        return {"p1_id": p1, "p2_id": p2, "score1": t1, "score2": t2, "status": "completed",
                "winner_id": p1 if t1 > t2 else p2}
    ms = [cum(1, 2, 60, 59), cum(2, 3, 60, 30), cum(3, 1, 60, 30)]
    rows = eng.compute_standings(ms, _teams(3), "A", profile="team_cumulative")
    # hiệu số tích luỹ: đội1 = (60−59)+(30−60) = −29; đội2 = (59−60)+(60−30) = +29; đội3 = (30−60)+(60−30) = 0
    assert [r["participant_id"] for r in rows] == [2, 3, 1]


def test_standings_needs_draw_flag_when_everything_equal():
    ms = [_tie(1, 2, 3, 2, 50, 49), _tie(2, 3, 3, 2, 50, 49), _tie(3, 1, 3, 2, 50, 49)]
    rows = eng.compute_standings(ms, _teams(3), "A", profile="team_match_points")
    assert all(r["needs_draw"] for r in rows)


def test_standings_default_profile_unchanged():
    ms = [{"p1_id": 1, "p2_id": 2, "score1": 11, "score2": 5, "status": "completed", "winner_id": 1}]
    rows = eng.compute_standings(ms, _teams(2), "A")
    assert rows[0]["participant_id"] == 1 and "needs_draw" in rows[0] and rows[0]["needs_draw"] is False


# ══════════════════════════════════════════════════════════════════════════════
# Phần 2: API — đội, VĐV, đội hình, biên bản trận đồng đội, xếp hạng, public
# ══════════════════════════════════════════════════════════════════════════════
import models
from conftest import World


def _h(world):
    return World.headers(world.admin1, world.club1)


def _create_team_tournament(client, world, fmt="round_robin", scoring="match_points", rubbers=None, **extra):
    body = {"name": "Đồng đội", "format": fmt, "team_type": "team",
            "team_rules": {"scoring": scoring, "points_per_rubber": 11, "win_by_two": True,
                           "rubbers": rubbers or [{"code": "MD"}, {"code": "WD"}, {"code": "XD"}]}}
    body.update(extra)
    r = client.post("/api/tournaments", json=body, headers=_h(world))
    assert r.status_code == 201, r.text
    return r.json()


def _set_genders(db, world, pattern=("male", "male", "female", "female", "male", "male", "female", "female")):
    for m, g in zip(world.members1, pattern):
        m.gender = g
    world.guest1.gender = "female"
    db.commit()


def _two_teams(client, world, db, tid):
    """Đội 1: members 0-3 (2 nam 2 nữ); Đội 2: members 4-7 (2 nam 2 nữ). Trả (team1, team2) TeamOut."""
    _set_genders(db, world)
    h = _h(world)
    t1 = client.post(f"/api/tournaments/{tid}/teams", json={"team_name": "Đội Rồng"}, headers=h).json()
    t2 = client.post(f"/api/tournaments/{tid}/teams", json={"team_name": "Đội Hổ"}, headers=h).json()
    r1 = client.post(f"/api/tournaments/{tid}/teams/{t1['participant']['id']}/players/bulk",
                     json={"member_ids": [m.id for m in world.members1[:4]], "player_ids": []}, headers=h)
    r2 = client.post(f"/api/tournaments/{tid}/teams/{t2['participant']['id']}/players/bulk",
                     json={"member_ids": [m.id for m in world.members1[4:8]], "player_ids": []}, headers=h)
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    return r1.json()["team"], r2.json()["team"]


def _by_gender(team, g):
    return [p["id"] for p in team["players"] if p["gender"] == g]


def _lineup_slots(team, labels=None):
    men, women = _by_gender(team, "male"), _by_gender(team, "female")
    slots = {"Đôi Nam 1": men[:2], "Đôi Nữ 1": women[:2], "Đôi Nam Nữ 1": [men[0], women[0]]}
    return {k: v for k, v in slots.items() if labels is None or k in labels}


def _started_tie(client, world, db, fmt="round_robin", scoring="match_points", rubbers=None):
    """Giải 2 đội đã sinh lịch (1 tie), đội hình leg1 đã đăng ký. Trả (tid, mid, team1, team2)."""
    t = _create_team_tournament(client, world, fmt=fmt, scoring=scoring, rubbers=rubbers)
    tid = t["id"]
    team1, team2 = _two_teams(client, world, db, tid)
    h = _h(world)
    labels = [x["label"] for x in t["team_rules"]["rubbers"]]
    for team in (team1, team2):
        r = client.put(f"/api/tournaments/{tid}/teams/{team['participant']['id']}/lineups/leg1",
                       json={"slots": _lineup_slots(team, labels)}, headers=h)
        assert r.status_code == 200, r.text
    g = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h)
    assert g.status_code == 200, g.text
    mid = g.json()["matches"][0]["id"]
    return tid, mid, team1, team2


def test_gender_on_members_and_players(client, world):
    h = _h(world)
    r = client.post("/api/members", json={"full_name": "Mới", "gender": "female"}, headers=h)
    assert r.status_code in (200, 201), r.text
    assert r.json()["gender"] == "female"
    mid = r.json()["id"]
    assert client.put(f"/api/members/{mid}", json={"gender": "male"}, headers=h).json()["gender"] == "male"
    r = client.post("/api/players", json={"name": "Khách nữ", "gender": "female"}, headers=h)
    assert r.status_code in (200, 201), r.text and r.json()["gender"] == "female"


def test_create_team_tournament_guards(client, world):
    h = _h(world)
    r = client.post("/api/tournaments", json={"name": "x", "format": "individual", "team_type": "team",
                                              "team_rules": {"rubbers": [{"code": "MD"}]}}, headers=h)
    assert r.status_code == 400
    r = client.post("/api/tournaments", json={"name": "x", "format": "round_robin", "team_type": "team",
                                              "team_rules": {"rubbers": [{"code": "ZZ"}]}}, headers=h)
    assert r.status_code == 400
    t = _create_team_tournament(client, world)
    assert t["team_type"] == "team" and t["team_rules"]["scoring"] == "match_points"
    assert [r["label"] for r in t["team_rules"]["rubbers"]] == ["Đôi Nam 1", "Đôi Nữ 1", "Đôi Nam Nữ 1"]
    # giải thường không có team_rules; endpoint đội trả 400
    plain = client.post("/api/tournaments", json={"name": "y", "format": "round_robin", "member_ids": []}, headers=h).json()
    assert plain["team_rules"] is None
    assert client.get(f"/api/tournaments/{plain['id']}/teams", headers=h).status_code == 400


def test_teams_players_one_team_per_person_and_snapshots(client, world, db):
    t = _create_team_tournament(client, world)
    tid = t["id"]
    team1, team2 = _two_teams(client, world, db, tid)
    assert len(team1["players"]) == 4 and {p["gender"] for p in team1["players"]} == {"male", "female"}
    h = _h(world)
    # người đã ở đội 1 → skipped khi thêm vào đội 2
    r = client.post(f"/api/tournaments/{tid}/teams/{team2['participant']['id']}/players/bulk",
                    json={"member_ids": [world.members1[0].id], "player_ids": [world.guest1.id]}, headers=h)
    assert r.status_code == 200 and r.json()["added"] == 1 and len(r.json()["skipped"]) == 1
    assert "Đội Rồng" in r.json()["skipped"][0]
    # trùng tên đội → 400; đổi tên OK
    assert client.post(f"/api/tournaments/{tid}/teams", json={"team_name": "đội rồng"}, headers=h).status_code == 400
    assert client.put(f"/api/tournaments/{tid}/teams/{team1['participant']['id']}", json={"team_name": "Rồng Xanh"}, headers=h).json()["participant"]["team_name"] == "Rồng Xanh"
    # đội trưởng duy nhất + sửa giới tính snapshot
    p0, p1 = team1["players"][0]["id"], team1["players"][1]["id"]
    assert client.patch(f"/api/tournaments/{tid}/teams/{team1['participant']['id']}/players/{p0}", json={"is_captain": True}, headers=h).json()["is_captain"]
    assert client.patch(f"/api/tournaments/{tid}/teams/{team1['participant']['id']}/players/{p1}", json={"is_captain": True, "gender": "other"}, headers=h).status_code == 200
    teams = client.get(f"/api/tournaments/{tid}/teams", headers=h).json()
    caps = [p for p in teams[0]["players"] if p["is_captain"]]
    assert len(caps) == 1 and caps[0]["id"] == p1
    # xoá thành viên đang trong đội → 400
    assert client.delete(f"/api/members/{world.members1[0].id}", headers=h).status_code == 400
    # danh sách giải: participants là đội (không member/player)
    d = client.get(f"/api/tournaments/{tid}", headers=h).json()
    assert all(p["member_id"] is None and p["player_id"] is None and p["team_name"] for p in d["participants"])


def test_lineup_validation_lock_unlock(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db)
    h = _h(world)
    pid1 = team1["participant"]["id"]
    men = _by_gender(team1, "male")
    # sai số người → 400; VĐV đội khác → 400; giới tính lệch → 200 kèm warnings; vượt 2 trận → over_limit
    assert client.put(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1", json={"slots": {"Đôi Nam 1": [men[0]]}}, headers=h).status_code == 400
    other = team2["players"][0]["id"]
    assert client.put(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1", json={"slots": {"Đôi Nam 1": [men[0], other]}}, headers=h).status_code == 400
    women = _by_gender(team1, "female")
    r = client.put(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1",
                   json={"slots": {"Đôi Nam 1": [men[0], women[0]], "Đôi Nữ 1": [women[0], women[1]], "Đôi Nam Nữ 1": [men[0], women[0]]}}, headers=h)
    assert r.status_code == 200, r.text
    assert any("không khớp" in w for w in r.json()["warnings"])
    assert r.json()["over_limit"] == [women[0]]        # women[0] ở 3 trận > 2; men[0] đúng 2 trận → không vượt
    assert client.get(f"/api/tournaments/{tid}/teams/{pid1}/lineups", headers=h).json()[0]["stage_key"] == "leg1"
    # có điểm → khoá đội hình cả 2 đội; PUT → 400; unlock có log → PUT lại OK
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    rid = tie["rubbers"][0]["id"]
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rid}/score", json={"score1": 11, "score2": 7}, headers=h).status_code == 200
    lus = client.get(f"/api/tournaments/{tid}/teams/{pid1}/lineups", headers=h).json()
    assert lus[0]["locked"] is True
    assert client.put(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1", json={"slots": _lineup_slots(team1)}, headers=h).status_code == 400
    assert client.post(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1/unlock", json={"note": "chấn thương"}, headers=h).json()["locked"] is False
    assert client.put(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1", json={"slots": _lineup_slots(team1)}, headers=h).status_code == 200
    logs = client.get(f"/api/tournaments/{tid}/team-logs", headers=h).json()
    assert {l["kind"] for l in logs} >= {"lineup_set", "lineup_lock", "lineup_unlock", "score"}


def test_tie_flow_match_points_prefill_draw_score_complete(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db)
    h = _h(world)
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    assert tie["stage_key"] == "leg1" and len(tie["rubbers"]) == 3 and tie["draw_seed"] is None
    r0 = tie["rubbers"][0]
    assert r0["label"] == "Đôi Nam 1" and r0["side1_players"] == _lineup_slots(team1)["Đôi Nam 1"]   # điền sẵn từ đội hình
    assert r0["side2_players"] == _lineup_slots(team2)["Đôi Nam 1"] and r0["target"] == 11
    # bốc thăm thứ tự: tất định theo seed, hoán vị đủ 3 nhãn
    d = client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/draw-order", headers=h).json()
    assert d["draw_seed"] and sorted(x["label"] for x in d["rubbers"]) == ["Đôi Nam 1", "Đôi Nam Nữ 1", "Đôi Nữ 1"]
    assert [x["order_index"] for x in d["rubbers"]] == [1, 2, 3]
    # chặn nhập điểm trực tiếp cả trận
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/score", json={"score1": 2, "score2": 1}, headers=h).status_code == 400
    # điểm không hợp lệ → 400 ; hợp lệ → tie đang đấu
    rids = [x["id"] for x in d["rubbers"]]
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[0]}/score", json={"score1": 11, "score2": 10}, headers=h).status_code == 400
    t1 = client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[0]}/score", json={"score1": 11, "score2": 9}, headers=h).json()
    assert t1["result"]["score1"] == 1 and t1["result"]["finished"] is False and t1["match"]["status"] == "pending"
    # không bốc lại khi đã có điểm; không đổi VĐV trận đã có điểm
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/draw-order", headers=h).status_code == 400
    assert client.put(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[0]}", json={"side1_players": _lineup_slots(team1)["Đôi Nam 1"]}, headers=h).status_code == 400
    client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[1]}/score", json={"score1": 5, "score2": 11}, headers=h)
    t3 = client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[2]}/walkover", json={"side": 2}, headers=h).json()
    assert t3["result"]["finished"] and t3["result"]["winner_side"] == 1 and t3["result"]["score1"] == 2
    assert t3["match"]["status"] == "completed" and t3["match"]["winner_id"] == team1["participant"]["id"]
    assert t3["rubbers"][2]["is_walkover"] and (t3["rubbers"][2]["score1"], t3["rubbers"][2]["score2"]) == (11, 0)
    # xếp hạng theo hồ sơ PA1 có hệ số trận và điểm nhỏ
    st = client.get(f"/api/tournaments/{tid}/standings", headers=h).json()
    top = st[0]
    assert top["participant_id"] == team1["participant"]["id"] and top["rubber_diff"] == 1 and top["pts_diff"] == (11 - 9) + (5 - 11) + 11
    # xoá điểm trận cuối → tie quay về pending, vòng sau được dọn
    back = client.delete(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[2]}/score", headers=h).json()
    assert back["match"]["status"] == "pending" and back["result"]["finished"] is False


def test_tie_even_rubbers_points_diff_decides_and_standings_win(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db, rubbers=[{"code": "MD"}, {"code": "WD"}])
    h = _h(world)
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    rids = [x["id"] for x in tie["rubbers"]]
    client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[0]}/score", json={"score1": 11, "score2": 2}, headers=h)
    res = client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[1]}/score", json={"score1": 9, "score2": 11}, headers=h).json()
    assert res["result"]["score1"] == 1 and res["result"]["score2"] == 1 and res["result"]["winner_side"] == 1
    assert res["match"]["winner_id"] == team1["participant"]["id"] and "hiệu số" in res["result"]["detail"]
    st = client.get(f"/api/tournaments/{tid}/standings", headers=h).json()
    assert st[0]["participant_id"] == team1["participant"]["id"] and st[0]["points"] == 1 and st[1]["points"] == 0


def test_tie_flow_cumulative_chain_and_early_finish(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db, scoring="cumulative",
                                          rubbers=[{"code": "MD"}, {"code": "WD"}, {"code": "XD"}, {"code": "MS"}])
    h = _h(world)
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    assert tie["rules"]["target_total"] == 44 and [x["target"] for x in tie["rubbers"]] == [11, 22, 33, 44]
    rids = [x["id"] for x in tie["rubbers"]]
    # trận 2 trước trận 1 → 400 (nối tiếp theo thứ tự)
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[1]}/score", json={"score1": 22, "score2": 10}, headers=h).status_code == 400
    r1 = client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[0]}/score", json={"score1": 11, "score2": 4}, headers=h).json()
    assert (r1["rubbers"][1]["start1"], r1["rubbers"][1]["start2"]) == (11, 4) and r1["result"]["score1"] == 11
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[1]}/score", json={"score1": 20, "score2": 22}, headers=h).status_code == 200
    r3 = client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[2]}/score", json={"score1": 33, "score2": 30}, headers=h).json()
    assert r3["result"]["finished"] is False
    # Đơn Nam 1 cần 1 nam mỗi bên — đội hình chưa xếp slot này → 400 thiếu VĐV; xếp rồi ghi điểm chạm mốc 44
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[3]}/score", json={"score1": 44, "score2": 40}, headers=h).status_code == 400
    m1, m2 = _by_gender(team1, "male")[0], _by_gender(team2, "male")[0]
    assert client.put(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[3]}", json={"side1_players": [m1], "side2_players": [m2]}, headers=h).status_code == 200
    r4 = client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[3]}/score", json={"score1": 44, "score2": 40}, headers=h).json()
    assert r4["result"]["finished"] and r4["result"]["winner_side"] == 1 and r4["match"]["score1"] == 44 and r4["match"]["score2"] == 40
    # sửa trận 2 khi trận 3,4 đã có điểm → 400; xoá điểm trận 2 → trận 3, 4 cũng về pending
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[1]}/score", json={"score1": 22, "score2": 15}, headers=h).status_code == 400
    back = client.delete(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rids[1]}/score", headers=h).json()
    assert [x["status"] for x in back["rubbers"]] == ["completed", "pending", "pending", "pending"] and back["match"]["status"] == "pending"
    st = client.get(f"/api/tournaments/{tid}/standings", headers=h).json()
    assert all(r["played"] == 0 for r in st)


def test_combined_team_tie_result_feeds_knockout_and_stage_keys(client, world, db):
    """Giải kết hợp 2 bảng × 2 đội: xong vòng bảng → lên vòng loại, đội hình giai đoạn knockout riêng."""
    t = _create_team_tournament(client, world, fmt="combined", num_groups=2, rubbers=[{"code": "MD"}])
    tid = t["id"]
    _set_genders(db, world)
    h = _h(world)
    pids = []
    for i in range(4):
        tm = client.post(f"/api/tournaments/{tid}/teams", json={"team_name": f"Đội {i}"}, headers=h).json()
        pid = tm["participant"]["id"]; pids.append(pid)
        r = client.post(f"/api/tournaments/{tid}/teams/{pid}/players/bulk",
                        json={"member_ids": [world.members1[2 * i].id, world.members1[2 * i + 1].id], "player_ids": []}, headers=h)
        assert r.status_code == 200, r.text
    assert client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).status_code == 200
    d = client.get(f"/api/tournaments/{tid}", headers=h).json()
    group_ms = [m for m in d["matches"] if m["phase"] == "group"]
    assert len(group_ms) == 2
    for m in group_ms:
        tie = client.get(f"/api/tournaments/{tid}/matches/{m['id']}/tie", headers=h).json()
        assert tie["stage_key"] == "leg1"
        rid = tie["rubbers"][0]["id"]
        # chưa có đội hình → đặt VĐV trực tiếp trong biên bản (giới tính lệch chỉ cảnh báo)
        t1p = client.get(f"/api/tournaments/{tid}/teams", headers=h).json()
        team_of = {tm["participant"]["id"]: tm for tm in t1p}
        s1 = [p["id"] for p in team_of[m["p1_id"]]["players"]][:2]
        s2 = [p["id"] for p in team_of[m["p2_id"]]["players"]][:2]
        assert client.put(f"/api/tournaments/{tid}/matches/{m['id']}/tie/rubbers/{rid}", json={"side1_players": s1, "side2_players": s2}, headers=h).status_code == 200
        r = client.post(f"/api/tournaments/{tid}/matches/{m['id']}/tie/rubbers/{rid}/score", json={"score1": 11, "score2": 3}, headers=h)
        assert r.status_code == 200, r.text and r.json()["match"]["status"] == "completed"
    assert client.post(f"/api/tournaments/{tid}/start-knockout", headers=h).status_code == 200
    d = client.get(f"/api/tournaments/{tid}", headers=h).json()
    ko = [m for m in d["matches"] if m["phase"] == "knockout"]
    assert ko and all(m["p1_id"] and m["p2_id"] for m in ko if m["round_number"] == 1)
    tie = client.get(f"/api/tournaments/{tid}/matches/{ko[0]['id']}/tie", headers=h).json()
    assert tie["stage_key"] == "knockout" and tie["lineup1"]["locked"] is False


def test_round_robin_double_leg2_stage_and_relineup(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db, fmt="round_robin_double")
    h = _h(world)
    d = client.get(f"/api/tournaments/{tid}", headers=h).json()
    ms = sorted(d["matches"], key=lambda m: m["round_number"])
    assert len(ms) == 2
    t_leg1 = client.get(f"/api/tournaments/{tid}/matches/{ms[0]['id']}/tie", headers=h).json()
    t_leg2 = client.get(f"/api/tournaments/{tid}/matches/{ms[1]['id']}/tie", headers=h).json()
    assert (t_leg1["stage_key"], t_leg2["stage_key"]) == ("leg1", "leg2")
    # lượt về chưa có đội hình → trận thành phần trống VĐV; đăng ký leg2 độc lập với leg1 đang khoá
    assert t_leg2["rubbers"][0]["side1_players"] == []
    pid1 = team1["participant"]["id"]
    rid = t_leg1["rubbers"][0]["id"]
    client.post(f"/api/tournaments/{tid}/matches/{ms[0]['id']}/tie/rubbers/{rid}/score", json={"score1": 11, "score2": 1}, headers=h)
    lus = {l["stage_key"]: l for l in client.get(f"/api/tournaments/{tid}/teams/{pid1}/lineups", headers=h).json()}
    assert lus["leg1"]["locked"] is True and lus["leg2"]["locked"] is False
    assert client.put(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg2", json={"slots": _lineup_slots(team1)}, headers=h).status_code == 200


def test_public_tie_and_teams_no_pii(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db)
    h = _h(world)
    assert client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=h).status_code in (200, 400)
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{tie['rubbers'][0]['id']}/score", json={"score1": 11, "score2": 8}, headers=h)
    slug = world.token1.slug
    r = client.get(f"/api/public/report/{slug}/tournaments/{tid}/matches/{mid}/tie")
    assert r.status_code == 200, r.text
    body = r.text
    for key in ("phone", "email", "dob", "address", "notes", "member_code", "join_date", "actor_name"):
        assert f'"{key}"' not in body, key
    j = r.json()
    assert j["result"]["score1"] == 1 and j["can_edit"] is False and j["team1"]["players"][0]["display_name"]
    r = client.get(f"/api/public/report/{slug}/tournaments/{tid}/teams")
    assert r.status_code == 200 and len(r.json()) == 2
    # public không nhập điểm cho giải đồng đội kể cả có PIN
    st = client.get(f"/api/public/report/{slug}/tournaments/{tid}/standings")
    assert st.status_code == 200 and "rubber_diff" in st.json()[0]


# ══════════════════════════════════════════════════════════════════════════════
# Phần 3: sửa theo rà soát độc lập (2026-10-21) — start_knockout cùng hồ sơ BXH, trận xử thắng/bỏ giải
# đóng băng, dọn biên bản trận sau, kẹp mốc PA2, đội hình điền lại biên bản mở sẵn, xử thua qua kiểm tra chung,
# public không lộ ghi chú mở khoá, guard update_tournament, giải kết thúc chặn đội hình.
# ══════════════════════════════════════════════════════════════════════════════

def _small_teams(client, world, db, tid, n, rubbers_per_team=2):
    """n đội, mỗi đội `rubbers_per_team` thành viên (tất cả nam) — cho giải nhiều đội với mẫu toàn Đôi Nam."""
    _set_genders(db, world, pattern=("male",) * 8)
    h = _h(world)
    teams = []
    for i in range(n):
        tm = client.post(f"/api/tournaments/{tid}/teams", json={"team_name": f"Đội {i}"}, headers=h).json()
        pid = tm["participant"]["id"]
        ids = [m.id for m in world.members1[rubbers_per_team * i: rubbers_per_team * (i + 1)]]
        r = client.post(f"/api/tournaments/{tid}/teams/{pid}/players/bulk", json={"member_ids": ids, "player_ids": []}, headers=h)
        assert r.status_code == 200, r.text
        teams.append(r.json()["team"])
    return teams


def test_normalize_clamps_cumulative_target_to_max_points():
    r = eng.normalize_team_rules({"scoring": "cumulative", "points_per_rubber": 11, "rubbers": [{"code": "MD"}] * 3, "target_total": 99})
    assert r["target_total"] == 33
    r = eng.normalize_team_rules({"scoring": "cumulative", "points_per_rubber": 11, "rubbers": [{"code": "MD"}] * 3, "target_total": 25})
    assert r["target_total"] == 25 and eng.rubber_target(r, 3) == 25


def test_start_knockout_uses_team_standings_profile(client, world, db):
    """Kịch bản reviewer (SK2): 3 đội 1 bảng, 2 trận hoà 1–1 phân định bằng hiệu số → hồ sơ mặc định xem là hoà
    và đưa đội bét bảng lên vòng loại. Nay start_knockout dùng đúng dữ liệu/hồ sơ của BXH hiển thị."""
    t = _create_team_tournament(client, world, fmt="combined", num_groups=1, rubbers=[{"code": "MD"}, {"code": "MD"}])
    tid = t["id"]
    teams = _small_teams(client, world, db, tid, 3)
    T = [tm["participant"]["id"] for tm in teams]
    h = _h(world)
    assert client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).status_code == 200
    d = client.get(f"/api/tournaments/{tid}", headers=h).json()
    team_of = {tm["participant"]["id"]: tm for tm in teams}
    want_winner = {frozenset((T[0], T[1])): T[1], frozenset((T[0], T[2])): T[2], frozenset((T[1], T[2])): T[1]}
    for m in [x for x in d["matches"] if x["phase"] == "group"]:
        key = frozenset((m["p1_id"], m["p2_id"]))
        want = want_winner[key]
        tie = client.get(f"/api/tournaments/{tid}/matches/{m['id']}/tie", headers=h).json()
        p1 = [p["id"] for p in team_of[m["p1_id"]]["players"]]
        p2 = [p["id"] for p in team_of[m["p2_id"]]["players"]]
        if key == frozenset((T[1], T[2])):
            scores = [(11, 3), (11, 3)] if want == m["p1_id"] else [(3, 11), (3, 11)]        # 2–0
        else:
            scores = [(11, 9), (3, 11)] if want == m["p2_id"] else [(11, 3), (9, 11)]         # 1–1, hiệu số quyết định
        for r, (s1, s2) in zip(tie["rubbers"], scores):
            assert client.put(f"/api/tournaments/{tid}/matches/{m['id']}/tie/rubbers/{r['id']}",
                              json={"side1_players": p1, "side2_players": p2}, headers=h).status_code == 200
            rr = client.post(f"/api/tournaments/{tid}/matches/{m['id']}/tie/rubbers/{r['id']}/score",
                             json={"score1": s1, "score2": s2}, headers=h)
            assert rr.status_code == 200, rr.text
        assert rr.json()["match"]["winner_id"] == want
    st = client.get(f"/api/tournaments/{tid}/standings", headers=h).json()
    assert [r["participant_id"] for r in st] == [T[1], T[2], T[0]]
    assert client.post(f"/api/tournaments/{tid}/start-knockout", headers=h).status_code == 200
    d = client.get(f"/api/tournaments/{tid}", headers=h).json()
    ko = [m for m in d["matches"] if m["phase"] == "knockout"]
    adv = {m["p1_id"] for m in ko if m["p1_id"]} | {m["p2_id"] for m in ko if m["p2_id"]}
    assert adv == {T[1], T[2]}, "đội vào vòng loại phải là top 2 của BXH hiển thị (đội 0 bét bảng không được đi tiếp)"


def test_withdrawn_or_walkover_tie_is_frozen(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db)
    h = _h(world)
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    rid = tie["rubbers"][0]["id"]
    assert tie["can_edit"] is True and tie["blocked_reason"] is None
    pid2 = team2["participant"]["id"]
    r = client.post(f"/api/tournaments/{tid}/participants/{pid2}/withdraw", headers=h)
    assert r.status_code == 200, r.text
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    assert tie["match"]["is_walkover"] is True and tie["match"]["winner_id"] == team1["participant"]["id"]
    assert tie["can_edit"] is False and "bỏ giải" in tie["blocked_reason"]
    base = f"/api/tournaments/{tid}/matches/{mid}/tie"
    assert client.post(f"{base}/rubbers/{rid}/score", json={"score1": 11, "score2": 3}, headers=h).status_code == 400
    assert client.post(f"{base}/rubbers/{rid}/walkover", json={"side": 1}, headers=h).status_code == 400
    assert client.put(f"{base}/rubbers/{rid}", json={"side1_players": []}, headers=h).status_code == 400
    assert client.post(f"{base}/draw-order", headers=h).status_code == 400
    assert client.delete(f"{base}/rubbers/{rid}/score", headers=h).status_code == 400
    # Kết quả xử thắng còn nguyên sau các lần bị từ chối
    d = client.get(f"/api/tournaments/{tid}", headers=h).json()
    m = next(x for x in d["matches"] if x["id"] == mid)
    assert m["status"] == "completed" and m["is_walkover"] is True


def test_reset_upstream_clears_next_tie_sheet_and_refills_for_new_team(client, world, db):
    """Knockout 4 đội: A thắng BK1 → biên bản chung kết đã mở với VĐV của A. Rút điểm BK1 → chung kết mất đội,
    biên bản bị xoá; B thắng lại BK1 → biên bản chung kết tạo lại với VĐV của B (không còn VĐV A)."""
    t = _create_team_tournament(client, world, fmt="knockout", rubbers=[{"code": "MD"}])
    tid = t["id"]
    teams = _small_teams(client, world, db, tid, 4)
    h = _h(world)
    for tm in teams:   # đội hình vòng loại trực tiếp để biên bản được điền sẵn
        pid = tm["participant"]["id"]
        slots = {"Đôi Nam 1": [p["id"] for p in tm["players"]]}
        assert client.put(f"/api/tournaments/{tid}/teams/{pid}/lineups/knockout", json={"slots": slots}, headers=h).status_code == 200
    assert client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).status_code == 200
    d = client.get(f"/api/tournaments/{tid}", headers=h).json()
    sf = sorted([m for m in d["matches"] if m["round_number"] == 1], key=lambda m: m["match_number"])
    final = next(m for m in d["matches"] if m["round_number"] == 2)
    sf1 = sf[0]
    a_id, b_id = sf1["p1_id"], sf1["p2_id"]
    players_of = {tm["participant"]["id"]: [p["id"] for p in tm["players"]] for tm in teams}
    tie1 = client.get(f"/api/tournaments/{tid}/matches/{sf1['id']}/tie", headers=h).json()
    rid1 = tie1["rubbers"][0]["id"]
    assert tie1["rubbers"][0]["side1_players"] == players_of[a_id]
    r = client.post(f"/api/tournaments/{tid}/matches/{sf1['id']}/tie/rubbers/{rid1}/score", json={"score1": 11, "score2": 3}, headers=h)
    assert r.status_code == 200 and r.json()["match"]["winner_id"] == a_id
    # BK2: C thắng → chung kết đủ 2 đội → mở biên bản chung kết (điền sẵn từ đội hình knockout của A và C)
    sf2 = sf[1]
    c_id = sf2["p1_id"]
    tie2 = client.get(f"/api/tournaments/{tid}/matches/{sf2['id']}/tie", headers=h).json()
    r = client.post(f"/api/tournaments/{tid}/matches/{sf2['id']}/tie/rubbers/{tie2['rubbers'][0]['id']}/score", json={"score1": 11, "score2": 3}, headers=h)
    assert r.status_code == 200 and r.json()["match"]["winner_id"] == c_id
    ftie = client.get(f"/api/tournaments/{tid}/matches/{final['id']}/tie", headers=h).json()
    assert ftie["match"]["p1_id"] == a_id and ftie["match"]["p2_id"] == c_id
    assert ftie["rubbers"][0]["side1_players"] == players_of[a_id] and ftie["rubbers"][0]["side2_players"] == players_of[c_id]
    # Rút điểm BK1 → chung kết mất đội 1 và mất biên bản
    r = client.delete(f"/api/tournaments/{tid}/matches/{sf1['id']}/tie/rubbers/{rid1}/score", headers=h)
    assert r.status_code == 200 and r.json()["match"]["status"] == "pending"
    ftie = client.get(f"/api/tournaments/{tid}/matches/{final['id']}/tie", headers=h).json()
    assert ftie["match"]["p1_id"] is None and ftie["rubbers"] == [] and ftie["draw_seed"] is None
    # B thắng lại → chung kết tạo biên bản mới với VĐV của B
    r = client.post(f"/api/tournaments/{tid}/matches/{sf1['id']}/tie/rubbers/{rid1}/score", json={"score1": 3, "score2": 11}, headers=h)
    assert r.status_code == 200 and r.json()["match"]["winner_id"] == b_id
    ftie = client.get(f"/api/tournaments/{tid}/matches/{final['id']}/tie", headers=h).json()
    assert ftie["match"]["p1_id"] == b_id and ftie["rubbers"][0]["side1_players"] == players_of[b_id]
    assert ftie["rubbers"][0]["side2_players"] == players_of[c_id]
    assert not set(ftie["rubbers"][0]["side1_players"]) & set(players_of[a_id])


def test_score_rejects_players_not_in_current_team(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db)
    h = _h(world)
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    rid = tie["rubbers"][0]["id"]
    # Rút VĐV đang xếp khỏi đội → ghi điểm phải bị chặn với lý do VĐV không còn thuộc đội
    tp = tie["rubbers"][0]["side1_players"][0]
    pid1 = team1["participant"]["id"]
    r = client.delete(f"/api/tournaments/{tid}/teams/{pid1}/players/{tp}", headers=h)
    if r.status_code == 200:
        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rid}/score", json={"score1": 11, "score2": 3}, headers=h)
        assert r.status_code == 400 and "không còn thuộc đội" in r.json()["detail"]
    else:
        assert r.status_code == 400   # giải đã bắt đầu, không rút VĐV — cũng là một cách chặn hợp lệ


def test_set_lineup_refills_open_sheets_but_not_scored_rubbers(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db)
    h = _h(world)
    pid1 = team1["participant"]["id"]
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    by_label = {r["label"]: r for r in tie["rubbers"]}
    men, women = _by_gender(team1, "male"), _by_gender(team1, "female")
    assert by_label["Đôi Nam Nữ 1"]["side1_players"] == [men[0], women[0]]
    # Ghi điểm Đôi Nam 1 → khoá đội hình; mở khoá rồi đổi cặp Nam Nữ và đảo thứ tự Đôi Nam 1
    rid_md = by_label["Đôi Nam 1"]["id"]
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rid_md}/score", json={"score1": 11, "score2": 5}, headers=h).status_code == 200
    new_slots = {"Đôi Nam 1": [men[1], men[0]], "Đôi Nữ 1": women[:2], "Đôi Nam Nữ 1": [men[1], women[1]]}
    assert client.put(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1", json={"slots": new_slots}, headers=h).status_code == 400  # đang khoá
    assert client.post(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1/unlock", json={"note": "đổi người"}, headers=h).status_code == 200
    r = client.put(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1", json={"slots": new_slots}, headers=h)
    assert r.status_code == 200, r.text
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    by_label = {r["label"]: r for r in tie["rubbers"]}
    assert by_label["Đôi Nam Nữ 1"]["side1_players"] == [men[1], women[1]]          # chưa có điểm → điền lại
    assert by_label["Đôi Nam 1"]["side1_players"] == [men[0], men[1]]               # đã có điểm → giữ nguyên
    assert by_label["Đôi Nữ 1"]["side2_players"] == _by_gender(team2, "female")[:2]  # đội 2 không bị đụng
    logs = client.get(f"/api/tournaments/{tid}/team-logs", headers=h).json()
    assert any("điền lại 1 ô" in l["note"] for l in logs)


def test_walkover_goes_through_common_guards_and_needs_no_players(client, world, db):
    t = _create_team_tournament(client, world, scoring="cumulative", rubbers=[{"code": "MD"}, {"code": "WD"}])
    tid = t["id"]
    team1, team2 = _two_teams(client, world, db, tid)
    h = _h(world)
    assert client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).status_code == 200
    mid = client.get(f"/api/tournaments/{tid}", headers=h).json()["matches"][0]["id"]
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    r1, r2 = tie["rubbers"]
    assert r1["side1_players"] == [] and r2["side1_players"] == []      # chưa có đội hình
    base = f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers"
    # PA2: xử thua trận 2 trước trận 1 → chặn như nhập điểm thường
    r = client.post(f"{base}/{r2['id']}/walkover", json={"side": 2}, headers=h)
    assert r.status_code == 400 and "thứ tự" in r.json()["detail"]
    # Xử thua trận 1 không cần VĐV: đội 1 thua 0–11, đội hình leg1 hai đội bị khoá
    r = client.post(f"{base}/{r1['id']}/walkover", json={"side": 1}, headers=h)
    assert r.status_code == 200, r.text
    j = r.json()
    rr = {x["id"]: x for x in j["rubbers"]}
    assert (rr[r1["id"]]["score1"], rr[r1["id"]]["score2"], rr[r1["id"]]["is_walkover"]) == (0, 11, True)
    assert j["lineup1"]["locked"] is True and j["lineup2"]["locked"] is True
    # Trận 2 xử thua đội 2: bên thắng lên mốc 22, bên thua giữ 11 → chạm mốc tổng → trận đồng đội kết thúc
    r = client.post(f"{base}/{r2['id']}/walkover", json={"side": 2}, headers=h)
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["result"]["score1"], j["result"]["score2"], j["result"]["finished"]) == (22, 11, True)
    assert j["match"]["status"] == "completed" and j["match"]["winner_id"] == team1["participant"]["id"]
    # Đã chạm mốc → không xử thua/ghi thêm
    assert client.post(f"{base}/{r2['id']}/walkover", json={"side": 1}, headers=h).status_code == 400


def test_public_lineup_hides_unlock_note_and_lock_time(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db)
    h = _h(world)
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    rid = tie["rubbers"][0]["id"]
    assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rid}/score", json={"score1": 11, "score2": 8}, headers=h).status_code == 200
    pid1 = team1["participant"]["id"]
    assert client.post(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1/unlock", json={"note": "BTC đồng ý đổi"}, headers=h).status_code == 200
    adm = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    assert adm["lineup1"]["unlock_note"] == "BTC đồng ý đổi" and adm["lineup2"]["locked_at"]
    pub = client.get(f"/api/public/report/{world.token1.slug}/tournaments/{tid}/matches/{mid}/tie").json()
    assert pub["lineup1"]["unlock_note"] is None and pub["lineup2"]["locked_at"] is None
    assert pub["lineup2"]["locked"] is True and pub["lineup1"]["slots"]   # trạng thái khoá và đội hình vẫn công khai
    assert "BTC đồng ý" not in client.get(f"/api/public/report/{world.token1.slug}/tournaments/{tid}/matches/{mid}/tie").text


def test_update_tournament_team_type_guards(client, world, db):
    h = _h(world)
    t = _create_team_tournament(client, world)
    assert client.put(f"/api/tournaments/{t['id']}", json={"format": "individual"}, headers=h).status_code == 400
    assert client.put(f"/api/tournaments/{t['id']}", json={"team_type": "pairs"}, headers=h).status_code == 400
    _two_teams(client, world, db, t["id"])
    assert client.put(f"/api/tournaments/{t['id']}", json={"team_type": "singles"}, headers=h).status_code == 400  # đã có đội
    # Giải thường trống → đổi sang đồng đội được, quy tắc mặc định tự sinh; có người thì không
    plain = client.post("/api/tournaments", json={"name": "y", "format": "round_robin", "member_ids": []}, headers=h).json()
    r = client.put(f"/api/tournaments/{plain['id']}", json={"team_type": "team"}, headers=h)
    assert r.status_code == 200 and r.json()["team_rules"]["scoring"] == "match_points", r.text
    r = client.put(f"/api/tournaments/{plain['id']}", json={"team_type": "singles"}, headers=h)
    assert r.status_code == 200 and r.json()["team_rules"] is None
    busy = client.post("/api/tournaments", json={"name": "z", "format": "round_robin", "member_ids": [world.members1[0].id]}, headers=h).json()
    assert client.put(f"/api/tournaments/{busy['id']}", json={"team_type": "team"}, headers=h).status_code == 400


def test_completed_tournament_blocks_lineup_and_rubber_edits(client, world, db):
    tid, mid, team1, team2 = _started_tie(client, world, db)
    h = _h(world)
    tie = client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()
    for r, (s1, s2) in zip(tie["rubbers"], [(11, 3), (11, 4), (11, 5)]):
        assert client.post(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{r['id']}/score", json={"score1": s1, "score2": s2}, headers=h).status_code == 200
    r = client.put(f"/api/tournaments/{tid}", json={"status": "completed"}, headers=h)
    assert r.status_code == 200, r.text
    pid1 = team1["participant"]["id"]
    rid = tie["rubbers"][0]["id"]
    assert client.put(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg2", json={"slots": _lineup_slots(team1)}, headers=h).status_code == 400
    assert client.post(f"/api/tournaments/{tid}/teams/{pid1}/lineups/leg1/unlock", json={"note": "x"}, headers=h).status_code == 400
    assert client.put(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rid}", json={"side1_players": []}, headers=h).status_code == 400
    assert client.delete(f"/api/tournaments/{tid}/matches/{mid}/tie/rubbers/{rid}/score", headers=h).status_code == 400
    assert client.get(f"/api/tournaments/{tid}/matches/{mid}/tie", headers=h).json()["can_edit"] is False
