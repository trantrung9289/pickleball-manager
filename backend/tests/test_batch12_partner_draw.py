"""Đợt 12: ghép ĐỘI ĐÔI bằng vòng quay (partner draw) — bảng riêng, seed commit–reveal, chốt → gộp participant.
Người dư / không khớp quy tắc / chưa có hạng được ĐỂ LẠI ghép tay; không "Bắt đầu giải" khi còn người chưa có đội."""
import hashlib

import pytest
from conftest import World

import models
import tournament_engine as eng


def _h(world):
    return World.headers(world.admin1, world.club1)


def _set_ranks(db, world):
    """3 người hạng A, 2 người hạng B, khách mời KHÔNG có hạng (→ 'Chưa xếp hạng')."""
    for m in world.members1[:3]:
        m.rank = "A"
    for m in world.members1[3:5]:
        m.rank = "B"
    world.guest1.rank = None
    db.commit()


def _create_doubles(client, world, members=None, players=None, fmt="knockout", **extra):
    """Giải ĐÔI tạo với DANH SÁCH NGƯỜI (không teams) → mỗi người là 1 participant đơn lẻ."""
    members = world.members1[:5] if members is None else members
    players = [world.guest1] if players is None else players
    body = {"name": "D", "format": fmt, "team_type": "doubles",
            "member_ids": [m.id for m in members], "player_ids": [p.id for p in players]}
    body.update(extra)
    r = client.post("/api/tournaments", json=body, headers=_h(world))
    assert r.status_code == 201, r.text
    return r.json()


def _detail(client, world, tid):
    return client.get(f"/api/tournaments/{tid}", headers=_h(world)).json()


def _open(client, world, tid, **body):
    return client.post(f"/api/tournaments/{tid}/partner-draw", json=body, headers=_h(world))


def _spin(client, world, tid, expected_step):
    return client.post(f"/api/tournaments/{tid}/partner-draw/spin", json={"expected_step": expected_step}, headers=_h(world))


def _commit(client, world, tid):
    return client.post(f"/api/tournaments/{tid}/partner-draw/commit", headers=_h(world))


def _cancel(client, world, tid, reason=None):
    return client.post(f"/api/tournaments/{tid}/partner-draw/cancel", json={"reason": reason}, headers=_h(world))


def _pair(client, world, tid, p1, p2):
    return client.post(f"/api/tournaments/{tid}/participants/pair", json={"p1_id": p1, "p2_id": p2}, headers=_h(world))


def _singles(t):
    return [p for p in t["participants"] if p["partner_member_id"] is None and p["partner_player_id"] is None]


def _teams(t):
    return [p for p in t["participants"] if p["partner_member_id"] is not None or p["partner_player_id"] is not None]


def _spin_all(client, world, tid, draw):
    """Quay tới khi `finished` (v2: số lượt có thể < trần total_steps khi hai bên trùng hạng);
    kiểm tra next_step/side/eligible nhất quán giữa các response."""
    k = draw["done_steps"]
    while not draw["finished"]:
        assert k < draw["total_steps"]
        nxt = draw["next_step"]
        assert nxt is not None and nxt["step_index"] == k
        r = _spin(client, world, tid, k)
        assert r.status_code == 200, r.text
        draw = r.json()
        st = draw["steps"][k]
        assert draw["done_steps"] == k + 1 and draw["status"] == "open"
        assert draw["seed_hex"] is None                          # commit–reveal
        assert st["step_index"] == k
        assert st["side"] == nxt["side"] and st["team_index"] == nxt["team_index"]
        assert st["eligible_pids"] == nxt["eligible_pids"]      # eligible công bố TRƯỚC khi quay
        assert st["pid"] in st["eligible_pids"]
        assert st["auto"] == (len(st["eligible_pids"]) == 1)
        assert isinstance(st["spun_at_ms"], int) and isinstance(draw["server_now_ms"], int)
        k += 1
    assert draw["next_step"] is None and draw["finished"] is True
    assert draw["done_steps"] % 2 == 0 and draw["done_steps"] <= draw["total_steps"]
    return draw


def _replay_next(people, rules, steps):
    """Tái lập ĐỘC LẬP (không dùng engine) ngữ cảnh lượt kế tiếp theo quy tắc v2:
    - lượt trước là bên 1 → bên 2 cùng đội, eligible = người còn lại có hạng ∈ ranks2 (rỗng = bất kỳ);
    - ngược lại duyệt quy tắc từ quy tắc của lượt trước: eligible bên 1 = người ∈ S1 mà bên 2 vẫn còn người khác;
    - hết quy tắc → None. Trả (phase_index, side, team_index, eligible)."""
    rules = rules or [{"ranks1": [], "ranks2": []}]
    picked = {s["pid"] for s in steps}
    rem = [p for p in people if p["pid"] not in picked]

    def pool(ranks):
        return sorted(p["pid"] for p in rem if not ranks or p["rank"] in ranks)

    if steps and steps[-1]["side"] == 1:
        ph = steps[-1]["phase_index"]
        return ph, 2, steps[-1]["team_index"], pool(rules[ph]["ranks2"])
    start = steps[-1]["phase_index"] if steps else 0
    team_index = sum(1 for s in steps if s["side"] == 2)
    for i in range(start, len(rules)):
        s2 = pool(rules[i]["ranks2"])
        elig = [x for x in pool(rules[i]["ranks1"]) if any(y != x for y in s2)]
        if elig:
            return i, 1, team_index, elig
    return None


def _verify_picks(draw):
    """Khán giả kiểm chứng: tái lập eligible từ pool + rules + steps trước (KHÔNG gọi engine backend,
    để engine sai cùng kiểu ở cả spin lẫn kiểm chứng vẫn bị phát hiện), idx bằng hashlib thô."""
    seed_hex = draw["seed_hex"]
    assert seed_hex and hashlib.sha256(seed_hex.encode()).hexdigest() == draw["seed_commit"]
    people = [{"pid": x["pid"], "rank": x["rank"]} for x in draw["pool"]]
    steps = sorted(draw["steps"], key=lambda s: s["step_index"])
    for k, st in enumerate(steps):
        ctx = _replay_next(people, draw["rules"], steps[:k])
        assert ctx is not None, f"lượt {k} không còn cặp hợp lệ"
        phase_index, side, team_index, eligible = ctx
        assert st["step_index"] == k and st["side"] == side and st["team_index"] == team_index
        assert st["phase_index"] == phase_index
        assert eligible == st["eligible_pids"]
        idx = int(hashlib.sha256(f"{seed_hex}:{k}".encode()).hexdigest(), 16) % len(eligible)
        assert st["pick_index"] == idx and st["pid"] == eligible[idx]
    # Phiên đã chốt: không còn cặp hợp lệ hoặc đã chạm trần
    assert _replay_next(people, draw["rules"], steps) is None or len(steps) == draw["total_steps"]


PUBLIC_KEYS = {
    "id", "tournament_id", "seq", "status", "total_steps", "done_steps", "finished", "stuck", "reveal_ms", "pool", "rules",
    "plan", "next_step", "steps", "seed_commit", "seed_hex", "created_at", "committed_at", "cancelled_at",
    "cancel_reason", "server_now_ms",
}
POOL_KEYS = {"pid", "member_id", "player_id", "name", "rank"}


# ── Engine thuần ───────────────────────────────────────────────────────────

def test_normalize_rank():
    assert eng.normalize_rank(None) == eng.UNRANKED
    assert eng.normalize_rank("") == eng.UNRANKED
    assert eng.normalize_rank("   ") == eng.UNRANKED
    assert eng.normalize_rank(" A ") == "A"


def _ppl(*ranks):
    return [{"pid": i + 1, "rank": r} for i, r in enumerate(ranks)]


@pytest.mark.parametrize("n,teams", [(6, 3), (7, 3), (2, 1), (1, 0)])
def test_plan_no_rules(n, teams):
    plan = eng.partner_draw_plan(_ppl(*(["A"] * n)), [])
    assert plan["total_steps_max"] == 2 * teams
    # v2: không quy tắc → 1 phase "bất kỳ + bất kỳ" (2 bên rỗng), team_max = n // 2, luôn overlap
    assert plan["phases"] == [{"index": 0, "ranks1": [], "ranks2": [], "team_max": teams, "team_cap": teams, "overlap": True}]
    assert plan["total_steps_est"] == 2 * teams
    assert plan["unpaired_pids"] == []   # người dư chỉ xác định sau khi quay


def test_plan_same_rank_odd():
    plan = eng.partner_draw_plan(_ppl("A", "A", "A", "B"), [{"rank1": "A", "rank2": "A"}])
    assert plan["phases"] == [{"index": 0, "ranks1": ["A"], "ranks2": ["A"], "team_max": 1, "team_cap": 1, "overlap": True}]
    assert plan["total_steps_max"] == 2
    assert plan["unpaired_pids"] == [4]              # hạng B không quy tắc nào dùng
    assert plan["estimated"] is True                 # cùng hạng 2 bên → 1 A dư, ai dư biết sau khi quay


def test_plan_cross_rank_uneven():
    plan = eng.partner_draw_plan(_ppl("A", "A", "A", "B", "B"), [{"rank1": "A", "rank2": "B"}])
    assert plan["phases"][0]["team_max"] == 2 and plan["total_steps_max"] == 4
    assert plan["phases"][0]["overlap"] is False and plan["estimated"] is False
    assert plan["unpaired_pids"] == []


def test_plan_overlapping_rules_consume_in_order():
    # A+B rồi B+C: B bị A+B tiêu thụ trước → B+C không còn B → phase 2 tối đa 0 đội (C ghép tay)
    plan = eng.partner_draw_plan(_ppl("A", "A", "B", "B", "C", "C"),
                                 [{"rank1": "A", "rank2": "B"}, {"rank1": "B", "rank2": "C"}])
    assert [ph["index"] for ph in plan["phases"]] == [0, 1]
    assert [ph["team_max"] for ph in plan["phases"]] == [2, 0] and plan["total_steps_est"] == 4
    # Trần THẬT: team_cap tính trên toàn bộ pool [2, 2] → 2 × min(4, 6 // 2) = 6 ≥ dự kiến 4
    assert [ph["team_cap"] for ph in plan["phases"]] == [2, 2] and plan["total_steps_max"] == 6
    assert plan["unpaired_pids"] == []               # C có trong hợp các hạng → không "không khớp", chỉ là dư
    # Đảo thứ tự: B+C trước → A+B không còn B
    plan2 = eng.partner_draw_plan(_ppl("A", "A", "B", "B", "C", "C"),
                                  [{"rank1": "B", "rank2": "C"}, {"rank1": "A", "rank2": "B"}])
    assert [ph["team_max"] for ph in plan2["phases"]] == [2, 0] and plan2["total_steps_est"] == 4
    assert plan2["total_steps_max"] == 6


def test_plan_unranked_go_unpaired_and_rule_ranks_normalized():
    plan = eng.partner_draw_plan(_ppl("A", "A", eng.UNRANKED), [{"rank1": " A ", "rank2": "A"}])
    assert plan["phases"][0]["ranks1"] == ["A"] and plan["total_steps_max"] == 2
    assert plan["unpaired_pids"] == [3]
    # Quy tắc nhắc tới hạng "Chưa xếp hạng" thì người không hạng vẫn ghép được
    plan2 = eng.partner_draw_plan(_ppl("A", eng.UNRANKED), [{"rank1": "A", "rank2": eng.UNRANKED}])
    assert plan2["total_steps_max"] == 2 and plan2["unpaired_pids"] == []


def test_plan_no_rule_matches_gives_zero_steps():
    plan = eng.partner_draw_plan(_ppl("A", "B"), [{"rank1": "C", "rank2": "D"}])
    assert [ph["team_max"] for ph in plan["phases"]] == [0]
    assert plan["total_steps_max"] == 0 and plan["unpaired_pids"] == [1, 2]


def _st(pid, side, phase_index, team_index):
    return {"pid": pid, "side": side, "phase_index": phase_index, "team_index": team_index}


def test_step_context_sides_eligible_and_multi_phase():
    people = _ppl("A", "A", "B", "B", "C", "C")
    rules = [{"rank1": "A", "rank2": "B"}, {"rank1": "C", "rank2": "C"}]
    plan = eng.partner_draw_plan(people, rules)
    assert [ph["team_max"] for ph in plan["phases"]] == [2, 1] and plan["total_steps_max"] == 6
    c0 = eng.partner_step_context(people, rules, [])
    assert (c0["step_index"], c0["phase_index"], c0["team_index"], c0["side"], c0["eligible_pids"]) == (0, 0, 0, 1, [1, 2])
    c1 = eng.partner_step_context(people, rules, [_st(2, 1, 0, 0)])
    assert (c1["step_index"], c1["team_index"], c1["side"], c1["eligible_pids"]) == (1, 0, 2, [3, 4])
    done = [_st(2, 1, 0, 0), _st(4, 2, 0, 0)]
    c2 = eng.partner_step_context(people, rules, done)
    assert (c2["team_index"], c2["side"], c2["eligible_pids"]) == (1, 1, [1])   # người đã chọn không còn eligible
    done += [_st(1, 1, 0, 1), _st(3, 2, 0, 1)]
    c4 = eng.partner_step_context(people, rules, done)
    assert (c4["step_index"], c4["phase_index"], c4["team_index"], c4["side"], c4["eligible_pids"]) == (4, 1, 2, 1, [5, 6])
    c5 = eng.partner_step_context(people, rules, done + [_st(6, 1, 1, 2)])
    assert (c5["team_index"], c5["side"], c5["eligible_pids"]) == (2, 2, [5])
    assert eng.partner_step_context(people, rules, done + [_st(6, 1, 1, 2), _st(5, 2, 1, 2)]) is None   # hết lượt hợp lệ
    # Không quy tắc → eligible = toàn bộ người chưa chọn
    assert eng.partner_step_context(people, [], [_st(3, 1, 0, 0)])["eligible_pids"] == [1, 2, 4, 5, 6]


# ── API luồng ──────────────────────────────────────────────────────────────

def test_create_doubles_without_teams_makes_singles(client, world):
    t = _create_doubles(client, world, partner_rules=[{"rank1": "A", "rank2": "B"}])
    assert t["team_type"] == "doubles" and len(t["participants"]) == 6
    assert len(_singles(t)) == 6 and t["unpaired_count"] == 6
    assert t["partner_rules"] == [{"ranks1": ["A"], "ranks2": ["B"]}]   # shape cũ được chuẩn hoá về v2
    assert t["partner_draw"] is None and t["draw"] is None
    # Đợt 3: cho phép tạo giải với < 2 người (chọn người tại trang giải); guard ≥ 2 chuyển sang lúc "Bắt đầu giải"
    r = client.post("/api/tournaments", json={"name": "x", "format": "knockout", "team_type": "doubles",
                                              "member_ids": [world.members1[0].id]}, headers=_h(world))
    assert r.status_code == 201 and len(r.json()["participants"]) == 1
    r = client.put(f"/api/tournaments/{r.json()['id']}", json={"status": "active"}, headers=_h(world))
    assert r.status_code == 400 and "Cần ít nhất 2" in r.json()["detail"]


def test_flow_cross_rank_rules_leaves_unmatched_for_manual(client, world, db):
    _set_ranks(db, world)
    t = _create_doubles(client, world)
    tid = t["id"]
    pid_of = {p["member_id"]: p["id"] for p in t["participants"] if p["member_id"]}
    guest_pid = next(p["id"] for p in t["participants"] if p["player_id"] == world.guest1.id)
    a_pids = sorted(pid_of[m.id] for m in world.members1[:3])
    b_pids = sorted(pid_of[m.id] for m in world.members1[3:5])

    r = _open(client, world, tid, rules=[{"rank1": "A", "rank2": "B"}], reveal_ms=5000)
    assert r.status_code == 201, r.text
    draw = r.json()
    assert draw["status"] == "open" and draw["seq"] == 1 and draw["reveal_ms"] == 5000
    assert draw["total_steps"] == 4 and draw["done_steps"] == 0 and draw["seed_hex"] is None
    assert len(draw["seed_commit"]) == 64
    assert draw["rules"] == [{"ranks1": ["A"], "ranks2": ["B"]}]
    assert draw["plan"]["phases"] == [{"index": 0, "ranks1": ["A"], "ranks2": ["B"], "team_max": 2, "team_cap": 2, "overlap": False}]
    assert draw["plan"]["unpaired_pids"] == [guest_pid]            # khách mời không hạng → ghép tay
    assert draw["plan"]["total_steps_max"] == 4 and draw["plan"]["estimated"] is False
    assert draw["finished"] is False
    assert [x["pid"] for x in draw["pool"]] == sorted(x["pid"] for x in draw["pool"])
    assert all(set(x.keys()) == POOL_KEYS for x in draw["pool"])
    guest = next(x for x in draw["pool"] if x["pid"] == guest_pid)
    assert guest["rank"] == eng.UNRANKED and guest["player_id"] == world.guest1.id and guest["name"] == "Guest One"
    assert draw["next_step"] == {"step_index": 0, "team_index": 0, "side": 1, "phase_index": 0, "eligible_pids": a_pids}
    assert draw["created_by"] == "admin1"
    # TournamentOut nhúng tóm tắt phiên và lưu partner_rules
    d = _detail(client, world, tid)
    assert d["partner_draw"]["status"] == "open" and d["partner_draw"]["total_steps"] == 4
    assert d["partner_draw"]["finished"] is False
    assert d["partner_rules"] == [{"ranks1": ["A"], "ranks2": ["B"]}]
    assert d["draw"] is None   # không lẫn với phiên bốc cặp đấu

    draw = _spin_all(client, world, tid, draw)
    steps = draw["steps"]
    assert [s["side"] for s in steps] == [1, 2, 1, 2]
    assert [s["team_index"] for s in steps] == [0, 0, 1, 1]
    assert steps[0]["eligible_pids"] == a_pids and steps[1]["eligible_pids"] == b_pids
    assert len(steps[2]["eligible_pids"]) == 2 and steps[2]["pid"] in a_pids
    assert steps[3]["eligible_pids"] == [b for b in b_pids if b != steps[1]["pid"]] and steps[3]["auto"] is True
    assert steps[0]["auto"] is False

    assert draw["done_steps"] == 4 and draw["finished"] is True
    r = _spin(client, world, tid, 4)
    assert r.status_code == 409 and "hết lượt" in r.json()["detail"]   # đã hết lượt hợp lệ

    r = _commit(client, world, tid)
    assert r.status_code == 200, r.text
    t2 = r.json()
    assert t2["status"] == "draft"
    teams, singles = _teams(t2), _singles(t2)
    assert len(teams) == 2 and len(singles) == 2 and t2["unpaired_count"] == 2
    assert t2["partner_draw"]["status"] == "committed" and t2["partner_draw"]["finished"] is True
    by_pid = {x["pid"]: x for x in draw["pool"]}
    teams_by_id = {p["id"]: p for p in teams}
    for ti in range(2):
        s1 = next(s for s in steps if s["team_index"] == ti and s["side"] == 1)
        s2 = next(s for s in steps if s["team_index"] == ti and s["side"] == 2)
        team = teams_by_id.get(s1["pid"])                       # người 1 (hạng A) giữ record
        assert team is not None, (ti, s1, teams)
        assert team["member_id"] == by_pid[s1["pid"]]["member_id"]
        assert team["partner_member_id"] == by_pid[s2["pid"]]["member_id"]
        assert team["team_name"] == f'{by_pid[s1["pid"]]["name"]} / {by_pid[s2["pid"]]["name"]}'
    left = {p["id"] for p in singles}
    assert guest_pid in left and len(left & set(a_pids)) == 1   # 1 A dư + khách mời

    r = client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world))
    final = r.json()
    assert final["status"] == "committed" and final["seed_hex"] and final["next_step"] is None
    _verify_picks(final)
    # Chưa ghép hết → chưa được bắt đầu giải / sinh lịch
    r = client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=_h(world))
    assert r.status_code == 400 and "Còn 2 người chưa có đội" in r.json()["detail"]
    r = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
    assert r.status_code == 400 and "chưa có đội" in r.json()["detail"]
    # Ghép tay 2 người còn lại → bắt đầu được
    a_left = next(iter(left - {guest_pid}))
    r = _pair(client, world, tid, a_left, guest_pid)
    assert r.status_code == 200, r.text
    assert r.json()["unpaired_count"] == 0 and len(r.json()["participants"]) == 3
    paired = next(p for p in r.json()["participants"] if p["id"] == a_left)
    assert paired["partner_player_id"] == world.guest1.id and paired["team_name"].endswith(" / Guest One")
    r = client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=_h(world))
    assert r.status_code == 200, r.text


def test_flow_no_rules_all_paired(client, world, db):
    _set_ranks(db, world)
    t = _create_doubles(client, world)
    tid = t["id"]
    r = _open(client, world, tid, rules=[])
    assert r.status_code == 201, r.text
    draw = r.json()
    assert draw["total_steps"] == 6 and draw["plan"]["unpaired_pids"] == []
    assert draw["rules"] == []
    assert draw["plan"]["phases"] == [{"index": 0, "ranks1": [], "ranks2": [], "team_max": 3, "team_cap": 3, "overlap": True}]
    assert len(draw["next_step"]["eligible_pids"]) == 6
    draw = _spin_all(client, world, tid, draw)
    assert all(len(s["eligible_pids"]) == 6 - s["step_index"] for s in draw["steps"])
    assert draw["steps"][5]["auto"] is True
    r = _commit(client, world, tid)
    assert r.status_code == 200, r.text
    assert len(_teams(r.json())) == 3 and r.json()["unpaired_count"] == 0
    assert _detail(client, world, tid)["partner_rules"] == []
    _verify_picks(client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json())


def test_flow_same_rank_uses_tournament_rules_when_body_omits(client, world, db):
    _set_ranks(db, world)
    t = _create_doubles(client, world, partner_rules=[{"rank1": "A", "rank2": "A"}])
    tid = t["id"]
    r = _open(client, world, tid)      # rules None → dùng t.partner_rules
    assert r.status_code == 201, r.text
    draw = r.json()
    assert draw["rules"] == [{"ranks1": ["A"], "ranks2": ["A"]}] and draw["total_steps"] == 2
    assert len(draw["plan"]["unpaired_pids"]) == 3     # 2 B + khách mời không có quy tắc nào
    draw = _spin_all(client, world, tid, draw)
    assert len(draw["steps"][0]["eligible_pids"]) == 3 and len(draw["steps"][1]["eligible_pids"]) == 2
    assert _commit(client, world, tid).status_code == 200
    d = _detail(client, world, tid)
    assert len(_teams(d)) == 1 and d["unpaired_count"] == 4


# ── Gating ─────────────────────────────────────────────────────────────────

def test_open_guards(client, world, db):
    _set_ranks(db, world)
    # Giải đơn → 400
    r = client.post("/api/tournaments", json={"name": "S", "format": "knockout",
                                              "member_ids": [m.id for m in world.members1[:4]]}, headers=_h(world))
    assert _open(client, world, r.json()["id"], rules=[]).status_code == 400
    # < 2 người đơn lẻ → 400
    t = _create_doubles(client, world, members=world.members1[:2], players=[])
    assert _pair(client, world, t["id"], t["participants"][0]["id"], t["participants"][1]["id"]).status_code == 200
    r = _open(client, world, t["id"], rules=[])
    assert r.status_code == 400 and "2 người" in r.json()["detail"]
    # Không quy tắc nào khớp → 400
    t = _create_doubles(client, world)
    r = _open(client, world, t["id"], rules=[{"rank1": "D", "rank2": "D"}])
    assert r.status_code == 400 and "Không có quy tắc" in r.json()["detail"]
    # Quy tắc sai kiểu → 422 (v2: ranks1/ranks2 phải là danh sách; bên rỗng = bất kỳ hạng nên KHÔNG còn lỗi "thiếu hạng")
    assert _open(client, world, t["id"], rules=[{"ranks1": "A", "ranks2": ["B"]}]).status_code == 422
    assert _open(client, world, t["id"], rules=[{"ranks1": ["A"], "ranks2": 5}]).status_code == 422
    assert _open(client, world, t["id"], rules=[], reveal_ms=100).status_code == 422
    # Giải active → 400
    tid = t["id"]
    assert _open(client, world, tid, rules=[]).status_code == 201
    draw = _spin_all(client, world, tid, client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json())
    assert _commit(client, world, tid).status_code == 200
    assert client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=_h(world)).status_code == 200
    r = _open(client, world, tid, rules=[])
    assert r.status_code == 400 and "Nháp" in r.json()["detail"]


def test_open_twice_spin_commit_and_list_guards(client, world, db):
    _set_ranks(db, world)
    tid = _create_doubles(client, world)["id"]
    assert _open(client, world, tid, rules=[]).status_code == 201
    r = _open(client, world, tid, rules=[])
    assert r.status_code == 409
    assert _spin(client, world, tid, 1).status_code == 409           # sai lượt
    r = _commit(client, world, tid)
    assert r.status_code == 409 and "Chưa hết lượt" in r.json()["detail"]      # còn người đủ điều kiện để quay
    # Đang có phiên → không được thêm/xoá/ghép tay
    r = client.post(f"/api/tournaments/{tid}/participants", json={"member_id": world.members1[6].id}, headers=_h(world))
    assert r.status_code == 400 and "phiên ghép đội" in r.json()["detail"]
    pid0 = _detail(client, world, tid)["participants"][0]["id"]
    r = client.delete(f"/api/tournaments/{tid}/participants/{pid0}", headers=_h(world))
    assert r.status_code == 400 and "phiên ghép đội" in r.json()["detail"]
    ps = _detail(client, world, tid)["participants"]
    assert _pair(client, world, tid, ps[0]["id"], ps[1]["id"]).status_code == 400
    r = client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=_h(world))
    assert r.status_code == 400 and "phiên ghép đội" in r.json()["detail"]
    # Không có phiên nào mở → spin/commit/cancel 409; sau cancel mở lại seq=2
    r = _cancel(client, world, tid, reason="thử lại")
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["cancel_reason"] == "thử lại"
    assert r.json()["seed_hex"]                                       # phiên đã kết thúc → lộ seed
    assert _spin(client, world, tid, 0).status_code == 409
    assert _commit(client, world, tid).status_code == 409
    assert _cancel(client, world, tid).status_code == 409
    r = _open(client, world, tid, rules=[])
    assert r.status_code == 201 and r.json()["seq"] == 2
    hist = client.get(f"/api/tournaments/{tid}/partner-draws", headers=_h(world)).json()
    assert [d["seq"] for d in hist] == [2, 1] and [d["status"] for d in hist] == ["open", "cancelled"]


def test_commit_detects_pool_change(client, world, db):
    _set_ranks(db, world)
    tid = _create_doubles(client, world)["id"]
    draw = _open(client, world, tid, rules=[]).json()
    _spin_all(client, world, tid, draw)
    # Xoá 1 người trực tiếp trong DB (API đã chặn khi phiên mở)
    p = db.query(models.TournamentParticipant).filter_by(tournament_id=tid).first()
    db.delete(p); db.commit()
    r = _commit(client, world, tid)
    assert r.status_code == 409 and "thay đổi" in r.json()["detail"]


def test_replace_slot_blocked_while_partner_draw_open(client, world, db):
    """Pool là snapshot người: thay người ở slot khi phiên đang mở → 400 (Nháp). Sau huỷ phiên → thay được."""
    _set_ranks(db, world)
    t = _create_doubles(client, world)
    tid = t["id"]
    pid = t["participants"][0]["id"]
    body = {"slot": "main", "member_id": world.members1[6].id}
    assert _open(client, world, tid, rules=[]).status_code == 201
    r = client.patch(f"/api/tournaments/{tid}/participants/{pid}", json=body, headers=_h(world))
    assert r.status_code == 400 and "phiên ghép đội" in r.json()["detail"]
    assert _cancel(client, world, tid).status_code == 200
    r = client.patch(f"/api/tournaments/{tid}/participants/{pid}", json=body, headers=_h(world))
    assert r.status_code == 200, r.text
    assert r.json()["member_id"] == world.members1[6].id


def test_commit_detects_person_swap_same_pid(client, world, db):
    """Cùng pid nhưng đổi NGƯỜI (member/player) trong lúc phiên mở → commit 409 (không chỉ so tập pid)."""
    _set_ranks(db, world)
    t = _create_doubles(client, world)
    tid = t["id"]
    draw = _open(client, world, tid, rules=[]).json()
    _spin_all(client, world, tid, draw)
    first_pid = draw["pool"][0]["pid"]
    p = db.query(models.TournamentParticipant).filter_by(id=first_pid).first()
    p.member_id, p.player_id = world.members1[6].id, None       # đổi người trực tiếp DB (API đã chặn)
    db.commit()
    r = _commit(client, world, tid)
    assert r.status_code == 409 and "thay đổi" in r.json()["detail"]


def test_generate_precondition_only_blocks_unpaired_when_draft(client, world, db):
    """Dữ liệu cũ: giải đôi đã active có participant thiếu người 2 → generate/bốc cặp đấu KHÔNG bị chặn
    bằng câu 'chưa có đội' (không còn cách ghép khi active)."""
    _set_ranks(db, world)
    tid = _create_doubles(client, world, members=world.members1[:4], players=[])["id"]
    draw = _open(client, world, tid, rules=[]).json()
    _spin_all(client, world, tid, draw)
    assert _commit(client, world, tid).status_code == 200
    assert client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=_h(world)).status_code == 200
    p = db.query(models.TournamentParticipant).filter_by(tournament_id=tid).first()
    p.partner_member_id, p.partner_player_id = None, None
    db.commit()
    r = client.post(f"/api/tournaments/{tid}/generate", headers=_h(world))
    assert r.status_code == 200, r.text


def test_second_commit_supersedes_previous(client, world, db):
    _set_ranks(db, world)
    tid = _create_doubles(client, world)["id"]
    draw = _open(client, world, tid, rules=[{"rank1": "A", "rank2": "A"}]).json()
    _spin_all(client, world, tid, draw)
    assert _commit(client, world, tid).status_code == 200            # 1 đội A/A, còn 4 người đơn
    draw = _open(client, world, tid, rules=[]).json()
    assert draw["seq"] == 2 and draw["total_steps"] == 4 and len(draw["pool"]) == 4
    _spin_all(client, world, tid, draw)
    assert _commit(client, world, tid).status_code == 200
    hist = client.get(f"/api/tournaments/{tid}/partner-draws", headers=_h(world)).json()
    assert [(d["seq"], d["status"]) for d in hist] == [(2, "committed"), (1, "superseded")]
    d = _detail(client, world, tid)
    assert d["unpaired_count"] == 0 and len(_teams(d)) == 3


def test_pair_endpoint_errors(client, world, db):
    _set_ranks(db, world)
    t = _create_doubles(client, world)
    tid = t["id"]
    ps = [p["id"] for p in t["participants"]]
    assert _pair(client, world, tid, ps[0], ps[0]).status_code == 400            # cùng id
    assert _pair(client, world, tid, ps[0], 999999).status_code == 404           # không tồn tại
    assert _pair(client, world, tid, ps[0], ps[1]).status_code == 200
    assert _pair(client, world, tid, ps[0], ps[2]).status_code == 400            # ps[0] đã có đội
    assert _pair(client, world, tid, ps[2], ps[1]).status_code == 404            # ps[1] đã bị gộp (xoá)
    # Người của giải khác → 404
    t2 = _create_doubles(client, world, members=world.members1[5:7], players=[])
    assert _pair(client, world, tid, ps[2], t2["participants"][0]["id"]).status_code == 404
    # Giải đơn → 400
    r = client.post("/api/tournaments", json={"name": "S", "format": "knockout",
                                              "member_ids": [m.id for m in world.members1[:2]]}, headers=_h(world))
    sp = [p["id"] for p in r.json()["participants"]]
    assert _pair(client, world, r.json()["id"], sp[0], sp[1]).status_code == 400
    # Giải active → 400
    assert _pair(client, world, tid, ps[2], ps[3]).status_code == 200
    assert _pair(client, world, tid, ps[4], ps[5]).status_code == 200
    assert client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=_h(world)).status_code == 200
    assert _pair(client, world, tid, ps[2], ps[4]).status_code == 400


def test_permissions_viewer_and_other_club(client, world, db):
    _set_ranks(db, world)
    tid = _create_doubles(client, world)["id"]
    assert _open(client, world, tid, rules=[]).status_code == 201
    hv = World.headers(world.viewer1, world.club1)
    assert client.get(f"/api/tournaments/{tid}/partner-draw", headers=hv).status_code == 200
    assert client.get(f"/api/tournaments/{tid}/partner-draws", headers=hv).status_code == 200
    assert client.post(f"/api/tournaments/{tid}/partner-draw", json={}, headers=hv).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/partner-draw/spin", json={"expected_step": 0}, headers=hv).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/partner-draw/commit", headers=hv).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/participants/pair", json={"p1_id": 1, "p2_id": 2}, headers=hv).status_code == 403
    h2 = World.headers(world.admin2, world.club2)
    assert client.get(f"/api/tournaments/{tid}/partner-draw", headers=h2).status_code == 404
    assert client.post(f"/api/tournaments/{tid}/partner-draw", json={}, headers=h2).status_code == 404


def test_get_partner_draw_404_when_none(client, world):
    tid = _create_doubles(client, world)["id"]
    r = client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world))
    assert r.status_code == 404 and "chưa có phiên ghép đội" in r.json()["detail"]
    assert client.get(f"/api/tournaments/{tid}/partner-draws", headers=_h(world)).json() == []


# ── Public ─────────────────────────────────────────────────────────────────

def test_public_sees_draft_only_while_partner_draw_live(client, world, db):
    _set_ranks(db, world)
    slug = world.token1.slug
    tid = _create_doubles(client, world)["id"]
    base = f"/api/public/report/{slug}/tournaments"
    # Nháp chưa có phiên → ẩn hoàn toàn
    assert tid not in [x["id"] for x in client.get(base).json()]
    assert client.get(f"{base}/{tid}").status_code == 404
    assert client.get(f"{base}/{tid}/partner-draw").status_code == 404
    assert client.get(f"{base}/{tid}/standings").status_code == 404
    assert client.get(f"{base}/{tid}/draw").status_code == 404

    assert _open(client, world, tid, rules=[{"rank1": "A", "rank2": "B"}]).status_code == 201
    assert _spin(client, world, tid, 0).status_code == 200
    lst = client.get(base).json()
    item = next(x for x in lst if x["id"] == tid)
    assert item["status"] == "draft" and item["partner_draw_status"] == "open" and item["unpaired_count"] == 6
    det = client.get(f"{base}/{tid}")
    assert det.status_code == 200
    assert det.json()["partner_draw"]["status"] == "open" and det.json()["partner_draw"]["done_steps"] == 1
    assert det.json()["unpaired_count"] == 6 and det.json()["draw"] is None
    assert client.get(f"{base}/{tid}/standings").status_code == 200
    assert client.get(f"{base}/{tid}/draw").json()["draw"] is None

    r = client.get(f"{base}/{tid}/partner-draw")
    assert r.status_code == 200 and isinstance(r.json()["server_now_ms"], int)
    pd = r.json()["partner_draw"]
    assert pd["status"] == "open" and pd["seed_hex"] is None and pd["done_steps"] == 1
    assert set(pd.keys()) <= PUBLIC_KEYS and "created_by" not in pd
    assert all(set(x.keys()) == POOL_KEYS for x in pd["pool"])
    assert pd["next_step"]["step_index"] == 1 and pd["next_step"]["side"] == 2
    assert "0900000" not in r.text and "@x.vn" not in r.text and "secret note" not in r.text and "0911111111" not in r.text
    assert "M Member 1" in r.text                                    # tên hiển thị là cần thiết cho vòng quay

    # Huỷ phiên DUY NHẤT → mọi phiên đều cancelled → giải nháp lại biến mất khỏi public
    assert _cancel(client, world, tid).status_code == 200
    assert tid not in [x["id"] for x in client.get(base).json()]
    assert client.get(f"{base}/{tid}").status_code == 404
    assert client.get(f"{base}/{tid}/partner-draws").status_code == 404

    # Mở lại, chốt → vẫn hiện (committed) và seed_hex lộ; lịch sử không có created_by
    draw = _open(client, world, tid, rules=[]).json()
    _spin_all(client, world, tid, draw)
    assert _commit(client, world, tid).status_code == 200
    item = next(x for x in client.get(base).json() if x["id"] == tid)
    assert item["partner_draw_status"] == "committed" and item["unpaired_count"] == 0
    pd = client.get(f"{base}/{tid}/partner-draw").json()["partner_draw"]
    assert pd["status"] == "committed" and pd["seed_hex"] and pd["next_step"] is None
    _verify_picks(pd)
    hist = client.get(f"{base}/{tid}/partner-draws")
    assert hist.status_code == 200 and [d["seq"] for d in hist.json()] == [2, 1]
    assert all(set(d.keys()) <= PUBLIC_KEYS for d in hist.json())
    assert "0900000" not in hist.text and "admin1" not in hist.text

    assert client.get("/api/public/report/khong-ton-tai/tournaments/1/partner-draw").status_code == 404


def test_public_stays_visible_when_later_session_cancelled_after_commit(client, world, db):
    """Đã có phiên chốt (đội công khai) → mở phiên #2 rồi huỷ: giải vẫn hiện trên public (không 'biến mất')."""
    _set_ranks(db, world)
    slug = world.token1.slug
    tid = _create_doubles(client, world)["id"]
    base = f"/api/public/report/{slug}/tournaments"
    draw = _open(client, world, tid, rules=[{"rank1": "A", "rank2": "A"}]).json()   # 1 đội A/A, còn 4 người
    _spin_all(client, world, tid, draw)
    assert _commit(client, world, tid).status_code == 200
    assert _open(client, world, tid, rules=[]).json()["seq"] == 2
    assert _cancel(client, world, tid).status_code == 200
    item = next(x for x in client.get(base).json() if x["id"] == tid)
    assert item["status"] == "draft" and item["partner_draw_status"] == "cancelled" and item["unpaired_count"] == 4
    assert client.get(f"{base}/{tid}").status_code == 200
    hist = client.get(f"{base}/{tid}/partner-draws")
    assert hist.status_code == 200 and [(d["seq"], d["status"]) for d in hist.json()] == [(2, "cancelled"), (1, "committed")]


def test_public_active_tournament_still_visible_without_partner_draw(client, world):
    """Hồi quy: quy tắc hiển thị mới không làm giải đã bắt đầu biến mất."""
    slug = world.token1.slug
    r = client.post("/api/tournaments", json={"name": "S", "format": "knockout",
                                              "member_ids": [m.id for m in world.members1[:4]]}, headers=_h(world))
    tid = r.json()["id"]
    assert client.get(f"/api/public/report/{slug}/tournaments/{tid}").status_code == 404
    assert client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=_h(world)).status_code == 200
    assert client.get(f"/api/public/report/{slug}/tournaments/{tid}").status_code == 200
    item = next(x for x in client.get(f"/api/public/report/{slug}/tournaments").json() if x["id"] == tid)
    assert item["partner_draw_status"] is None and item["unpaired_count"] == 0
    r = client.get(f"/api/public/report/{slug}/tournaments/{tid}/partner-draw")
    assert r.status_code == 200 and r.json()["partner_draw"] is None


# ── Xoá giải & cascade ─────────────────────────────────────────────────────

def test_delete_tournament_cascades_partner_draws(client, world, db):
    _set_ranks(db, world)
    tid = _create_doubles(client, world)["id"]
    assert _open(client, world, tid, rules=[]).status_code == 201
    for k in range(2):
        assert _spin(client, world, tid, k).status_code == 200
    assert db.query(models.TournamentPartnerDraw).filter_by(tournament_id=tid).count() == 1
    assert db.query(models.TournamentPartnerDrawStep).count() == 2
    r = client.delete(f"/api/tournaments/{tid}", headers=_h(world))
    assert r.status_code == 204, r.text
    db.expire_all()
    assert db.query(models.TournamentPartnerDraw).filter_by(tournament_id=tid).count() == 0
    assert db.query(models.TournamentPartnerDrawStep).count() == 0
    assert db.query(models.TournamentParticipant).filter_by(tournament_id=tid).count() == 0
