// Hàm thuần cho GIẢI ĐỒNG ĐỘI (team_type="team") — gương của backend/tournament_engine.py
// (RUBBER_CODES, STAGE_LABELS, normalize_team_rules, rubber_target, over_limit_players).
// Không import antd/React để chạy được bằng `node --test src/utils/`.

/** Mã thể thức trận thành phần: tên hiển thị + giới tính kỳ vọng của từng VĐV một bên. */
export const RUBBER_CODES = {
  MD: { name: "Đôi Nam", genders: ["male", "male"] },
  WD: { name: "Đôi Nữ", genders: ["female", "female"] },
  XD: { name: "Đôi Nam Nữ", genders: ["male", "female"] },
  MS: { name: "Đơn Nam", genders: ["male"] },
  WS: { name: "Đơn Nữ", genders: ["female"] },
  FD: { name: "Đôi tự do", genders: ["any", "any"] },   // 2 VĐV bất kỳ giới
};
export const RUBBER_CODE_LIST = ["MD", "WD", "XD", "MS", "WS", "FD"];
export const DEFAULT_RUBBER_CODES = ["MD", "WD", "XD", "MS", "WS"];

export const STAGE_KEYS = ["leg1", "leg2", "knockout"];
export const STAGE_LABELS = { leg1: "Lượt đi / Vòng bảng", leg2: "Lượt về", knockout: "Vòng loại trực tiếp" };

export const GENDER_LABELS = { male: "Nam", female: "Nữ", other: "Khác" };
export const GENDER_OPTIONS = [
  { value: "male", label: "Nam" },
  { value: "female", label: "Nữ" },
  { value: "other", label: "Khác" },
];

export const SCORING_LABELS = {
  match_points: "Tính theo trận thành phần (PA1)",
  cumulative: "Điểm nối tiếp (PA2)",
};
export const RANKING_LABELS = {
  tie_points: "Điểm bảng theo trận đồng đội thắng (điều lệ PA1/PA2)",
  point_diff: "Tổng hiệu số điểm trận thành phần → điểm ghi → đối đầu",
};
export const RANKING_SHORT = { tie_points: "theo trận đồng đội", point_diff: "theo hiệu số điểm" };
export const SCORING_SHORT = { match_points: "PA1 · theo trận", cumulative: "PA2 · nối tiếp" };

export const TEAM_TYPE_LABELS = { singles: "Đấu đơn", doubles: "Đấu đôi", team: "Đồng đội" };

/** Số VĐV mỗi bên của một thể thức (0 nếu mã lạ). */
export const rubberSize = (code) => RUBBER_CODES[code]?.genders.length || 0;
/** Tên thể thức ("Đôi Nam"); mã lạ trả lại chính mã. */
export const rubberName = (code) => RUBBER_CODES[code]?.name || code;

/**
 * Tự đánh số nhãn theo thể thức khi để trống — gương normalize_team_rules: bộ đếm tăng theo MỌI trận cùng mã
 * (kể cả trận có nhãn tự đặt), nhãn trùng được thêm hậu tố " (2)" để làm khoá slot đội hình.
 * Vào: [{code, label?}] (mã lạ bị bỏ) → ra: [{code, label}] mới (không sửa mảng gốc).
 */
export function autoLabelRubbers(rubbers) {
  const counters = {};
  const out = [];
  (rubbers || []).forEach((r) => {
    const code = String(r?.code || "").toUpperCase().trim();
    if (!RUBBER_CODES[code]) return;
    counters[code] = (counters[code] || 0) + 1;
    const label = String(r?.label || "").trim() || `${rubberName(code)} ${counters[code]}`;
    out.push({ code, label });
  });
  const seen = {};
  out.forEach((r) => {
    if (seen[r.label]) { seen[r.label] += 1; r.label = `${r.label} (${seen[r.label]})`; }
    else seen[r.label] = 1;
  });
  return out;
}

/** Nhãn gợi ý (placeholder) cho ô nhãn thứ i khi người dùng để trống — cùng bộ đếm với autoLabelRubbers. */
export function placeholderLabels(rubbers) {
  const counters = {};
  return (rubbers || []).map((r) => {
    const code = String(r?.code || "").toUpperCase().trim();
    if (!RUBBER_CODES[code]) return "";
    counters[code] = (counters[code] || 0) + 1;
    return `${rubberName(code)} ${counters[code]}`;
  });
}

const toInt = (v, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
};

/** Bản mẫu 5 thể thức mặc định (nhãn để trống → tự đánh số). */
export const defaultRubbers = () => DEFAULT_RUBBER_CODES.map((code) => ({ code, label: "" }));

/**
 * Chuẩn hoá team_rules như backend: scoring mặc định match_points; rubbers ≥ 1 (mặc định 5 thể thức);
 * points_per_rubber mặc định 11 (1..99); cumulative: target_total mặc định điểm × số trận (≥ điểm/trận);
 * max_rubbers_per_player mặc định 2; win_by_two / play_all mặc định true. Không có trận nào → ném Error.
 */
export function normalizeTeamRules(raw) {
  const r = raw || {};
  const scoring = r.scoring === "cumulative" ? "cumulative" : "match_points";
  const ranking = r.ranking === "point_diff" ? "point_diff" : "tie_points";   // cách xếp hạng vòng bảng
  const ppr = Math.max(1, Math.min(99, toInt(r.points_per_rubber, 11) || 11));
  const rubbers = autoLabelRubbers(r.rubbers && r.rubbers.length ? r.rubbers : defaultRubbers());
  if (!rubbers.length) throw new Error("Cần ít nhất 1 trận thành phần");
  if (rubbers.length > 20) throw new Error("Tối đa 20 trận thành phần");
  // Vòng loại trực tiếp có thể dùng bộ thể thức riêng (null = dùng chung) và cách kết thúc riêng
  const knockout_rubbers = r.knockout_rubbers && r.knockout_rubbers.length ? autoLabelRubbers(r.knockout_rubbers) : null;
  const knockout_play_all = r.knockout_play_all === undefined || r.knockout_play_all === null ? null : !!r.knockout_play_all;
  const n = rubbers.length;
  let target_total = null;
  if (scoring === "cumulative") {
    target_total = Math.max(ppr, Math.min(toInt(r.target_total, ppr * n) || ppr * n, ppr * n));   // kẹp ≤ ppr×n như backend
  }
  return {
    scoring,
    ranking,
    rubbers,
    points_per_rubber: ppr,
    win_by_two: r.win_by_two === undefined ? true : !!r.win_by_two,
    target_total,
    max_rubbers_per_player: Math.max(1, toInt(r.max_rubbers_per_player, 2) || 2),
    play_all: r.play_all === undefined ? true : !!r.play_all,
    knockout_rubbers,
    knockout_play_all,
    // Sĩ số đội tối đa (ví dụ "8 nam 2 nữ"): null = không giới hạn; chỉ cảnh báo, không chặn — như backend
    max_male: capOrNull(r.max_male),
    max_female: capOrNull(r.max_female),
    max_players: capOrNull(r.max_players),
  };
}
/** Luật áp cho một giai đoạn — gương backend rules_for_stage: knockout có thể có bộ thể thức / play_all riêng. */
export function rulesForStage(rules, stage) {
  if (stage !== "knockout" || !rules) return rules;
  const out = { ...rules };
  if (rules.knockout_rubbers && rules.knockout_rubbers.length) {
    out.rubbers = rules.knockout_rubbers;
    if (rules.scoring === "cumulative") out.target_total = (rules.points_per_rubber || 11) * out.rubbers.length;
  }
  if (rules.knockout_play_all !== null && rules.knockout_play_all !== undefined) out.play_all = !!rules.knockout_play_all;
  return out;
}
/** Giai đoạn "thể thức" của một trận chỉ cần phân biệt loại trực tiếp hay không (leg1/leg2 dùng chung bộ). */
export const stageOfMatch = (match) => (match?.phase === "knockout" ? "knockout" : "leg1");

function capOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Quy tắc khởi tạo cho editor (nhãn để trống để người dùng thấy placeholder tự đánh số). */
export const defaultTeamRules = () => ({
  scoring: "match_points", rubbers: defaultRubbers(), points_per_rubber: 11, win_by_two: true,
  target_total: 11 * 5, max_rubbers_per_player: 2, play_all: true,
});

/** Mốc tổng mặc định của PA2 = điểm/trận × số trận. */
export const defaultTargetTotal = (rules) =>
  (toInt(rules?.points_per_rubber, 11) || 11) * Math.max(1, (rules?.rubbers || []).length || 5);

/** Mốc điểm của trận thành phần thứ `orderIndex` (1-based) — PA2 chặn ở target_total. */
export function rubberTarget(rules, orderIndex) {
  if (rules?.scoring === "cumulative") {
    return Math.min(rules.points_per_rubber * Math.max(1, orderIndex | 0), rules.target_total);
  }
  return rules?.points_per_rubber ?? 11;
}

/** Các giai đoạn đội hình có nghĩa với thể thức giải (gương stage_key_for_match). */
export function stagesForFormat(format) {
  if (format === "knockout") return ["knockout"];
  if (format === "combined") return ["leg1", "knockout"];
  if (format === "round_robin_double") return ["leg1", "leg2"];
  return ["leg1"];
}

/** VĐV xuất hiện ở nhiều trận thành phần hơn max_rubbers_per_player — `sides` là mảng các mảng team_player_id. */
export function overLimitIds(rules, sides) {
  const counts = new Map();
  (sides || []).forEach((side) => {
    new Set((side || []).map(Number)).forEach((tp) => counts.set(tp, (counts.get(tp) || 0) + 1));
  });
  const limit = rules?.max_rubbers_per_player || 2;
  return [...counts.entries()].filter(([, c]) => c > limit).map(([tp]) => tp).sort((a, b) => a - b);
}

/** Số lần một VĐV được xếp (đếm mỗi trận thành phần 1 lần). */
export function appearanceCounts(sides) {
  const counts = {};
  (sides || []).forEach((side) => {
    new Set((side || []).map(Number)).forEach((tp) => { counts[tp] = (counts[tp] || 0) + 1; });
  });
  return counts;
}

/**
 * Kiểm tra giới tính một bên so với thể thức (gương rubber_players_check, phần cảnh báo):
 * trả "unknown" (có người chưa khai), "mismatch" (đủ người nhưng lệch thể thức) hoặc null.
 */
export function genderIssue(code, genders) {
  const expected = RUBBER_CODES[code]?.genders;
  if (expected?.includes("any")) return "";   // Đôi tự do: không ràng buộc giới tính
  if (!expected || !genders || genders.length !== expected.length) return null;
  if (genders.some((g) => g !== "male" && g !== "female")) return "unknown";
  const a = [...genders].sort().join(","), b = [...expected].sort().join(",");
  return a === b ? null : "mismatch";
}

/** Dòng cảnh báo giới tính của một slot (tiếng Việt) từ danh sách team_player_id và bản đồ id → VĐV; null = ổn. */
export function slotIssueText(code, ids, playerById) {
  const issue = genderIssue(code, (ids || []).map((id) => (playerById || {})[id]?.gender));
  if (issue === "mismatch") return "Giới tính VĐV không khớp thể thức";
  if (issue === "unknown") return "Có VĐV chưa khai giới tính";
  return null;
}

/** Giới tính "nên có" của một thể thức để lọc gợi ý: MD/MS → nam, WD/WS → nữ, XD → cả hai. */
export function preferredGenders(code) {
  return [...new Set((RUBBER_CODES[code]?.genders || []).filter((g) => g !== "any"))];
}

/**
 * Số VĐV nam/nữ tối thiểu một đội cần có để xếp đủ mọi trận thành phần (mỗi người tối đa
 * max_rubbers_per_player trận): ceil(tổng suất theo giới / giới hạn).
 */
export function teamGenderNeeds(rules) {
  const limit = Math.max(1, rules?.max_rubbers_per_player || 2);
  let male = 0, female = 0;
  (rules?.rubbers || []).forEach((r) => {
    (RUBBER_CODES[r.code]?.genders || []).forEach((g) => { if (g === "male") male += 1; else if (g === "female") female += 1; });
  });
  return { male: Math.ceil(male / limit), female: Math.ceil(female / limit) };
}

/** Đếm giới tính VĐV của đội: {male, female, unknown}. */
export function countGenders(players) {
  const c = { male: 0, female: 0, unknown: 0 };
  (players || []).forEach((p) => {
    if (p.gender === "male") c.male += 1;
    else if (p.gender === "female") c.female += 1;
    else c.unknown += 1;
  });
  return c;
}

/** Cảnh báo thiếu VĐV theo giới của một đội so với quy tắc (mảng chuỗi tiếng Việt, rỗng = đủ). */
export function teamRosterWarnings(rules, players) {
  const need = teamGenderNeeds(rules);
  const have = countGenders(players);
  const out = [];
  if (have.male < need.male) out.push(`Thiếu VĐV Nam: cần tối thiểu ${need.male}, hiện có ${have.male}`);
  if (have.female < need.female) out.push(`Thiếu VĐV Nữ: cần tối thiểu ${need.female}, hiện có ${have.female}`);
  if (have.unknown > 0) out.push(`${have.unknown} VĐV chưa khai giới tính`);
  // Sĩ số tối đa theo luật giải (null = không giới hạn)
  if (rules?.max_male && have.male > rules.max_male) out.push(`Vượt sĩ số Nam: tối đa ${rules.max_male}, hiện có ${have.male}`);
  if (rules?.max_female && have.female > rules.max_female) out.push(`Vượt sĩ số Nữ: tối đa ${rules.max_female}, hiện có ${have.female}`);
  const total = (players || []).length;
  if (rules?.max_players && total > rules.max_players) out.push(`Vượt sĩ số đội: tối đa ${rules.max_players}, hiện có ${total}`);
  return out;
}

/** Chữ sĩ số đội: "3 VĐV · 2/8 Nam · 1/2 Nữ" (có trần) hoặc "3 VĐV · 2 Nam · 1 Nữ" (không trần). */
export function rosterCountText(rules, players) {
  const g = countGenders(players);
  const n = (players || []).length;
  const part = (have, cap, label) => (cap ? `${have}/${cap} ${label}` : `${have} ${label}`);
  const head = rules?.max_players ? `${n}/${rules.max_players} VĐV` : `${n} VĐV`;
  return `${head} · ${part(g.male, rules?.max_male, "Nam")} · ${part(g.female, rules?.max_female, "Nữ")}${g.unknown ? ` · ${g.unknown} chưa khai` : ""}`;
}

/**
 * Chữ tỉ số tổng của trận đồng đội cho lịch/bảng/nhánh: hoàn thành → "3 – 2"; chưa xong nhưng đã có điểm
 * → {text:"1 – 0", live:true}; chưa đấu → "–".
 */
export function tieScoreLabel(match) {
  if (!match) return { text: "–", live: false };
  const s1 = match.score1 ?? 0, s2 = match.score2 ?? 0;
  if (match.status === "completed") return { text: `${s1} – ${s2}`, live: false };
  if (s1 > 0 || s2 > 0) return { text: `${s1} – ${s2}`, live: true };
  return { text: "–", live: false };
}

/** Bản đồ team_player_id → VĐV từ TeamOut (hoặc nhiều TeamOut). */
export function playerIndex(...teams) {
  const idx = {};
  teams.forEach((t) => (t?.players || []).forEach((p) => { idx[p.id] = p; }));
  return idx;
}

/** Nhãn ngắn trạng thái trận thành phần. */
export function rubberStatusLabel(rubber, tieFinished) {
  if (rubber.status === "completed") return rubber.is_walkover ? "Xử thua" : "Hoàn thành";
  return tieFinished ? "Không cần đấu" : "Chưa đấu";
}

/** Bản đồ id → VĐV từ danh sách phẳng (TournamentOut.team_players). */
export function indexTeamPlayers(list) {
  const idx = {};
  (list || []).forEach((p) => { idx[p.id] = p; });
  return idx;
}

/**
 * Trận thành phần để hiển thị chi tiết ở lịch/nhánh: có biên bản (match.rubbers) thì dùng; chưa có
 * (chưa mở biên bản) thì trả mẫu theo team_rules (chưa xếp VĐV, chưa bốc thứ tự) kèm cờ `template`.
 */
export function matchRubbersForDisplay(match, rules) {
  const real = match?.rubbers || [];
  if (real.length) return { rubbers: [...real].sort((a, b) => a.order_index - b.order_index), template: false };
  const n = rulesForStage(normalizeTeamRules(rules), stageOfMatch(match));
  return {
    template: true,
    rubbers: n.rubbers.map((r, i) => ({
      id: `t${i}`, order_index: i + 1, code: r.code, label: r.label, side1_players: [], side2_players: [],
      score1: null, score2: null, status: "pending", is_walkover: false, start1: 0, start2: 0,
    })),
  };
}

/**
 * Tỉ số một trận thành phần: PA1 "11 – 7"; PA2 (nối tiếp) "26 – 18" kèm điểm riêng trận "(+11 / +7)";
 * chưa đấu → null. Bên thắng: 1 | 2 | null.
 */
export function rubberScoreView(rubber, rules) {
  if (!rubber || rubber.status !== "completed" || rubber.score1 == null || rubber.score2 == null) {
    return { text: null, own: null, winner: null };
  }
  const s1 = rubber.score1, s2 = rubber.score2;
  const cumulative = rules?.scoring === "cumulative";
  const o1 = s1 - (rubber.start1 || 0), o2 = s2 - (rubber.start2 || 0);
  const winner = cumulative ? (o1 > o2 ? 1 : o2 > o1 ? 2 : null) : (s1 > s2 ? 1 : s2 > s1 ? 2 : null);
  return { text: `${s1} – ${s2}`, own: cumulative ? `${o1} / ${o2}` : null, winner };
}

/**
 * Bảng phân đội thủ công — "Chia đều": lần lượt gán mỗi VĐV đã chọn cho đội đang ÍT người nhất
 * (hoà → đội đứng trước trong danh sách). teams: TeamOut[] ({participant:{id}, players:[]}).
 * Trả về [{tpid, participant_id}] cho POST /team-players/assign.
 */
export function distributeEvenly(tpids, teams) {
  const sizes = (teams || []).map((t) => ({ pid: t.participant.id, n: (t.players || []).length }));
  if (!sizes.length) return [];
  const out = [];
  (tpids || []).forEach((tpid) => {
    let best = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i].n < sizes[best].n) best = i;
    sizes[best].n += 1;
    out.push({ tpid, participant_id: sizes[best].pid });
  });
  return out;
}

/**
 * Tổng số TRẬN THÀNH PHẦN của giải đồng đội (thống kê đầu trang / nhãn tab / tiêu đề bản in).
 * - Trận chưa kết thúc: đếm số trận thành phần đã có (biên bản đã mở) hoặc số trận theo thể thức (chưa mở biên bản).
 * - Trận đã kết thúc: chỉ đếm trận thành phần đã đấu (PA2 chạm mốc sớm → các trận còn lại không đấu, không tính "còn lại").
 * - Xử thua do bỏ giải (is_walkover): không có trận thành phần → 0.
 * Trả { total, done, remaining, perTie }.
 */
export function rubberTotals(matches, rules) {
  const perTie = (rules?.rubbers || []).length;
  const perTieKo = (rules?.knockout_rubbers?.length ? rules.knockout_rubbers : rules?.rubbers || []).length;
  let total = 0;
  let done = 0;
  (matches || []).forEach((m) => {
    if (m.is_walkover) return;
    const rs = m.rubbers || [];
    const d = rs.filter((r) => r.status === "completed").length;
    done += d;
    const tpl = m.phase === "knockout" ? perTieKo : perTie;
    total += m.status === "completed" ? d : Math.max(rs.length, tpl);
  });
  return { total, done, remaining: total - done, perTie };
}
