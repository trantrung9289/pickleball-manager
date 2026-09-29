"""Đợt 11: bốc thăm cặp đấu bằng vòng quay (phiên lưu DB, seed commit–reveal, chốt → sinh lịch)."""
import hashlib
import re

import pytest
from conftest import World

import models
import tournament_engine as eng


def _h(world):
    return World.headers(world.admin1, world.club1)


def _create(client, world, members, fmt="knockout", **extra):
    body = {"name": "T", "format": fmt, "member_ids": [m.id for m in members]}
    body.update(extra)
    r = client.post("/api/tournaments", json=body, headers=_h(world))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _activate(client, world, tid):
    r = client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=_h(world))
    assert r.status_code == 200, r.text
    return r.json()


def _detail(client, world, tid):
    return client.get(f"/api/tournaments/{tid}", headers=_h(world)).json()


def _score(client, world, tid, mid, s1, s2):
    return client.post(f"/api/tournaments/{tid}/matches/{mid}/score", json={"score1": s1, "score2": s2}, headers=_h(world))


def _open(client, world, tid, **body):
    return client.post(f"/api/tournaments/{tid}/draw", json=body, headers=_h(world))


def _spin(client, world, tid, expected_step):
    return client.post(f"/api/tournaments/{tid}/draw/spin", json={"expected_step": expected_step}, headers=_h(world))


def _commit(client, world, tid, force=False):
    return client.post(f"/api/tournaments/{tid}/draw/commit", json={"force": force}, headers=_h(world))


def _cancel(client, world, tid, reason=None):
    return client.post(f"/api/tournaments/{tid}/draw/cancel", json={"reason": reason}, headers=_h(world))


def _spin_all(client, world, tid, draw):
    """Quay đủ total_steps lượt, kiểm tra từng response. Trả về DrawOut cuối (vẫn open)."""
    n = draw["total_steps"]
    fmt, g = draw["format"], draw["num_groups"]
    for k in range(n):
        r = _spin(client, world, tid, k)
        assert r.status_code == 200, r.text
        draw = r.json()
        assert draw["done_steps"] == k + 1
        assert draw["status"] == "open"
        assert draw["seed_hex"] is None                       # commit–reveal: chưa lộ seed khi đang mở
        assert draw["steps"][k]["step_index"] == k
        assert draw["steps"][k]["slot_label"] == eng.draw_slot_label(fmt, k, n, g)
        assert isinstance(draw["steps"][k]["spun_at_ms"], int)
        assert isinstance(draw["server_now_ms"], int)
    return draw


def _verify_picks(draw):
    """Kiểm chứng lại toàn bộ phiên bằng công thức công khai — như khán giả sẽ làm."""
    seed_hex = draw["seed_hex"]
    assert seed_hex and hashlib.sha256(seed_hex.encode()).hexdigest() == draw["seed_commit"]
    remaining = list(draw["pool"])
    for k, st in enumerate(sorted(draw["steps"], key=lambda s: s["step_index"])):
        # Tính lại bằng công thức công khai (hashlib thô), KHÔNG gọi lại hàm engine — nếu engine đổi
        # công thức mà quên cập nhật tài liệu kiểm chứng, test này phải đỏ.
        idx = int(hashlib.sha256(f"{seed_hex}:{k}".encode()).hexdigest(), 16) % len(remaining)
        assert st["pick_index"] == idx
        assert st["participant_id"] == remaining[idx]
        remaining.remove(st["participant_id"])
    assert remaining == []


PUBLIC_DRAW_KEYS = {
    "id", "tournament_id", "seq", "status", "format", "num_groups", "total_steps", "done_steps",
    "reveal_ms", "force", "pool", "seed_commit", "seed_hex", "steps", "created_at",
    "committed_at", "cancelled_at", "cancel_reason", "server_now_ms",
}
STEP_KEYS = {"step_index", "participant_id", "slot_label", "pick_index", "spun_at", "spun_at_ms"}


# ── Engine thuần ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("n", range(2, 10))
def test_knockout_slots_match_bracket_byes_and_pairs(n):
    slots = eng.draw_display_slots("knockout", n)
    assert len(slots) == n
    assert [s["index"] for s in slots] == list(range(n))
    size = 1
    while size < n:
        size *= 2
    assert sum(1 for s in slots if s["bye"]) == size - n
    # Tập seed được bye phải trùng với bracket thật
    ms = eng._knockout_bracket(list(range(1, n + 1)))
    bracket_byes = {m["p1"] or m["p2"] for m in ms if m["round"] == 1 and (m["p1"] is None or m["p2"] is None)}
    assert {s["seed"] for s in slots if s["bye"]} == bracket_byes
    assert all(("miễn vòng 1" in s["label"]) == s["bye"] for s in slots)
    # Các ô không bye đi theo cặp lượt liên tiếp (k, k+1), display_pos chẵn/lẻ kề nhau
    non_bye = [s for s in slots if not s["bye"]]
    assert len(non_bye) % 2 == 0
    for i in range(0, len(non_bye), 2):
        a, b = non_bye[i], non_bye[i + 1]
        assert b["index"] == a["index"] + 1
        assert a["display_pos"] % 2 == 0 and b["display_pos"] == a["display_pos"] + 1


@pytest.mark.parametrize("g", (2, 3))
@pytest.mark.parametrize("n", range(2, 10))
def test_combined_slots_round_robin_over_groups(n, g):
    if n < 2 * g:
        pytest.skip("không đủ đội cho số bảng")
    slots = eng.draw_display_slots("combined", n, g)
    assert len(slots) == n
    for k, s in enumerate(slots):
        assert s["group"] == "ABCDEFGHIJKLMNOP"[k % g]
        assert s["pos"] == k // g + 1
        assert s["label"] == f"Bảng {s['group']} – vị trí {s['pos']}"


@pytest.mark.parametrize("n", range(2, 10))
def test_individual_slots_pair_consecutive_and_odd_last(n):
    slots = eng.draw_display_slots("individual", n)
    assert len(slots) == n
    for k, s in enumerate(slots):
        if n % 2 == 1 and k == n - 1:
            assert s["match"] is None and s["label"] == "Không có trận (số lẻ)"
        else:
            assert s["match"] == k // 2 + 1 and s["side"] == k % 2 + 1
            assert s["label"] == f"Trận {s['match']} – Đội {s['side']}"


def test_unsupported_format_raises():
    with pytest.raises(ValueError):
        eng.draw_display_slots("round_robin", 4)
    with pytest.raises(ValueError):
        eng.draw_picks_to_pid_list("round_robin_double", [1, 2, 3])


def test_draw_pick_index_deterministic_and_in_range():
    seed = "00ff" * 8
    for k in range(20):
        for rem in range(1, 12):
            a = eng.draw_pick_index(seed, k, rem)
            assert a == eng.draw_pick_index(seed, k, rem)
            assert 0 <= a < rem
    assert eng.draw_pick_index(seed, 0, 7) == int(hashlib.sha256(f"{seed}:0".encode()).hexdigest(), 16) % 7
    assert eng.draw_pick_index(seed, 3, 1) == 0                      # còn 1 đội → luôn chọn đội đó


@pytest.mark.parametrize("n", range(2, 10))
def test_knockout_picks_to_pid_list_consecutive_picks_are_opponents(n):
    picks = list(range(100, 100 + n))
    pid_list = eng.draw_picks_to_pid_list("knockout", picks)
    assert sorted(pid_list) == sorted(picks)
    slots = eng.draw_display_slots("knockout", n)
    ms = eng._knockout_bracket(pid_list)
    r1 = [m for m in ms if m["round"] == 1]
    bye_ids = {picks[s["index"]] for s in slots if s["bye"]}
    for m in r1:
        if m["p1"] is not None and m["p2"] is not None:
            a, b = picks.index(m["p1"]), picks.index(m["p2"])
            assert b == a + 1                                        # 2 lượt bốc liên tiếp là đối thủ
        else:
            assert (m["p1"] or m["p2"]) in bye_ids
    assert eng.draw_picks_to_pid_list("combined", picks) == picks
    assert eng.draw_picks_to_pid_list("individual", picks) == picks


# ── API luồng đầy đủ ───────────────────────────────────────────────────────

def _full_flow(client, world, tid):
    _activate(client, world, tid)
    r = _open(client, world, tid)
    assert r.status_code == 201, r.text
    draw = r.json()
    assert draw["status"] == "open" and draw["done_steps"] == 0 and draw["seq"] == 1
    assert draw["seed_hex"] is None and len(draw["seed_commit"]) == 64
    assert draw["pool"] == sorted(draw["pool"])
    assert draw["created_by"] == "admin1"
    draw = _spin_all(client, world, tid, draw)
    r = _commit(client, world, tid)
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["status"] == "active" and t["matches"]
    assert t["draw"]["status"] == "committed"
    assert t["draw"]["done_steps"] == t["draw"]["total_steps"] == draw["total_steps"]
    final = client.get(f"/api/tournaments/{tid}/draw", headers=_h(world)).json()
    assert final["status"] == "committed" and final["committed_at"]
    _verify_picks(final)
    return t, final


def test_flow_combined_groups_follow_slot_labels(client, world):
    tid = _create(client, world, world.members1[:6], fmt="combined", num_groups=2)
    t, draw = _full_flow(client, world, tid)
    by_id = {p["id"]: p for p in t["participants"]}
    for st in draw["steps"]:
        letter = re.search(r"Bảng ([A-Z])", st["slot_label"]).group(1)
        assert by_id[st["participant_id"]]["group_name"] == letter
    assert all(m["phase"] == "group" for m in t["matches"])


def test_flow_individual_pairs_follow_pick_order(client, world):
    tid = _create(client, world, world.members1[:5], fmt="individual")
    t, draw = _full_flow(client, world, tid)
    picks = [st["participant_id"] for st in draw["steps"]]
    ms = sorted(t["matches"], key=lambda m: m["match_number"])
    assert len(ms) == 2   # 5 đội → 2 trận, đội cuối không có trận
    for i, m in enumerate(ms):
        assert (m["p1_id"], m["p2_id"]) == (picks[2 * i], picks[2 * i + 1])
    assert draw["steps"][-1]["slot_label"] == "Không có trận (số lẻ)"


def test_flow_knockout_consecutive_picks_meet_and_byes_completed(client, world):
    tid = _create(client, world, world.members1[:6], fmt="knockout")
    t, draw = _full_flow(client, world, tid)
    picks = [st["participant_id"] for st in draw["steps"]]
    bye_ids = {st["participant_id"] for st in draw["steps"] if "miễn vòng 1" in st["slot_label"]}
    assert len(bye_ids) == 2
    r1 = [m for m in t["matches"] if m["round_number"] == 1]
    seen_bye = set()
    for m in r1:
        if m["p1_id"] is not None and m["p2_id"] is not None:
            a, b = picks.index(m["p1_id"]), picks.index(m["p2_id"])
            assert b == a + 1                                        # 2 lượt bốc liên tiếp là đối thủ
        else:
            pid = m["p1_id"] or m["p2_id"]
            assert pid in bye_ids and m["status"] == "completed" and m["winner_id"] == pid
            seen_bye.add(pid)
    assert seen_bye == bye_ids


def test_withdrawn_participant_still_in_pool(client, world):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    _activate(client, world, tid)
    pid = _detail(client, world, tid)["participants"][0]["id"]
    r = client.post(f"/api/tournaments/{tid}/participants/{pid}/withdraw", headers=_h(world))
    assert r.status_code == 200, r.text
    r = _open(client, world, tid)
    assert r.status_code == 201, r.text
    assert pid in r.json()["pool"] and r.json()["total_steps"] == 4


# ── Gating ─────────────────────────────────────────────────────────────────

def test_open_requires_active_and_supported_format(client, world):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    r = _open(client, world, tid)
    assert r.status_code == 400 and "Bắt đầu giải" in r.json()["detail"]

    for fmt in ("round_robin", "round_robin_double"):
        tid2 = _create(client, world, world.members1[:4], fmt=fmt)
        _activate(client, world, tid2)
        r = _open(client, world, tid2)
        assert r.status_code == 400 and "không hỗ trợ" in r.json()["detail"], fmt


def test_open_twice_conflicts_and_spin_step_guards(client, world):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    _activate(client, world, tid)
    assert _open(client, world, tid).status_code == 201
    assert _open(client, world, tid).status_code == 409

    assert _spin(client, world, tid, 1).status_code == 409          # sai expected_step
    assert _commit(client, world, tid).status_code == 409           # chưa bốc đủ
    for k in range(4):
        assert _spin(client, world, tid, k).status_code == 200
    assert _spin(client, world, tid, 3).status_code == 409          # bấm trùng lượt cũ
    assert _spin(client, world, tid, 4).status_code == 409          # đã đủ
    assert _commit(client, world, tid).status_code == 200


def test_cancel_then_reopen_increments_seq(client, world):
    tid = _create(client, world, world.members1[:4], fmt="individual")
    _activate(client, world, tid)
    assert _open(client, world, tid).status_code == 201
    assert _spin(client, world, tid, 0).status_code == 200
    r = _cancel(client, world, tid, reason="Nhầm danh sách")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert r.json()["cancel_reason"] == "Nhầm danh sách" and r.json()["cancelled_at"]
    assert r.json()["seed_hex"]                                      # phiên kết thúc → lộ seed
    assert _cancel(client, world, tid).status_code == 409           # không còn phiên mở
    r = _open(client, world, tid)
    assert r.status_code == 201 and r.json()["seq"] == 2
    hist = client.get(f"/api/tournaments/{tid}/draws", headers=_h(world)).json()
    assert [d["seq"] for d in hist] == [2, 1]
    assert hist[0]["seed_hex"] is None and hist[1]["seed_hex"]


def test_complete_blocked_while_draw_open(client, world):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    _activate(client, world, tid)
    assert _open(client, world, tid).status_code == 201
    r = client.put(f"/api/tournaments/{tid}", json={"status": "completed"}, headers=_h(world))
    assert r.status_code == 400 and "bốc thăm" in r.json()["detail"]
    assert _cancel(client, world, tid).status_code == 200
    r = client.put(f"/api/tournaments/{tid}", json={"status": "completed"}, headers=_h(world))
    assert r.status_code == 200
    assert _open(client, world, tid).status_code == 400              # đã kết thúc


def test_manual_generate_cancels_open_draw(client, world):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    _activate(client, world, tid)
    assert _open(client, world, tid).status_code == 201
    r = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
    assert r.status_code == 200, r.text
    assert r.json()["draw"]["status"] == "cancelled"
    d = client.get(f"/api/tournaments/{tid}/draw", headers=_h(world)).json()
    assert d["status"] == "cancelled" and d["cancel_reason"] == "Sinh lịch thủ công"


def test_commit_with_new_scores_needs_force_and_clears_them(client, world):
    tid = _create(client, world, world.members1[:4], fmt="individual")
    r = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
    assert r.status_code == 200
    assert _open(client, world, tid).status_code == 201             # chưa có điểm → mở được
    mid = r.json()["matches"][0]["id"]
    assert _score(client, world, tid, mid, 11, 5).status_code == 200  # điểm nhập SAU khi mở phiên
    for k in range(4):
        assert _spin(client, world, tid, k).status_code == 200
    r = _commit(client, world, tid)
    assert r.status_code == 400 and "force" in r.json()["detail"]
    r = _commit(client, world, tid, force=True)
    assert r.status_code == 200, r.text
    assert all(m["score1"] is None for m in r.json()["matches"])
    assert r.json()["draw"]["status"] == "committed"


def test_open_with_existing_scores_needs_force(client, world):
    tid = _create(client, world, world.members1[:4], fmt="individual")
    r = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
    mid = r.json()["matches"][0]["id"]
    assert _score(client, world, tid, mid, 11, 5).status_code == 200
    assert _open(client, world, tid).status_code == 400
    r = _open(client, world, tid, force=True)
    assert r.status_code == 201 and r.json()["force"] is True
    for k in range(4):
        assert _spin(client, world, tid, k).status_code == 200
    r = _commit(client, world, tid)                                  # draw.force đã ghi nhận xác nhận
    assert r.status_code == 200 and all(m["score1"] is None for m in r.json()["matches"])


def test_second_commit_supersedes_previous(client, world):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    _full_flow(client, world, tid)
    assert _open(client, world, tid).status_code == 201
    for k in range(4):
        assert _spin(client, world, tid, k).status_code == 200
    assert _commit(client, world, tid).status_code == 200
    hist = client.get(f"/api/tournaments/{tid}/draws", headers=_h(world)).json()
    assert [(d["seq"], d["status"]) for d in hist] == [(2, "committed"), (1, "superseded")]


def test_commit_detects_participant_list_change(client, world, db):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    _activate(client, world, tid)
    assert _open(client, world, tid).status_code == 201
    for k in range(4):
        assert _spin(client, world, tid, k).status_code == 200
    # Thêm đội trực tiếp trong DB (API chặn thêm khi active) — mô phỏng danh sách đổi giữa chừng
    db.add(models.TournamentParticipant(tournament_id=tid, member_id=world.members1[5].id)); db.commit()
    r = _commit(client, world, tid)
    assert r.status_code == 409 and "thay đổi" in r.json()["detail"]


def test_permissions_viewer_and_other_club(client, world):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    _activate(client, world, tid)
    assert _open(client, world, tid).status_code == 201
    hv = World.headers(world.viewer1, world.club1)
    assert client.get(f"/api/tournaments/{tid}/draw", headers=hv).status_code == 200
    assert client.get(f"/api/tournaments/{tid}/draws", headers=hv).status_code == 200
    assert client.post(f"/api/tournaments/{tid}/draw", json={}, headers=hv).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/draw/spin", json={"expected_step": 0}, headers=hv).status_code == 403
    h2 = World.headers(world.admin2, world.club2)
    assert client.get(f"/api/tournaments/{tid}/draw", headers=h2).status_code == 404
    assert client.post(f"/api/tournaments/{tid}/draw", json={}, headers=h2).status_code == 404


def test_get_draw_404_when_none(client, world):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    assert client.get(f"/api/tournaments/{tid}/draw", headers=_h(world)).status_code == 404
    assert client.get(f"/api/tournaments/{tid}/draws", headers=_h(world)).json() == []
    assert _detail(client, world, tid)["draw"] is None


# ── Public ─────────────────────────────────────────────────────────────────

def test_public_draw_live_and_history_without_pii(client, world):
    slug = world.token1.slug
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    # Giải nháp → public không thấy
    assert client.get(f"/api/public/report/{slug}/tournaments/{tid}/draw").status_code == 404
    _activate(client, world, tid)
    r = client.get(f"/api/public/report/{slug}/tournaments/{tid}/draw")
    assert r.status_code == 200 and r.json()["draw"] is None and isinstance(r.json()["server_now_ms"], int)

    assert _open(client, world, tid).status_code == 201
    assert _spin(client, world, tid, 0).status_code == 200
    r = client.get(f"/api/public/report/{slug}/tournaments/{tid}/draw")
    body = r.json()
    assert body["draw"]["status"] == "open" and body["draw"]["seed_hex"] is None
    assert body["draw"]["done_steps"] == 1 and len(body["draw"]["seed_commit"]) == 64
    assert set(body["draw"].keys()) <= PUBLIC_DRAW_KEYS
    assert "created_by" not in body["draw"]  # tên đăng nhập admin không lộ ra public
    assert all(set(st.keys()) <= STEP_KEYS for st in body["draw"]["steps"])
    pub_detail = client.get(f"/api/public/report/{slug}/tournaments/{tid}").json()
    assert pub_detail["draw"]["status"] == "open"
    assert pub_detail["draw"]["done_steps"] == 1 and pub_detail["draw"]["total_steps"] == 4

    for k in range(1, 4):
        assert _spin(client, world, tid, k).status_code == 200
    assert _commit(client, world, tid).status_code == 200
    r = client.get(f"/api/public/report/{slug}/tournaments/{tid}/draw")
    assert r.json()["draw"]["status"] == "committed" and r.json()["draw"]["seed_hex"]
    _verify_picks(r.json()["draw"])

    hist = client.get(f"/api/public/report/{slug}/tournaments/{tid}/draws")
    assert hist.status_code == 200 and [d["seq"] for d in hist.json()] == [1]
    assert all(set(d.keys()) <= PUBLIC_DRAW_KEYS for d in hist.json())
    # Không lộ tên/SĐT trong bất kỳ trường nào
    dumped = hist.text + r.text
    assert "M Member" not in dumped and "0900000" not in dumped

    assert client.get("/api/public/report/khong-ton-tai/tournaments/1/draw").status_code == 404


# ── Xoá giải & cascade ─────────────────────────────────────────────────────

def test_delete_tournament_cascades_draws(client, world, db):
    tid = _create(client, world, world.members1[:4], fmt="knockout")
    _activate(client, world, tid)
    assert _open(client, world, tid).status_code == 201
    for k in range(2):
        assert _spin(client, world, tid, k).status_code == 200
    assert db.query(models.TournamentDraw).filter_by(tournament_id=tid).count() == 1
    assert db.query(models.TournamentDrawStep).count() == 2
    r = client.delete(f"/api/tournaments/{tid}", headers=_h(world))
    assert r.status_code == 204, r.text
    db.expire_all()
    assert db.query(models.TournamentDraw).filter_by(tournament_id=tid).count() == 0
    assert db.query(models.TournamentDrawStep).count() == 0
    assert db.query(models.TournamentParticipant).filter_by(tournament_id=tid).count() == 0
