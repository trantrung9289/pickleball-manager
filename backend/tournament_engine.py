"""Thuật toán sinh lịch thi đấu."""
import random
import math
from typing import List, Optional, Dict, Any


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


def generate_knockout_from_groups(
    group_standings: Dict[str, List[Dict]],
    existing_match_count: int = 0,
) -> List[Dict]:
    """
    Sinh vòng loại từ kết quả đấu bảng (top 2 mỗi bảng).
    Luật ghép: nhất bảng lẻ (A,C,E...) vs nhì bảng chẵn (B,D,F...) và ngược lại.
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

    # A,C,E... index chẵn (bảng lẻ); B,D,F... index lẻ (bảng chẵn)
    odd_groups  = [g for i, g in enumerate(group_letters) if i % 2 == 0]  # A, C, E
    even_groups = [g for i, g in enumerate(group_letters) if i % 2 == 1]  # B, D, F

    ko_players: List[Optional[int]] = []
    pair_count = min(len(odd_groups), len(even_groups))
    for i in range(pair_count):
        og, eg = odd_groups[i], even_groups[i]
        ko_players.append(firsts.get(og))
        ko_players.append(seconds.get(eg))
        ko_players.append(firsts.get(eg))
        ko_players.append(seconds.get(og))

    # Bảng dư (số bảng lẻ)
    for i in range(pair_count, len(odd_groups)):
        og = odd_groups[i]
        ko_players.append(firsts.get(og))
        ko_players.append(seconds.get(og))
    for i in range(pair_count, len(even_groups)):
        eg = even_groups[i]
        ko_players.append(firsts.get(eg))
        ko_players.append(seconds.get(eg))

    ko_players = [p for p in ko_players if p is not None]
    n_ko = len(ko_players)
    if n_ko >= 2 and (n_ko & (n_ko - 1)) == 0:
        # Đủ luỹ thừa 2: giữ nguyên luật ghép nhất bảng lẻ vs nhì bảng chẵn
        raw = _knockout_bracket(ko_players, seeded=False)
    else:
        # Số đội lẻ (vd 3 bảng = 6 đội): seeding nhất bảng trước, nhì bảng theo thứ tự ngược
        # để bye rơi vào các đội nhất bảng và tránh cùng bảng gặp nhau ngay vòng 1
        seeds = [firsts[g] for g in group_letters if firsts.get(g) is not None]
        seeds += [seconds[g] for g in reversed(group_letters) if seconds.get(g) is not None]
        raw = _knockout_bracket(seeds, seeded=True)
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
) -> List[Dict]:
    """
    Tính bảng xếp hạng vòng bảng.
    Điểm: Thắng = 1, Thua = 0 (không tính hòa).
    Tiebreaker: điểm → đối đầu trực tiếp giữa các đội bằng điểm (điểm, hiệu số, ghi được)
                → hiệu số toàn giải → điểm ghi được toàn giải.
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
        }

    for m in matches:
        if m.get("status") != "completed":
            continue
        p1, p2 = m.get("p1_id"), m.get("p2_id")
        s1 = int(m.get("score1") or 0)
        s2 = int(m.get("score2") or 0)
        if p1 not in stats or p2 not in stats:
            continue
        stats[p1]["played"] += 1
        stats[p2]["played"] += 1
        stats[p1]["goals_for"] += s1
        stats[p1]["goals_against"] += s2
        stats[p2]["goals_for"] += s2
        stats[p2]["goals_against"] += s1
        if s1 > s2:
            stats[p1]["won"] += 1
            stats[p1]["points"] += 1
            stats[p2]["lost"] += 1
        elif s2 > s1:
            stats[p2]["won"] += 1
            stats[p2]["points"] += 1
            stats[p1]["lost"] += 1
        # Hòa: không cộng điểm

    rows = list(stats.values())
    for r in rows:
        r["goal_diff"] = r["goals_for"] - r["goals_against"]

    completed_matches = [m for m in matches if m.get("status") == "completed"]

    def head_to_head_key(pid: int, tied_ids: set) -> tuple:
        """Hệ số đối đầu: chỉ tính các trận giữa những đội đang bằng điểm nhau."""
        h_points = h_for = h_against = 0
        for m in completed_matches:
            p1, p2 = m.get("p1_id"), m.get("p2_id")
            if pid not in (p1, p2):
                continue
            other = p2 if p1 == pid else p1
            if other not in tied_ids:
                continue
            s1 = int(m.get("score1") or 0)
            s2 = int(m.get("score2") or 0)
            my_score, opp_score = (s1, s2) if p1 == pid else (s2, s1)
            h_for += my_score
            h_against += opp_score
            if my_score > opp_score:
                h_points += 1
        return (-h_points, -(h_for - h_against), -h_for)

    # Nhóm theo điểm số; trong mỗi nhóm bằng điểm: đối đầu trực tiếp trước,
    # rồi mới tới hiệu số / điểm ghi được toàn giải.
    rows.sort(key=lambda x: (-x["points"], -x["goal_diff"], -x["goals_for"]))
    ordered: List[Dict] = []
    i = 0
    while i < len(rows):
        j = i
        while j < len(rows) and rows[j]["points"] == rows[i]["points"]:
            j += 1
        tied_group = rows[i:j]
        if len(tied_group) > 1:
            tied_ids = {r["participant_id"] for r in tied_group}
            tied_group.sort(key=lambda x: head_to_head_key(x["participant_id"], tied_ids)
                            + (-x["goal_diff"], -x["goals_for"]))
        ordered.extend(tied_group)
        i = j

    for idx, r in enumerate(ordered):
        r["rank"] = idx + 1
    return ordered
