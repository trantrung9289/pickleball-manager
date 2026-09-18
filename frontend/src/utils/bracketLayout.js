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
 * Danh sách nhãn theo ĐÚNG thứ tự ghép cặp vòng loại từ vòng bảng — bảng lẻ (A,C,E..)
 * ghép Nhất với Nhì bảng chẵn (B,D,F..) và ngược lại; bảng dư (số bảng lẻ) ghép Nhất-Nhì
 * trong cùng bảng. Giống hệt generate_knockout_from_groups ở backend/tournament_engine.py —
 * dùng để vẽ "sơ đồ dự kiến" khi vòng loại trực tiếp CHƯA được sinh trong hệ thống.
 */
export function projectedQualifierLabels(groupNames) {
  const sorted = [...groupNames].sort();
  const oddGroups = sorted.filter((_, i) => i % 2 === 0); // A, C, E...
  const evenGroups = sorted.filter((_, i) => i % 2 === 1); // B, D, F...
  const labels = [];
  const pairCount = Math.min(oddGroups.length, evenGroups.length);
  for (let i = 0; i < pairCount; i++) {
    const og = oddGroups[i], eg = evenGroups[i];
    labels.push(`Nhất bảng ${og}`, `Nhì bảng ${eg}`, `Nhất bảng ${eg}`, `Nhì bảng ${og}`);
  }
  for (let i = pairCount; i < oddGroups.length; i++) {
    labels.push(`Nhất bảng ${oddGroups[i]}`, `Nhì bảng ${oddGroups[i]}`);
  }
  for (let i = pairCount; i < evenGroups.length; i++) {
    labels.push(`Nhất bảng ${evenGroups[i]}`, `Nhì bảng ${evenGroups[i]}`);
  }
  return labels;
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
 * Bye (số đội lẻ so với luỹ thừa 2) tự động phân giải lên các vòng sau ngay tại đây.
 */
export function buildProjectedBracketNodes(labels) {
  const n = labels.length;
  if (n < 2) return [];
  let size = 1;
  while (size < n) size *= 2;
  const order = seedOrder(size);
  const seedToLabel = (seed) => (seed <= n ? labels[seed - 1] : null); // null = bye

  const round0 = [];
  for (let i = 0; i < size; i += 2) {
    round0.push({
      id: `r0-${i / 2}`,
      feederIds: null,
      top: seedToLabel(order[i]),
      bottom: seedToLabel(order[i + 1]),
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
