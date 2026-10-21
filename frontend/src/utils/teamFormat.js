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
};
export const RUBBER_CODE_LIST = ["MD", "WD", "XD", "MS", "WS"];

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
export const defaultRubbers = () => RUBBER_CODE_LIST.map((code) => ({ code, label: "" }));

/**
 * Chuẩn hoá team_rules như backend: scoring mặc định match_points; rubbers ≥ 1 (mặc định 5 thể thức);
 * points_per_rubber mặc định 11 (1..99); cumulative: target_total mặc định điểm × số trận (≥ điểm/trận);
 * max_rubbers_per_player mặc định 2; win_by_two / play_all mặc định true. Không có trận nào → ném Error.
 */
export function normalizeTeamRules(raw) {
  const r = raw || {};
  const scoring = r.scoring === "cumulative" ? "cumulative" : "match_points";
  const ppr = Math.max(1, Math.min(99, toInt(r.points_per_rubber, 11) || 11));
  const rubbers = autoLabelRubbers(r.rubbers && r.rubbers.length ? r.rubbers : defaultRubbers());
  if (!rubbers.length) throw new Error("Cần ít nhất 1 trận thành phần");
  if (rubbers.length > 20) throw new Error("Tối đa 20 trận thành phần");
  const n = rubbers.length;
  let target_total = null;
  if (scoring === "cumulative") {
    target_total = Math.max(ppr, Math.min(toInt(r.target_total, ppr * n) || ppr * n, ppr * n));   // kẹp ≤ ppr×n như backend
  }
  return {
    scoring,
    rubbers,
    points_per_rubber: ppr,
    win_by_two: r.win_by_two === undefined ? true : !!r.win_by_two,
    target_total,
    max_rubbers_per_player: Math.max(1, toInt(r.max_rubbers_per_player, 2) || 2),
    play_all: r.play_all === undefined ? true : !!r.play_all,
  };
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
  return [...new Set(RUBBER_CODES[code]?.genders || [])];
}

/**
 * Số VĐV nam/nữ tối thiểu một đội cần có để xếp đủ mọi trận thành phần (mỗi người tối đa
 * max_rubbers_per_player trận): ceil(tổng suất theo giới / giới hạn).
 */
export function teamGenderNeeds(rules) {
  const limit = Math.max(1, rules?.max_rubbers_per_player || 2);
  let male = 0, female = 0;
  (rules?.rubbers || []).forEach((r) => {
    (RUBBER_CODES[r.code]?.genders || []).forEach((g) => { if (g === "male") male += 1; else female += 1; });
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
  return out;
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
