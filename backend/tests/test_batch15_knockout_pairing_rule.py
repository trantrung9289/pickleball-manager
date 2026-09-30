"""Đợt 15: luật ghép cặp vòng loại từ vòng bảng — khối 2 bảng (A,B), (C,D), (E,F)...:
Nhất A gặp Nhì B, Nhất B gặp Nhì A. Bao gồm test thuộc tính, luồng API và ĐỐI CHIẾU bản gương JS
(frontend/src/utils/bracketLayout.js) bằng node — hai bên phải cho ra từng ô giống hệt nhau."""
import json
import os
import random
import shutil
import subprocess

import pytest
from conftest import World

import tournament_engine as eng

LETTERS = "ABCDEFGHIJKLMNOP"
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BRACKET_JS = os.path.join(REPO, "frontend", "src", "utils", "bracketLayout.js")


def _full(k):
    letters = list(LETTERS[:k])
    return letters, {g: f"1{g}" for g in letters}, {g: f"2{g}" for g in letters}


def _r1_pairs(slots):
    return [(slots[i], slots[i + 1]) for i in range(0, len(slots), 2)]


def _group(pid):
    return pid[1]


def _check_invariants(letters, firsts, seconds, slots):
    teams = [p for g in letters for p in (firsts.get(g), seconds.get(g)) if p is not None]
    n = len(teams)
    if n < 2:
        assert slots == teams
        return
    size = len(slots)
    assert size >= n and (size & (size - 1)) == 0, "độ dài phải là luỹ thừa 2"
    real = [s for s in slots if s is not None]
    assert sorted(real) == sorted(teams), "mỗi suất xuất hiện đúng 1 lần"
    pairs = _r1_pairs(slots)
    assert not any(a is None and b is None for a, b in pairs), "không có trận None–None (double bye)"
    byes = [a or b for a, b in pairs if (a is None) != (b is None)]
    assert len(byes) == size - n
    firsts_set = {p for p in firsts.values() if p is not None}
    if len(byes) <= len(firsts_set):
        assert all(b in firsts_set for b in byes), "bye chỉ dành cho nhất bảng khi còn đủ nhất bảng"
    if n > 2:
        for a, b in pairs:
            if a is not None and b is not None:
                assert _group(a) != _group(b), f"cùng bảng gặp nhau ngay vòng đầu: {a}–{b}"
    # Khối nguyên: cả 2 trận Nhất X–Nhì Y, Nhất Y–Nhì X còn nguyên → phải kề nhau, thẳng hàng (chỉ số trận chẵn)
    bye_set = set(byes)
    for i in range(0, len(letters) - 1, 2):
        x, y = letters[i], letters[i + 1]
        m1, m2 = (firsts.get(x), seconds.get(y)), (firsts.get(y), seconds.get(x))
        if all(p is not None and p not in bye_set for p in m1 + m2):
            assert m1 in pairs and m2 in pairs, f"khối {x}{y} phải giữ nguyên luật: {m1}, {m2}"
            i1, i2 = pairs.index(m1), pairs.index(m2)
            assert i1 % 2 == 0 and i2 == i1 + 1, f"2 trận khối {x}{y} phải kề nhau và thẳng hàng"


# ── Thuộc tính ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("k", range(1, 17))
def test_layout_invariants_full_groups(k):
    letters, firsts, seconds = _full(k)
    slots = eng.knockout_layout_from_groups(letters, firsts, seconds)
    _check_invariants(letters, firsts, seconds, slots)


@pytest.mark.parametrize("k", range(3, 17))
def test_bye_team_not_next_to_same_group_full_groups(k):
    """Đội được bye không gặp lại đội cùng bảng ngay vòng 2 (đủ 2 suất/bảng)."""
    letters, firsts, seconds = _full(k)
    pairs = _r1_pairs(eng.knockout_layout_from_groups(letters, firsts, seconds))
    for i in range(0, len(pairs), 2):
        a, b = pairs[i], pairs[i + 1]
        for bye_match, other in ((a, b), (b, a)):
            if (bye_match[0] is None) != (bye_match[1] is None):
                team = bye_match[0] or bye_match[1]
                assert all(o is None or _group(o) != _group(team) for o in other), \
                    f"{k} bảng: {team} bye nhưng vòng 2 có thể gặp cùng bảng {other}"


def test_random_uneven_groups_invariants():
    rng = random.Random(20260930)
    for _ in range(600):
        k = rng.randint(1, 12)
        letters = list(LETTERS[:k])
        firsts = {g: (f"1{g}" if rng.random() < 0.9 else None) for g in letters}
        seconds = {g: (f"2{g}" if (firsts[g] and rng.random() < 0.75) else None) for g in letters}
        slots = eng.knockout_layout_from_groups(letters, firsts, seconds)
        _check_invariants(letters, firsts, seconds, slots)


# ── Luật cụ thể ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("k", [2, 4, 8, 16])
def test_power_of_two_groups_exact_rule(k):
    letters, firsts, seconds = _full(k)
    pairs = _r1_pairs(eng.knockout_layout_from_groups(letters, firsts, seconds))
    expected = []
    for i in range(0, k, 2):
        x, y = letters[i], letters[i + 1]
        expected += [(f"1{x}", f"2{y}"), (f"1{y}", f"2{x}")]
    assert pairs == expected


def test_two_groups_semis_and_final_structure():
    ms = eng.generate_knockout_from_groups({"A": _st("A"), "B": _st("B")})
    semis = [m for m in ms if m["round_name"] == "Bán kết"]
    assert [(m["p1_id"], m["p2_id"]) for m in semis] == [("1A", "2B"), ("1B", "2A")]
    final = [m for m in ms if m["round_name"] == "Chung kết"]
    assert len(final) == 1 and all(m["_next_match_idx"] == ms.index(final[0]) for m in semis)


def test_six_groups_block_ef_intact_and_winners_get_byes():
    letters, firsts, seconds = _full(6)
    pairs = _r1_pairs(eng.knockout_layout_from_groups(letters, firsts, seconds))
    assert ("1E", "2F") in pairs and ("1F", "2E") in pairs
    byes = sorted(a or b for a, b in pairs if (a is None) != (b is None))
    assert byes == ["1A", "1B", "1C", "1D"]


def test_three_groups_pinned_layout():
    """3 bảng = 6 suất, 2 bye cho Nhất A, Nhất B; đội tự do ghép chéo bảng; ghim để phát hiện thay đổi vô tình."""
    letters, firsts, seconds = _full(3)
    assert eng.knockout_layout_from_groups(letters, firsts, seconds) == \
        ["1A", None, "2B", "2C", "1B", None, "2A", "1C"]


@pytest.mark.parametrize("k", [9, 10])  # chỉ khi số bye > số bảng mới có khối toàn bye (9: 14 bye, 10: 12 bye)
def test_all_bye_block_applies_rule_in_round_two(k):
    """Nhiều bảng → khối mà cả 4 suất đều bye: vòng 2 vẫn là Nhất X–Nhì Y, Nhất Y–Nhì X và kề nhau."""
    letters, firsts, seconds = _full(k)
    slots = eng.knockout_layout_from_groups(letters, firsts, seconds)
    pairs = _r1_pairs(slots)
    byes = {a or b for a, b in pairs if (a is None) != (b is None)}
    r2 = [(pairs[i][0] or pairs[i][1], pairs[i + 1][0] or pairs[i + 1][1]) for i in range(0, len(pairs), 2)
          if all((p[0] is None) != (p[1] is None) for p in pairs[i:i + 2])]  # cặp vòng 2 giữa 2 đội bye
    found = 0
    for i in range(0, k - 1, 2):
        x, y = letters[i], letters[i + 1]
        quad = (f"1{x}", f"2{y}", f"1{y}", f"2{x}")
        if all(q in byes for q in quad):
            found += 1
            i1 = r2.index((f"1{x}", f"2{y}"))
            assert r2[i1 + 1] == (f"1{y}", f"2{x}"), f"khối {x}{y} toàn bye phải kề nhau ở vòng 2: {r2}"
            assert (pairs.index((f"1{x}", None)) % 4) == 0, "khối 8 ô phải thẳng hàng"
    assert found >= 1, f"{k} bảng phải có ít nhất 1 khối toàn bye để test có ý nghĩa"


def test_duplicate_pid_across_groups_raises():
    with pytest.raises(ValueError):
        eng.knockout_layout_from_groups(["A", "B", "C"], {"A": "P", "B": "R", "C": "P"}, {"A": "Q", "B": "S", "C": "T"})


def test_group_with_single_team_has_no_runner_up():
    ms = eng.generate_knockout_from_groups({"A": _st("A"), "B": _st("B", 1)})
    r1 = [(m["p1_id"], m["p2_id"]) for m in ms if m["round_number"] == 1]
    assert r1 == [("1A", None), ("1B", "2A")]


def _st(g, n=2):
    return [{"participant_id": f"{r}{g}", "rank": r} for r in range(1, n + 1)]


# ── Đối chiếu bản gương JS ────────────────────────────────────────────────────

def test_js_mirror_matches_python_layout():
    if shutil.which("node") is None:
        if os.environ.get("CI"):
            pytest.fail("CI thiếu node → không đối chiếu được bản gương JS (thêm actions/setup-node)")
        pytest.skip("cần node để đối chiếu bản gương JS")
    cases = []
    for k in range(1, 17):
        letters, firsts, seconds = _full(k)
        cases.append({"letters": letters, "firsts": firsts, "seconds": seconds})
    rng = random.Random(42)
    for _ in range(400):
        k = rng.randint(1, 10)
        letters = list(LETTERS[:k])
        firsts = {g: (f"1{g}" if rng.random() < 0.9 else None) for g in letters}
        seconds = {g: (f"2{g}" if (firsts[g] and rng.random() < 0.75) else None) for g in letters}
        cases.append({"letters": letters, "firsts": firsts, "seconds": seconds})
    script = (
        f"import {{ knockoutLayoutFromGroups }} from {json.dumps(BRACKET_JS)};\n"
        "let s=''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => {\n"
        "  const out = JSON.parse(s).map(c => knockoutLayoutFromGroups(c.letters, c.firsts, c.seconds));\n"
        "  process.stdout.write(JSON.stringify(out)); });\n"
    )
    r = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(cases),
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    js_out = json.loads(r.stdout)
    for c, js in zip(cases, js_out):
        py = eng.knockout_layout_from_groups(c["letters"], c["firsts"], c["seconds"])
        assert js == py, f"lệch gương: {c}\nJS={js}\nPY={py}"


# ── Luồng API ─────────────────────────────────────────────────────────────────

def _h(world):
    return World.headers(world.admin1, world.club1)


def _score(client, world, tid, mid, s1, s2):
    return client.post(f"/api/tournaments/{tid}/matches/{mid}/score", json={"score1": s1, "score2": s2}, headers=_h(world))


def _play_groups_lowest_id_wins(client, world, tid):
    """Đấu hết vòng bảng: đội có participant id nhỏ hơn luôn thắng → Nhất = id nhỏ nhất bảng, Nhì = id nhỏ nhì."""
    d = client.get(f"/api/tournaments/{tid}", headers=_h(world)).json()
    for m in d["matches"]:
        if m["phase"] != "group":
            continue
        low_is_p1 = m["p1_id"] < m["p2_id"]
        assert _score(client, world, tid, m["id"], 11 if low_is_p1 else 5, 5 if low_is_p1 else 11).status_code == 200
    return client.get(f"/api/tournaments/{tid}", headers=_h(world)).json()


def _expected_top2(detail):
    by_group = {}
    for p in detail["participants"]:
        by_group.setdefault(p["group_name"], []).append(p["id"])
    return {g: sorted(ids)[:2] for g, ids in by_group.items()}


@pytest.mark.parametrize("num_groups,n_members", [(2, 8), (4, 8)])
def test_start_knockout_applies_block_rule(client, world, num_groups, n_members):
    h = _h(world)
    r = client.post("/api/tournaments", json={"name": "KO rule", "format": "combined", "num_groups": num_groups,
                                              "member_ids": [m.id for m in world.members1[:n_members]]}, headers=h)
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    assert client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).status_code == 200
    detail = _play_groups_lowest_id_wins(client, world, tid)
    top2 = _expected_top2(detail)
    r = client.post(f"/api/tournaments/{tid}/start-knockout", headers=h)
    assert r.status_code == 200, r.text
    ko = sorted([m for m in r.json()["matches"] if m["phase"] == "knockout"], key=lambda m: m["match_number"])
    r1 = [m for m in ko if m["round_number"] == min(x["round_number"] for x in ko)]
    letters = sorted(top2)
    expected = []
    for i in range(0, len(letters), 2):
        x, y = letters[i], letters[i + 1]
        expected += [(top2[x][0], top2[y][1]), (top2[y][0], top2[x][1])]
    assert [(m["p1_id"], m["p2_id"]) for m in r1] == expected
    # 2 trận của cùng khối gặp nhau ở vòng sau
    for i in range(0, len(r1), 2):
        assert r1[i]["next_match_id"] == r1[i + 1]["next_match_id"]


# ── Lỗi có sẵn (phát hiện khi phản biện): 2 bên đều "out" → trận treo pending mãi ─────────

def _withdraw(client, world, tid, pid):
    return client.post(f"/api/tournaments/{tid}/participants/{pid}/withdraw", headers=_h(world))


def test_withdrawn_group_winner_with_bye_does_not_block_bracket(client, world):
    """3 bảng: Nhất A được bye; Nhất A bỏ giải TRƯỚC khi lên vòng loại (vẫn đứng nhất bảng theo standings).
    Trước đây trận (1A, trống) treo pending → bán kết không bao giờ đủ người, giải không kết thúc được."""
    h = _h(world)
    r = client.post("/api/tournaments", json={"name": "KO stuck", "format": "combined", "num_groups": 3,
                                              "member_ids": [m.id for m in world.members1[:6]]}, headers=h)
    tid = r.json()["id"]
    assert client.post(f"/api/tournaments/{tid}/generate?shuffle=false", headers=h).status_code == 200
    detail = _play_groups_lowest_id_wins(client, world, tid)
    first_a = _expected_top2(detail)["A"][0]
    assert _withdraw(client, world, tid, first_a).status_code == 200
    r = client.post(f"/api/tournaments/{tid}/start-knockout", headers=h)
    assert r.status_code == 200, r.text
    ko = [m for m in r.json()["matches"] if m["phase"] == "knockout"]
    bye_match = next(m for m in ko if first_a in (m["p1_id"], m["p2_id"]))
    assert bye_match["status"] == "completed" and bye_match["winner_id"] is None  # không ai đi tiếp
    # Không trận nào còn pending mà thiếu người (trừ trận đang chờ kết quả vòng trước)
    for _ in range(4):
        d = client.get(f"/api/tournaments/{tid}", headers=h).json()
        todo = [m for m in d["matches"] if m["phase"] == "knockout" and m["status"] != "completed"]
        if not todo:
            break
        for m in todo:
            if m["p1_id"] and m["p2_id"]:
                assert _score(client, world, tid, m["id"], 11, 5).status_code == 200
    d = client.get(f"/api/tournaments/{tid}", headers=h).json()
    ko = [m for m in d["matches"] if m["phase"] == "knockout"]
    assert all(m["status"] == "completed" for m in ko), [(m["round_name"], m["p1_id"], m["p2_id"], m["status"]) for m in ko]
    final = next(m for m in ko if m["round_name"] == "Chung kết")
    assert final["winner_id"] is not None and final["winner_id"] != first_a

