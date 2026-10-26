// Nhãn và hàm thuần cho thể thức GIẢI ĐỒNG ĐỘI (team_type="team") — gương với
// backend/tournament_engine.py (RUBBER_CODES, STAGE_LABELS, GENDER_LABELS, normalize_team_rules,
// rubber_target, first_leg_rounds, stage_key_for_match). Dùng ở phần public (PublicTournamentTracker,
// PublicTieBoard) và bản in (TournamentPrintSheet). Không gọi API, không phụ thuộc antd.

import {
  normalizeTeamRules as _normalizeTeamRules,
  rubberTarget as _rubberTarget,
  stagesForFormat as _stagesForFormat,
} from "./teamFormat";

// Ba hàm dưới dùng chung bản trong utils/teamFormat.js (có test node, gương đúng engine kể cả hậu tố nhãn trùng)
export const normalizeTeamRules = _normalizeTeamRules;
export const rubberTarget = (rules, orderIndex) => _rubberTarget(_normalizeTeamRules(rules), orderIndex);
export const stagesForFormat = _stagesForFormat;

export const RUBBER_CODE_LABELS = {
  MD: "Đôi Nam",
  WD: "Đôi Nữ",
  XD: "Đôi Nam Nữ",
  MS: "Đơn Nam",
  WS: "Đơn Nữ",
  FD: "Đôi tự do",
};

/** Số VĐV mỗi bên của một thể thức trận thành phần. */
export const RUBBER_CODE_SIZE = { MD: 2, WD: 2, XD: 2, MS: 1, WS: 1, FD: 2 };

export const STAGE_LABELS = {
  leg1: "Lượt đi / Vòng bảng",
  leg2: "Lượt về",
  knockout: "Vòng loại trực tiếp",
};

export const GENDER_LABELS = { male: "Nam", female: "Nữ", other: "Khác" };

export const SCORING_LABELS = {
  match_points: "Tính số trận thắng",
  cumulative: "Cộng dồn điểm",
};

export const genderLabel = (g) => GENDER_LABELS[g] || "Chưa khai";
export const stageLabel = (k) => STAGE_LABELS[k] || k || "";
export const rubberCodeLabel = (code) => RUBBER_CODE_LABELS[code] || code || "";
export const rubberSize = (code) => RUBBER_CODE_SIZE[code] || 2;
export const isCumulative = (rules) => rules?.scoring === "cumulative";
export const scoringLabel = (rules) => SCORING_LABELS[rules?.scoring] || SCORING_LABELS.match_points;

/** Danh sách trận thành phần MẪU theo team_rules (khi tie chưa tạo rubber / in khung trống). */
export function templateRubbers(rules) {
  const n = normalizeTeamRules(rules);
  return n.rubbers.map((r, i) => ({
    order_index: i + 1,
    code: r.code,
    label: r.label,
    side1_players: [],
    side2_players: [],
    score1: null,
    score2: null,
    status: "pending",
    is_walkover: false,
    start1: 0,
    start2: 0,
    target: rubberTarget(n, i + 1),
  }));
}

/**
 * Tỉ số tổng của trận đồng đội để hiện ở lịch/nhánh: "3 – 2" (PA1) hoặc "60 – 48" (PA2).
 * Trận đang đấu dở vẫn có score1/score2 (backend _recompute_tie cập nhật dù status pending);
 * trả null khi chưa có điểm nào.
 */
export function tieScoreText(match) {
  if (!match) return null;
  if (match.status === "completed") return `${match.score1 ?? 0} – ${match.score2 ?? 0}`;
  if ((match.score1 || 0) > 0 || (match.score2 || 0) > 0) return `${match.score1 || 0} – ${match.score2 || 0}`;
  return null;
}

/** Map team_player_id → player từ một hay nhiều TeamOut (team1/team2 của TieOut, hoặc danh sách đội). */
export function playersById(...teams) {
  const m = {};
  teams.forEach((t) => (t?.players || []).forEach((p) => { m[p.id] = p; }));
  return m;
}

/** Tên hiển thị của danh sách team_player_id (thiếu trong map → "#id"). */
export const playerNames = (ids, byId) => (ids || []).map((id) => byId?.[id]?.display_name || `#${id}`);

/** Số vòng lượt đi (gương engine.first_leg_rounds): vòng tròn 2 lượt = một nửa số vòng; 0 với thể thức khác. */
export function firstLegRounds(fmt, matches) {
  if (fmt !== "round_robin_double") return 0;
  const rounds = (matches || []).filter((m) => m.phase === "group").map((m) => Number(m.round_number) || 0);
  return rounds.length ? Math.floor(Math.max(...rounds) / 2) : 0;
}

/** Giai đoạn đội hình của một trận (gương engine.stage_key_for_match). */
export function stageKeyForMatch(fmt, match, firstLeg) {
  if (match?.phase === "knockout") return "knockout";
  if (fmt === "round_robin_double" && firstLeg && (Number(match?.round_number) || 0) > firstLeg) return "leg2";
  return "leg1";
}

/** Nhãn trạng thái một trận thành phần. */
export function rubberStatusLabel(r) {
  if (r?.is_walkover) return "Xử thua";
  if (r?.status === "completed") return "Đã đấu";
  if ((r?.side1_players || []).length || (r?.side2_players || []).length) return "Chờ đấu";
  return "Chưa xếp";
}
