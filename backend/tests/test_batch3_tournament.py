"""Đợt 3: logic giải đấu — khách mời, chia bảng combined, bye knockout, rollback, tie-break, bảo vệ trạng thái."""
import pytest
from conftest import World

import tournament_engine as eng


def _h(world):
    return World.headers(world.admin1, world.club1)


def _create(client, world, members, fmt="round_robin", **extra):
    body = {"name": "T", "format": fmt, "member_ids": [m.id for m in members]}
    body.update(extra)
    r = client.post("/api/tournaments", json=body, headers=_h(world))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _detail(client, world, tid):
    return client.get(f"/api/tournaments/{tid}", headers=_h(world)).json()


def _score(client, world, tid, mid, s1, s2):
    return client.post(f"/api/tournaments/{tid}/matches/{mid}/score", json={"score1": s1, "score2": s2}, headers=_h(world))


# ── Engine ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("n", range(2, 10))
def test_knockout_bracket_no_double_bye_and_byes_to_top_seeds(n):
    ms = eng._knockout_bracket(list(range(1, n + 1)))
    r1 = [m for m in ms if m["round"] == 1]
    assert not any(m["p1"] is None and m["p2"] is None for m in r1)
    size = len(r1) * 2
    assert len(ms) == size - 1
    byes = sorted(m["p1"] or m["p2"] for m in r1 if m["p1"] is None or m["p2"] is None)
    assert byes == list(range(1, size - n + 1))  # hạt giống 1..k được bye
    assert all(m["next_match_idx"] is not None for m in ms if m["round"] < max(x["round"] for x in ms))


def test_knockout_bracket_requires_two():
    for bad in ([], [1]):
        with pytest.raises(ValueError):
            eng._knockout_bracket(bad)


def test_tiebreak_head_to_head_before_goal_diff():
    parts = [{"id": i, "member_id": None, "team_name": f"P{i}"} for i in (1, 2, 3, 4)]
    # P1 & P2 cùng 2 điểm; P1 thắng P2 đối đầu nhưng hiệu số toàn giải thấp hơn
    ms = [
        {"p1_id": 1, "p2_id": 2, "score1": 11, "score2": 9, "status": "completed"},
        {"p1_id": 1, "p2_id": 3, "score1": 11, "score2": 10, "status": "completed"},
        {"p1_id": 2, "p2_id": 3, "score1": 11, "score2": 0, "status": "completed"},
        {"p1_id": 2, "p2_id": 4, "score1": 11, "score2": 0, "status": "completed"},
        {"p1_id": 4, "p2_id": 1, "score1": 11, "score2": 0, "status": "completed"},
    ]
    rows = eng.compute_standings(ms, parts)
    by_name = {r["team_name"]: r for r in rows}
    assert by_name["P1"]["points"] == by_name["P2"]["points"] == 2
    assert by_name["P2"]["goal_diff"] > by_name["P1"]["goal_diff"]
    assert by_name["P1"]["rank"] == 1 and by_name["P2"]["rank"] == 2


def test_tiebreak_three_way_circle_falls_back_to_goal_diff():
    parts = [{"id": i, "member_id": None, "team_name": f"P{i}"} for i in (1, 2, 3)]
    ms = [{"p1_id": 1, "p2_id": 2, "score1": 11, "score2": 9, "status": "completed"},
          {"p1_id": 2, "p2_id": 3, "score1": 11, "score2": 0, "status": "completed"},
          {"p1_id": 3, "p2_id": 1, "score1": 11, "score2": 5, "status": "completed"}]
    rows = eng.compute_standings(ms, parts)
    assert [r["team_name"] for r in rows] == ["P2", "P1", "P3"]


# ── API: sinh lịch ─────────────────────────────────────────────────────────

def test_generate_with_guest_works_for_all_formats(client, world):
    for fmt in ("round_robin", "round_robin_double", "knockout", "individual"):
        tid = _create(client, world, world.members1[:3], fmt=fmt, player_ids=[world.guest1.id])
        r = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
        assert r.status_code == 200, (fmt, r.text)
        assert r.json()["status"] == "active" and r.json()["matches"]


def test_combined_groups_consistent_after_shuffle(client, world):
    tid = _create(client, world, world.members1[:7], fmt="combined", num_groups=3)
    for _ in range(5):
        d = client.post(f"/api/tournaments/{tid}/generate?shuffle=true", headers=_h(world)).json()
        grp = {p["id"]: p["group_name"] for p in d["participants"]}
        assert set(grp.values()) == {"A", "B", "C"}
        for m in d["matches"]:
            assert grp[m["p1_id"]] == m["group_name"] == grp[m["p2_id"]], m


def test_generate_validation(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:1], fmt="knockout")
    assert client.post(f"/api/tournaments/{tid}/generate", headers=h).status_code == 400
    tid = _create(client, world, world.members1[:3], fmt="combined", num_groups=2)
    assert client.post(f"/api/tournaments/{tid}/generate", headers=h).status_code == 400  # 2 bảng cần ≥4
    r = client.post("/api/tournaments", json={"name": "x", "format": "combined", "num_groups": 0,
                    "member_ids": [world.members1[0].id]}, headers=h)
    assert r.status_code == 422
    r = client.post("/api/tournaments", json={"name": "x", "format": "round_robin", "team_type": "doubles",
                    "teams": [{"member_id": world.members1[0].id}]}, headers=h)
    assert r.status_code == 400  # đôi thiếu partner


def test_regenerate_requires_force_when_results_exist_and_blocked_when_completed(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:4])
    d = client.post(f"/api/tournaments/{tid}/generate", headers=h).json()
    assert _score(client, world, tid, d["matches"][0]["id"], 11, 5).status_code == 200
    assert client.post(f"/api/tournaments/{tid}/generate", headers=h).status_code == 400
    assert client.post(f"/api/tournaments/{tid}/generate?force=true", headers=h).status_code == 200
    assert all(m["score1"] is None for m in _detail(client, world, tid)["matches"])
    client.put(f"/api/tournaments/{tid}", json={"status": "completed"}, headers=h)
    r = client.post(f"/api/tournaments/{tid}/generate?force=true", headers=h)
    assert r.status_code == 400
    assert _detail(client, world, tid)["status"] == "completed"


# ── API: knockout bye + rollback ───────────────────────────────────────────

def test_knockout_bye_auto_advances_and_tournament_can_finish(client, world):
    for n in (3, 5, 6):
        tid = _create(client, world, world.members1[:n], fmt="knockout")
        d = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=_h(world)).json()
        ms = {m["id"]: m for m in d["matches"]}
        byes = [m for m in ms.values() if m["round_number"] == 1 and (m["p1_id"] is None) != (m["p2_id"] is None)]
        assert byes and all(m["status"] == "completed" and m["winner_id"] for m in byes)
        for b in byes:
            nxt = ms[b["next_match_id"]]
            assert (nxt["p1_id"] if b["next_match_slot"] == 1 else nxt["p2_id"]) == b["winner_id"]
        assert not any(m["p1_id"] is None and m["p2_id"] is None for m in ms.values() if m["round_number"] == 1)
        # Chấm hết mọi trận theo thứ tự → chung kết có 2 đội và có nhà vô địch
        while True:
            d = _detail(client, world, tid)
            playable = [m for m in d["matches"] if m["status"] != "completed" and m["p1_id"] and m["p2_id"]]
            if not playable:
                break
            assert _score(client, world, tid, playable[0]["id"], 11, 7).status_code == 200
        final = max(d["matches"], key=lambda m: m["round_number"])
        assert final["status"] == "completed" and final["winner_id"], n


def test_editing_semifinal_resets_final(client, world):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    d = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=_h(world)).json()
    sf = sorted([m for m in d["matches"] if m["round_number"] == 1], key=lambda m: m["match_number"])
    final = [m for m in d["matches"] if m["round_number"] == 2][0]
    assert _score(client, world, tid, sf[0]["id"], 11, 5).status_code == 200   # p1 của SF1 thắng
    assert _score(client, world, tid, sf[1]["id"], 11, 5).status_code == 200
    assert _score(client, world, tid, final["id"], 11, 9).status_code == 200
    champion = sf[0]["p1_id"]
    f = [m for m in _detail(client, world, tid)["matches"] if m["id"] == final["id"]][0]
    assert f["winner_id"] == champion
    # Sửa SF1: p2 thắng → chung kết phải reset, slot 1 đổi người
    assert _score(client, world, tid, sf[0]["id"], 3, 11).status_code == 200
    f = [m for m in _detail(client, world, tid)["matches"] if m["id"] == final["id"]][0]
    assert f["status"] == "pending" and f["winner_id"] is None and f["score1"] is None
    assert f["p1_id"] == sf[0]["p2_id"] and f["p2_id"] == sf[1]["p1_id"]


def test_score_validation_and_state_protection(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:3], fmt="knockout")
    d = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).json()
    bye = [m for m in d["matches"] if m["round_number"] == 1 and m["status"] == "completed"][0]
    real = [m for m in d["matches"] if m["round_number"] == 1 and m["status"] == "pending"][0]
    assert _score(client, world, tid, bye["id"], 11, 0).status_code == 400          # trận bye không đủ 2 đội
    assert _score(client, world, tid, real["id"], -1, 5).status_code == 422         # điểm âm
    assert _score(client, world, tid, real["id"], 9, 9).status_code == 400          # knockout không hoà
    assert _score(client, world, tid, real["id"], 11, 9).status_code == 200
    client.put(f"/api/tournaments/{tid}", json={"status": "completed"}, headers=h)
    assert _score(client, world, tid, real["id"], 5, 11).status_code == 400         # giải đã kết thúc


def test_start_knockout_guards(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:6], fmt="combined", num_groups=2)
    assert client.post(f"/api/tournaments/{tid}/start-knockout", headers=h).status_code == 400  # chưa sinh lịch
    d = client.post(f"/api/tournaments/{tid}/generate", headers=h).json()
    assert client.post(f"/api/tournaments/{tid}/start-knockout", headers=h).status_code == 400  # vòng bảng chưa xong
    for m in d["matches"]:
        assert _score(client, world, tid, m["id"], 11, 7).status_code == 200
    r = client.post(f"/api/tournaments/{tid}/start-knockout", headers=h)
    assert r.status_code == 200
    ko = [m for m in r.json()["matches"] if m["phase"] == "knockout"]
    assert len(ko) == 3 and all(m["p1_id"] and m["p2_id"] for m in ko if m["round_number"] == 1)
    assert client.post(f"/api/tournaments/{tid}/start-knockout", headers=h).status_code == 400  # không nhân đôi
    assert len([m for m in _detail(client, world, tid)["matches"] if m["phase"] == "knockout"]) == 3


def test_start_knockout_three_groups_has_no_double_bye(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:6], fmt="combined", num_groups=3)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=h).json()
    for m in d["matches"]:
        assert _score(client, world, tid, m["id"], 11, 7).status_code == 200
    r = client.post(f"/api/tournaments/{tid}/start-knockout", headers=h)
    assert r.status_code == 200, r.text
    ko = [m for m in r.json()["matches"] if m["phase"] == "knockout"]
    r1 = [m for m in ko if m["round_number"] == min(x["round_number"] for x in ko)]
    assert not any(m["p1_id"] is None and m["p2_id"] is None for m in r1)
    byes = [m for m in r1 if (m["p1_id"] is None) != (m["p2_id"] is None)]
    assert all(m["status"] == "completed" for m in byes)


# ── Xoá thành viên ─────────────────────────────────────────────────────────

def test_delete_member_blocked_when_referenced(client, world):
    h = _h(world)
    m_tx, m_tour, m_free = world.members1[0], world.members1[1], world.members1[2]
    client.post("/api/transactions", json={"fee_type_id": world.fee1.id, "member_id": m_tx.id,
                "amount": 50000, "transaction_date": "2026-09-01"}, headers=h)
    _create(client, world, [m_tour, world.members1[3]])
    assert client.delete(f"/api/members/{m_tx.id}", headers=h).status_code == 400
    assert client.delete(f"/api/members/{m_tour.id}", headers=h).status_code == 400
    assert client.delete(f"/api/members/{m_free.id}", headers=h).status_code == 204
