/**
 * MatchScoreCell — ô "Tỉ số" trong bảng trận (admin + public, giải thường lẫn đồng đội):
 * đã xong → ScoreBox nhỏ có bên thắng; đang đấu dở (đồng đội) → ScoreBox viền chấm + chip "Đang đấu";
 * xử thắng do bỏ giải → chip; chưa đấu → chip trung tính. Props: { match, isTeam }
 */
import ScoreBox from "./ScoreBox";
import StatusChip from "./StatusChip";
import { tieScoreLabel } from "../../utils/teamFormat";

export default function MatchScoreCell({ match: m, isTeam = false }) {
  if (m.is_walkover) return <StatusChip tone="warn">Xử thắng</StatusChip>;
  const winner = m.winner_id ? (m.winner_id === m.p1_id ? 1 : m.winner_id === m.p2_id ? 2 : null) : null;
  if (m.status === "completed") return <ScoreBox a={m.score1} b={m.score2} winner={winner} size="sm" />;
  if (isTeam) {
    const t = tieScoreLabel(m);
    if (t.live) {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <ScoreBox a={m.score1 ?? 0} b={m.score2 ?? 0} size="sm" live />
          <StatusChip tone="info" dot pulse>Đang đấu</StatusChip>
        </span>
      );
    }
  }
  return <StatusChip tone="neutral">Chưa đấu</StatusChip>;
}
