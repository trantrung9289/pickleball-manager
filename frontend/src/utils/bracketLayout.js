// Tính hình học sơ đồ nhánh (bracket) cho bảng in thi đấu.
// Tách riêng khỏi component để test được thuần logic, không phụ thuộc React/DOM.

/** Thứ tự hạt giống chuẩn cho bracket kích thước `size` (giống backend tournament_engine.py:_seed_order). */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const m = order.length * 2;
    order = order.flatMap((s) => [s, m + 1 - s]);
  }
  return order;
}

/**
 * Xếp các suất từ vòng bảng vào ô sơ đồ loại trực tiếp — BẢN GƯƠNG của
 * backend/tournament_engine.py:knockout_layout_from_groups (sửa một bên phải sửa cả hai; pytest
 * test_batch15 chạy node đối chiếu từng ô). Dùng để vẽ "sơ đồ dự kiến" khi vòng loại trực tiếp
 * CHƯA được sinh (thể thức kết hợp còn đang đấu vòng bảng).
 *
 * Luật ghép cặp: khối 2 bảng (A,B), (C,D), (E,F)... — Nhất X gặp Nhì Y, Nhất Y gặp Nhì X, 2 trận kề nhau.
 * Thiếu suất so với luỹ thừa 2 → bye ưu tiên nhất bảng theo chữ cái; đội mất đối thủ thành đội tự do,
 * ghép chéo bảng; đội bye được đặt cạnh trận không có đội cùng bảng; khối mà cả 4 suất đều bye vẫn áp
 * luật ở vòng 2 (4 ô bye liền nhau 1X, 2Y, 1Y, 2X).
 * Tiền đề: tên bảng là chữ cái A–P do hệ thống gán (so sánh chuỗi JS/Python giống nhau); một suất chỉ
 * thuộc một bảng (trùng → throw). Đảm bảo "không gặp cùng bảng" chỉ chắc chắn khi mọi bảng đủ 2 suất.
 *
 * Trả về mảng độ dài luỹ thừa 2 theo thứ tự hiển thị (ô 2i, 2i+1 = 1 trận vòng đầu), null = bye.
 */
export function knockoutLayoutFromGroups(groupLetters, firsts, seconds) {
  const letters = [...groupLetters].sort();
  const groupOf = new Map();
  const isFirst = new Map();
  const teams = [];
  letters.forEach((g) => {
    [[firsts[g], true], [seconds[g], false]].forEach(([pid, first]) => {
      if (pid == null) return;
      if (groupOf.has(pid)) throw new Error(`Suất ${pid} xuất hiện ở 2 vị trí (bảng ${groupOf.get(pid)} và ${g})`);
      groupOf.set(pid, g);
      isFirst.set(pid, first);
      teams.push(pid);
    });
  });
  const n = teams.length;
  if (n < 2) return [...teams];
  let size = 1;
  while (size < n) size *= 2;
  const byesNeeded = size - n;

  // 1) Bye: nhất bảng theo chữ cái, rồi nhì bảng theo thứ tự ngược
  const byeOrder = letters.filter((g) => firsts[g] != null).map((g) => firsts[g])
    .concat([...letters].reverse().filter((g) => seconds[g] != null).map((g) => seconds[g]));
  const byes = byeOrder.slice(0, byesNeeded);

  const build = (byes) => {
    const byeSet = new Set(byes);
    const playable = (pid) => pid != null && !byeSet.has(pid);

    // 2) Khối 2 bảng
    const intact = [];
    const partial = [];
    const free = [];
    for (let i = 0; i < letters.length; i += 2) {
      const block = letters.slice(i, i + 2);
      if (block.length === 2) {
        const [x, y] = block;
        const made = [];
        [[firsts[x], seconds[y]], [firsts[y], seconds[x]]].forEach(([a, b]) => {
          if (playable(a) && playable(b)) made.push([a, b]);
          else {
            if (playable(a)) free.push(a);
            if (playable(b)) free.push(b);
          }
        });
        (made.length === 2 ? intact : partial).push(...made);
      } else {
        [firsts[block[0]], seconds[block[0]]].forEach((pid) => { if (playable(pid)) free.push(pid); });
      }
    }

    // 3) Đội tự do: sắp theo bảng (nhất trước nhì), ghép i với i + len/2
    free.sort((p, q) => {
      const gp = groupOf.get(p), gq = groupOf.get(q);
      if (gp !== gq) return gp < gq ? -1 : 1;
      return (isFirst.get(p) ? 0 : 1) - (isFirst.get(q) ? 0 : 1);
    });
    const half = Math.floor(free.length / 2);
    const freeMatches = [];
    for (let i = 0; i < half; i++) freeMatches.push([free[i], free[i + half]]);

    // 4) Xếp ô
    const otherGroup = (pid, m) => m.every((q) => groupOf.get(q) !== groupOf.get(pid));
    const slots = [];
    const remByes = [...byes];
    const remFree = [...freeMatches];
    const remPartial = [...partial];

    // 4a) Khối (X,Y) mà cả 4 suất đều bye → đặt trước [1X,—,2Y,—,1Y,—,2X,—] (gương backend)
    for (let i = 0; i + 1 < letters.length; i += 2) {
      const x = letters[i], y = letters[i + 1];
      const quad = [firsts[x], seconds[y], firsts[y], seconds[x]];
      if (quad.every((q) => q != null && byeSet.has(q))) {
        quad.forEach((q) => { remByes.splice(remByes.indexOf(q), 1); slots.push(q, null); });
      }
    }
    const pickBye = (excludeGroup) => {
      let best = null, bestKey = null;
      remByes.forEach((o, k) => {
        const g = groupOf.get(o);
        if (g === excludeGroup) return;
        const key = [remByes.filter((q) => groupOf.get(q) === g).length, -k];
        if (bestKey === null || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
          best = o; bestKey = key;
        }
      });
      return best;
    };
    while (remByes.length) {
      const b = pickBye(null);
      remByes.splice(remByes.indexOf(b), 1);
      let idx = remFree.findIndex((m) => otherGroup(b, m));
      if (idx >= 0) { slots.push(b, null, ...remFree.splice(idx, 1)[0]); continue; }
      const o = pickBye(groupOf.get(b));
      if (o != null) { remByes.splice(remByes.indexOf(o), 1); slots.push(b, null, o, null); continue; }
      idx = remPartial.findIndex((m) => otherGroup(b, m));
      if (idx >= 0) { slots.push(b, null, ...remPartial.splice(idx, 1)[0]); continue; }
      slots.push(b, null);
    }
    remFree.forEach((m) => slots.push(...m));
    remPartial.forEach((m) => slots.push(...m));
    intact.forEach((m) => slots.push(...m));
    if (slots.length !== size) throw new Error(`Xếp nhánh lỗi: ${slots.length} ô ≠ ${size}`);
    return slots;
  };

  const sameGroupR1 = (slots) => {
    const clash = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i], b = slots[i + 1];
      if (a != null && b != null && groupOf.get(a) === groupOf.get(b)) clash.push(a, b);
    }
    return clash;
  };

  let slots = build(byes);
  // Bảng thiếu đội: thử đổi suất bye cho một đội trong cặp cùng bảng (ưu tiên nhất bảng) — gương backend
  const clash = n > 2 ? sameGroupR1(slots) : [];
  if (clash.length) {
    const candidates = [...new Set(clash)].sort((p, q) => {
      const kp = isFirst.get(p) ? 0 : 1, kq = isFirst.get(q) ? 0 : 1;
      if (kp !== kq) return kp - kq;
      const gp = groupOf.get(p), gq = groupOf.get(q);
      return gp === gq ? 0 : (gp < gq ? -1 : 1);
    });
    for (let bi = 0; bi < byes.length; bi++) {
      for (const f of candidates) {
        const alt = [...byes.slice(0, bi), f, ...byes.slice(bi + 1)];
        const altSlots = build(alt);
        if (!sameGroupR1(altSlots).length) return altSlots;
      }
    }
  }
  return slots;
}

/**
 * Ô sơ đồ DỰ KIẾN với nhãn văn bản ("Nhất bảng A", "Nhì bảng B"...).
 * groups: [{ name, size }] — size = số đội trong bảng (≥1 có Nhất, ≥2 có Nhì); hoặc mảng tên bảng (coi như đủ 2 đội).
 */
export function projectedKnockoutSlots(groups) {
  const items = groups.map((g) => (typeof g === "string" ? { name: g, size: 2 } : g));
  const letters = items.map((g) => g.name);
  const firsts = {}, seconds = {};
  items.forEach((g) => {
    firsts[g.name] = g.size >= 1 ? `Nhất bảng ${g.name}` : null;
    seconds[g.name] = g.size >= 2 ? `Nhì bảng ${g.name}` : null;
  });
  return knockoutLayoutFromGroups(letters, firsts, seconds);
}

/** Tên vòng theo số vòng còn lại — giống backend tournament_engine.py:_round_name. */
export function roundNameFromEnd(roundIndexFromEnd) {
  if (roundIndexFromEnd === 0) return "Chung kết";
  if (roundIndexFromEnd === 1) return "Bán kết";
  if (roundIndexFromEnd === 2) return "Tứ kết";
  return null; // gọi nơi dùng tự ghép "Vòng N" theo index thật
}

/**
 * Cây vòng đấu THUẦN từ dữ liệu trận thật của hệ thống (đã sinh lịch).
 * Trả về mảng theo vòng, mỗi vòng là mảng node {id, feederIds, match}.
 * feederIds = id 2 trận vòng trước dẫn thắng vào đây (qua next_match_id), null nếu là vòng đầu.
 */
export function buildRealBracketNodes(matches) {
  // Trận "Tranh giải 3" không đi theo đường THẮNG (next_match_id) như cây chính — nó được
  // 2 trận bán kết trỏ tới qua loser_next_match_id (đường THUA riêng). Tách ra, vẽ như một
  // ô độc lập cạnh "Vô địch" (xem findThirdPlaceMatch) thay vì lẫn vào hình học cây chính.
  const main = matches.filter((m) => m.round_name !== "Tranh giải 3");

  const byRound = {};
  main.forEach((m) => {
    (byRound[m.round_number] = byRound[m.round_number] || []).push(m);
  });
  const roundNumbers = Object.keys(byRound).map(Number).sort((a, b) => a - b);

  const feedersByNextId = {};
  main.forEach((m) => {
    if (m.next_match_id) {
      (feedersByNextId[m.next_match_id] = feedersByNextId[m.next_match_id] || []).push(m);
    }
  });

  return roundNumbers.map((rn) =>
    byRound[rn]
      .slice()
      .sort((a, b) => a.match_number - b.match_number)
      .map((m) => ({
        id: m.id,
        feederIds: (feedersByNextId[m.id] || []).map((f) => f.id),
        feeders: feedersByNextId[m.id] || [],
        match: m,
      }))
  );
}

/** Trận tranh giải 3 (nếu có) + 2 trận bán kết đã "thua" vào đây, để hiển thị tên/điểm. */
export function findThirdPlaceMatch(matches) {
  const third = matches.find((m) => m.round_name === "Tranh giải 3");
  if (!third) return null;
  const feeders = matches.filter((m) => m.loser_next_match_id === third.id);
  return { match: third, feeders };
}

/**
 * Cây vòng đấu DỰ KIẾN (khi vòng loại trực tiếp chưa được sinh, ví dụ thể thức "combined"
 * còn đang đấu vòng bảng) — chỉ có nhãn văn bản ("Nhất bảng A"...), không có id trận thật.
 * Bye (ô null ở vòng đầu) tự động phân giải lên các vòng sau ngay tại đây.
 */
export function buildProjectedBracketNodes(slots) {
  // slots: mảng ô ĐÃ XẾP theo thứ tự hiển thị (projectedKnockoutSlots), độ dài luỹ thừa 2, null = bye.
  // Trước đây hàm này nhận danh sách đã ghép cặp rồi lại áp seedOrder lên → vẽ sai (Nhất A gặp Nhì A).
  const size = slots.length;
  if (size < 2) return [];
  const round0 = [];
  for (let i = 0; i < size; i += 2) {
    round0.push({
      id: `r0-${i / 2}`,
      feederIds: null,
      top: slots[i] ?? null,
      bottom: slots[i + 1] ?? null,
    });
  }
  const rounds = [round0];
  let prev = round0;
  let roundIdx = 1;
  while (prev.length > 1) {
    const cur = [];
    for (let i = 0; i < prev.length; i += 2) {
      cur.push({ id: `r${roundIdx}-${i / 2}`, feederIds: [prev[i].id, prev[i + 1].id], top: null, bottom: null });
    }
    rounds.push(cur);
    prev = cur;
    roundIdx += 1;
  }

  // Phân giải bye: 1 trận vòng đầu chỉ có 1 nhãn → nhãn đó coi như "thắng" luôn, truyền lên
  // vòng sau nếu vòng sau cũng chỉ có 1 nguồn đã biết (giống _advance_byes ở backend).
  const resolved = {};
  round0.forEach((node) => {
    if (node.top && !node.bottom) resolved[node.id] = node.top;
    else if (node.bottom && !node.top) resolved[node.id] = node.bottom;
    else resolved[node.id] = null;
  });
  for (let r = 1; r < rounds.length; r++) {
    rounds[r].forEach((node) => {
      const [a, b] = node.feederIds;
      const la = resolved[a], lb = resolved[b];
      // Vòng >0 luôn cần 2 đối thủ thật để đấu — chỉ "để trống chờ" khi 1 bên chưa xác định,
      // không tự động coi là bye (bye chỉ xảy ra ở vòng đầu theo đúng cấu trúc bracket).
      resolved[node.id] = la && lb ? null : null;
      node.top = la || null;
      node.bottom = lb || null;
    });
  }
  return rounds;
}

/**
 * Tính toạ độ tâm trục dọc (y) cho từng node dựa trên quan hệ feederIds — vòng đầu chia đều
 * theo baseSpacing, vòng sau lấy trung bình cộng tâm 2 trận nguồn (đúng hình học bracket chuẩn).
 */
export function computeBracketGeometry(roundsNodes, { boxHeight = 60, minGap = 30 } = {}) {
  const centers = {};
  const baseSpacing = Math.max(boxHeight + minGap, 100);
  (roundsNodes[0] || []).forEach((node, i) => {
    centers[node.id] = i * baseSpacing + baseSpacing / 2;
  });
  for (let r = 1; r < roundsNodes.length; r++) {
    roundsNodes[r].forEach((node) => {
      const feeders = (node.feederIds || []).map((id) => centers[id]).filter((v) => v != null);
      centers[node.id] = feeders.length
        ? feeders.reduce((a, b) => a + b, 0) / feeders.length
        : baseSpacing / 2;
    });
  }
  const allCenters = Object.values(centers);
  const totalHeight = (allCenters.length ? Math.max(...allCenters) : 0) + baseSpacing / 2;
  return { centers, totalHeight, baseSpacing };
}
