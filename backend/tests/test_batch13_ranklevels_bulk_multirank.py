"""Đợt 13: cấu hình HẠNG cấp CLB, thêm người chơi HÀNG LOẠT tại trang giải, giải RỖNG + guard ≥ 2 khi bắt đầu,
engine quy tắc ghép đội NHIỀU HẠNG v2 (ranks1/ranks2, bên rỗng = bất kỳ, kết thúc sớm khi hết cặp hợp lệ)."""
import hashlib

import pytest
from conftest import World

import main as app_main
import models
import tournament_engine as eng


def _h(world):
    return World.headers(world.admin1, world.club1)


def _hv(world):
    return World.headers(world.viewer1, world.club1)


def _h2(world):
    return World.headers(world.admin2, world.club2)


RL = "/api/club/rank-levels"


def _get_levels(client, headers):
    r = client.get(RL, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _put_levels(client, headers, levels):
    return client.put(RL, json={"rank_levels": levels}, headers=headers)


# ── 1.1 Cấu hình hạng CLB ──────────────────────────────────────────────────

def test_rank_levels_default(client, world):
    j = _get_levels(client, _h(world))
    assert j["rank_levels"] == app_main.DEFAULT_RANK_LEVELS
    assert j["unranked_label"] == eng.UNRANKED and eng.UNRANKED not in j["rank_levels"]
    assert j["in_use"] == {"B": 8, "C": 1}          # 8 thành viên hạng B + khách mời hạng C


def test_rank_levels_put_valid_reorder_add_and_per_club(client, world):
    levels = ["Pro", "A", "C", "B", "D"]
    r = _put_levels(client, _h(world), levels + ["  ", ""])
    assert r.status_code == 200, r.text
    assert r.json()["rank_levels"] == levels          # giữ thứ tự, bỏ phần tử rỗng; "Hạt giống" bỏ được vì không ai dùng
    assert r.json()["in_use"] == {"B": 8, "C": 1}
    assert _get_levels(client, _h(world))["rank_levels"] == levels
    # Mỗi CLB một danh sách: CLB 2 vẫn mặc định
    assert _get_levels(client, _h2(world))["rank_levels"] == app_main.DEFAULT_RANK_LEVELS
    # strip khoảng trắng
    r = _put_levels(client, _h(world), [" A ", "B", "C "])
    assert r.status_code == 200 and r.json()["rank_levels"] == ["A", "B", "C"]
    # Danh sách rỗng hợp lệ chỉ khi không hạng nào đang dùng → ở đây B/C đang dùng → 400
    assert _put_levels(client, _h(world), []).status_code == 400


@pytest.mark.parametrize("levels,msg", [
    (["A", "B", "A", "C"], "Hạng bị trùng: A"),
    (["A", "B", "C", eng.UNRANKED], "ngầm định"),
    (["A", "B", "C", "X" * 31], "quá dài"),
    ([f"R{i}" for i in range(31)] + ["B", "C"], "Tối đa 30 hạng"),
])
def test_rank_levels_put_invalid(client, world, levels, msg):
    r = _put_levels(client, _h(world), levels)
    assert r.status_code == 400 and msg in r.json()["detail"], r.text
    assert _get_levels(client, _h(world))["rank_levels"] == app_main.DEFAULT_RANK_LEVELS   # không lưu


def test_rank_levels_put_30_chars_ok_and_30_levels_ok(client, world):
    r = _put_levels(client, _h(world), ["B", "C", "X" * 30])
    assert r.status_code == 200, r.text
    r = _put_levels(client, _h(world), ["B", "C"] + [f"R{i}" for i in range(28)])
    assert r.status_code == 200 and len(r.json()["rank_levels"]) == 30


def test_rank_levels_cannot_remove_rank_in_use_counts_guests(client, world, db):
    world.members1[0].rank = "A"
    world.members1[1].rank = "A"
    db.commit()
    r = _put_levels(client, _h(world), ["B", "C", "D"])                    # bỏ A (2 thành viên đang dùng)
    assert r.status_code == 400
    assert r.json()["detail"] == "Hạng A đang được dùng bởi 2 người — đổi hạng của họ trước khi xoá"
    r = _put_levels(client, _h(world), ["A", "B", "D"])                    # bỏ C (khách mời đang dùng)
    assert r.status_code == 400 and "Hạng C đang được dùng bởi 1 người" in r.json()["detail"]
    r = _put_levels(client, _h(world), ["A", "B", "C"])                    # bỏ D + Hạt giống: không ai dùng → OK
    assert r.status_code == 200, r.text
    assert r.json()["in_use"] == {"A": 2, "B": 6, "C": 1}
    # Hạng cũ ngoài danh sách (dữ liệu cũ) không chặn lưu, nhưng vẫn được đếm trong in_use
    world.members1[2].rank = "Pro"
    world.guest1.rank = None
    db.commit()
    r = _put_levels(client, _h(world), ["A", "B"])
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["in_use"] == {"A": 2, "B": 5, "Pro": 1, eng.UNRANKED: 1}
    assert "C" not in j["in_use"]
    # Đổi hạng của 2 người A về B → bỏ A được
    world.members1[0].rank = "B"
    world.members1[1].rank = ""
    db.commit()
    r = _put_levels(client, _h(world), ["B"])
    assert r.status_code == 200 and r.json()["in_use"] == {"B": 6, "Pro": 1, eng.UNRANKED: 2}


def test_rank_levels_permissions_and_isolation(client, world):
    assert client.get(RL, headers=_hv(world)).status_code == 200
    assert _put_levels(client, _hv(world), ["B", "C"]).status_code == 403
    assert client.get(RL).status_code == 401
    # admin2 lưu cho CLB 2 (3 thành viên B + khách C đang dùng) → không ảnh hưởng CLB 1
    r = _put_levels(client, _h2(world), ["X", "B", "C"])
    assert r.status_code == 200 and r.json()["in_use"] == {"B": 3, "C": 1}
    assert _get_levels(client, _h(world))["rank_levels"] == app_main.DEFAULT_RANK_LEVELS
    assert _get_levels(client, _h2(world))["rank_levels"] == ["X", "B", "C"]


def test_member_and_guest_endpoints_still_accept_rank_outside_levels(client, world):
    """Không đổi: tạo/sửa thành viên, khách mời KHÔNG từ chối hạng ngoài danh sách (dữ liệu cũ)."""
    r = client.put(f"/api/members/{world.members1[0].id}", json={"rank": "Ngoài danh sách"}, headers=_h(world))
    assert r.status_code == 200, r.text
    r = client.post("/api/players", json={"name": "Khách X", "rank": "Ngoài danh sách"}, headers=_h(world))
    assert r.status_code in (200, 201), r.text
    assert _get_levels(client, _h(world))["in_use"]["Ngoài danh sách"] == 2


# ── 1.4 Tạo giải rỗng + thêm hàng loạt + guard ≥ 2 ─────────────────────────

def _create(client, world, team_type="singles", **extra):
    body = {"name": "T", "format": "knockout", "team_type": team_type}
    body.update(extra)
    r = client.post("/api/tournaments", json=body, headers=_h(world))
    assert r.status_code == 201, r.text
    return r.json()


def _bulk(client, world, tid, member_ids=(), player_ids=(), headers=None):
    return client.post(f"/api/tournaments/{tid}/participants/bulk",
                       json={"member_ids": list(member_ids), "player_ids": list(player_ids)},
                       headers=headers or _h(world))


def _detail(client, world, tid):
    return client.get(f"/api/tournaments/{tid}", headers=_h(world)).json()


def _set_status(client, world, tid, status):
    return client.put(f"/api/tournaments/{tid}", json={"status": status}, headers=_h(world))


def test_create_empty_tournament_singles_and_doubles(client, world):
    for tt in ("singles", "doubles"):
        t = _create(client, world, tt)
        assert t["status"] == "draft" and t["participants"] == [] and t["unpaired_count"] == 0
        r = _set_status(client, world, t["id"], "active")
        assert r.status_code == 400 and r.json()["detail"] == "Cần ít nhất 2 đội/người chơi trước khi bắt đầu giải"
    # Giải đôi rỗng: mở phiên ghép đội → 400 (chưa có ai)
    r = client.post(f"/api/tournaments/{t['id']}/partner-draw", json={"rules": []}, headers=_h(world))
    assert r.status_code == 400 and "2 người" in r.json()["detail"]


def test_bulk_add_then_skip_duplicates(client, world):
    t = _create(client, world, "doubles")
    tid = t["id"]
    mids = [m.id for m in world.members1[:4]]
    r = _bulk(client, world, tid, mids, [world.guest1.id])
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["added"] == 5 and j["skipped"] == []
    tt = j["tournament"]
    assert tt["id"] == tid and len(tt["participants"]) == 5 and tt["unpaired_count"] == 5
    names = [p["team_name"] for p in tt["participants"]]
    assert names == [m.full_name for m in world.members1[:4]] + ["Guest One"]
    assert [p["seed"] for p in tt["participants"]] == [1, 2, 3, 4, 5]
    assert all(p["partner_member_id"] is None and p["partner_player_id"] is None for p in tt["participants"])
    # Gọi lại cùng danh sách → không thêm, bỏ qua 5 tên
    r = _bulk(client, world, tid, mids, [world.guest1.id])
    assert r.status_code == 200 and r.json()["added"] == 0 and r.json()["skipped"] == names
    assert len(_detail(client, world, tid)["participants"]) == 5
    # Trùng trong cùng request → chỉ thêm 1; seed nối tiếp
    r = _bulk(client, world, tid, [world.members1[4].id, world.members1[4].id])
    assert r.json()["added"] == 1 and r.json()["skipped"] == []
    assert r.json()["tournament"]["participants"][-1]["seed"] == 6
    # Người đang là NGƯỜI 2 của một đội cũng bị bỏ qua
    ps = _detail(client, world, tid)["participants"]
    r = client.post(f"/api/tournaments/{tid}/participants/pair",
                    json={"p1_id": ps[0]["id"], "p2_id": ps[1]["id"]}, headers=_h(world))
    assert r.status_code == 200, r.text
    r = _bulk(client, world, tid, [mids[0], mids[1]])
    assert r.json()["added"] == 0 and r.json()["skipped"] == [world.members1[0].full_name, world.members1[1].full_name]
    # Body rỗng → không lỗi
    r = _bulk(client, world, tid)
    assert r.status_code == 200 and r.json()["added"] == 0 and r.json()["skipped"] == []


def test_bulk_guards(client, world, db):
    t = _create(client, world, "doubles")
    tid = t["id"]
    assert _bulk(client, world, tid, [world.members1[0].id], headers=_hv(world)).status_code == 403
    assert _bulk(client, world, tid, [world.members1[0].id], headers=_h2(world)).status_code == 404   # giải của CLB 1
    # Người CLB khác → 404, không thêm ai
    r = _bulk(client, world, tid, [world.members1[0].id, world.members2[0].id])
    assert r.status_code == 404 and "không thuộc câu lạc bộ" in r.json()["detail"]
    r = _bulk(client, world, tid, [], [world.guest2.id])
    assert r.status_code == 404
    assert _detail(client, world, tid)["participants"] == []
    assert client.post(f"/api/tournaments/{tid}/participants/bulk", json={"member_ids": "x"}, headers=_h(world)).status_code == 422
    # Phiên ghép đội đang mở → 400
    assert _bulk(client, world, tid, [m.id for m in world.members1[:4]]).json()["added"] == 4
    assert client.post(f"/api/tournaments/{tid}/partner-draw", json={"rules": []}, headers=_h(world)).status_code == 201
    r = _bulk(client, world, tid, [world.members1[4].id])
    assert r.status_code == 400 and "phiên ghép đội" in r.json()["detail"]
    assert client.post(f"/api/tournaments/{tid}/partner-draw/cancel", json={}, headers=_h(world)).status_code == 200
    assert _bulk(client, world, tid, [world.members1[4].id]).json()["added"] == 1
    # Giải active → 400
    s = _create(client, world, "singles")
    assert _bulk(client, world, s["id"], [m.id for m in world.members1[:2]]).json()["added"] == 2
    assert _set_status(client, world, s["id"], "active").status_code == 200
    r = _bulk(client, world, s["id"], [world.members1[2].id])
    assert r.status_code == 400 and "Nháp" in r.json()["detail"]
    assert _bulk(client, world, 999999, [world.members1[0].id]).status_code == 404


def test_start_guard_min_two_before_unpaired_check(client, world):
    # Giải đơn: 1 người → 400 "Cần ít nhất 2"; thêm người thứ 2 → bắt đầu được
    s = _create(client, world, "singles")
    assert _bulk(client, world, s["id"], [world.members1[0].id]).json()["added"] == 1
    r = _set_status(client, world, s["id"], "active")
    assert r.status_code == 400 and "Cần ít nhất 2" in r.json()["detail"]
    assert _bulk(client, world, s["id"], [world.members1[1].id]).json()["added"] == 1
    assert _set_status(client, world, s["id"], "active").status_code == 200
    # Giải đôi: 2 người chưa ghép → qua guard ≥ 2 nhưng vướng "chưa có đội"; ghép tay → còn 1 đội → "Cần ít nhất 2"
    d = _create(client, world, "doubles")
    assert _bulk(client, world, d["id"], [m.id for m in world.members1[2:4]]).json()["added"] == 2
    r = _set_status(client, world, d["id"], "active")
    assert r.status_code == 400 and "chưa có đội" in r.json()["detail"]
    ps = _detail(client, world, d["id"])["participants"]
    assert client.post(f"/api/tournaments/{d['id']}/participants/pair",
                       json={"p1_id": ps[0]["id"], "p2_id": ps[1]["id"]}, headers=_h(world)).status_code == 200
    r = _set_status(client, world, d["id"], "active")
    assert r.status_code == 400 and "Cần ít nhất 2" in r.json()["detail"]


# ── 1.2 Engine quy tắc nhiều hạng v2 ───────────────────────────────────────

def _ppl(*ranks):
    return [{"pid": i + 1, "rank": r} for i, r in enumerate(ranks)]


def _st(pid, side, phase_index, team_index):
    return {"pid": pid, "side": side, "phase_index": phase_index, "team_index": team_index}


def test_normalize_partner_rules():
    assert eng.normalize_partner_rules(None) == [] and eng.normalize_partner_rules([]) == []
    assert eng.normalize_partner_rules([{"rank1": "A", "rank2": " B "}]) == [{"ranks1": ["A"], "ranks2": ["B"]}]
    assert eng.normalize_partner_rules([{"ranks1": ["A", "A", " A"], "ranks2": []}]) == [{"ranks1": ["A"], "ranks2": []}]
    # Quy tắc 2 bên rỗng = "bất kỳ + bất kỳ": hợp lệ, KHÔNG bị bỏ
    assert eng.normalize_partner_rules([{}]) == [{"ranks1": [], "ranks2": []}]
    # Trộn shape cũ/mới trong 1 quy tắc: rank1 gộp vào ranks1; None/rỗng trong danh sách = "để trống" → BỎ
    # (KHÔNG đổi thành "Chưa xếp hạng" — muốn hạng đó thì chọn tường minh)
    assert eng.normalize_partner_rules([{"ranks1": ["B"], "rank1": "A", "ranks2": [None, "", "  "]}]) == \
        [{"ranks1": ["B", "A"], "ranks2": []}]
    # Shape cũ với rank1 = "" / None = để trống (bất kỳ hạng), không phải "Chưa xếp hạng"
    assert eng.normalize_partner_rules([{"rank1": "", "rank2": None}]) == [{"ranks1": [], "ranks2": []}]
    assert eng.normalize_partner_rules([{"rank1": " ", "rank2": "A"}]) == [{"ranks1": [], "ranks2": ["A"]}]
    # "Chưa xếp hạng" chọn tường minh thì giữ nguyên
    assert eng.normalize_partner_rules([{"ranks1": [eng.UNRANKED, ""], "rank2": eng.UNRANKED}]) == \
        [{"ranks1": [eng.UNRANKED], "ranks2": [eng.UNRANKED]}]
    # Idempotent, giữ thứ tự
    r = [{"ranks1": ["B", "A"], "ranks2": ["B", eng.UNRANKED]}]
    assert eng.normalize_partner_rules(eng.normalize_partner_rules(r)) == eng.normalize_partner_rules(r) == r


def test_plan_empty_rules_is_single_any_phase():
    plan = eng.partner_draw_plan(_ppl("A", "B", "C", "D", "E"), [])
    assert plan["phases"] == [{"index": 0, "ranks1": [], "ranks2": [], "team_max": 2, "team_cap": 2, "overlap": True}]
    assert plan["total_steps_max"] == 4 and plan["total_steps_est"] == 4
    assert plan["unpaired_pids"] == [] and plan["estimated"] is True
    assert eng.partner_draw_plan(_ppl("A", "B"), None)["total_steps_max"] == 2


def test_plan_one_side_any():
    # bất kỳ + {A}: 2A, 3B → S1 = 5 người, S2 = 2A: a = 3 (B), b = 0, c = 2 → min(5, 2, 2) = 2
    plan = eng.partner_draw_plan(_ppl("A", "A", "B", "B", "B"), [{"ranks1": [], "ranks2": ["A"]}])
    ph = plan["phases"][0]
    assert ph["team_max"] == 2 and ph["overlap"] is True and plan["total_steps_max"] == 4
    assert plan["unpaired_pids"] == []                  # có bên rỗng → không ai bị coi là "không khớp"
    # {B} + bất kỳ: 1B, 3C → S1 = {B}, S2 = 4: a = 0, b = 3, c = 1 → 1 đội
    plan = eng.partner_draw_plan(_ppl("B", "C", "C", "C"), [{"ranks1": ["B"], "ranks2": []}])
    assert plan["phases"][0]["team_max"] == 1 and plan["total_steps_max"] == 2


def test_plan_overlap_formula_a_b_c():
    plan = eng.partner_draw_plan(_ppl("A", "B", "C"), [{"ranks1": ["A", "B"], "ranks2": ["B", "C"]}])
    assert plan["phases"][0]["team_max"] == 1 and plan["phases"][0]["overlap"] is True
    assert plan["total_steps_max"] == 2 and plan["estimated"] is True
    # 2A, 2B, 2C: a = 2, b = 2, c = 2 → min(4, 4, 3) = 3
    plan = eng.partner_draw_plan(_ppl("A", "A", "B", "B", "C", "C"), [{"ranks1": ["A", "B"], "ranks2": ["B", "C"]}])
    assert plan["phases"][0]["team_max"] == 3 and plan["total_steps_max"] == 6
    # {A,B} + {B}: 2A, 2B: a = 2, b = 0, c = 2 → min(4, 2, 2) = 2 (thực tế có thể ít hơn → estimated)
    plan = eng.partner_draw_plan(_ppl("A", "A", "B", "B"), [{"ranks1": ["A", "B"], "ranks2": ["B"]}])
    assert plan["phases"][0]["team_max"] == 2 and plan["estimated"] is True
    # Không trùng hạng: {A} + {B} 3A, 1B → 1 đội, estimated False
    plan = eng.partner_draw_plan(_ppl("A", "A", "A", "B"), [{"ranks1": ["A"], "ranks2": ["B"]}])
    assert plan["phases"][0]["team_max"] == 1 and plan["phases"][0]["overlap"] is False and plan["estimated"] is False


def test_plan_multi_phase_consumption_and_unpaired():
    rules = [{"ranks1": ["A"], "ranks2": ["B"]}, {"ranks1": ["B"], "ranks2": ["C"]}]
    # 2A, 3B, 1C: phase 0 → 2 đội (tiêu thụ 2A + 2B); phase 1 còn 1B + 1C → 1 đội
    plan = eng.partner_draw_plan(_ppl("A", "A", "B", "B", "B", "C"), rules)
    assert [ph["team_max"] for ph in plan["phases"]] == [2, 1] and plan["total_steps_max"] == 6
    assert plan["unpaired_pids"] == [] and plan["estimated"] is False
    # Thêm 1 D không thuộc hợp các hạng → unpaired (không phase nào có bên rỗng)
    plan = eng.partner_draw_plan(_ppl("A", "A", "B", "B", "B", "C", "D"), rules)
    assert plan["unpaired_pids"] == [7]
    # Có 1 quy tắc bên rỗng → unpaired [] dù D không thuộc hạng nào
    plan = eng.partner_draw_plan(_ppl("A", "A", "B", "B", "B", "C", "D"), rules + [{"ranks1": [], "ranks2": ["A"]}])
    assert plan["unpaired_pids"] == []
    # Ước lượng tiêu thụ: bên 1 lấy từ S1 \\ S2 trước (giữ người trong giao cho phase sau)
    # {A,B} + {C} rồi {B} + {B} với A, B, B, C: phase 0 lấy A + C → phase 1 còn B, B → 1 đội
    plan = eng.partner_draw_plan(_ppl("A", "B", "B", "C"),
                                 [{"ranks1": ["A", "B"], "ranks2": ["C"]}, {"ranks1": ["B"], "ranks2": ["B"]}])
    assert [ph["team_max"] for ph in plan["phases"]] == [1, 1] and plan["total_steps_max"] == 4


def test_step_context_side1_excludes_people_that_starve_side2():
    people = _ppl("A", "B")
    rules = [{"ranks1": ["A", "B"], "ranks2": ["B"]}]
    # Bên 1: B bị loại vì nếu chọn B thì bên 2 không còn ai → chỉ A
    assert eng.partner_step_context(people, rules, []) == \
        {"step_index": 0, "phase_index": 0, "team_index": 0, "side": 1, "eligible_pids": [1]}
    assert eng.partner_step_context(people, rules, [_st(1, 1, 0, 0)]) == \
        {"step_index": 1, "phase_index": 0, "team_index": 0, "side": 2, "eligible_pids": [2]}
    assert eng.partner_step_context(people, rules, [_st(1, 1, 0, 0), _st(2, 2, 0, 0)]) is None


def test_step_context_early_finish_and_team_index():
    people = _ppl("A", "A", "B", "B")
    rules = [{"ranks1": ["A", "B"], "ranks2": ["B"]}]
    assert eng.partner_draw_plan(people, rules)["total_steps_max"] == 4   # trần 2 đội
    c0 = eng.partner_step_context(people, rules, [])
    assert c0["eligible_pids"] == [1, 2, 3, 4]            # B nào cũng chọn được vì còn B kia cho bên 2
    # Đội 1 = B + B → còn 2A, bên 2 không ai → KẾT THÚC SỚM (2 lượt < trần 4)
    assert eng.partner_step_context(people, rules, [_st(3, 1, 0, 0), _st(4, 2, 0, 0)]) is None
    assert eng.partner_draw_finished(people, rules, [_st(3, 1, 0, 0), _st(4, 2, 0, 0)]) is True
    assert eng.partner_draw_finished(people, rules, [_st(3, 1, 0, 0)]) is False
    # Đội 1 = A + B → đội 2: eligible bên 1 chỉ A (B còn lại bị loại), team_index = 1
    c = eng.partner_step_context(people, rules, [_st(1, 1, 0, 0), _st(3, 2, 0, 0)])
    assert (c["step_index"], c["phase_index"], c["team_index"], c["side"], c["eligible_pids"]) == (2, 0, 1, 1, [2])
    # Sang phase kế tiếp: {A}+{A} rồi {B}+{B}; sau đội A/A → phase 1, team_index 1, eligible [3, 4]
    rules2 = [{"ranks1": ["A"], "ranks2": ["A"]}, {"ranks1": ["B"], "ranks2": ["B"]}]
    c = eng.partner_step_context(people, rules2, [_st(1, 1, 0, 0), _st(2, 2, 0, 0)])
    assert (c["phase_index"], c["team_index"], c["side"], c["eligible_pids"]) == (1, 1, 1, [3, 4])
    # Không quay lại phase trước: đang ở phase 1 thì phase 0 không được duyệt lại
    c = eng.partner_step_context(_ppl("A", "A", "B", "B", "A", "A"), rules2,
                                 [_st(1, 1, 0, 0), _st(2, 2, 0, 0), _st(3, 1, 1, 1), _st(4, 2, 1, 1)])
    assert c is None
    # finished CHỈ theo replay (không còn cặp hợp lệ) — không có nhánh "chạm trần"
    assert eng.partner_draw_finished(people, [], [_st(1, 1, 0, 0), _st(2, 2, 0, 0)]) is False
    assert eng.partner_draw_finished(people, [], [_st(1, 1, 0, 0), _st(2, 2, 0, 0), _st(3, 1, 0, 1), _st(4, 2, 0, 1)]) is True


def test_plan_ceiling_is_true_upper_bound_not_heuristic():
    """Trần total_steps_max phải là cận trên THẬT: pool B(1),B(2),A(3),C(4), quy tắc [{A,B}+{C}, {B}+{B}].
    Ước lượng tiêu thụ theo thứ tự pid lấy B(1)+C(4) → phase 2 còn 1B → dự kiến 1 đội (2 lượt);
    nhưng nếu lượt 0 bốc A(3) thì phase 2 vẫn ghép được B+B → thực tế 2 đội (4 lượt). Trần phải là 4."""
    people = [{"pid": 1, "rank": "B"}, {"pid": 2, "rank": "B"}, {"pid": 3, "rank": "A"}, {"pid": 4, "rank": "C"}]
    rules = [{"ranks1": ["A", "B"], "ranks2": ["C"]}, {"ranks1": ["B"], "ranks2": ["B"]}]
    plan = eng.partner_draw_plan(people, rules)
    assert [ph["team_max"] for ph in plan["phases"]] == [1, 0] and plan["total_steps_est"] == 2
    assert [ph["team_cap"] for ph in plan["phases"]] == [1, 1] and plan["total_steps_max"] == 4
    steps = [_st(3, 1, 0, 0), _st(4, 2, 0, 0)]
    c = eng.partner_step_context(people, rules, steps)
    assert (c["phase_index"], c["team_index"], c["side"], c["eligible_pids"]) == (1, 1, 1, [1, 2])
    assert eng.partner_draw_finished(people, rules, steps) is False
    steps += [_st(1, 1, 1, 1), _st(2, 2, 1, 1)]
    assert eng.partner_draw_finished(people, rules, steps) is True and len(steps) == plan["total_steps_max"]
    # Trần không vượt n // 2 đội: {A}+{B} rồi {B}+{C} với 2A, 2B, 2C → Σ team_cap = 4 nhưng n // 2 = 3
    plan = eng.partner_draw_plan(_ppl("A", "A", "B", "B", "C", "C"), [{"ranks1": ["A"], "ranks2": ["B"]}, {"ranks1": ["B"], "ranks2": ["C"]}])
    assert plan["total_steps_max"] == 6 and plan["total_steps_est"] == 4


def _replay_random_walk(people, rules, seed):
    """Quay hết phiên bằng engine với seed cho trước; trả số lượt thực tế."""
    steps = []
    while True:
        ctx = eng.partner_step_context(people, rules, steps)
        if ctx is None:
            return len(steps)
        assert ctx["eligible_pids"], "bên 2 không bao giờ cạn với engine v2"
        idx = eng.draw_pick_index(seed, len(steps), len(ctx["eligible_pids"]))
        steps.append(_st(ctx["eligible_pids"][idx], ctx["side"], ctx["phase_index"], ctx["team_index"]))


@pytest.mark.parametrize("trial", range(300))
def test_plan_ceiling_never_cut_by_replay_random(trial):
    """Thuộc tính: với pool/quy tắc ngẫu nhiên, số lượt thực tế ≤ total_steps_max (trần thật)
    và total_steps_max ≥ total_steps_est; kết thúc chỉ khi hết cặp hợp lệ."""
    import random
    rng = random.Random(trial)
    ranks = ["A", "B", "C", eng.UNRANKED]
    people = _ppl(*[rng.choice(ranks) for _ in range(rng.randint(2, 9))])
    rules = []
    for _ in range(rng.randint(0, 3)):
        rules.append({"ranks1": rng.sample(ranks, rng.randint(0, 2)), "ranks2": rng.sample(ranks, rng.randint(0, 2))})
    plan = eng.partner_draw_plan(people, rules)
    assert plan["total_steps_max"] >= plan["total_steps_est"] and plan["total_steps_max"] <= 2 * (len(people) // 2)
    for s in range(3):
        done = _replay_random_walk(people, rules, f"{trial:028x}{s:04x}")
        assert done % 2 == 0 and done <= plan["total_steps_max"]
        if done == 0:
            assert plan["total_steps_max"] == 0


def test_normalize_partner_plan_legacy_shape():
    """plan_json của phiên mở TRƯỚC đợt 3 (rank1/rank2/team_count/total_steps) → luôn trả v2."""
    old = {"phases": [{"index": 0, "rank1": "A", "rank2": "B", "team_count": 2},
                      {"index": 2, "rank1": None, "rank2": None, "team_count": 1}],
           "total_steps": 6, "unpaired_pids": [9], "leftover_by_rank": {"A": 1}}
    plan = eng._normalize_partner_plan(old)
    assert plan["phases"] == [
        {"index": 0, "ranks1": ["A"], "ranks2": ["B"], "team_max": 2, "team_cap": 2, "overlap": False},
        {"index": 2, "ranks1": [], "ranks2": [], "team_max": 1, "team_cap": 1, "overlap": True},
    ]
    assert plan["total_steps_max"] == 6 and plan["total_steps_est"] == 6 and plan["estimated"] is True
    assert plan["unpaired_pids"] == [9] and "total_steps" not in plan and plan["leftover_by_rank"] == {"A": 1}
    # Plan v2 đi qua hàm → không đổi
    v2 = eng.partner_draw_plan(_ppl("A", "A", "B", "B"), [{"ranks1": ["A", "B"], "ranks2": ["B"]}])
    assert eng._normalize_partner_plan(v2) == v2
    assert eng._normalize_partner_plan(None) == {"phases": [], "total_steps_max": 0, "total_steps_est": 0,
                                                 "unpaired_pids": [], "estimated": False}


# ── 1.3 API luồng overlap / kết thúc sớm / legacy ──────────────────────────

def _open(client, world, tid, **body):
    return client.post(f"/api/tournaments/{tid}/partner-draw", json=body, headers=_h(world))


def _spin(client, world, tid, k):
    return client.post(f"/api/tournaments/{tid}/partner-draw/spin", json={"expected_step": k}, headers=_h(world))


def _commit(client, world, tid):
    return client.post(f"/api/tournaments/{tid}/partner-draw/commit", headers=_h(world))


def _replay_next(people, rules, steps):
    """Tái lập ĐỘC LẬP (không gọi engine) ngữ cảnh lượt kế tiếp theo quy tắc v2 — dùng để kiểm chứng biên bản."""
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


def _verify(draw):
    seed_hex = draw["seed_hex"]
    assert seed_hex and hashlib.sha256(seed_hex.encode()).hexdigest() == draw["seed_commit"]
    people = [{"pid": x["pid"], "rank": x["rank"]} for x in draw["pool"]]
    steps = sorted(draw["steps"], key=lambda s: s["step_index"])
    for k, st in enumerate(steps):
        ctx = _replay_next(people, draw["rules"], steps[:k])
        assert ctx is not None
        phase_index, side, team_index, eligible = ctx
        assert (st["step_index"], st["phase_index"], st["side"], st["team_index"]) == (k, phase_index, side, team_index)
        assert st["eligible_pids"] == eligible
        idx = int(hashlib.sha256(f"{seed_hex}:{k}".encode()).hexdigest(), 16) % len(eligible)
        assert st["pick_index"] == idx and st["pid"] == eligible[idx]
        assert st["auto"] == (len(eligible) == 1)
    assert _replay_next(people, draw["rules"], steps) is None or len(steps) == draw["total_steps"]


def _spin_until_finished(client, world, tid, draw):
    k = draw["done_steps"]
    while not draw["finished"]:
        nxt = draw["next_step"]
        assert nxt is not None and nxt["step_index"] == k and k < draw["total_steps"]
        r = _spin(client, world, tid, k)
        assert r.status_code == 200, r.text
        draw = r.json()
        st = draw["steps"][k]
        assert (st["side"], st["team_index"], st["phase_index"]) == (nxt["side"], nxt["team_index"], nxt["phase_index"])
        assert st["eligible_pids"] == nxt["eligible_pids"] and st["pid"] in st["eligible_pids"]
        k += 1
    assert draw["next_step"] is None
    return draw


def _people_ids(t):
    """Tập (member_id, player_id) của mọi vị trí trong các đội/người của giải — để kiểm tra không ai ở 2 đội."""
    out = []
    for p in t["participants"]:
        out.append((p["member_id"], p["player_id"]))
        if p["partner_member_id"] is not None or p["partner_player_id"] is not None:
            out.append((p["partner_member_id"], p["partner_player_id"]))
    return out


def test_api_overlap_rule_flow(client, world, db):
    """5 người: 2A, 2B, 1 'Chưa xếp hạng'; quy tắc {A,B} + {B, Chưa xếp hạng} → trần 2 đội (4 lượt)."""
    world.members1[0].rank = "A"; world.members1[1].rank = "A"
    world.members1[2].rank = "B"; world.members1[3].rank = "B"
    world.guest1.rank = None
    db.commit()
    t = _create(client, world, "doubles", member_ids=[m.id for m in world.members1[:4]], player_ids=[world.guest1.id])
    tid = t["id"]
    rules = [{"ranks1": ["A", "B"], "ranks2": ["B", eng.UNRANKED]}]
    r = _open(client, world, tid, rules=rules)
    assert r.status_code == 201, r.text
    draw = r.json()
    assert draw["rules"] == rules and draw["finished"] is False
    assert draw["total_steps"] == 4 and draw["plan"]["total_steps_max"] == 4       # a=2 (A), b=1 (U), c=2 (B) → 2 đội
    assert draw["plan"]["phases"][0]["team_max"] == 2 and draw["plan"]["phases"][0]["overlap"] is True
    assert draw["plan"]["estimated"] is True and draw["plan"]["unpaired_pids"] == []
    assert len(draw["next_step"]["eligible_pids"]) == 4                              # 2A + 2B (U không ở bên 1)
    assert _detail(client, world, tid)["partner_rules"] == rules
    # Chốt khi chưa hết lượt → 409
    assert _spin(client, world, tid, 0).status_code == 200
    r = _commit(client, world, tid)
    assert r.status_code == 409 and r.json()["detail"] == "Chưa hết lượt — còn người đủ điều kiện để quay"
    draw = client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json()
    draw = _spin_until_finished(client, world, tid, draw)
    assert draw["done_steps"] % 2 == 0 and 2 <= draw["done_steps"] <= draw["total_steps"]
    assert _spin(client, world, tid, draw["done_steps"]).status_code == 409
    r = _commit(client, world, tid)
    assert r.status_code == 200, r.text
    t2 = r.json()
    teams = [p for p in t2["participants"] if p["partner_member_id"] is not None or p["partner_player_id"] is not None]
    assert len(teams) == draw["done_steps"] // 2
    ids = _people_ids(t2)
    assert len(ids) == len(set(ids)) == 5                                            # không ai ở 2 đội, không mất ai
    assert t2["unpaired_count"] == 5 - 2 * len(teams)
    assert t2["partner_draw"]["status"] == "committed" and t2["partner_draw"]["finished"] is True
    _verify(client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json())


def _force_seed(db, tid, want):
    """Chọn seed sao cho lượt 0 rơi vào chỉ số `want` (kiểm thử tất định); cập nhật cả seed_commit."""
    pd = db.query(models.TournamentPartnerDraw).filter_by(tournament_id=tid, status="open").first()
    n = 0
    while True:
        seed = f"{n:032x}"
        if eng.draw_pick_index(seed, 0, 4) == want:
            break
        n += 1
    pd.seed_hex = seed
    pd.seed_commit = hashlib.sha256(seed.encode()).hexdigest()
    db.commit()


def test_api_early_finish_below_ceiling(client, world, db):
    """{A,B} + {B} với 2A, 2B: trần 4 lượt; nếu đội 1 là B + B thì hết cặp sau 2 lượt → finished sớm, chốt được."""
    world.members1[0].rank = "A"; world.members1[1].rank = "A"
    world.members1[2].rank = "B"; world.members1[3].rank = "B"
    db.commit()
    t = _create(client, world, "doubles", member_ids=[m.id for m in world.members1[:4]])
    tid = t["id"]
    draw = _open(client, world, tid, rules=[{"ranks1": ["A", "B"], "ranks2": ["B"]}]).json()
    assert draw["total_steps"] == 4 and draw["plan"]["estimated"] is True
    assert draw["plan"]["total_steps_max"] == 4 and draw["plan"]["total_steps_est"] == 4 and draw["stuck"] is False
    b_pids = sorted(p["id"] for p in t["participants"] if p["member_id"] in (world.members1[2].id, world.members1[3].id))
    eligible0 = draw["next_step"]["eligible_pids"]
    assert len(eligible0) == 4
    _force_seed(db, tid, eligible0.index(b_pids[0]))          # lượt 0 chọn B thứ nhất
    r = _spin(client, world, tid, 0)
    assert r.status_code == 200 and r.json()["steps"][0]["pid"] == b_pids[0]
    draw = r.json()
    assert draw["next_step"]["side"] == 2 and draw["next_step"]["eligible_pids"] == [b_pids[1]]
    r = _spin(client, world, tid, 1)
    draw = r.json()
    assert draw["steps"][1]["pid"] == b_pids[1] and draw["steps"][1]["auto"] is True
    # Còn 2A nhưng bên 2 cần B → hết lượt hợp lệ ở 2/4
    assert draw["finished"] is True and draw["next_step"] is None and draw["done_steps"] == 2 < draw["total_steps"]
    r = _spin(client, world, tid, 2)
    assert r.status_code == 409 and r.json()["detail"] == "Đã hết lượt hợp lệ — bấm 'Chốt & tạo đội'"
    d = _detail(client, world, tid)
    assert d["partner_draw"]["finished"] is True and d["partner_draw"]["done_steps"] == 2
    r = _commit(client, world, tid)
    assert r.status_code == 200, r.text
    assert r.json()["unpaired_count"] == 2 and len(r.json()["participants"]) == 3
    final = client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json()
    assert final["status"] == "committed" and final["done_steps"] == 2 and final["finished"] is True
    _verify(final)


def test_api_rule_with_empty_side_and_unranked_guest(client, world, db):
    """Bên rỗng = bất kỳ hạng: {A} + bất kỳ với 1A, 1B, khách chưa xếp hạng → 1 đội, bên 2 chọn cả khách."""
    world.members1[0].rank = "A"; world.members1[1].rank = "B"
    world.guest1.rank = None
    db.commit()
    t = _create(client, world, "doubles", member_ids=[m.id for m in world.members1[:2]], player_ids=[world.guest1.id])
    tid = t["id"]
    draw = _open(client, world, tid, rules=[{"ranks1": ["A"], "ranks2": []}]).json()
    assert draw["rules"] == [{"ranks1": ["A"], "ranks2": []}] and draw["total_steps"] == 2
    assert draw["plan"]["unpaired_pids"] == []
    a_pid = next(p["id"] for p in t["participants"] if p["member_id"] == world.members1[0].id)
    assert draw["next_step"]["eligible_pids"] == [a_pid]
    draw = _spin(client, world, tid, 0).json()
    assert draw["steps"][0]["auto"] is True and len(draw["next_step"]["eligible_pids"]) == 2
    draw = _spin(client, world, tid, 1).json()
    assert draw["finished"] is True
    assert _commit(client, world, tid).status_code == 200
    _verify(client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json())
    # Quy tắc 2 bên rỗng gửi tường minh = ngẫu nhiên toàn bộ
    t = _create(client, world, "doubles", member_ids=[m.id for m in world.members1[2:6]])
    draw = _open(client, world, t["id"], rules=[{"ranks1": [], "ranks2": []}]).json()
    assert draw["rules"] == [{"ranks1": [], "ranks2": []}] and draw["total_steps"] == 4
    assert len(draw["next_step"]["eligible_pids"]) == 4


def test_api_legacy_rank1_rank2_rules(client, world, db):
    for m in world.members1[:3]:
        m.rank = "A"
    for m in world.members1[3:5]:
        m.rank = "B"
    db.commit()
    # 3A + 2B + khách mời hạng C (mặc định của harness) → A+B ghép 2 đội, còn 1A + khách C đơn lẻ
    t = _create(client, world, "doubles", member_ids=[m.id for m in world.members1[:5]], player_ids=[world.guest1.id],
                partner_rules=[{"rank1": "A", "rank2": "B"}])
    tid = t["id"]
    assert t["partner_rules"] == [{"ranks1": ["A"], "ranks2": ["B"]}]
    # Body shape cũ → vẫn mở được, rules trả shape mới
    r = _open(client, world, tid, rules=[{"rank1": "A", "rank2": "B"}])
    assert r.status_code == 201, r.text
    draw = r.json()
    assert draw["rules"] == [{"ranks1": ["A"], "ranks2": ["B"]}] and draw["total_steps"] == 4
    assert _detail(client, world, tid)["partner_rules"] == [{"ranks1": ["A"], "ranks2": ["B"]}]
    # Phiên cũ trong DB lưu rules_json shape cũ → API vẫn trả v2, replay chạy đúng
    pd = db.query(models.TournamentPartnerDraw).filter_by(tournament_id=tid).first()
    pd.rules_json = [{"rank1": "A", "rank2": "B"}]
    db.commit()
    draw = client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json()
    assert draw["rules"] == [{"ranks1": ["A"], "ranks2": ["B"]}]
    a_pids = sorted(p["id"] for p in t["participants"] if p["member_id"] in {m.id for m in world.members1[:3]})
    assert draw["next_step"]["eligible_pids"] == a_pids
    draw = _spin_until_finished(client, world, tid, draw)
    assert draw["done_steps"] == 4
    assert _commit(client, world, tid).status_code == 200
    # tournaments.partner_rules còn shape cũ trong DB → mở không kèm rules vẫn dùng được
    tt = db.query(models.Tournament).filter_by(id=tid).first()
    tt.partner_rules = [{"rank1": "A", "rank2": "A"}]
    db.commit()
    # còn 1A + khách C đơn lẻ → {A}+{A} không ghép được → 400 câu chuẩn
    r = _open(client, world, tid)
    assert r.status_code == 400 and r.json()["detail"] == "Không có quy tắc nào ghép được đội với danh sách hiện tại"
    tt = db.query(models.Tournament).filter_by(id=tid).first()
    tt.partner_rules = [{"rank1": "A", "rank2": "C"}]
    db.commit()
    r = _open(client, world, tid)
    assert r.status_code == 201, r.text
    assert r.json()["rules"] == [{"ranks1": ["A"], "ranks2": ["C"]}] and r.json()["total_steps"] == 2
    assert _detail(client, world, tid)["partner_rules"] == [{"ranks1": ["A"], "ranks2": ["C"]}]   # đã lưu lại shape v2


def test_api_stuck_session_side2_exhausted(client, world, db):
    """Dữ liệu hỏng / phiên engine cũ: lượt cuối là bên 1 nhưng bên 2 không còn ai → stuck (không finished),
    next_step None, spin/commit 409 với thông điệp rõ; huỷ phiên vẫn được."""
    world.members1[0].rank = "A"; world.members1[1].rank = "A"; world.members1[2].rank = "B"
    db.commit()
    t = _create(client, world, "doubles", member_ids=[m.id for m in world.members1[:3]])
    tid = t["id"]
    draw = _open(client, world, tid, rules=[{"ranks1": ["A"], "ranks2": ["B"]}]).json()
    assert draw["total_steps"] == 2 and draw["stuck"] is False
    pd = db.query(models.TournamentPartnerDraw).filter_by(tournament_id=tid, status="open").first()
    a_pid, b_pid = sorted(x["pid"] for x in draw["pool"] if x["rank"] == "A")[0], next(x["pid"] for x in draw["pool"] if x["rank"] == "B")
    # Gieo thủ công 1 lượt bên 1 đã chọn NGƯỜI B (engine v2 không bao giờ làm vậy) → bên 2 cần B nhưng hết B
    db.add(models.TournamentPartnerDrawStep(draw_id=pd.id, step_index=0, team_index=0, side=1, phase_index=0,
                                            pid=b_pid, member_id=world.members1[2].id, pick_index=0, auto=False,
                                            eligible_pids_json=[a_pid, b_pid], spun_at_ms=0))
    db.commit()
    r = client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world))
    d = r.json()
    assert d["stuck"] is True and d["finished"] is False and d["next_step"] is None and d["done_steps"] == 1
    assert _detail(client, world, tid)["partner_draw"]["stuck"] is True
    r = _spin(client, world, tid, 1)
    assert r.status_code == 409 and r.json()["detail"].startswith("Phiên bị kẹt")
    r = _commit(client, world, tid)
    assert r.status_code == 409 and r.json()["detail"].startswith("Phiên bị kẹt")
    assert client.post(f"/api/tournaments/{tid}/partner-draw/cancel", json={}, headers=_h(world)).status_code == 200
    d = client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json()
    assert d["status"] == "cancelled" and d["stuck"] is True and d["next_step"] is None
    # Mở lại → phiên mới sạch
    assert _open(client, world, tid, rules=[{"ranks1": ["A"], "ranks2": ["B"]}]).json()["stuck"] is False


def test_api_legacy_plan_json_returned_as_v2(client, world, db):
    """Phiên mở/chốt TRƯỚC đợt 3 lưu plan_json shape cũ → API trả plan v2 như rules."""
    for m in world.members1[:2]:
        m.rank = "A"
    for m in world.members1[2:4]:
        m.rank = "B"
    db.commit()
    t = _create(client, world, "doubles", member_ids=[m.id for m in world.members1[:4]])
    tid = t["id"]
    assert _open(client, world, tid, rules=[{"rank1": "A", "rank2": "B"}]).status_code == 201
    pd = db.query(models.TournamentPartnerDraw).filter_by(tournament_id=tid, status="open").first()
    pd.rules_json = [{"rank1": "A", "rank2": "B"}]
    pd.plan_json = {"phases": [{"index": 0, "rank1": "A", "rank2": "B", "team_count": 2}], "total_steps": 4,
                    "unpaired_pids": [], "leftover_by_rank": {}}
    db.commit()
    draw = client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json()
    assert draw["rules"] == [{"ranks1": ["A"], "ranks2": ["B"]}]
    assert draw["plan"]["phases"] == [{"index": 0, "ranks1": ["A"], "ranks2": ["B"], "team_max": 2, "team_cap": 2, "overlap": False}]
    assert draw["plan"]["total_steps_max"] == 4 and draw["plan"]["total_steps_est"] == 4
    assert draw["plan"]["estimated"] is False and draw["plan"]["unpaired_pids"] == [] and "total_steps" not in draw["plan"]
    draw = _spin_until_finished(client, world, tid, draw)
    assert draw["done_steps"] == 4 and _commit(client, world, tid).status_code == 200
    final = client.get(f"/api/tournaments/{tid}/partner-draw", headers=_h(world)).json()
    assert final["plan"]["total_steps_max"] == 4 and final["plan"]["phases"][0]["team_max"] == 2
    _verify(final)


def test_bulk_player_linked_to_member_is_added_once_as_member(client, world, db):
    """Player gắn thành viên (member_id != NULL) là cùng một người với thành viên → quy đổi sang member_id,
    không vào giải 2 lần dù gửi cả member_ids lẫn player_ids."""
    m = world.members1[0]
    linked = models.Player(name="Linked", club_id=world.club1.id, member_id=m.id, rank="A")
    db.add(linked); db.commit(); db.refresh(linked)
    t = _create(client, world, "doubles")
    tid = t["id"]
    r = _bulk(client, world, tid, [m.id], [linked.id, world.guest1.id])
    assert r.status_code == 200, r.text
    assert r.json()["added"] == 2 and r.json()["skipped"] == []
    ps = r.json()["tournament"]["participants"]
    assert [(p["member_id"], p["player_id"]) for p in ps] == [(m.id, None), (None, world.guest1.id)]
    # Chỉ gửi player_id của bản ghi gắn thành viên → nhận ra đã có (qua member_id) → bỏ qua
    r = _bulk(client, world, tid, [], [linked.id])
    assert r.json()["added"] == 0 and r.json()["skipped"] == [m.full_name]
    # Giải khác, chỉ gửi player_id gắn thành viên → thêm dưới dạng member_id
    t2 = _create(client, world, "singles")
    r = _bulk(client, world, t2["id"], [], [linked.id])
    assert r.json()["added"] == 1
    p = r.json()["tournament"]["participants"][0]
    assert p["member_id"] == m.id and p["player_id"] is None and p["team_name"] == m.full_name
