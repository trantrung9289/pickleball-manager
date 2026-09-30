"""Bật/tắt trận tranh giải 3 SAU khi giải đã bắt đầu — PATCH /api/tournaments/{tid}/third-place."""
from conftest import World


def _h(world, user=None, club=None):
    return World.headers(user or world.admin1, club or world.club1)


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


def _toggle(client, world, tid, enabled, **kw):
    return client.patch(f"/api/tournaments/{tid}/third-place", json={"enabled": enabled}, headers=_h(world, **kw))


def _third(d):
    return next((m for m in d["matches"] if m["round_name"] == "Tranh giải 3"), None)


def _semis(d):
    ko = [m for m in d["matches"] if m["phase"] == "knockout" and m["round_name"] != "Tranh giải 3"]
    max_round = max(m["round_number"] for m in ko)
    return [m for m in ko if m["round_number"] == max_round - 1]


def test_enable_after_generate_creates_match_and_links_semis(client, world):
    tid = _create(client, world, world.members1[:8])  # mặc định không tranh giải 3
    assert client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).status_code == 200
    assert _third(_detail(client, world, tid)) is None

    r = _toggle(client, world, tid, True)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["third_place_enabled"] is True
    third = _third(d)
    assert third is not None and third["p1_id"] is None and third["p2_id"] is None
    # Cả 2 bán kết trỏ đường thua về trận tranh giải 3
    assert sum(1 for m in d["matches"] if m["loser_next_match_id"] == third["id"]) == 2
    assert {m["loser_next_match_slot"] for m in d["matches"] if m["loser_next_match_id"] == third["id"]} == {1, 2}
    semis = _semis(d)
    # đấu hết tứ kết để bán kết có đủ người
    for m in [x for x in d["matches"] if x["round_number"] == 1]:
        assert _score(client, world, tid, m["id"], 11, 5).status_code == 200
    d = _detail(client, world, tid)
    s0 = next(m for m in d["matches"] if m["id"] == semis[0]["id"])
    assert _score(client, world, tid, s0["id"], 11, 7).status_code == 200
    d = _detail(client, world, tid)
    third = _third(d)
    s0 = next(m for m in d["matches"] if m["id"] == semis[0]["id"])
    loser = s0["p2_id"] if s0["winner_id"] == s0["p1_id"] else s0["p1_id"]
    assert loser in (third["p1_id"], third["p2_id"])


def test_enable_after_semifinals_played_backfills_losers(client, world):
    tid = _create(client, world, world.members1[:4])
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    semis = [m for m in d["matches"] if m["round_number"] == 1]
    assert len(semis) == 2
    losers = set()
    for m, (a, b) in zip(semis, [(11, 3), (6, 11)]):
        assert _score(client, world, tid, m["id"], a, b).status_code == 200
        losers.add(m["p2_id"] if a > b else m["p1_id"])

    d = _toggle(client, world, tid, True).json()
    third = _third(d)
    assert third is not None and third["status"] == "pending"
    assert {third["p1_id"], third["p2_id"]} == losers  # người thua 2 bán kết được xếp vào ngay
    # và trận tranh giải 3 nhập điểm được như trận thường
    assert _score(client, world, tid, third["id"], 11, 9).status_code == 200


def test_disable_removes_unplayed_match_and_reenable_recreates(client, world):
    tid = _create(client, world, world.members1[:4], third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    assert _third(d) is not None
    n_before = len(d["matches"])

    d = _toggle(client, world, tid, False).json()
    assert d["third_place_enabled"] is False and _third(d) is None
    assert len(d["matches"]) == n_before - 1

    # Bán kết đấu xong khi đang TẮT → người thua không đi đâu; bật lại → được điền vào trận mới
    semis = [m for m in d["matches"] if m["round_number"] == 1]
    for m in semis:
        assert _score(client, world, tid, m["id"], 11, 2).status_code == 200
    d = _toggle(client, world, tid, True).json()
    third = _third(d)
    assert third is not None and third["p1_id"] and third["p2_id"]
    assert len(d["matches"]) == n_before


def test_disable_blocked_when_third_place_has_score(client, world):
    tid = _create(client, world, world.members1[:4], third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    for m in [x for x in d["matches"] if x["round_number"] == 1]:
        assert _score(client, world, tid, m["id"], 11, 4).status_code == 200
    third = _third(_detail(client, world, tid))
    assert _score(client, world, tid, third["id"], 11, 8).status_code == 200
    r = _toggle(client, world, tid, False)
    assert r.status_code == 400 and "đã có kết quả" in r.json()["detail"]
    assert _third(_detail(client, world, tid)) is not None


def test_toggle_guards(client, world):
    # thể thức vòng tròn → 400
    tid = _create(client, world, world.members1[:4], fmt="round_robin")
    assert _toggle(client, world, tid, True).status_code == 400
    # giải đã kết thúc → 400
    tid = _create(client, world, world.members1[:4])
    client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
    client.put(f"/api/tournaments/{tid}", json={"status": "completed"}, headers=_h(world))
    assert _toggle(client, world, tid, True).status_code == 400
    # quyền: viewer1 403, CLB khác 404
    tid = _create(client, world, world.members1[:4])
    assert _toggle(client, world, tid, True, user=world.viewer1).status_code == 403
    assert _toggle(client, world, tid, True, user=world.admin2, club=world.club2).status_code == 404
    # bật ở Nháp cũng được (chưa có lịch → chỉ lưu cờ), đồng thời PUT SETUP_FIELDS vẫn chỉ cho Nháp như cũ
    r = _toggle(client, world, tid, True)
    assert r.status_code == 200 and r.json()["third_place_enabled"] is True and _third(r.json()) is None


def test_enable_with_too_few_teams_sets_flag_without_match(client, world):
    tid = _create(client, world, world.members1[:2])  # chỉ có chung kết, không có bán kết
    client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
    d = _toggle(client, world, tid, True).json()
    assert d["third_place_enabled"] is True and _third(d) is None


def test_combined_enable_before_and_after_start_knockout(client, world):
    tid = _create(client, world, world.members1[:8], fmt="combined", num_groups=2)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    # trước khi lên vòng loại: chỉ lưu cờ
    d = _toggle(client, world, tid, True).json()
    assert d["third_place_enabled"] is True and _third(d) is None
    # đấu hết vòng bảng rồi lên vòng loại → start_knockout tự tạo trận tranh giải 3
    for m in [x for x in d["matches"] if x["phase"] == "group"]:
        assert _score(client, world, tid, m["id"], 11, 5).status_code == 200
    r = client.post(f"/api/tournaments/{tid}/start-knockout", headers=_h(world))
    assert r.status_code == 200, r.text
    assert _third(r.json()) is not None
    # tắt sau khi đã lên vòng loại (chưa có tỉ số) → xoá; bật lại → tạo lại
    d = _toggle(client, world, tid, False).json()
    assert _third(d) is None
    d = _toggle(client, world, tid, True).json()
    assert _third(d) is not None


def _withdraw(client, world, tid, pid):
    return client.post(f"/api/tournaments/{tid}/participants/{pid}/withdraw", headers=_h(world))


def test_enable_with_bye_semifinal_resolves_third_place(client, world):
    """3 đội: một bán kết là bye (không có người thua) → sau khi bán kết thật có kết quả, trận tranh giải 3
    phải tự xử thắng cho người thua bán kết thật thay vì treo pending mãi (lỗi feeder-completed đã sửa)."""
    tid = _create(client, world, world.members1[:3])
    client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
    d = _toggle(client, world, tid, True).json()
    third = _third(d)
    assert third is not None
    real_semi = next(m for m in d["matches"] if m["round_number"] == 1 and m["p1_id"] and m["p2_id"])
    assert _score(client, world, tid, real_semi["id"], 11, 6).status_code == 200
    d = _detail(client, world, tid)
    third = _third(d)
    loser = real_semi["p2_id"]
    assert third["status"] == "completed" and third["winner_id"] == loser and third["is_walkover"] is False


def test_enable_after_walkover_semifinal_routes_withdrawn_loser(client, world):
    tid = _create(client, world, world.members1[:4])
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    semis = [m for m in d["matches"] if m["round_number"] == 1]
    # bán kết 1: người 2 bỏ giải → xử thắng người 1 (walkover), người thua = người bỏ giải
    assert _withdraw(client, world, tid, semis[0]["p2_id"]).status_code == 200
    d = _toggle(client, world, tid, True).json()
    third = _third(d)
    assert semis[0]["p2_id"] in (third["p1_id"], third["p2_id"])
    # bán kết 2 xong → tranh giải 3 = (người bỏ giải vs người thua BK2) → tự xử thắng người thua BK2
    assert _score(client, world, tid, semis[1]["id"], 11, 5).status_code == 200
    third = _third(_detail(client, world, tid))
    assert third["status"] == "completed" and third["is_walkover"] is True and third["winner_id"] == semis[1]["p2_id"]


def test_rescore_semifinal_after_enable_resets_third_place(client, world):
    tid = _create(client, world, world.members1[:4])
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    semis = [m for m in d["matches"] if m["round_number"] == 1]
    final = next(m for m in d["matches"] if m["round_number"] == 2)
    for m in semis:
        assert _score(client, world, tid, m["id"], 11, 3).status_code == 200   # p1 thắng cả 2 bán kết
    assert _score(client, world, tid, final["id"], 11, 9).status_code == 200
    d = _toggle(client, world, tid, True).json()
    third = _third(d)
    assert {third["p1_id"], third["p2_id"]} == {semis[0]["p2_id"], semis[1]["p2_id"]}
    assert _score(client, world, tid, third["id"], 11, 8).status_code == 200
    # Sửa kết quả bán kết 1 đảo chiều → chung kết và tranh giải 3 phải được dọn và điền lại người mới
    assert _score(client, world, tid, semis[0]["id"], 3, 11).status_code == 200
    d = _detail(client, world, tid)
    final = next(m for m in d["matches"] if m["id"] == final["id"])
    third = _third(d)
    assert final["status"] == "pending" and final["score1"] is None
    assert third["status"] == "pending" and third["score1"] is None
    assert {third["p1_id"], third["p2_id"]} == {semis[0]["p1_id"], semis[1]["p2_id"]}
    assert semis[0]["p2_id"] in (final["p1_id"], final["p2_id"])


def test_disable_allowed_when_third_place_completed_by_walkover(client, world):
    """Quyết định nghiệp vụ: trận tranh giải 3 chỉ 'có kết quả' khi có tỉ số thật; xử thắng do bỏ giải
    (score None) vẫn tắt được — UI cảnh báo rõ là sẽ xoá kết quả xử thắng."""
    tid = _create(client, world, world.members1[:4], third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    semis = [m for m in d["matches"] if m["round_number"] == 1]
    for m in semis:
        assert _score(client, world, tid, m["id"], 11, 4).status_code == 200
    assert _withdraw(client, world, tid, semis[0]["p2_id"]).status_code == 200  # người thua BK1 bỏ giải
    third = _third(_detail(client, world, tid))
    assert third["status"] == "completed" and third["score1"] is None and third["is_walkover"] is True
    r = _toggle(client, world, tid, False)
    assert r.status_code == 200 and _third(r.json()) is None


def test_toggle_loop_is_stable(client, world):
    tid = _create(client, world, world.members1[:8])
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    base_matches = len(d["matches"])
    max_num = max(m["match_number"] for m in d["matches"])
    final_round = max(m["round_number"] for m in d["matches"])
    for _ in range(3):
        d = _toggle(client, world, tid, True).json()
        third = _third(d)
        assert third["match_number"] == max_num + 1 and third["round_number"] == final_round
        assert sum(1 for m in d["matches"] if m["loser_next_match_id"] == third["id"]) == 2
        assert len(d["matches"]) == base_matches + 1
        d = _toggle(client, world, tid, False).json()
        assert _third(d) is None and len(d["matches"]) == base_matches
        assert all(m["loser_next_match_id"] is None for m in d["matches"])


def test_combined_disable_before_start_knockout_then_reenable(client, world):
    tid = _create(client, world, world.members1[:8], fmt="combined", num_groups=2, third_place_enabled=True)
    d = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world)).json()
    d = _toggle(client, world, tid, False).json()
    assert d["third_place_enabled"] is False
    for m in [x for x in d["matches"] if x["phase"] == "group"]:
        assert _score(client, world, tid, m["id"], 11, 5).status_code == 200
    d = client.post(f"/api/tournaments/{tid}/start-knockout", headers=_h(world)).json()
    assert _third(d) is None  # đã tắt trước khi lên vòng loại → start_knockout không tạo
    max_num = max(m["match_number"] for m in d["matches"] if m["phase"] == "knockout")
    d = _toggle(client, world, tid, True).json()
    third = _third(d)
    assert third is not None and third["match_number"] == max_num + 1
