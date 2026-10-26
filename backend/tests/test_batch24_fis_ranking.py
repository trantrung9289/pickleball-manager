"""Mẫu FIS đợt 3 (2026-10-26): xếp hạng "point_diff" (hiệu số điểm → điểm ghi → đối đầu) + breakdown BXH theo thể loại /
lượt / từng cặp đấu + lọc theo lượt (gộp yêu cầu BXH 2026-10-23)."""
import tournament_engine as eng
from tests.test_batch19_team_format import _create_team_tournament, _two_teams, _h, _teams, _tie


def test_ranking_normalized_and_profile():
    assert eng.normalize_team_rules(None)["ranking"] == "tie_points"
    assert eng.normalize_team_rules({"ranking": "point_diff"})["ranking"] == "point_diff"
    assert eng.normalize_team_rules({"ranking": "weird"})["ranking"] == "tie_points"


def test_point_diff_profile_orders_by_points_diff_not_tie_wins():
    # Đội 2 thắng 2 trận đồng đội sít sao, đội 1 thắng 1 trận đậm → FIS: đội 1 (hiệu số +20) trên đội 2 (+2)
    ms = [_tie(1, 3, 3, 0, 33, 13), _tie(2, 1, 2, 1, 30, 29), _tie(2, 3, 2, 1, 31, 30)]
    rows = eng.compute_standings(ms, _teams(3), "A", profile="team_point_diff")
    assert [r["participant_id"] for r in rows] == [1, 2, 3]
    by = {r["participant_id"]: r for r in rows}
    assert by[1]["pts_diff"] == 19 and by[2]["pts_diff"] == 2 and by[1]["points"] == 1 and by[2]["points"] == 2
    # Cùng hiệu số & điểm ghi → đối đầu theo điểm nhỏ; vẫn bằng → needs_draw (tie-break ngoài hệ thống)
    ms2 = [_tie(1, 2, 2, 1, 30, 30, winner=1), _tie(2, 3, 2, 1, 30, 30, winner=2), _tie(3, 1, 2, 1, 30, 30, winner=3)]
    rows2 = eng.compute_standings(ms2, _teams(3), "A", profile="team_point_diff")
    assert all(r["needs_draw"] for r in rows2)


def test_breakdown_by_category_leg_and_h2h():
    rules = eng.normalize_team_rules({"rubbers": [{"code": "MD"}, {"code": "WD"}]})
    parts = [{"id": 1, "team_name": "A"}, {"id": 2, "team_name": "B"}]
    ms = [{
        "id": 10, "p1_id": 1, "p2_id": 2, "status": "completed", "winner_id": 1, "is_walkover": False, "round_name": "Vòng 1",
        "score1": 2, "score2": 0, "stage_key": "leg1",
        "rubbers": [{"label": "Đôi Nam 1", "code": "MD", "status": "completed", "score1": 11, "score2": 5},
                    {"label": "Đôi Nữ 1", "code": "WD", "status": "completed", "score1": 11, "score2": 9}],
    }, {
        "id": 11, "p1_id": 2, "p2_id": 1, "status": "in_progress", "winner_id": None, "is_walkover": False, "round_name": "Vòng 2",
        "score1": 1, "score2": 0, "stage_key": "leg2",
        "rubbers": [{"label": "Đôi Nam 1", "code": "MD", "status": "completed", "score1": 11, "score2": 7},
                    {"label": "Đôi Nữ 1", "code": "WD", "status": "pending"}],
    }]
    bd = eng.team_standings_breakdown(ms, parts, rules)
    a = bd[1]
    assert a["by_category"]["Đôi Nam 1"] == {"played": 2, "won": 1, "lost": 1, "pts_for": 18, "pts_against": 16}
    assert a["by_category"]["Đôi Nữ 1"] == {"played": 1, "won": 1, "lost": 0, "pts_for": 11, "pts_against": 9}
    assert a["by_leg"]["leg1"]["ties_won"] == 1 and a["by_leg"]["leg2"]["ties_played"] == 0
    assert a["by_leg"]["leg2"]["rubbers_lost"] == 1
    h = a["h2h"][0]
    assert h["opponent_id"] == 2 and h["legs"]["leg1"]["result"] == "W" and h["legs"]["leg2"]["result"] is None
    assert h["legs"]["leg1"]["rubbers"][0]["for"] == 11 and h["legs"]["leg2"]["rubbers"][1]["for"] is None
    assert bd[2]["h2h"][0]["legs"]["leg1"]["score_for"] == 0


def test_standings_api_has_breakdown_and_leg_filter(client, world, db):
    t = _create_team_tournament(client, world, fmt="round_robin_double", team_rules={
        "scoring": "match_points", "points_per_rubber": 11, "win_by_two": True, "ranking": "point_diff",
        "rubbers": [{"code": "MD"}, {"code": "WD"}]})
    tid = t["id"]; h = _h(world)
    assert t["team_rules"]["ranking"] == "point_diff"
    team1, team2 = _two_teams(client, world, db, tid)
    client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=h)
    tt = client.post(f"/api/tournaments/{tid}/generate", headers=h).json()
    ms = sorted(tt["matches"], key=lambda m: m["round_number"])
    assert len(ms) == 2   # 2 đội vòng tròn 2 lượt → lượt đi + lượt về
    rows = client.get(f"/api/tournaments/{tid}/standings", headers=h).json()
    assert rows[0]["ranking"] == "point_diff" and "breakdown" in rows[0]
    assert set(rows[0]["breakdown"]["by_category"]) == {"Đôi Nam 1", "Đôi Nữ 1"}
    # Lọc theo lượt: lượt về chưa có trận nào → không có trận → mọi chỉ số 0, h2h chỉ có leg2 rỗng
    r2 = client.get(f"/api/tournaments/{tid}/standings", params={"leg": "leg2"}, headers=h).json()
    assert all(r["played"] == 0 for r in r2)
    assert set(r2[0]["breakdown"]["h2h"][0]["legs"]) == {"leg2"}
    r1 = client.get(f"/api/tournaments/{tid}/standings", params={"leg": "leg1"}, headers=h).json()
    assert set(r1[0]["breakdown"]["h2h"][0]["legs"]) == {"leg1"}
    # Public cùng cấu trúc
    pub = client.get(f"/api/public/report/{world.token1.slug}/tournaments/{tid}/standings", params={"leg": "leg1"}).json()
    assert pub[0]["ranking"] == "point_diff" and "breakdown" in pub[0]
