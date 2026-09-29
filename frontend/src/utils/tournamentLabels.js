// Nhãn đội / hạng dùng chung cho Tournament.jsx (admin), PublicTournamentTracker.jsx (public)
// và các component bốc thăm — trước đây mỗi trang định nghĩa một bản trùng nhau.

/** Tên hiển thị của một đội/người chơi trong giải. */
export const teamLabel = (p) => p?.team_name || p?.member?.full_name || p?.player?.name || "—";

/** Đấu đôi: ghép hạng của cả 2 người (VD "B / B", "A / C"); đấu đơn: 1 hạng. */
export const teamRank = (p) => {
  const r1 = p?.member?.rank || p?.player?.rank;
  const r2 = p?.partner?.rank || p?.partner_player?.rank;
  return r1 && r2 ? `${r1} / ${r2}` : (r1 || r2 || null);
};
