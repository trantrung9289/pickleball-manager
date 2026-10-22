"""Đợt 21 (2026-10-22): VÒNG QUAY PHÂN VĐV VÀO ĐỘI cho giải đồng đội — engine (luật theo vòng hạng/giới tính,
rắn, chia tới hết), API mở/quay/chốt/huỷ (seed commit–reveal, replay tất định), khoá thao tác tay khi phiên mở, public."""
import hashlib

import pytest

import tournament_engine as eng
from tests.test_batch19_team_format import _create_team_tournament, _set_genders, _h


# ── Engine ───────────────────────────────────────────────────────────────────

def _ppl(n, rank=lambda i: "A", gender=lambda i: "male"):
    return [{"tpid": i, "rank": rank(i), "gender": gender(i)} for i in range(1, n + 1)]


def _run(people, teams, rules, pick=lambda e: e[0]):
    steps = []
    while True:
        ctx = eng.team_draw_step_context(people, teams, rules, steps)
        if ctx is None:
            return steps
        steps.append({"tpid": pick(ctx["eligible_tpids"]), "team_pid": ctx["team_pid"],
                      "round_index": ctx["round_index"], "pass_index": ctx["pass_index"]})


def test_normalize_rules_appends_leftover_round_and_cleans():
    r = eng.normalize_team_draw_rules([{"ranks": ["A", "a ", None, "A"], "genders": ["male", "x"], "per_team": "2"},
                                       {"genders": ["male", "female"], "per_team": 0}])
    assert r == [{"ranks": ["A", "a"], "genders": ["male"], "per_team": 2},
                 {"ranks": [], "genders": [], "per_team": None}]          # cả 2 giới = không lọc; per_team 0 → None; vòng cuối đã không tiêu chí → không thêm
    assert eng.normalize_team_draw_rules(None) == [{"ranks": [], "genders": [], "per_team": None}]
    r2 = eng.normalize_team_draw_rules([{"ranks": ["B"]}])
    assert r2[-1] == {"ranks": [], "genders": [], "per_team": None} and len(r2) == 2


def test_snake_order_and_drain_non_divisible():
    # 5 hạng A, 3 đội: pass 0 xuôi (10,20,30), pass 1 ngược (30,20) → đội 10 nhận ít hơn
    ppl = _ppl(5)
    steps = _run(ppl, [10, 20, 30], [{"ranks": ["A"]}])
    assert [s["team_pid"] for s in steps] == [10, 20, 30, 30, 20]
    assert [s["pass_index"] for s in steps] == [0, 0, 0, 1, 1]
    assert steps[-1]["round_index"] == 0 and eng.team_draw_finished(ppl, [10, 20, 30], [{"ranks": ["A"]}], steps)


def test_rounds_filter_by_rank_gender_cap_and_leftover():
    # 1-3 hạng A nam, 4-6 hạng B nữ, 7-9 hạng C (nam/nữ xen kẽ)
    ppl = _ppl(9, rank=lambda i: "A" if i <= 3 else "B" if i <= 6 else "C",
               gender=lambda i: "female" if i in (4, 5, 6, 8) else "male")
    rules = [{"ranks": ["A"]}, {"genders": ["female"], "per_team": 1}]
    teams = [1, 2, 3]
    steps = _run(ppl, teams, rules)
    # vòng 0: 3 A xuôi; vòng 1: nữ trần 1/đội — pass 1 ngược (3,2,1) lấy 3 nữ đầu (4,5,6), nữ thứ 4 (8) chờ vòng cuối
    assert [(s["tpid"], s["team_pid"]) for s in steps[:3]] == [(1, 1), (2, 2), (3, 3)]
    assert [(s["tpid"], s["team_pid"], s["round_index"]) for s in steps[3:6]] == [(4, 3, 1), (5, 2, 1), (6, 1, 1)]
    assert sorted(s["tpid"] for s in steps[6:]) == [7, 8, 9] and all(s["round_index"] == 2 for s in steps[6:])
    assert len(steps) == 9
    plan = eng.team_draw_plan(ppl, teams, rules)
    assert [r["est_count"] for r in plan["rounds"]] == [3, 3, 3] and plan["total_steps"] == 9 and plan["estimated"] is True
    # Không đội → không lượt
    assert eng.team_draw_step_context(ppl, [], rules, []) is None and eng.team_draw_plan(ppl, [], rules)["total_steps"] == 0


def test_replay_is_deterministic_with_seed():
    ppl = _ppl(7, rank=lambda i: "A" if i % 2 else "B")
    teams = [5, 6]
    rules = [{"ranks": ["A"], "per_team": 1}]
    seed = "ab" * 16
    steps = []
    while True:
        ctx = eng.team_draw_step_context(ppl, teams, rules, steps)
        if ctx is None:
            break
        idx = eng.draw_pick_index(seed, len(steps), len(ctx["eligible_tpids"]))
        steps.append({"tpid": ctx["eligible_tpids"][idx], "team_pid": ctx["team_pid"]})
    assert len(steps) == 7 and len({s["tpid"] for s in steps}) == 7
    # replay lại với cùng seed → cùng kết quả
    steps2 = []
    while True:
        ctx = eng.team_draw_step_context(ppl, teams, rules, steps2)
        if ctx is None:
            break
        idx = eng.draw_pick_index(seed, len(steps2), len(ctx["eligible_tpids"]))
        steps2.append({"tpid": ctx["eligible_tpids"][idx], "team_pid": ctx["team_pid"]})
    assert steps == steps2


# ── API ──────────────────────────────────────────────────────────────────────

def _setup(client, world, db, n_pool=8, n_teams=3):
    t = _create_team_tournament(client, world, rubbers=[{"code": "MD"}])
    tid = t["id"]; h = _h(world)
    _set_genders(db, world)
    for i, m in enumerate(world.members1[:n_pool]):
        m.rank = "A" if i < 3 else "B"
    db.commit()
    r = client.post(f"/api/tournaments/{tid}/team-players/bulk",
                    json={"member_ids": [m.id for m in world.members1[:n_pool]]}, headers=h)
    assert r.status_code == 200, r.text
    teams = client.post(f"/api/tournaments/{tid}/teams/bulk", json={"count": n_teams}, headers=h).json()
    return tid, [x["participant"]["id"] for x in teams]


def _spin_all(client, world, tid):
    h = _h(world)
    d = client.get(f"/api/tournaments/{tid}/team-draw", headers=h).json()
    while not d["finished"]:
        r = client.post(f"/api/tournaments/{tid}/team-draw/spin", json={"expected_step": d["done_steps"]}, headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
    return d


def test_team_draw_open_spin_commit_assigns_players(client, world, db):
    tid, pids = _setup(client, world, db)
    h = _h(world)
    rules = [{"ranks": ["A"], "genders": [], "per_team": None}, {"genders": ["female"], "per_team": 1}]
    r = client.post(f"/api/tournaments/{tid}/team-draw", json={"rules": rules, "reveal_ms": 2000}, headers=h)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["status"] == "open" and d["seed_hex"] is None and d["total_steps"] == 8 and len(d["teams"]) == 3
    assert d["rules"][-1] == {"ranks": [], "genders": [], "per_team": None}
    assert d["next_step"]["team_pid"] == pids[0] and d["next_step"]["round_index"] == 0
    assert all(set(p) == {"tpid", "name", "gender", "rank"} for p in d["pool"])
    # Tóm tắt trong TournamentOut; phiên mở khoá thao tác tay
    tt = client.get(f"/api/tournaments/{tid}", headers=h).json()
    assert tt["team_draw"]["status"] == "open" and tt["team_draw"]["total_steps"] == 8
    tp0 = d["pool"][0]["tpid"]
    assert client.patch(f"/api/tournaments/{tid}/team-players/{tp0}", json={"participant_id": pids[0]}, headers=h).status_code == 400
    assert client.post(f"/api/tournaments/{tid}/teams", json={"team_name": "X"}, headers=h).status_code == 400
    assert client.delete(f"/api/tournaments/{tid}/team-players/{tp0}", headers=h).status_code == 400
    assert client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=h).status_code == 400
    # Sửa hạng (không đổi đội) vẫn được
    assert client.patch(f"/api/tournaments/{tid}/team-players/{tp0}", json={"rank": "A"}, headers=h).status_code == 200
    # Mở trùng → 409; lệch lượt → 409
    assert client.post(f"/api/tournaments/{tid}/team-draw", json={"rules": []}, headers=h).status_code == 409
    assert client.post(f"/api/tournaments/{tid}/team-draw/spin", json={"expected_step": 5}, headers=h).status_code == 409
    assert client.post(f"/api/tournaments/{tid}/team-draw/commit", headers=h).status_code == 409   # chưa hết lượt
    d = _spin_all(client, world, tid)
    assert d["done_steps"] == 8 and d["next_step"] is None
    # Kiểm chứng: mỗi lượt đúng công thức SHA256(seed:k) mod |eligible| — seed chưa lộ khi open → dùng DB
    import models as m
    draw = db.query(m.TournamentTeamDraw).filter(m.TournamentTeamDraw.id == d["id"]).first()
    assert hashlib.sha256(draw.seed_hex.encode()).hexdigest() == d["seed_commit"]
    for st in d["steps"]:
        assert st["tpid"] == st["eligible_tpids"][eng.draw_pick_index(draw.seed_hex, st["step_index"], len(st["eligible_tpids"]))]
    # Vòng 0 = 3 hạng A đi 3 đội theo thứ tự; vòng 1 nữ mỗi đội tối đa 1
    assert [st["team_pid"] for st in d["steps"][:3]] == pids and all(st["round_index"] == 0 for st in d["steps"][:3])
    assert client.post(f"/api/tournaments/{tid}/team-draw/spin", json={"expected_step": 8}, headers=h).status_code == 409
    r = client.post(f"/api/tournaments/{tid}/team-draw/commit", headers=h)
    assert r.status_code == 200, r.text
    tt = r.json()
    assert tt["team_pool_count"] == 0 and tt["team_draw"]["status"] == "committed"
    by_tp = {p["id"]: p["participant_id"] for p in tt["team_players"]}
    for st in d["steps"]:
        assert by_tp[st["tpid"]] == st["team_pid"]
    d2 = client.get(f"/api/tournaments/{tid}/team-draw", headers=h).json()
    assert d2["status"] == "committed" and d2["seed_hex"] == draw.seed_hex
    # Nhật ký có dòng chốt
    logs = client.get(f"/api/tournaments/{tid}/team-logs", headers=h).json()
    assert any(x["kind"] == "team_draw" for x in (logs if isinstance(logs, list) else logs.get("items", [])))


def test_team_draw_guards_cancel_and_pool_change(client, world, db):
    tid, pids = _setup(client, world, db, n_pool=4, n_teams=2)
    h = _h(world)
    # Chưa có đội đủ / pool rỗng
    t2 = _create_team_tournament(client, world, name="Rỗng")
    assert client.post(f"/api/tournaments/{t2['id']}/team-draw", json={"rules": []}, headers=h).status_code == 400
    r = client.post(f"/api/tournaments/{tid}/team-draw", json={"rules": []}, headers=h)
    assert r.status_code == 201, r.text
    # Huỷ → mở lại được; phiên huỷ vẫn trong lịch sử kèm seed
    r = client.post(f"/api/tournaments/{tid}/team-draw/cancel", json={"reason": "thử"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["seed_hex"]
    hist = client.get(f"/api/tournaments/{tid}/team-draws", headers=h).json()
    assert [x["status"] for x in hist] == ["cancelled"]
    # Sau khi huỷ, thao tác tay mở lại
    tp = client.get(f"/api/tournaments/{tid}/team-players", headers=h).json()[0]["id"]
    assert client.patch(f"/api/tournaments/{tid}/team-players/{tp}", json={"participant_id": pids[0]}, headers=h).status_code == 200
    # Mở phiên mới chỉ với 3 người còn lại; đổi pool "ngoài luồng" (SQL) → chốt 409
    r = client.post(f"/api/tournaments/{tid}/team-draw", json={"rules": [{"ranks": ["A"], "per_team": 1}]}, headers=h)
    assert r.status_code == 201 and r.json()["total_steps"] == 3 and r.json()["seq"] == 2
    d = _spin_all(client, world, tid)
    import models as m
    victim = db.query(m.TournamentTeamPlayer).filter(m.TournamentTeamPlayer.id == d["pool"][0]["tpid"]).first()
    victim.participant_id = pids[1]; db.commit()
    assert client.post(f"/api/tournaments/{tid}/team-draw/commit", headers=h).status_code == 409
    victim.participant_id = None; db.commit()
    assert client.post(f"/api/tournaments/{tid}/team-draw/commit", headers=h).status_code == 200
    # Giải đang diễn ra → không mở phiên
    assert client.put(f"/api/tournaments/{tid}", json={"status": "active"}, headers=h).status_code == 200
    assert client.post(f"/api/tournaments/{tid}/team-draw", json={"rules": []}, headers=h).status_code == 400


def test_team_draw_public_visibility_and_no_pii(client, world, db):
    tid, pids = _setup(client, world, db, n_pool=3, n_teams=2)
    h = _h(world)
    slug = world.token1.slug
    assert client.get(f"/api/public/report/{slug}/tournaments/{tid}").status_code == 404   # Nháp chưa có phiên → ẩn
    assert client.post(f"/api/tournaments/{tid}/team-draw", json={"rules": []}, headers=h).status_code == 201
    lst = client.get(f"/api/public/report/{slug}/tournaments").json()
    assert any(x["id"] == tid and x["team_draw_status"] == "open" for x in lst)
    pub = client.get(f"/api/public/report/{slug}/tournaments/{tid}/team-draw")
    assert pub.status_code == 200
    d = pub.json()["team_draw"]
    assert d["status"] == "open" and "created_by" not in d and d["seed_hex"] is None and "server_now_ms" in pub.json()
    assert client.get(f"/api/public/report/{slug}/tournaments/{tid}").json()["team_draw"]["status"] == "open"
    _spin_all(client, world, tid)
    assert client.post(f"/api/tournaments/{tid}/team-draw/commit", headers=h).status_code == 200
    hist = client.get(f"/api/public/report/{slug}/tournaments/{tid}/team-draws").json()
    assert len(hist) == 1 and hist[0]["status"] == "committed" and hist[0]["seed_hex"] and "created_by" not in hist[0]
    # Đã chốt → giải Nháp vẫn hiện public (đội đã công khai)
    assert client.get(f"/api/public/report/{slug}/tournaments/{tid}").status_code == 200
