"""Thuật toán sinh lịch thi đấu."""
import hashlib
import random
import math
from typing import List, Optional, Dict, Any, Tuple


def _round_robin_pairs(players: List) -> List[List[tuple]]:
    """Berger table: trả về list các vòng, mỗi vòng là list (p1, p2). Bỏ None (bye)."""
    n = len(players)
    if n % 2 == 1:
        players = players + [None]
        n += 1
    half = n // 2
    fixed = players[0]
    rotating = list(players[1:])
    rounds = []
    for _ in range(n - 1):
        circle = [fixed] + rotating
        pairs = []
        for i in range(half):
            a, b = circle[i], circle[n - 1 - i]
            if a is not None and b is not None:
                pairs.append((a, b))
        rounds.append(pairs)
        rotating = [rotating[-1]] + rotating[:-1]
    return rounds


def _round_name(r: int, total_rounds: int) -> str:
    remaining = total_rounds - r + 1
    if remaining == 1:
        return "Chung kết"
    if remaining == 2:
        return "Bán kết"
    if remaining == 3:
        return "Tứ kết"
    return f"Vòng {r}"


def _seed_order(size: int) -> List[int]:
    """Thứ tự vị trí bracket chuẩn (1-indexed seed): size 8 → [1, 8, 4, 5, 2, 7, 3, 6].
    Hạt giống 1 và 2 ở hai nhánh đối diện; bye (seed > n) rơi vào hạt giống cao nhất."""
    order = [1]
    while len(order) < size:
        m = len(order) * 2
        order = [x for s_ in order for x in (s_, m + 1 - s_)]
    return order


def _knockout_bracket(players: List, seeded: bool = True) -> List[Dict]:
    """Sinh bracket loại trực tiếp với next_match linkage.

    players: danh sách theo thứ tự hạt giống (đã shuffle nếu cần).
    seeded=True  → xếp theo seeding chuẩn, bye dành cho hạt giống cao, không có trận None-None.
    seeded=False → dùng nguyên thứ tự truyền vào làm cặp (chỉ khi len là luỹ thừa 2).
    """
    n = len(players)
    if n < 2:
        raise ValueError("Cần ít nhất 2 đội để sinh bracket loại trực tiếp")
    size = 1
    while size < n:
        size *= 2

    if seeded or size != n:
        full = [players[seed - 1] if seed <= n else None for seed in _seed_order(size)]
    else:
        full = list(players)
    rounds_total = int(math.log2(size)) if size > 1 else 1
    all_matches: List[Dict] = []
    match_num = 0

    r1_matches: List[Dict] = []
    for i in range(0, size, 2):
        match_num += 1
        r1_matches.append({
            "round": 1,
            "round_name": _round_name(1, rounds_total),
            "match_number": match_num,
            "phase": "knockout",
            "p1": full[i], "p2": full[i + 1],
            "next_match_idx": None, "next_slot": None,
        })
    all_matches.extend(r1_matches)

    prev_round = r1_matches
    for r in range(2, rounds_total + 1):
        rname = _round_name(r, rounds_total)
        cur_round: List[Dict] = []
        for i in range(0, len(prev_round), 2):
            match_num += 1
            m: Dict = {
                "round": r, "round_name": rname,
                "match_number": match_num, "phase": "knockout",
                "p1": None, "p2": None,
                "next_match_idx": None, "next_slot": None,
            }
            prev_round[i]["next_match_idx"] = len(all_matches) + len(cur_round)
            prev_round[i]["next_slot"] = 1
            if i + 1 < len(prev_round):
                prev_round[i + 1]["next_match_idx"] = len(all_matches) + len(cur_round)
                prev_round[i + 1]["next_slot"] = 2
            cur_round.append(m)
        all_matches.extend(cur_round)
        prev_round = cur_round

    return all_matches


# ── Bốc thăm bằng vòng quay (hàm thuần, không DB) ──────────────────────────
# Thể thức hỗ trợ: combined (bốc vào bảng), knockout (bốc vị trí nhánh), individual (bốc đối thủ).
# round_robin / round_robin_double không bốc vì thứ tự không ảnh hưởng cặp đấu.
DRAW_SUPPORTED_FORMATS = ("combined", "knockout", "individual")
_GROUP_LETTERS = "ABCDEFGHIJKLMNOP"


def _knockout_slot_seq(n: int):
    """(order, slot_seq): order = thứ tự hiển thị sơ đồ (trên→dưới, theo seed) với size = luỹ thừa 2 ≥ n;
    slot_seq = các seed ≤ n theo đúng thứ tự hiển thị đó — lượt bốc k nhận seed slot_seq[k]."""
    size = 1
    while size < n:
        size *= 2
    order = _seed_order(size)
    return order, [s for s in order if s <= n]


def draw_display_slots(format: str, n: int, num_groups: int = 2) -> List[Dict]:
    """Danh sách ô đích theo THỨ TỰ BỐC (lượt k điền ô k). Mỗi ô: {"index": k, "label": str, ...}.

    - combined: k → bảng letters[k % g], vị trí k // g + 1 (giống cách generate gán i % num_groups).
    - individual: k → trận k//2 + 1, đội k%2 + 1; n lẻ thì lượt cuối không có trận (giống _make_pairs).
    - knockout: lượt k nhận seed slot_seq[k] (thứ tự hiển thị trên sơ đồ, trên→dưới);
      bye khi ô kề bên (display_pos ^ 1) là seed > n → đội đó vào thẳng vòng 2.
    """
    slots: List[Dict] = []
    if format == "combined":
        g = max(1, int(num_groups))
        for k in range(n):
            letter = _GROUP_LETTERS[k % g]
            pos = k // g + 1
            slots.append({"index": k, "group": letter, "pos": pos, "label": f"Bảng {letter} – vị trí {pos}"})
        return slots
    if format == "individual":
        for k in range(n):
            if n % 2 == 1 and k == n - 1:
                slots.append({"index": k, "match": None, "side": None, "label": "Không có trận (số lẻ)"})
                continue
            m, side = k // 2 + 1, k % 2 + 1
            slots.append({"index": k, "match": m, "side": side, "label": f"Trận {m} – Đội {side}"})
        return slots
    if format == "knockout":
        order, slot_seq = _knockout_slot_seq(n)
        for k, seed in enumerate(slot_seq):
            display_pos = order.index(seed)
            bye = order[display_pos ^ 1] > n
            label = f"Vị trí {k + 1}" + (" (miễn vòng 1)" if bye else "")
            slots.append({"index": k, "seed": seed, "display_pos": display_pos, "bye": bye, "label": label})
        return slots
    raise ValueError(f"Thể thức '{format}' không hỗ trợ bốc thăm bằng vòng quay")


def draw_slot_label(format: str, step_index: int, n: int, num_groups: int = 2) -> str:
    return draw_display_slots(format, n, num_groups)[step_index]["label"]


def draw_picks_to_pid_list(format: str, picks: List[int], num_groups: int = 2) -> List[int]:
    """picks = participant_id theo thứ tự lượt bốc (đủ n phần tử). Trả pid_list để đưa vào _generate_from_order.

    - combined, individual: giữ nguyên thứ tự (generate gán bảng i % g và ghép (2k, 2k+1) theo đúng thứ tự).
    - knockout: pid_list[slot_seq[k] - 1] = picks[k] — vì _knockout_bracket đặt players[seed-1] vào vị trí
      hiển thị theo _seed_order, nên hai đội bốc liên tiếp (không bye) sẽ là đối thủ vòng 1.
    """
    if format in ("combined", "individual"):
        return list(picks)
    if format == "knockout":
        n = len(picks)
        _, slot_seq = _knockout_slot_seq(n)
        pid_list: List[Optional[int]] = [None] * n
        for k, pid in enumerate(picks):
            pid_list[slot_seq[k] - 1] = pid
        return pid_list
    raise ValueError(f"Thể thức '{format}' không hỗ trợ bốc thăm bằng vòng quay")


def draw_pick_index(seed_hex: str, step_index: int, remaining_count: int) -> int:
    """Công thức công khai để khán giả kiểm chứng: SHA256("{seed}:{k}") mod (số đội còn lại)."""
    digest = hashlib.sha256(f"{seed_hex}:{step_index}".encode()).hexdigest()
    return int(digest, 16) % remaining_count


# ── GHÉP ĐỘI ĐÔI BẰNG VÒNG QUAY (partner draw) — hàm thuần, không I/O ──────

UNRANKED = "Chưa xếp hạng"


def normalize_rank(r) -> str:
    """None/""/khoảng trắng → UNRANKED (khách mời mặc định, member.rank NULL); còn lại strip()."""
    if r is None:
        return UNRANKED
    s = str(r).strip()
    return s if s else UNRANKED


def normalize_partner_rules(rules) -> List[Dict]:
    """Chuẩn hoá quy tắc ghép đội về shape v2: [{"ranks1": [...], "ranks2": [...]}].
    Nhận None / [] / shape cũ [{"rank1": "A", "rank2": "B"}] / shape mới [{"ranks1": [...], "ranks2": [...]}]
    (hoặc trộn cả hai trong một quy tắc — rank1 chuỗi được gộp vào ranks1).
    Mỗi phần tử hạng đi qua normalize_rank; loại trùng nhưng giữ thứ tự. Bên rỗng = BẤT KỲ hạng.
    Phần tử None/"" (và rank1/rank2 = None/"" của shape cũ) được coi là "để trống" → BỎ, KHÔNG đổi thành
    "Chưa xếp hạng" (muốn hạng đó thì chọn tường minh UNRANKED).
    Quy tắc cả 2 bên rỗng vẫn hợp lệ (= ghép ngẫu nhiên toàn bộ)."""
    out: List[Dict] = []
    for rule in (rules or []):
        if rule is None:
            continue
        if not isinstance(rule, dict):
            rule = dict(rule)
        norm = {}
        for side in (1, 2):
            raw = list(rule.get(f"ranks{side}") or [])
            raw.append(rule.get(f"rank{side}"))          # shape cũ: chuỗi đơn gộp vào danh sách
            seen: List[str] = []
            for r in raw:
                if r is None or not str(r).strip():
                    continue                              # để trống ≠ "Chưa xếp hạng"
                nr = normalize_rank(r)
                if nr not in seen:
                    seen.append(nr)
            norm[f"ranks{side}"] = seen
        out.append(norm)
    return out


def _normalize_partner_plan(plan) -> Dict:
    """Đưa plan_json về shape v2 để API luôn trả cùng một hợp đồng, kể cả phiên mở/chốt TRƯỚC đợt 3
    (shape cũ: phases[].rank1/rank2/team_count, total_steps, leftover_by_rank).
    Ánh xạ: rank1→ranks1 (None/""→[]), rank2→ranks2, team_count→team_max, total_steps→total_steps_max;
    bổ sung mặc định team_cap (= team_max), overlap, total_steps_est, estimated, unpaired_pids.
    Plan đã là v2 thì giữ nguyên giá trị, chỉ điền trường thiếu."""
    plan = dict(plan or {})
    phases_out = []
    for i, ph in enumerate(plan.get("phases") or []):
        ph = dict(ph or {})
        ranks1 = ph.get("ranks1")
        ranks2 = ph.get("ranks2")
        if ranks1 is None:
            r1 = ph.get("rank1")
            ranks1 = [normalize_rank(r1)] if (r1 is not None and str(r1).strip()) else []
        if ranks2 is None:
            r2 = ph.get("rank2")
            ranks2 = [normalize_rank(r2)] if (r2 is not None and str(r2).strip()) else []
        team_max = ph.get("team_max")
        if team_max is None:
            team_max = ph.get("team_count") or 0
        team_max = int(team_max or 0)
        team_cap = ph.get("team_cap")
        team_cap = int(team_cap) if team_cap is not None else team_max
        overlap = ph.get("overlap")
        if overlap is None:
            # Plan cũ: cùng hạng 2 bên (hoặc 2 bên rỗng) → hai bên trùng nhau
            overlap = (not ranks1 or not ranks2) or bool(set(ranks1) & set(ranks2))
        phases_out.append({
            "index": int(ph.get("index", i)),
            "ranks1": list(ranks1), "ranks2": list(ranks2),
            "team_max": team_max, "team_cap": team_cap, "overlap": bool(overlap),
        })
    total_est = plan.get("total_steps_est")
    if total_est is None:
        total_est = 2 * sum(ph["team_max"] for ph in phases_out)
    total_max = plan.get("total_steps_max")
    if total_max is None:
        total_max = plan.get("total_steps")
    if total_max is None:
        total_max = 2 * sum(ph["team_cap"] for ph in phases_out)
    estimated = plan.get("estimated")
    if estimated is None:
        estimated = any(ph["overlap"] for ph in phases_out)
    out = dict(plan)
    out.pop("total_steps", None)
    out.update({
        "phases": phases_out,
        "total_steps_max": int(total_max),
        "total_steps_est": int(total_est),
        "unpaired_pids": list(plan.get("unpaired_pids") or []),
        "estimated": bool(estimated),
    })
    return out


def _side_pool(people_remaining: List[Dict], ranks: List[str]) -> List[Dict]:
    """Người còn lại đủ điều kiện cho một bên: ranks rỗng → tất cả; else rank ∈ ranks."""
    if not ranks:
        return list(people_remaining)
    allowed = set(ranks)
    return [p for p in people_remaining if p["rank"] in allowed]


def _people_sorted(people: List[Dict]) -> List[Dict]:
    return sorted(({"pid": p["pid"], "rank": normalize_rank(p.get("rank"))} for p in people), key=lambda x: x["pid"])


def partner_draw_plan(people: List[Dict], rules: Optional[List[Dict]]) -> Dict:
    """Kế hoạch (ƯỚC LƯỢNG) ghép đội v2 từ danh sách người và quy tắc nhiều hạng.
    - rules rỗng → 1 phase {index 0, ranks1 [], ranks2 [], team_max n//2, overlap True}.
    - Mỗi phase tính trên "remaining" ước lượng: S1/S2 theo _side_pool;
        a = |S1 \ S2|, b = |S2 \ S1|, c = |S1 ∩ S2|;
        team_max = min(a + c, b + c, (a + b + c) // 2) (cỡ ghép cặp lớn nhất); overlap = c > 0.
      Tiêu thụ ước lượng cho phase sau: lặp team_max lần — bên 1 lấy từ S1\S2 trước, hết thì từ giao;
      bên 2 lấy từ S2\S1 trước, hết thì từ giao.
    - unpaired_pids: người có hạng không thuộc hợp của mọi ranks1 ∪ ranks2 — CHỈ khi không quy tắc nào
      có bên rỗng (bên rỗng = bất kỳ hạng nên ai cũng có thể được chọn).
    - estimated = any(overlap): khi hai bên có hạng trùng nhau, số đội thực tế có thể ÍT hơn team_max
      (quy tắc dừng sớm khi hết cặp hợp lệ).
    - team_cap (mỗi phase): cỡ ghép cặp lớn nhất của quy tắc trên TOÀN BỘ pool (không trừ tiêu thụ) —
      cận trên THẬT của số đội phase đó dù các phase trước tiêu thụ thế nào.
    - total_steps_est = 2 × Σ team_max (con số "dự kiến" để UI hiển thị);
      total_steps_max = 2 × min(Σ team_cap, n // 2) — TRẦN THẬT số lượt: replay không bao giờ vượt, nên
      điều kiện kết thúc chỉ cần "hết cặp hợp lệ" (partner_step_context → None) mà vẫn không quá
      "tối đa N lượt" đã công bố. Luôn có total_steps_max ≥ total_steps_est."""
    ppl = _people_sorted(people)
    rules = normalize_partner_rules(rules)
    if not rules:
        rules = [{"ranks1": [], "ranks2": []}]

    def _pair_capacity(pool: List[Dict], ranks1: List[str], ranks2: List[str]):
        """(team_max, only1, only2, both) của một quy tắc trên `pool`: a=|S1\\S2|, b=|S2\\S1|, c=|S1∩S2|."""
        s1 = _side_pool(pool, ranks1)
        s2 = _side_pool(pool, ranks2)
        ids2 = {p["pid"] for p in s2}
        ids1 = {p["pid"] for p in s1}
        only1 = [p for p in s1 if p["pid"] not in ids2]
        only2 = [p for p in s2 if p["pid"] not in ids1]
        both = [p for p in s1 if p["pid"] in ids2]
        a, b, c = len(only1), len(only2), len(both)
        return min(a + c, b + c, (a + b + c) // 2), only1, only2, both

    remaining = list(ppl)
    phases = []
    for i, rule in enumerate(rules):
        ranks1, ranks2 = rule["ranks1"], rule["ranks2"]
        team_cap, _, _, _ = _pair_capacity(ppl, ranks1, ranks2)          # trên toàn bộ pool
        team_max, only1, only2, both = _pair_capacity(remaining, ranks1, ranks2)   # trên phần còn lại (ước lượng)
        phases.append({"index": i, "ranks1": list(ranks1), "ranks2": list(ranks2),
                       "team_max": team_max, "team_cap": team_cap, "overlap": len(both) > 0})
        consumed = set()
        for _ in range(team_max):
            for primary in (only1, only2):
                src = primary if primary else both
                if not src:
                    break
                consumed.add(src.pop(0)["pid"])
        remaining = [p for p in remaining if p["pid"] not in consumed]

    any_side_empty = any(not r["ranks1"] or not r["ranks2"] for r in rules)
    if any_side_empty:
        unpaired: List[int] = []
    else:
        union = set()
        for r in rules:
            union.update(r["ranks1"]); union.update(r["ranks2"])
        unpaired = [p["pid"] for p in ppl if p["rank"] not in union]

    return {
        "phases": phases,
        "total_steps_max": 2 * min(sum(ph["team_cap"] for ph in phases), len(ppl) // 2),
        "total_steps_est": 2 * sum(ph["team_max"] for ph in phases),
        "unpaired_pids": unpaired,
        "estimated": any(ph["overlap"] for ph in phases),
    }


def partner_step_context(people: List[Dict], rules: Optional[List[Dict]], steps: List[Dict]) -> Optional[Dict]:
    """Ngữ cảnh lượt kế tiếp (k = len(steps)) bằng REPLAY tất định — không dùng kế hoạch ước lượng.
    steps: [{"pid", "side", "phase_index", "team_index"}] theo thứ tự lượt.
    - Lượt trước là bên 1 → lượt này là bên 2 cùng phase/đội: eligible = _side_pool(remaining, ranks2).
    - Ngược lại: duyệt phase từ phase của lượt trước (hoặc 0): eligible bên 1 = người trong S1 mà
      sau khi chọn thì bên 2 VẪN còn người (loại người khiến bên 2 cạn → không có đội dở dang);
      phase không còn ai đủ điều kiện → sang phase kế; hết phase → None (đã hết lượt hợp lệ).
    - team_index = số lượt bên 2 đã có (0-based cho đội mới).
    Trả {"step_index", "phase_index", "team_index", "side", "eligible_pids" (sắp theo pid)} hoặc None."""
    ppl = _people_sorted(people)
    rules = normalize_partner_rules(rules)
    if not rules:
        rules = [{"ranks1": [], "ranks2": []}]
    steps = list(steps or [])
    k = len(steps)
    picked = {st["pid"] for st in steps}
    remaining = [p for p in ppl if p["pid"] not in picked]

    if steps and steps[-1].get("side") == 1:
        last = steps[-1]
        ph_i = int(last.get("phase_index") or 0)
        ph_i = min(max(ph_i, 0), len(rules) - 1)
        eligible = [p["pid"] for p in _side_pool(remaining, rules[ph_i]["ranks2"])]
        return {"step_index": k, "phase_index": ph_i, "team_index": int(last.get("team_index") or 0),
                "side": 2, "eligible_pids": eligible}

    start = int(steps[-1].get("phase_index") or 0) if steps else 0
    start = min(max(start, 0), len(rules) - 1)
    team_index = sum(1 for st in steps if st.get("side") == 2)
    for i in range(start, len(rules)):
        s1 = _side_pool(remaining, rules[i]["ranks1"])
        s2_ids = [p["pid"] for p in _side_pool(remaining, rules[i]["ranks2"])]
        eligible1 = [p["pid"] for p in s1 if any(y != p["pid"] for y in s2_ids)]
        if eligible1:
            return {"step_index": k, "phase_index": i, "team_index": team_index,
                    "side": 1, "eligible_pids": eligible1}
    return None


def partner_draw_finished(people: List[Dict], rules: Optional[List[Dict]], steps: List[Dict]) -> bool:
    """Phiên đã hết lượt ⇔ không còn cặp hợp lệ (replay → None). KHÔNG dùng trần total_steps làm điều kiện
    kết thúc: total_steps_max của plan v2 là cận trên thật nên replay không thể vượt nó."""
    return partner_step_context(people, rules, list(steps or [])) is None


def partner_draw_stuck(people: List[Dict], rules: Optional[List[Dict]], steps: List[Dict]) -> bool:
    """Phiên KẸT: lượt cuối là bên 1 nhưng bên 2 không còn ai đủ điều kiện (chỉ xảy ra với dữ liệu hỏng /
    phiên mở bằng engine cũ — engine v2 lọc bên 1 nên bên 2 luôn ≥ 1). Không thể quay tiếp lẫn chốt
    (đội dở dang) → UI gợi ý huỷ phiên và mở lại."""
    ctx = partner_step_context(people, rules, list(steps or []))
    return ctx is not None and not ctx["eligible_pids"]


def generate_group_schedule(
    participant_ids: List[int],
    num_groups: int,
    shuffle: bool = True,
) -> List[Dict]:
    """
    Sinh lịch đấu vòng bảng (round-robin trong từng bảng).
    Trả về list match dicts với phase="group".
    """
    ids = list(participant_ids)
    if shuffle:
        random.shuffle(ids)

    group_letters = "ABCDEFGHIJKLMNOP"
    groups: List[List[int]] = [[] for _ in range(num_groups)]
    for i, pid in enumerate(ids):
        groups[i % num_groups].append(pid)

    matches = []
    match_num = 0
    for g_idx, group in enumerate(groups):
        gname = group_letters[g_idx]
        for r_idx, round_pairs in enumerate(_round_robin_pairs(group)):
            for p1, p2 in round_pairs:
                match_num += 1
                matches.append({
                    "round_number": r_idx + 1,
                    "round_name": f"Bảng {gname} – Vòng {r_idx + 1}",
                    "match_number": match_num,
                    "phase": "group",
                    "group_name": gname,
                    "p1_id": p1,
                    "p2_id": p2,
                })
    return matches


def knockout_layout_from_groups(
    group_letters: List[str],
    firsts: Dict[str, Optional[int]],
    seconds: Dict[str, Optional[int]],
) -> List[Optional[int]]:
    """Xếp các suất từ vòng bảng vào Ô sơ đồ loại trực tiếp (hàm thuần, không DB).

    Trả về danh sách độ dài luỹ thừa 2 theo THỨ TỰ HIỂN THỊ (trên→dưới); ô 2i và 2i+1 là một trận
    vòng đầu, None = bye. Luật ghép cặp (theo yêu cầu BTC):
      * Bảng ghép thành KHỐI 2 bảng theo thứ tự chữ cái: (A,B), (C,D), (E,F)...
        Trong khối (X,Y): Nhất X gặp Nhì Y, Nhất Y gặp Nhì X; 2 trận này kề nhau (thắng gặp nhau ở vòng sau).
      * Số suất không phải luỹ thừa 2 → có bye. Bye ưu tiên NHẤT BẢNG theo thứ tự chữ cái (A, B, C...),
        hết nhất bảng mới đến nhì bảng (thứ tự ngược). Đội bị "mất" đối thủ vì bye thành đội TỰ DO,
        ghép chéo bảng với nhau (không gặp đội cùng bảng ở vòng đầu); khối còn đủ 2 trận vẫn giữ nguyên luật.
      * Đội được bye được xếp cạnh trận không có đội cùng bảng mình để vòng 2 không gặp lại đội cùng bảng
        (khi còn sắp xếp được).
      * Khối mà cả 4 suất đều được bye (nhiều bảng, vd 9–10 bảng): trận đầu thật của họ là vòng 2 → vẫn
        áp luật bằng cách đặt 4 ô bye liền nhau theo thứ tự 1X, 2Y, 1Y, 2X.
    Tiền đề: tên bảng là chữ cái A–P do hệ thống gán (so sánh chuỗi Python/JS giống nhau); một suất chỉ
    thuộc một bảng (trùng → ValueError). Các đảm bảo "không gặp cùng bảng" chỉ chắc chắn khi mọi bảng có
    đủ 2 suất (đường đi thật của ứng dụng: generate chia đều nên bảng luôn ≥ 2 đội); bảng 1 đội vẫn ra
    bracket hợp lệ nhưng heuristic tham lam có thể để đội bye kề đội cùng bảng ở vòng 2.
    Bản gương JS: frontend/src/utils/bracketLayout.js:knockoutLayoutFromGroups — sửa một bên phải sửa cả hai
    (có test đối chiếu trong backend/tests/test_batch15_knockout_pairing_rule.py).
    """
    letters = sorted(group_letters)
    group_of: Dict[int, str] = {}
    is_first: Dict[int, bool] = {}
    teams: List[int] = []
    for g in letters:
        for pid, first in ((firsts.get(g), True), (seconds.get(g), False)):
            if pid is None:
                continue
            if pid in group_of:
                raise ValueError(f"Suất {pid} xuất hiện ở 2 vị trí (bảng {group_of[pid]} và {g})")
            group_of[pid] = g
            is_first[pid] = first
            teams.append(pid)
    n = len(teams)
    if n < 2:
        return list(teams)
    size = 1
    while size < n:
        size *= 2
    byes_needed = size - n

    # 1) Bye: nhất bảng theo thứ tự chữ cái, rồi nhì bảng theo thứ tự ngược
    bye_order = [firsts[g] for g in letters if firsts.get(g) is not None]
    bye_order += [seconds[g] for g in reversed(letters) if seconds.get(g) is not None]
    byes = bye_order[:byes_needed]

    def build(byes: List[int]) -> List[Optional[int]]:
        bye_set = set(byes)

        def playable(pid: Optional[int]) -> bool:
            return pid is not None and pid not in bye_set

        # 2) Khối 2 bảng (X,Y): Nhất X–Nhì Y, Nhất Y–Nhì X. Đội lẻ ra → tự do.
        intact_matches: List[Tuple[int, int]] = []   # khối còn đủ 2 trận (giữ kề nhau)
        partial_matches: List[Tuple[int, int]] = []  # khối chỉ còn 1 trận
        free: List[int] = []
        for i in range(0, len(letters), 2):
            block = letters[i:i + 2]
            if len(block) == 2:
                x, y = block
                made: List[Tuple[int, int]] = []
                for a, b in ((firsts.get(x), seconds.get(y)), (firsts.get(y), seconds.get(x))):
                    if playable(a) and playable(b):
                        made.append((a, b))
                    else:
                        if playable(a):
                            free.append(a)
                        if playable(b):
                            free.append(b)
                (intact_matches if len(made) == 2 else partial_matches).extend(made)
            else:
                z = block[0]
                for pid in (firsts.get(z), seconds.get(z)):
                    if playable(pid):
                        free.append(pid)

        # 3) Đội tự do: sắp theo bảng (nhất trước nhì), ghép i với i + len/2 → luôn khác bảng khi ≥ 4 đội
        free.sort(key=lambda pid: (group_of[pid], 0 if is_first[pid] else 1))
        half = len(free) // 2
        free_matches: List[Tuple[int, int]] = [(free[i], free[i + half]) for i in range(half)]

        # 4) Xếp ô: mỗi bye đi kèm 1 trận/bye KHÁC BẢNG ngay cạnh (gặp nhau ở vòng 2), rồi trận tự do,
        #    trận khối lẻ, cuối cùng các khối nguyên (số trận trước khối nguyên luôn chẵn → khối thẳng hàng).
        def other_group(pid: int, match: Tuple[int, int]) -> bool:
            return all(group_of[q] != group_of[pid] for q in match)

        slots: List[Optional[int]] = []
        rem_byes = list(byes)
        rem_free = list(free_matches)
        rem_partial = list(partial_matches)

        # 4a) Khối (X,Y) mà cả 4 suất đều bye: đặt trước [1X,—,2Y,—,1Y,—,2X,—] (8 ô, thẳng hàng vì đặt
        #     đầu tiên) → vòng 2: 1X gặp 2Y, 1Y gặp 2X; vòng 3 hai người thắng gặp nhau — đúng luật khối.
        for i in range(0, len(letters) - 1, 2):
            x, y = letters[i], letters[i + 1]
            quad = (firsts.get(x), seconds.get(y), firsts.get(y), seconds.get(x))
            if all(q is not None and q in bye_set for q in quad):
                for q in quad:
                    rem_byes.remove(q)
                    slots += [q, None]

        def pick_bye(exclude_group: Optional[str]) -> Optional[int]:
            """Bye cần xử lý tiếp: ưu tiên bảng còn NHIỀU bye nhất (1X và 2X cùng bye) để không bị kẹt
            2 đội cùng bảng cạnh nhau ở cuối; hoà thì lấy bye đứng trước trong thứ tự ưu tiên."""
            best = None
            best_key = None
            for k, o in enumerate(rem_byes):
                g = group_of[o]
                if g == exclude_group:
                    continue
                key = (sum(1 for q in rem_byes if group_of[q] == g), -k)
                if best_key is None or key > best_key:
                    best, best_key = o, key
            return best

        while rem_byes:
            b = pick_bye(None)
            rem_byes.remove(b)
            idx = next((k for k, m in enumerate(rem_free) if other_group(b, m)), None)
            if idx is not None:
                slots += [b, None, *rem_free.pop(idx)]
                continue
            o = pick_bye(group_of[b])
            if o is not None:
                rem_byes.remove(o)
                slots += [b, None, o, None]
                continue
            idx = next((k for k, m in enumerate(rem_partial) if other_group(b, m)), None)
            if idx is not None:
                slots += [b, None, *rem_partial.pop(idx)]
                continue
            slots += [b, None]  # bí: ô kế tiếp là gì cũng được
        for m in rem_free:
            slots += list(m)
        for m in rem_partial:
            slots += list(m)
        for m in intact_matches:
            slots += list(m)
        if len(slots) != size:  # không xảy ra về mặt toán học; giữ để lộ lỗi sớm thay vì sinh bracket hỏng
            raise ValueError(f"Xếp nhánh lỗi: {len(slots)} ô ≠ {size}")
        return slots

    def same_group_r1(slots: List[Optional[int]]) -> List[int]:
        clash: List[int] = []
        for i in range(0, len(slots), 2):
            a, b = slots[i], slots[i + 1]
            if a is not None and b is not None and group_of[a] == group_of[b]:
                clash += [a, b]
        return clash

    slots = build(byes)
    # Bảng thiếu đội (vd A chỉ 1 đội, B đủ 2): 1A bye → 1B và 2B lẻ ra buộc gặp nhau. Thử đổi suất bye cho
    # một đội trong cặp cùng bảng đó (ưu tiên nhất bảng) để tránh cùng bảng gặp nhau ngay vòng đầu.
    clash = same_group_r1(slots) if n > 2 else []
    if clash:
        candidates = sorted(set(clash), key=lambda pid: (0 if is_first[pid] else 1, group_of[pid]))
        for bi in range(len(byes)):
            for f in candidates:
                alt = byes[:bi] + [f] + byes[bi + 1:]
                alt_slots = build(alt)
                if not same_group_r1(alt_slots):
                    return alt_slots
    return slots


def generate_knockout_from_groups(
    group_standings: Dict[str, List[Dict]],
    existing_match_count: int = 0,
) -> List[Dict]:
    """
    Sinh vòng loại từ kết quả đấu bảng (top 2 mỗi bảng).
    Luật ghép: khối 2 bảng (A,B), (C,D), (E,F)... — Nhất A gặp Nhì B, Nhất B gặp Nhì A (xem knockout_layout_from_groups).
    group_standings: { "A": [ranked_rows (rank=1 là nhất)...], ... }
    """
    group_letters = sorted(group_standings.keys())
    firsts: Dict[str, Optional[int]] = {}
    seconds: Dict[str, Optional[int]] = {}
    for gname, standings in group_standings.items():
        firsts[gname] = None
        seconds[gname] = None
        for row in standings:
            if row.get("rank") == 1:
                firsts[gname] = row["participant_id"]
            elif row.get("rank") == 2:
                seconds[gname] = row["participant_id"]

    slots = knockout_layout_from_groups(group_letters, firsts, seconds)
    # slots đã đúng độ dài luỹ thừa 2 và thứ tự hiển thị → dùng nguyên (seeded=False), None = bye
    raw = _knockout_bracket(slots, seeded=False)
    match_num = existing_match_count
    matches = []
    for m in raw:
        match_num += 1
        matches.append({
            "round_number": m["round"],
            "round_name": m["round_name"],
            "match_number": match_num,
            "phase": "knockout",
            "group_name": None,
            "p1_id": m["p1"],
            "p2_id": m["p2"],
            "_next_match_idx": m["next_match_idx"],
            "_next_slot": m["next_slot"],
        })
    return matches


def generate_schedule(
    format: str,
    participant_ids: List[int],
    pairing_mode: str = "random",
    rank_rules: Optional[List[Dict]] = None,
    member_ranks: Optional[Dict[int, str]] = None,
    num_groups: int = 2,
    shuffle: bool = True,
) -> List[Dict]:
    """
    Sinh lịch thi đấu theo format.
    participant_ids: list TournamentParticipant.id
    """
    ids = list(participant_ids)
    if shuffle:
        random.shuffle(ids)

    matches = []
    match_counter = [0]

    def next_num():
        match_counter[0] += 1
        return match_counter[0]

    if format == "individual":
        pairs = _make_pairs(ids, pairing_mode, rank_rules, member_ranks)
        for p1, p2 in pairs:
            matches.append({
                "round_number": 1, "round_name": "Trận đấu",
                "match_number": next_num(), "phase": "group",
                "group_name": None, "p1_id": p1, "p2_id": p2,
            })
        return matches

    if format == "round_robin":
        for r_idx, round_pairs in enumerate(_round_robin_pairs(ids)):
            for p1, p2 in round_pairs:
                matches.append({
                    "round_number": r_idx + 1,
                    "round_name": f"Vòng {r_idx + 1}",
                    "match_number": next_num(), "phase": "group",
                    "group_name": None, "p1_id": p1, "p2_id": p2,
                })
        return matches

    if format == "round_robin_double":
        first_leg = _round_robin_pairs(ids)
        total_rounds = len(first_leg)
        for r_idx, round_pairs in enumerate(first_leg):
            for p1, p2 in round_pairs:
                matches.append({
                    "round_number": r_idx + 1,
                    "round_name": f"Lượt đi – Vòng {r_idx + 1}",
                    "match_number": next_num(), "phase": "group",
                    "group_name": None, "p1_id": p1, "p2_id": p2,
                })
        for r_idx, round_pairs in enumerate(first_leg):
            for p1, p2 in round_pairs:
                matches.append({
                    "round_number": total_rounds + r_idx + 1,
                    "round_name": f"Lượt về – Vòng {r_idx + 1}",
                    "match_number": next_num(), "phase": "group",
                    "group_name": None, "p1_id": p2, "p2_id": p1,
                })
        return matches

    if format == "knockout":
        for m in _knockout_bracket(ids):
            matches.append({
                "round_number": m["round"], "round_name": m["round_name"],
                "match_number": next_num(), "phase": "knockout",
                "group_name": None, "p1_id": m["p1"], "p2_id": m["p2"],
                "_next_match_idx": m["next_match_idx"],
                "_next_slot": m["next_slot"],
            })
        return matches

    if format == "combined":
        return generate_group_schedule(ids, num_groups, shuffle=False)

    return matches


def _make_pairs(ids, pairing_mode, rank_rules, member_ranks):
    if pairing_mode == "cross_rank" and rank_rules and member_ranks:
        pairs = []
        rank_groups: Dict[str, List] = {}
        for pid in ids:
            r = member_ranks.get(pid, "")
            rank_groups.setdefault(r, []).append(pid)
        for rule in rank_rules:
            r1, r2 = rule.get("rank1", ""), rule.get("rank2", "")
            g1 = rank_groups.get(r1, [])[:]
            g2 = rank_groups.get(r2, [])[:]
            random.shuffle(g1); random.shuffle(g2)
            for a, b in zip(g1, g2):
                pairs.append((a, b))
        return pairs
    paired = []
    for i in range(0, len(ids) - 1, 2):
        paired.append((ids[i], ids[i + 1]))
    return paired


def compute_standings(
    matches: List[Dict],
    participants: List[Dict],
    group: Optional[str] = None,
    profile: str = "default",
) -> List[Dict]:
    """
    Tính bảng xếp hạng vòng bảng.
    Điểm: Thắng = 1, Thua = 0 (không tính hòa).
    Trận walkover (đối thủ bỏ giải, is_walkover=True): vẫn tính thắng/thua/điểm xếp hạng như
    thắng thật, nhưng KHÔNG cộng vào hiệu số bàn thắng/bàn thua — tránh 1 đội được lợi hiệu
    số ảo khi so tie-break với các đội thi đấu thật.
    Tiebreaker (profile="default"): điểm → đối đầu trực tiếp giữa các đội bằng điểm (điểm, hiệu số, ghi được)
                → hiệu số toàn giải → điểm ghi được toàn giải.

    Giải ĐỒNG ĐỘI — m dict có thêm rubber_won1/rubber_won2 (số trận thành phần thắng) và pts1/pts2 (tổng điểm nhỏ);
    score1/score2 của tie là số trận thắng (PA1) hoặc tổng điểm cộng dồn (PA2):
      profile="team_match_points" (điều lệ PA1): điểm bảng → đối đầu trực tiếp → hiệu số TRẬN THÀNH PHẦN toàn bảng
                → hiệu số ĐIỂM NHỎ toàn bảng → (bốc thăm: giữ nguyên thứ tự, đánh dấu needs_draw).
      profile="team_cumulative" (điều lệ PA2): điểm bảng → hiệu số TỔNG ĐIỂM TÍCH LUỸ toàn bảng → đối đầu trực tiếp
                → (bốc thăm).
    """
    stats: Dict[int, Dict] = {}
    for p in participants:
        if group is not None and p.get("group_name") != group:
            continue
        stats[p["id"]] = {
            "participant_id": p["id"],
            "member_id": p["member_id"],
            "full_name": p.get("full_name", ""),
            "team_name": p.get("team_name") or p.get("full_name", ""),
            "group_name": p.get("group_name"),
            "played": 0, "won": 0, "lost": 0,
            "goals_for": 0, "goals_against": 0,
            "points": 0,
            # giải đồng đội: trận thành phần thắng/thua và điểm nhỏ ghi/thua (0 với giải thường)
            "rubbers_won": 0, "rubbers_lost": 0, "pts_for": 0, "pts_against": 0,
        }

    for m in matches:
        if m.get("status") != "completed":
            continue
        p1, p2 = m.get("p1_id"), m.get("p2_id")
        if p1 not in stats or p2 not in stats:
            continue
        stats[p1]["played"] += 1
        stats[p2]["played"] += 1

        if m.get("is_walkover"):
            # Đối thủ bỏ giải: tính thắng/thua/điểm, không tính hiệu số (không có tỉ số thật)
            winner = m.get("winner_id")
            if winner == p1:
                stats[p1]["won"] += 1; stats[p1]["points"] += 1; stats[p2]["lost"] += 1
            elif winner == p2:
                stats[p2]["won"] += 1; stats[p2]["points"] += 1; stats[p1]["lost"] += 1
            continue

        s1 = int(m.get("score1") or 0)
        s2 = int(m.get("score2") or 0)
        stats[p1]["goals_for"] += s1
        stats[p1]["goals_against"] += s2
        stats[p2]["goals_for"] += s2
        stats[p2]["goals_against"] += s1
        rw1, rw2 = int(m.get("rubber_won1") or 0), int(m.get("rubber_won2") or 0)
        pt1, pt2 = int(m.get("pts1") or 0), int(m.get("pts2") or 0)
        stats[p1]["rubbers_won"] += rw1; stats[p1]["rubbers_lost"] += rw2
        stats[p2]["rubbers_won"] += rw2; stats[p2]["rubbers_lost"] += rw1
        stats[p1]["pts_for"] += pt1; stats[p1]["pts_against"] += pt2
        stats[p2]["pts_for"] += pt2; stats[p2]["pts_against"] += pt1
        # Giải đồng đội: tie đã có winner_id (có thể hoà số trận nhưng phân định bằng hiệu số/trận cuối)
        winner = m.get("winner_id") if profile != "default" else None
        if winner == p1 or (winner is None and s1 > s2):
            stats[p1]["won"] += 1
            stats[p1]["points"] += 1
            stats[p2]["lost"] += 1
        elif winner == p2 or (winner is None and s2 > s1):
            stats[p2]["won"] += 1
            stats[p2]["points"] += 1
            stats[p1]["lost"] += 1
        # Hòa: không cộng điểm

    rows = list(stats.values())
    for r in rows:
        r["goal_diff"] = r["goals_for"] - r["goals_against"]
        r["rubber_diff"] = r["rubbers_won"] - r["rubbers_lost"]
        r["pts_diff"] = r["pts_for"] - r["pts_against"]
        r["needs_draw"] = False

    completed_matches = [m for m in matches if m.get("status") == "completed"]

    def head_to_head_key(pid: int, tied_ids: set) -> tuple:
        """Hệ số đối đầu: chỉ tính các trận giữa những đội đang bằng điểm nhau.
        Trận walkover vẫn tính thắng/thua đối đầu, không cộng vào hiệu số/điểm ghi được
        (nhất quán với compute_standings ở trên)."""
        h_points = h_for = h_against = 0
        for m in completed_matches:
            p1, p2 = m.get("p1_id"), m.get("p2_id")
            if pid not in (p1, p2):
                continue
            other = p2 if p1 == pid else p1
            if other not in tied_ids:
                continue
            if m.get("is_walkover"):
                if m.get("winner_id") == pid:
                    h_points += 1
                continue
            s1 = int(m.get("score1") or 0)
            s2 = int(m.get("score2") or 0)
            my_score, opp_score = (s1, s2) if p1 == pid else (s2, s1)
            h_for += my_score
            h_against += opp_score
            won_h2h = (m.get("winner_id") == pid) if (profile != "default" and m.get("winner_id")) else my_score > opp_score
            if won_h2h:
                h_points += 1
        if profile != "default":
            return (-h_points,)          # điều lệ: đối đầu trực tiếp chỉ xét kết quả thắng/thua
        return (-h_points, -(h_for - h_against), -h_for)

    def secondary_key(x: Dict) -> tuple:
        if profile == "team_match_points":
            return (-x["rubber_diff"], -x["pts_diff"])
        if profile == "team_cumulative":
            return (-x["goal_diff"],)    # hiệu số tổng điểm tích luỹ (score của tie là tổng điểm)
        return (-x["goal_diff"], -x["goals_for"])

    def group_sort_key(x: Dict, tied_ids: set) -> tuple:
        h2h = head_to_head_key(x["participant_id"], tied_ids)
        if profile == "team_cumulative":
            return secondary_key(x) + h2h     # PA2: hiệu số tích luỹ TRƯỚC, đối đầu SAU
        return h2h + secondary_key(x)         # default & PA1: đối đầu trước

    # Nhóm theo điểm số; trong mỗi nhóm bằng điểm áp tie-break theo profile.
    rows.sort(key=lambda x: (-x["points"],) + secondary_key(x))
    ordered: List[Dict] = []
    i = 0
    while i < len(rows):
        j = i
        while j < len(rows) and rows[j]["points"] == rows[i]["points"]:
            j += 1
        tied_group = rows[i:j]
        if len(tied_group) > 1:
            tied_ids = {r["participant_id"] for r in tied_group}
            tied_group.sort(key=lambda x: group_sort_key(x, tied_ids))
            if profile != "default":
                # Vẫn bằng nhau sau mọi chỉ số → điều lệ: bốc thăm. Đánh dấu để BTC xử lý, giữ thứ tự ổn định.
                keys = [group_sort_key(x, tied_ids) for x in tied_group]
                for k in range(len(tied_group)):
                    dup = any(keys[k] == keys[o] for o in range(len(tied_group)) if o != k)
                    if dup:
                        tied_group[k]["needs_draw"] = True
        ordered.extend(tied_group)
        i = j

    for idx, r in enumerate(ordered):
        r["rank"] = idx + 1
    return ordered


# ══════════════════════════════════════════════════════════════════════════════
# GIẢI ĐỒNG ĐỘI (team_type="team") — hàm thuần, không DB.
# Trận đồng đội (tie) = 1 TournamentMatch giữa 2 đội; bên trong là các trận thành phần (rubber)
# theo thể thức MD/WD/XD/MS/WS. Hai cách tính điểm theo điều lệ: match_points (PA1) và cumulative (PA2).
# ══════════════════════════════════════════════════════════════════════════════

RUBBER_CODES = {
    "MD": ("Đôi Nam", ("male", "male")),
    "WD": ("Đôi Nữ", ("female", "female")),
    "XD": ("Đôi Nam Nữ", ("male", "female")),
    "MS": ("Đơn Nam", ("male",)),
    "WS": ("Đơn Nữ", ("female",)),
}
TEAM_SCORINGS = ("match_points", "cumulative")
STAGE_KEYS = ("leg1", "leg2", "knockout")
STAGE_LABELS = {"leg1": "Lượt đi / Vòng bảng", "leg2": "Lượt về", "knockout": "Vòng loại trực tiếp"}
GENDER_LABELS = {"male": "Nam", "female": "Nữ", "other": "Khác"}


def normalize_team_rules(raw: Optional[Dict]) -> Dict:
    """Chuẩn hoá team_rules. Mặc định: PA1, 5 thể thức (MD, WD, XD, MS, WS), 11 điểm, cách biệt 2,
    tối đa 2 trận/VĐV, đánh hết các trận. PA2: target_total mặc định = điểm/trận × số trận.
    Nhãn thiếu → tự sinh "Đôi Nam 1", "Đôi Nam 2"...; nhãn trùng → thêm hậu tố để làm khoá slot đội hình."""
    raw = dict(raw or {})
    scoring = raw.get("scoring") if raw.get("scoring") in TEAM_SCORINGS else "match_points"
    try:
        ppr = int(raw.get("points_per_rubber") or 11)
    except (TypeError, ValueError):
        ppr = 11
    ppr = max(1, min(ppr, 99))
    rubbers_in = raw.get("rubbers") or [{"code": c} for c in ("MD", "WD", "XD", "MS", "WS")]
    counters: Dict[str, int] = {}
    rubbers: List[Dict] = []
    for r in rubbers_in:
        code = str((r or {}).get("code") or "").upper().strip()
        if code not in RUBBER_CODES:
            continue
        counters[code] = counters.get(code, 0) + 1
        label = str((r or {}).get("label") or "").strip() or f"{RUBBER_CODES[code][0]} {counters[code]}"
        rubbers.append({"code": code, "label": label})
    if not rubbers:
        raise ValueError("Cần ít nhất 1 trận thành phần")
    if len(rubbers) > 20:
        raise ValueError("Tối đa 20 trận thành phần")
    seen: Dict[str, int] = {}
    for r in rubbers:
        base = r["label"]
        if base in seen:
            seen[base] += 1
            r["label"] = f"{base} ({seen[base]})"
        else:
            seen[base] = 1
    n = len(rubbers)
    target_total = None
    if scoring == "cumulative":
        try:
            target_total = int(raw.get("target_total") or ppr * n)
        except (TypeError, ValueError):
            target_total = ppr * n
        # Kẹp trong [ppr, ppr×n]: mốc lớn hơn tổng điểm tối đa thì trận đồng đội không bao giờ kết thúc
        target_total = max(ppr, min(target_total, ppr * n))
    try:
        max_per = max(1, int(raw.get("max_rubbers_per_player") or 2))
    except (TypeError, ValueError):
        max_per = 2
    return {
        "scoring": scoring,
        "rubbers": rubbers,
        "points_per_rubber": ppr,
        "win_by_two": bool(raw.get("win_by_two", True)),
        "target_total": target_total,
        "max_rubbers_per_player": max_per,
        "play_all": bool(raw.get("play_all", True)),
    }


def rubber_target(rules: Dict, order_index: int) -> int:
    """Mốc điểm của trận thành phần thứ `order_index` (1-based). PA2: k × điểm/trận, chặn ở mốc tổng."""
    if rules["scoring"] == "cumulative":
        return min(rules["points_per_rubber"] * max(1, int(order_index)), rules["target_total"])
    return rules["points_per_rubber"]


def validate_rubber_score(rules: Dict, rubber: Dict, score1: int, score2: int) -> None:
    """Kiểm tra tỉ số một trận thành phần. PA1: tỉ số ván đó. PA2: TỔNG sau trận (xuất phát + ghi thêm).
    Ném ValueError (thông điệp tiếng Việt) khi không hợp lệ."""
    s1, s2 = int(score1), int(score2)
    if s1 < 0 or s2 < 0:
        raise ValueError("Điểm không được âm")
    if s1 == s2:
        raise ValueError("Trận thành phần không được hoà")
    if rules["scoring"] == "cumulative":
        st1, st2 = int(rubber.get("start1") or 0), int(rubber.get("start2") or 0)
        if s1 < st1 or s2 < st2:
            raise ValueError(f"Điểm cộng dồn không được thấp hơn điểm xuất phát ({st1} – {st2})")
        target = rubber_target(rules, rubber.get("order_index") or 1)
        hi, lo = max(s1, s2), min(s1, s2)
        if hi < target:
            raise ValueError(f"Phải có một bên chạm mốc {target} điểm")
        if hi == target:
            if lo >= target:
                raise ValueError(f"Chỉ một bên được chạm mốc {target} điểm")
            if rules.get("win_by_two") and lo > target - 2:
                raise ValueError(f"Cần cách biệt 2 điểm (vd {target}–{target - 2})")
        else:
            # vượt mốc chỉ khi deuce (cách biệt 2): bên thua có thể ≥ mốc, vd 62–60
            if not rules.get("win_by_two") or hi - lo != 2:
                raise ValueError(f"Bên thắng dừng ở đúng mốc {target} (hoặc hơn đúng 2 điểm khi deuce)")
        return
    ppr = rules["points_per_rubber"]
    hi, lo = max(s1, s2), min(s1, s2)
    if hi < ppr:
        raise ValueError(f"Bên thắng phải đạt {ppr} điểm")
    if rules.get("win_by_two"):
        if hi == ppr and lo > ppr - 2:
            raise ValueError(f"Cần cách biệt 2 điểm (vd {ppr}–{ppr - 2})")
        if hi > ppr and hi - lo != 2:
            raise ValueError("Quá mốc chỉ khi deuce: bên thắng hơn đúng 2 điểm")
    else:
        if hi != ppr:
            raise ValueError(f"Bên thắng dừng ở đúng {ppr} điểm")


def tie_result(rules: Dict, rubbers: List[Dict]) -> Dict:
    """Kết quả trận đồng đội từ các trận thành phần (dict có order_index, status, score1, score2, start1, start2).

    PA1 (match_points): score = số trận thắng; finished khi mọi trận đã đấu (play_all);
      hoà số trận → hiệu số điểm nhỏ (Σscore1 − Σscore2) → vẫn bằng → đội thắng trận thành phần CUỐI.
    PA2 (cumulative): score = tổng điểm cộng dồn sau trận gần nhất; finished khi một bên đạt target_total.
    Trả: {score1, score2, winner_side, decided, finished, detail, next_start}."""
    rs = sorted(rubbers, key=lambda r: int(r.get("order_index") or 0))
    n = len(rs)
    done = [r for r in rs if r.get("status") == "completed"]
    if rules["scoring"] == "cumulative":
        tot1 = tot2 = 0
        for r in rs:
            if r.get("status") != "completed":
                break
            tot1, tot2 = int(r.get("score1") or 0), int(r.get("score2") or 0)
        target = rules["target_total"]
        finished = tot1 >= target or tot2 >= target
        winner = 1 if (finished and tot1 > tot2) else 2 if (finished and tot2 > tot1) else None
        detail = (f"Đội {'1' if winner == 1 else '2'} chạm mốc {target} điểm" if finished
                  else f"Đang {tot1} – {tot2}, mốc {target}")
        return {"score1": tot1, "score2": tot2, "winner_side": winner, "decided": finished,
                "finished": finished, "detail": detail, "next_start": (tot1, tot2)}
    wins1 = sum(1 for r in done if int(r.get("score1") or 0) > int(r.get("score2") or 0))
    wins2 = sum(1 for r in done if int(r.get("score2") or 0) > int(r.get("score1") or 0))
    diff = sum(int(r.get("score1") or 0) - int(r.get("score2") or 0) for r in done)
    finished = n > 0 and len(done) == n
    decided = wins1 * 2 > n or wins2 * 2 > n
    winner = None
    detail = f"Đang {wins1} – {wins2} trận"
    if finished:
        if wins1 != wins2:
            winner = 1 if wins1 > wins2 else 2
            detail = f"Thắng {max(wins1, wins2)} – {min(wins1, wins2)} trận"
        elif diff != 0:
            winner = 1 if diff > 0 else 2
            detail = f"Hoà {wins1} – {wins2} trận, phân định bằng hiệu số điểm ({diff:+d})"
        else:
            last = done[-1] if done else None
            if last is not None:
                winner = 1 if int(last.get("score1") or 0) > int(last.get("score2") or 0) else 2
            detail = f"Hoà {wins1} – {wins2} trận và hiệu số điểm, đội thắng trận cuối được tính thắng"
    return {"score1": wins1, "score2": wins2, "winner_side": winner, "decided": decided,
            "finished": finished, "detail": detail, "next_start": (0, 0)}


def rubber_players_check(code: str, players: List[int], gender_by_tp: Dict[int, Optional[str]]) -> Tuple[List[str], List[str]]:
    """(errors, warnings) cho danh sách VĐV một bên của một trận thành phần.
    Sai số người / trùng người → error (chặn). Giới tính không khớp hoặc chưa khai → warning (không chặn)."""
    if code not in RUBBER_CODES:
        return [f"Thể thức không hợp lệ: {code}"], []
    name, expected = RUBBER_CODES[code]
    errors: List[str] = []
    warnings: List[str] = []
    players = [int(p) for p in (players or [])]
    if len(players) != len(expected):
        errors.append(f"{name} cần {len(expected)} VĐV mỗi bên")
        return errors, warnings
    if len(set(players)) != len(players):
        errors.append("Một VĐV không thể xuất hiện 2 lần trong cùng trận thành phần")
        return errors, warnings
    genders = [gender_by_tp.get(p) for p in players]
    if any(g not in ("male", "female") for g in genders):
        warnings.append(f"{name}: có VĐV chưa khai giới tính")
    known = sorted(g for g in genders if g in ("male", "female"))
    need = sorted(expected)
    if len(known) == len(need) and known != need:
        warnings.append(f"{name}: giới tính VĐV không khớp thể thức")
    return errors, warnings


def over_limit_players(rules: Dict, sides: List[List[int]]) -> List[int]:
    """VĐV xuất hiện trong nhiều trận thành phần hơn max_rubbers_per_player (cảnh báo, không chặn)."""
    counts: Dict[int, int] = {}
    for side in sides:
        for tp in set(int(p) for p in (side or [])):
            counts[tp] = counts.get(tp, 0) + 1
    limit = rules.get("max_rubbers_per_player") or 2
    return sorted(tp for tp, c in counts.items() if c > limit)


def lineup_check(rules: Dict, slots: Dict[str, List[int]], gender_by_tp: Dict[int, Optional[str]]) -> Dict:
    """Kiểm tra đội hình theo giai đoạn: {errors, warnings, over_limit}. Slot rỗng = chưa xếp (cho phép)."""
    errors: List[str] = []
    warnings: List[str] = []
    labels = {r["label"]: r["code"] for r in rules["rubbers"]}
    for label, players in (slots or {}).items():
        if label not in labels:
            errors.append(f"Không có trận thành phần '{label}' trong giải")
            continue
        if not players:
            continue
        e, w = rubber_players_check(labels[label], players, gender_by_tp)
        errors += [f"{label}: {x}" for x in e]
        warnings += [f"{label}: {x}" for x in w]
    sides = [v for v in (slots or {}).values() if v]
    return {"errors": errors, "warnings": warnings, "over_limit": over_limit_players(rules, sides)}


def stage_key_for_match(fmt: str, phase: str, round_number: int, first_leg_rounds: int) -> str:
    """Giai đoạn đội hình của một trận: knockout → 'knockout'; vòng tròn 2 lượt và round > số vòng lượt đi → 'leg2'; còn lại 'leg1'."""
    if phase == "knockout":
        return "knockout"
    if fmt == "round_robin_double" and first_leg_rounds and int(round_number or 0) > first_leg_rounds:
        return "leg2"
    return "leg1"


def first_leg_rounds(fmt: str, group_round_numbers: List[int]) -> int:
    """Số vòng của lượt đi (vòng tròn 2 lượt = một nửa số vòng); 0 với thể thức khác."""
    if fmt != "round_robin_double" or not group_round_numbers:
        return 0
    return max(group_round_numbers) // 2


def draw_rubber_order(seed_hex: str, n: int) -> List[int]:
    """Thứ tự trận thành phần tất định từ seed công khai: lượt k lấy chỉ số SHA256(seed:k) mod (số còn lại)
    — cùng công thức với vòng quay bốc thăm (draw_pick_index) để khán giả tự kiểm chứng."""
    remaining = list(range(n))
    order: List[int] = []
    for k in range(n):
        idx = draw_pick_index(seed_hex, k, len(remaining))
        order.append(remaining.pop(idx))
    return order   # order[i] = chỉ số mẫu (0-based) được xếp ở vị trí i
