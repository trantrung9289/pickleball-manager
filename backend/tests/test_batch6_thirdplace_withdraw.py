"""Tranh giải 3 (bronze match) và Bỏ giải (withdrawal / walkover)."""
import pytest
from conftest import World


def _h(world):
    return World.headers(world.admin1, world.club1)


def _create(client, world, members, fmt="knockout", **extra):
    body = {"name": "T", "format": fmt, "member_ids": [m.id for m in members]}
    body.update(extra)
    r = client.post("/api/tournaments", json=body, headers=_h(world))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _detail(client, world, tid):
    return client.get(f"/api/tournaments/{tid}", headers=_h(world)).json()


def _score(client, world, tid, mid, s1, s2):
    return client.post(f"/api/tournaments/{tid}/matches/{mid}/score", json={"score1": s1, "score2": s2}, headers=_h(world))


def _withdraw(client, world, tid, pid):
    return client.post(f"/api/tournaments/{tid}/participants/{pid}/withdraw", headers=_h(world))


# ── Tranh giải 3 ─────────────────────────────────────────────────────────────

def test_third_place_match_created_for_knockout_with_semifinal(client, world):
    tid = _create(client, world, world.members1[:8], fmt="knockout", third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    third = [m for m in d["matches"] if m["round_name"] == "Tranh giải 3"]
    assert len(third) == 1
    semis = [m for m in d["matches"] if m["round_number"] == max(x["round_number"] for x in d["matches"]) - 1]
    assert len(semis) == 2
    assert all(m["id"] for m in semis)  # sanity


def test_no_third_place_without_semifinal_round(client, world):
    tid = _create(client, world, world.members1[:2], fmt="knockout", third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    assert not any(m["round_name"] == "Tranh giải 3" for m in d["matches"])


def test_third_place_disabled_by_default(client, world):
    tid = _create(client, world, world.members1[:8], fmt="knockout")  # không truyền third_place_enabled
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    assert not any(m["round_name"] == "Tranh giải 3" for m in d["matches"])


def test_third_place_losers_populate_after_semifinals_scored(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:8], fmt="knockout", third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).json()
    qf = sorted([m for m in d["matches"] if m["round_number"] == 1], key=lambda m: m["match_number"])
    for m in qf:
        assert _score(client, world, tid, m["id"], 11, 5).status_code == 200
    d = _detail(client, world, tid)
    sf = sorted([m for m in d["matches"] if m["round_number"] == 2], key=lambda m: m["match_number"])
    third = next(m for m in d["matches"] if m["round_name"] == "Tranh giải 3")
    assert third["p1_id"] is None and third["p2_id"] is None
    # Ghi điểm 2 bán kết, ghi nhận người thua thực tế qua winner_id trả về
    r1 = _score(client, world, tid, sf[0]["id"], 5, 11)
    winner1 = r1.json()["winner_id"]
    loser1 = sf[0]["p1_id"] if winner1 == sf[0]["p2_id"] else sf[0]["p2_id"]
    r2 = _score(client, world, tid, sf[1]["id"], 11, 3)
    winner2 = r2.json()["winner_id"]
    loser2 = sf[1]["p1_id"] if winner2 == sf[1]["p2_id"] else sf[1]["p2_id"]

    d = _detail(client, world, tid)
    third = next(m for m in d["matches"] if m["round_name"] == "Tranh giải 3")
    assert {third["p1_id"], third["p2_id"]} == {loser1, loser2}
    final = next(m for m in d["matches"] if m["round_number"] == max(x["round_number"] for x in d["matches"]) and m["round_name"] != "Tranh giải 3")
    assert {final["p1_id"], final["p2_id"]} == {winner1, winner2}

    # Ghi điểm trận tranh giải 3 luôn trước khi kiểm tra sửa bán kết
    third_before = client.get(f"/api/tournaments/{tid}", headers=h).json()
    third_id = next(m for m in third_before["matches"] if m["round_name"] == "Tranh giải 3")["id"]
    _score(client, world, tid, third_id, 11, 6)

    # Sửa lại kết quả bán kết 1 (đổi người thắng) -> người thua MỚI phải vào lại đúng slot 1
    # của trận tranh giải 3, và kết quả tranh giải 3 đã lỡ ghi (sai người) phải bị xoá/reset
    _score(client, world, tid, sf[0]["id"], 11, 5)
    d = _detail(client, world, tid)
    third = next(m for m in d["matches"] if m["round_name"] == "Tranh giải 3")
    assert third["status"] == "pending"       # kết quả cũ (sai người) đã bị reset
    assert third["p1_id"] == winner1          # winner1 cũ giờ là người thua mới -> vào slot 1
    assert third["p2_id"] == loser2           # slot 2 (từ sf[1]) không đổi


def test_third_place_can_be_scored_like_normal_match(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:8], fmt="knockout", third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).json()
    for m in [x for x in d["matches"] if x["round_number"] == 1]:
        _score(client, world, tid, m["id"], 11, 3)
    d = _detail(client, world, tid)
    for m in [x for x in d["matches"] if x["round_number"] == 2]:
        _score(client, world, tid, m["id"], 11, 7)
    d = _detail(client, world, tid)
    third = next(m for m in d["matches"] if m["round_name"] == "Tranh giải 3")
    assert third["p1_id"] and third["p2_id"]
    r = _score(client, world, tid, third["id"], 11, 9)
    assert r.status_code == 200 and r.json()["status"] == "completed"


def test_third_place_stays_pending_while_other_semifinal_unplayed(client, world):
    # Hồi quy: trước fix, _advance_byes_and_walkovers chỉ soi đường THẮNG (next_match_id) khi
    # xét "có trận nào sắp cấp người vào ô trống" — nên khi ghi điểm 1 bán kết, nó tưởng nhầm
    # ô trống còn lại của trận tranh giải 3 (chờ người thua bán kết #2, dẫn qua
    # loser_next_match_id) là bye và tự xử luôn 1 mình đội thua bán kết #1 "thắng" tranh giải 3.
    h = _h(world)
    tid = _create(client, world, world.members1[:4], fmt="knockout", third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).json()
    sf = sorted([m for m in d["matches"] if m["round_number"] == 1], key=lambda m: m["match_number"])
    assert len(sf) == 2

    r = _score(client, world, tid, sf[0]["id"], 5, 11)
    assert r.status_code == 200
    winner1 = r.json()["winner_id"]
    loser1 = sf[0]["p1_id"] if winner1 == sf[0]["p2_id"] else sf[0]["p2_id"]

    d = _detail(client, world, tid)
    third = next(m for m in d["matches"] if m["round_name"] == "Tranh giải 3")
    assert third["status"] == "pending"
    assert third["winner_id"] is None
    assert third["p1_id"] == loser1 and third["p2_id"] is None

    # Bán kết còn lại đấu xong -> đúng lúc này mới hợp lệ để tranh giải 3 có đủ 2 đội
    r2 = _score(client, world, tid, sf[1]["id"], 11, 4)
    winner2 = r2.json()["winner_id"]
    loser2 = sf[1]["p1_id"] if winner2 == sf[1]["p2_id"] else sf[1]["p2_id"]
    d = _detail(client, world, tid)
    third = next(m for m in d["matches"] if m["round_name"] == "Tranh giải 3")
    assert third["status"] == "pending"
    assert {third["p1_id"], third["p2_id"]} == {loser1, loser2}


def test_third_place_combined_via_start_knockout(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:8], fmt="combined", num_groups=2, third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=h).json()
    for m in d["matches"]:
        _score(client, world, tid, m["id"], 11, 5)
    r = client.post(f"/api/tournaments/{tid}/start-knockout", headers=h)
    assert r.status_code == 200, r.text
    ko = [m for m in r.json()["matches"] if m["phase"] == "knockout"]
    assert any(m["round_name"] == "Tranh giải 3" for m in ko)


# ── Bỏ giải (withdrawal) ─────────────────────────────────────────────────────

def test_withdraw_round_robin_awards_walkover_win_without_goal_diff(client, world, db):
    h = _h(world)
    tid = _create(client, world, world.members1[:4], fmt="round_robin")
    d = client.post(f"/api/tournaments/{tid}/generate", headers=h).json()
    participants = {p["id"]: p for p in d["participants"]}
    withdrawn = d["participants"][0]["id"]

    # Ghi điểm 1 trận CÓ liên quan tới người sắp bỏ giải trước khi họ bỏ — kết quả này giữ nguyên
    played_match = next(m for m in d["matches"] if withdrawn in (m["p1_id"], m["p2_id"]))
    opp_in_played = played_match["p2_id"] if played_match["p1_id"] == withdrawn else played_match["p1_id"]
    s1, s2 = (3, 11) if played_match["p1_id"] == withdrawn else (11, 3)  # đối thủ luôn thắng 11-3
    _score(client, world, tid, played_match["id"], s1, s2)

    r = _withdraw(client, world, tid, withdrawn)
    assert r.status_code == 200, r.text
    d2 = r.json()

    played_again = next(m for m in d2["matches"] if m["id"] == played_match["id"])
    assert played_again["is_walkover"] is False and played_again["score1"] == s1  # trận đã đấu giữ nguyên

    remaining = [m for m in d2["matches"] if withdrawn in (m["p1_id"], m["p2_id"]) and m["id"] != played_match["id"]]
    assert len(remaining) == 2  # 4 đội round-robin: mỗi đội đấu 3 trận, đã có 1 trận thật
    for m in remaining:
        assert m["status"] == "completed" and m["is_walkover"] is True
        assert m["score1"] is None and m["score2"] is None
        opp = m["p2_id"] if m["p1_id"] == withdrawn else m["p1_id"]
        assert m["winner_id"] == opp

    standings = client.get(f"/api/tournaments/{tid}/standings", headers=h).json()
    by_id = {r["participant_id"]: r for r in standings}
    # Đối thủ bị bỏ giải (2 walkover) phải được +2 thắng, +2 điểm, nhưng hiệu số KHÔNG đổi vì walkover
    for m in remaining:
        opp = m["p2_id"] if m["p1_id"] == withdrawn else m["p1_id"]
        assert by_id[opp]["won"] >= 1
        assert by_id[opp]["goal_diff"] == 0  # walkover không cộng hiệu số (đội này chưa đấu trận thật nào khác)
    # Đối thủ đã thắng thật 11-3 trước khi bỏ giải vẫn giữ hiệu số +8 từ đúng trận đó
    assert by_id[opp_in_played]["goal_diff"] == 8


def test_withdraw_knockout_opponent_auto_advances(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    d = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).json()
    m1 = [x for x in d["matches"] if x["round_number"] == 1][0]
    withdrawn = m1["p1_id"]
    opp = m1["p2_id"]

    r = _withdraw(client, world, tid, withdrawn)
    assert r.status_code == 200
    d2 = r.json()
    m1_after = next(m for m in d2["matches"] if m["id"] == m1["id"])
    assert m1_after["status"] == "completed" and m1_after["winner_id"] == opp and m1_after["is_walkover"] is True

    final = [m for m in d2["matches"] if m["round_number"] == 2][0]
    assert final["p1_id"] == opp or final["p2_id"] == opp


def test_withdraw_cascades_when_future_opponent_resolves_later(client, world):
    """A bỏ giải -> B thắng walkover vào chung kết chờ sẵn. Sau đó B CŨNG bỏ giải trong khi
    trận vòng 1 còn lại (C vs D) chưa đấu — chưa thể xử ngay vì chưa biết ai vào ô còn lại.
    Khi C-D đấu xong thật (không phải bỏ giải), hệ thống phải tự nhận ra đối thủ ở chung kết
    (B) đã bỏ giải từ trước và xử thắng walkover ngay, không để trận treo."""
    h = _h(world)
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    d = client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).json()
    m1, m2 = [x for x in d["matches"] if x["round_number"] == 1]
    a_withdraw, b_advances = m1["p1_id"], m1["p2_id"]

    _withdraw(client, world, tid, a_withdraw)
    d2 = _detail(client, world, tid)
    final = [m for m in d2["matches"] if m["round_number"] == 2][0]
    assert b_advances in (final["p1_id"], final["p2_id"])

    r = _withdraw(client, world, tid, b_advances)
    assert r.status_code == 200
    final_after_b = next(m for m in r.json()["matches"] if m["id"] == final["id"])
    assert final_after_b["status"] == "pending"  # chưa xử được — còn chờ m2 (C vs D) đấu xong

    r2 = _score(client, world, tid, m2["id"], 11, 5)  # trận thật, không phải bỏ giải
    assert r2.status_code == 200
    winner_m2 = r2.json()["winner_id"]

    d3 = _detail(client, world, tid)
    final_final = next(m for m in d3["matches"] if m["id"] == final["id"])
    assert final_final["status"] == "completed"
    assert final_final["is_walkover"] is True
    assert final_final["winner_id"] == winner_m2


def test_cannot_withdraw_twice_or_when_not_active(client, world):
    h = _h(world)
    tid = _create(client, world, world.members1[:4], fmt="round_robin")
    pid = client.get(f"/api/tournaments/{tid}", headers=h).json()["participants"][0]["id"]
    assert _withdraw(client, world, tid, pid).status_code == 400  # còn draft, chưa active

    client.post(f"/api/tournaments/{tid}/generate", headers=h)
    assert _withdraw(client, world, tid, pid).status_code == 200
    assert _withdraw(client, world, tid, pid).status_code == 400  # đã bỏ giải rồi


def test_withdraw_cross_club_forbidden(client, world):
    h2 = World.headers(world.admin2, world.club2)
    tid = _create(client, world, world.members1[:4], fmt="round_robin")
    client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
    pid = client.get(f"/api/tournaments/{tid}", headers=_h(world)).json()["participants"][0]["id"]
    resp = client.post(f"/api/tournaments/{tid}/participants/{pid}/withdraw", headers=h2)
    assert resp.status_code == 404
