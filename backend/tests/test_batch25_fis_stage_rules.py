"""Mẫu FIS đợt 4 (2026-10-26): thể loại Đôi tự do (FD), bộ thể thức riêng cho vòng loại trực tiếp, dừng khi thắng quá nửa,
tranh hạng 5-6 / 7-8 cho thể thức kết hợp 2 bảng."""
import tournament_engine as eng
from tests.test_batch14_third_place_toggle import _create, _score, _h as _h14


def test_free_doubles_code_skips_gender_check():
    e, w = eng.rubber_players_check("FD", [1, 2], {1: "male", 2: None})
    assert e == [] and w == []
    e, _ = eng.rubber_players_check("FD", [1], {1: "male"})
    assert e and "cần 2 VĐV" in e[0]
    r = eng.normalize_team_rules({"rubbers": [{"code": "FD"}, {"code": "FD"}]})
    assert [x["label"] for x in r["rubbers"]] == ["Đôi tự do 1", "Đôi tự do 2"]


def test_knockout_rubbers_and_rules_for_stage():
    r = eng.normalize_team_rules({"scoring": "cumulative", "points_per_rubber": 11,
                                  "rubbers": [{"code": "MD"}, {"code": "WD"}],
                                  "knockout_rubbers": [{"code": "MD"}, {"code": "WD"}, {"code": "XD"}, {"code": "FD"}],
                                  "knockout_play_all": False})
    assert len(r["knockout_rubbers"]) == 4 and r["knockout_play_all"] is False and r["target_total"] == 22
    assert eng.rules_for_stage(r, "leg1")["rubbers"] == r["rubbers"]
    ko = eng.rules_for_stage(r, "knockout")
    assert len(ko["rubbers"]) == 4 and ko["target_total"] == 44 and ko["play_all"] is False
    r2 = eng.normalize_team_rules(None)
    assert r2["knockout_rubbers"] is None and r2["knockout_play_all"] is None
    assert eng.rules_for_stage(r2, "knockout") == r2


def test_tie_result_stops_early_when_play_all_false():
    rules = eng.normalize_team_rules({"rubbers": [{"code": "MD"}] * 5, "play_all": False})
    done = lambda i, s1, s2: {"order_index": i, "status": "completed", "score1": s1, "score2": s2}
    rs = [done(1, 11, 5), done(2, 11, 6), done(3, 11, 7), {"order_index": 4, "status": "pending"}, {"order_index": 5, "status": "pending"}]
    res = eng.tie_result(rules, rs)
    assert res["finished"] is True and res["winner_side"] == 1 and "dừng sớm" in res["detail"]
    assert eng.tie_result(eng.normalize_team_rules({"rubbers": [{"code": "MD"}] * 5}), rs)["finished"] is False


def test_placement_matches_created_on_start_knockout(client, world):
    tid = _create(client, world, world.members1[:8], fmt="combined", num_groups=2, placement_matches_enabled=True)
    h = _h14(world)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=h).json()
    assert d["placement_matches_enabled"] is True
    for m in [x for x in d["matches"] if x["phase"] == "group"]:
        assert _score(client, world, tid, m["id"], 11, 5).status_code == 200
    r = client.post(f"/api/tournaments/{tid}/start-knockout", headers=h)
    assert r.status_code == 200, r.text
    ko = [m for m in r.json()["matches"] if m["phase"] == "knockout"]
    names = {m["round_name"] for m in ko}
    assert {"Tranh hạng 5-6", "Tranh hạng 7-8"} <= names
    p56 = next(m for m in ko if m["round_name"] == "Tranh hạng 5-6")
    p78 = next(m for m in ko if m["round_name"] == "Tranh hạng 7-8")
    assert p56["p1_id"] and p56["p2_id"] and p78["p1_id"] and p78["p2_id"]
    assert p56["next_match_id"] is None
    for g in ("A", "B"):
        rows = client.get(f"/api/tournaments/{tid}/standings", params={"group": g}, headers=h).json()
        assert rows[2]["participant_id"] in (p56["p1_id"], p56["p2_id"])
        assert rows[3]["participant_id"] in (p78["p1_id"], p78["p2_id"])
    tid2 = _create(client, world, world.members1[:8], fmt="combined", num_groups=2)
    d2 = client.post(f"/api/tournaments/{tid2}/generate", headers=h).json()
    for m in [x for x in d2["matches"] if x["phase"] == "group"]:
        _score(client, world, tid2, m["id"], 11, 5)
    ko2 = [m for m in client.post(f"/api/tournaments/{tid2}/start-knockout", headers=h).json()["matches"] if m["phase"] == "knockout"]
    assert not any(m["round_name"] in ("Tranh hạng 5-6", "Tranh hạng 7-8") for m in ko2)
