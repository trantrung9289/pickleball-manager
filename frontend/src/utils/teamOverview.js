// Hàm thuần cho TỔNG QUAN / THỐNG KÊ giải đồng đội (đợt 1 áp dụng mẫu FIS 2026-10-26).
// Không import antd/React để chạy được bằng `node --test src/utils/`. Chỉ đọc dữ liệu đã có trong
// TournamentOut / PublicTournamentOut (matches[].rubbers, participants, team_players) — không cần API mới.
import { rubberTotals } from "./teamFormat.js";

export const teamName = (p) => p?.team_name || p?.member?.full_name || p?.player?.name || "—";

const matchOrder = (a, b) =>
  Number(a.phase === "knockout") - Number(b.phase === "knockout")
  || (a.group_name || "").localeCompare(b.group_name || "")
  || (a.round_number || 0) - (b.round_number || 0)
  || (a.match_number || 0) - (b.match_number || 0);

/** Tiến độ trận đồng đội: chỉ tính trận đã đủ 2 đội; `pending` = chưa kết thúc (bỏ xử thua), sắp theo bảng/vòng. */
export function tieProgress(matches) {
  const real = (matches || []).filter((m) => m.p1_id && m.p2_id);
  const done = real.filter((m) => m.status === "completed").length;
  const pending = real.filter((m) => m.status !== "completed" && !m.is_walkover).sort(matchOrder);
  return { total: real.length, done, pending };
}

/** Điểm nhỏ hai bên của một trận thành phần (PA2: trừ điểm xuất phát để ra điểm ghi trong trận đó). */
export function rubberPoints(r, rules) {
  const s1 = r?.score1 ?? 0;
  const s2 = r?.score2 ?? 0;
  if (rules?.scoring === "cumulative") return [s1 - (r?.start1 || 0), s2 - (r?.start2 || 0)];
  return [s1, s2];
}

/**
 * Thống kê TOÀN GIẢI (mọi giai đoạn) cho từng đội: trận đồng đội đã đấu/thắng, trận thành phần thắng/thua,
 * điểm ghi/mất, hiệu số. Trận xử thua tính thắng/thua trận đồng đội, không có trận thành phần.
 * Sắp: bảng → trận ĐĐ thắng → HS trận TP → HS điểm → điểm ghi.
 */
export function teamAllStageStats(matches, participants, rules) {
  const rows = {};
  (participants || []).forEach((p) => {
    rows[p.id] = {
      participant_id: p.id, team_name: teamName(p), group_name: p.group_name || null, status: p.status,
      ties_played: 0, ties_won: 0, rubbers_won: 0, rubbers_lost: 0, pts_for: 0, pts_against: 0,
    };
  });
  (matches || []).forEach((m) => {
    if (m.status !== "completed" || !m.p1_id || !m.p2_id) return;
    const a = rows[m.p1_id]; const b = rows[m.p2_id];
    if (!a || !b) return;
    a.ties_played += 1; b.ties_played += 1;
    if (m.winner_id === m.p1_id) a.ties_won += 1;
    else if (m.winner_id === m.p2_id) b.ties_won += 1;
    (m.rubbers || []).forEach((r) => {
      if (r.status !== "completed") return;
      const [x, y] = rubberPoints(r, rules);
      if (x > y) { a.rubbers_won += 1; b.rubbers_lost += 1; } else if (y > x) { b.rubbers_won += 1; a.rubbers_lost += 1; }
      a.pts_for += x; a.pts_against += y; b.pts_for += y; b.pts_against += x;
    });
  });
  return Object.values(rows)
    .map((r) => ({ ...r, diff: r.pts_for - r.pts_against, rubber_diff: r.rubbers_won - r.rubbers_lost }))
    .sort((a, b) => (a.group_name || "").localeCompare(b.group_name || "")
      || b.ties_won - a.ties_won || b.rubber_diff - a.rubber_diff || b.diff - a.diff || b.pts_for - a.pts_for);
}

/** Xếp hạng chung cuộc từ vòng loại trực tiếp: Chung kết → 1-2, Tranh giải 3 → 3-4. Không có → null. */
export function finalPlacements(matches) {
  const ko = (matches || []).filter((m) => m.phase === "knockout");
  if (!ko.length) return null;
  const third = ko.find((m) => m.round_name === "Tranh giải 3") || null;
  const main = ko.filter((m) => m !== third);
  if (!main.length) return null;
  const maxRound = Math.max(...main.map((m) => m.round_number || 0));
  const finals = main.filter((m) => (m.round_number || 0) === maxRound);
  const final = finals.length === 1 ? finals[0] : null;
  const loser = (m) => (m.winner_id === m.p1_id ? m.p2_id : m.p1_id);
  const out = [];
  if (final?.status === "completed" && final.winner_id) {
    out.push({ rank: 1, label: "Vô địch", pid: final.winner_id });
    out.push({ rank: 2, label: "Á quân", pid: loser(final) });
  }
  if (third?.status === "completed" && third.winner_id) {
    out.push({ rank: 3, label: "Hạng Ba", pid: third.winner_id });
    out.push({ rank: 4, label: "Hạng Tư", pid: loser(third) });
  }
  return out.length ? out : null;
}

/** Số trận (vòng bảng) của một đội trong bảng: đã đấu / tổng — cột "Lượt đủ" kiểu FIS. */
export function teamRoundsPlayed(matches, pid) {
  const mine = (matches || []).filter((m) => m.phase !== "knockout" && (m.p1_id === pid || m.p2_id === pid) && m.p1_id && m.p2_id);
  return { played: mine.filter((m) => m.status === "completed").length, total: mine.length };
}

const FORMAT_TEXT = {
  round_robin: "vòng tròn một lượt", round_robin_double: "vòng tròn hai lượt", knockout: "loại trực tiếp",
  combined: "vòng bảng rồi loại trực tiếp", individual: "thi đấu riêng lẻ",
};

/** Tóm tắt thể thức bằng lời (danh sách dòng) để in ở Tổng quan — sinh từ team_rules + thể thức giải. */
export function teamRuleSummary(tournament, rules) {
  const parts = (tournament?.participants || []).filter((p) => p.status !== "withdrawn");
  const groups = [...new Set(parts.map((p) => p.group_name).filter(Boolean))].sort();
  const lines = [];
  let head = `${parts.length} đội, thi đấu ${FORMAT_TEXT[tournament?.format] || tournament?.format || ""}`;
  if (groups.length) {
    const sizes = groups.map((g) => `${g}: ${parts.filter((p) => p.group_name === g).length} đội`);
    head += ` — ${groups.length} bảng (${sizes.join(", ")})`;
  }
  lines.push(head + ".");
  const rubbers = rules?.rubbers || [];
  lines.push(`Mỗi trận đồng đội gồm ${rubbers.length} trận thành phần: ${rubbers.map((r) => r.label).join(", ")}.`);
  if (rules?.scoring === "cumulative") {
    lines.push(`Tính điểm cộng dồn (PA2): mỗi trận thành phần ${rules.points_per_rubber} điểm${rules.win_by_two ? ", cách biệt 2" : ""}; `
      + `đội chạm mốc tổng ${rules.target_total} điểm trước thắng trận đồng đội, các trận còn lại không cần đấu.`);
    lines.push("Xếp hạng: điểm bảng (1 điểm/trận đồng đội thắng) → hiệu số tổng điểm tích luỹ → đối đầu trực tiếp → bốc thăm.");
  } else {
    lines.push(`Mỗi trận thành phần chạm ${rules?.points_per_rubber ?? 11} điểm${rules?.win_by_two ? ", cách biệt 2" : ", không cần cách biệt"}; `
      + `${rules?.play_all ? "đánh hết các trận thành phần" : "dừng khi một đội thắng quá nửa số trận"}.`);
    lines.push("Đội thắng nhiều trận thành phần hơn thắng trận đồng đội; hoà số trận → hiệu số điểm → đội thắng trận thành phần cuối.");
    lines.push("Xếp hạng: điểm bảng (1 điểm/trận đồng đội thắng) → đối đầu trực tiếp → hiệu số trận thành phần → hiệu số điểm → bốc thăm.");
  }
  lines.push(`Mỗi VĐV tối đa ${rules?.max_rubbers_per_player ?? 2} trận thành phần trong một trận đồng đội (quá giới hạn chỉ cảnh báo).`);
  lines.push("Trận xử thua do đội bỏ giải: tính thắng/thua, không tính hiệu số.");
  return lines;
}

/** Gói số liệu đầu trang Tổng quan: trận ĐĐ, trận TP, VĐV. */
export function teamOverviewCounts(tournament, rules) {
  const matches = tournament?.matches || [];
  const ties = tieProgress(matches);
  const rubbers = rubberTotals(matches, rules);
  const players = tournament?.team_players || [];
  const assigned = players.filter((p) => p.participant_id != null).length;
  return {
    ties, rubbers,
    players: { total: players.length, assigned, pool: players.length - assigned },
    teams: (tournament?.participants || []).filter((p) => p.status !== "withdrawn").length,
  };
}
