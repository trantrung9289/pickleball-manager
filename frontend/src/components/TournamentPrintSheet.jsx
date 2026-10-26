import { useEffect, useState } from "react";
import { tournamentsApi } from "../api";
import { useAuth } from "../context/AuthContext";
import {
  projectedKnockoutSlots, buildProjectedBracketNodes, buildRealBracketNodes, computeBracketGeometry,
  findThirdPlaceMatch,
} from "../utils/bracketLayout";
import {
  normalizeTeamRules, templateRubbers, isCumulative, scoringLabel, stageLabel, playersById, playerNames,
  rubberCodeLabel, rubberSize, firstLegRounds, stageKeyForMatch, stagesForFormat, genderLabel,
} from "../utils/teamLabels";
import { rubberTotals, rulesForStage } from "../utils/teamFormat";
import { findPlacementMatches } from "../utils/bracketLayout";

// Giống hệt teamLabel/teamRank trong Tournament.jsx và PublicTournamentTracker.jsx (đã trùng lặp
// sẵn giữa 2 file đó) — giữ nguyên logic để tên hiển thị nhất quán trên toàn hệ thống.
const teamLabel = (p) => p?.team_name || p?.member?.full_name || p?.player?.name || "—";

const FORMAT_LABEL = {
  round_robin: "Vòng tròn một lượt",
  round_robin_double: "Vòng tròn hai lượt",
  knockout: "Đấu loại trực tiếp",
  combined: "Vòng bảng + loại trực tiếp",
  individual: "Thi đấu riêng lẻ",
};
const TEAM_TYPE_LABEL = { singles: "Đấu đơn", doubles: "Đấu đôi", team: "Đồng đội" };

const BOX_W = 220;
const BOX_H = 76; // đủ chỗ cho tên đội bọc 2 dòng (xem Slot) thay vì cắt "..."
const COL_GAP = 70;
// Chiều rộng in được thực tế của trang ngang A4 (297mm) trừ padding .print-page (14mm x 2),
// quy đổi ra px theo chuẩn 96px/inch mà trình duyệt dùng để bố cục các phần tử CSS px khi in.
const LANDSCAPE_PRINTABLE_PX = ((297 - 28) / 25.4) * 96;
// Chiều cao in được của trang ngang (210mm − 2×14mm lề) — sơ đồ 16 ô (5–8 bảng) cao hơn mức này nên
// phải thu nhỏ theo CẢ chiều cao, nếu không trình duyệt ngắt trang giữa các ô.
const LANDSCAPE_PRINTABLE_H_PX = ((210 - 28) / 25.4) * 96;
const BRACKET_MIN_SCALE = 0.5; // dưới mức này chữ quá nhỏ để ghi tay — chấp nhận tràn trang

// ── Khối tiêu đề dùng chung mọi trang in ─────────────────────────────────────
function SheetHeader({ tournament, subtitle }) {
  // Portal vào document.body vẫn giữ React context → đọc được CLB đang chọn.
  const clubName = useAuth()?.selectedClub?.name;
  // Giải đồng đội: tổng số trận đồng đội + trận thành phần (cùng cách đếm với thống kê đầu trang giải)
  let teamCounts = null;
  if (tournament.team_type === "team") {
    try {
      const r = rubberTotals(tournament.matches || [], normalizeTeamRules(tournament.team_rules));
      teamCounts = `${(tournament.matches || []).length} trận đồng đội · ${r.total} trận thành phần`;
    } catch { teamCounts = null; }
  }
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      borderBottom: "3px solid #141413", paddingBottom: 10, marginBottom: 10,
    }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#888" }}>
          {clubName || "CLB: ___________________"}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>{subtitle}</div>
        <div style={{ fontSize: 12.5, color: "#555", marginTop: 2 }}>Tên giải: {tournament.name}</div>
      </div>
      <div style={{ textAlign: "right", fontSize: 12, color: "#555", lineHeight: 1.6, whiteSpace: "nowrap" }}>
        Ngày: ____ / ____ / {new Date().getFullYear()} &nbsp;·&nbsp; Số đội: <b>{tournament.participants.length}</b>
        &nbsp;·&nbsp; {TEAM_TYPE_LABEL[tournament.team_type] || "Đấu đơn"}
        {teamCounts ? <>&nbsp;·&nbsp; {teamCounts}</> : null}
        <br />Người ghi: _______________
      </div>
    </div>
  );
}

// ── Danh sách trận theo vòng + ô trống ghi tỉ số ──────────────────────────────
function MatchRows({ matches }) {
  const rounds = [...new Set(matches.map((m) => m.round_number))].sort((a, b) => a - b);
  const showRoundLabel = rounds.length > 1;
  return (
    <div>
      {rounds.map((rn) => {
        const rMatches = matches.filter((m) => m.round_number === rn).sort((a, b) => a.match_number - b.match_number);
        return (
          <div key={rn}>
            {showRoundLabel && (
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "#555", textTransform: "uppercase",
                margin: "12px 0 4px", paddingBottom: 3, borderBottom: "2px solid #141413",
              }}>
                {rMatches[0]?.round_name || `Vòng ${rn}`}
              </div>
            )}
            {rMatches.map((m) => {
              const scored = m.status === "completed" && m.score1 != null;
              if (m.is_walkover) {
                const winnerLabel = teamLabel(m.winner_id === m.p1_id ? m.p1 : m.p2);
                return (
                  <div key={m.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "5px 2px", borderBottom: "1px solid #e5e5e5",
                  }}>
                    <div style={{ width: 20, fontSize: 11, color: "#999", textAlign: "right" }}>{m.match_number}</div>
                    <div style={{ flex: 1, fontSize: 13.5, textAlign: "right" }}>{teamLabel(m.p1)}</div>
                    <div style={{ flex: "0 0 auto", fontSize: 11.5, color: "#b8860b", fontStyle: "italic", padding: "0 4px" }}>
                      {winnerLabel} thắng — đối thủ bỏ giải
                    </div>
                    <div style={{ flex: 1, fontSize: 13.5 }}>{teamLabel(m.p2)}</div>
                  </div>
                );
              }
              return (
                <div key={m.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "5px 2px", borderBottom: "1px solid #e5e5e5",
                }}>
                  <div style={{ width: 20, fontSize: 11, color: "#999", textAlign: "right" }}>{m.match_number}</div>
                  <div style={{ flex: 1, fontSize: 13.5, textAlign: "right" }}>{teamLabel(m.p1)}</div>
                  <div style={{
                    width: 34, height: 23, border: "1.3px solid #333", borderRadius: 2,
                    textAlign: "center", fontSize: 13, lineHeight: "23px",
                  }}>{scored ? m.score1 : " "}</div>
                  <div style={{ fontSize: 12, color: "#999" }}>–</div>
                  <div style={{
                    width: 34, height: 23, border: "1.3px solid #333", borderRadius: 2,
                    textAlign: "center", fontSize: 13, lineHeight: "23px",
                  }}>{scored ? m.score2 : " "}</div>
                  <div style={{ flex: 1, fontSize: 13.5 }}>{teamLabel(m.p2)}</div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Bảng xếp hạng (dữ liệu thật từ API — toàn số 0 nếu chưa đấu trận nào) ────
const STANDINGS_COLS = [
  { label: "#", width: 20 },
  { label: "Đội", width: null }, // chiếm phần còn lại
  { label: "Trận", width: 34 },
  { label: "Thắng", width: 40 },
  { label: "H.số", width: 42 },
  { label: "Điểm", width: 36 },
];
// Giải đồng đội: thay H.số (tổng tỉ số tie) bằng 2 chỉ số tie-break của điều lệ —
// hiệu số TRẬN thành phần (rubber_diff) và hiệu số ĐIỂM nhỏ (pts_diff) từ /standings
const TEAM_STANDINGS_COLS = [
  { label: "#", width: 20 },
  { label: "Đội", width: null },
  { label: "Trận", width: 34 },
  { label: "Thắng", width: 40 },
  { label: "HS trận", width: 48 },
  { label: "HS điểm", width: 50 },
  { label: "Điểm", width: 36 },
];
const signed = (v) => (v > 0 ? `+${v}` : `${v ?? 0}`);

function StandingsShell({ rows, isTeam, pointDiff = false }) {
  if (!rows) return null;
  // Xếp hạng theo hiệu số điểm (point_diff): cột "Điểm" bảng không còn ý nghĩa → thay bằng Đ.ghi (điểm ghi được)
  const cols = isTeam ? (pointDiff ? TEAM_STANDINGS_COLS.map((c) => (c.label === "Điểm" ? { label: "Đ.ghi", width: 40 } : c)) : TEAM_STANDINGS_COLS) : STANDINGS_COLS;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <colgroup>
        {cols.map((c) => <col key={c.label} style={c.width ? { width: c.width } : undefined} />)}
      </colgroup>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={c.label} style={{
              fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "#666", fontWeight: 700,
              borderBottom: "1.5px solid #141413", padding: "4px 4px", textAlign: i === 1 ? "left" : "center",
              whiteSpace: "nowrap", overflow: "hidden",
            }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.participant_id} style={{ breakInside: "avoid" }}>
            <td style={cellStyle("center")}>{i + 1}</td>
            <td style={cellStyle("left")}>
              {/* div riêng bên trong <td> — line-clamp cần display:-webkit-box, đặt thẳng lên
                  <td> sẽ phá layout table (không còn là table-cell) */}
              <div style={{
                lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                overflow: "hidden", wordBreak: "break-word",
              }}>
                {r.team_name}
                {/* Giải đồng đội: bằng mọi chỉ số → điều lệ bốc thăm xếp hạng */}
                {r.needs_draw && <span style={{ fontSize: 11, color: "#b8860b", marginLeft: 4 }}>(bốc thăm)</span>}
              </div>
            </td>
            <td style={cellStyle("center")}>{r.played}</td>
            <td style={cellStyle("center")}>{r.won}</td>
            {isTeam
              ? (
                <>
                  <td style={cellStyle("center")}>{signed(r.rubber_diff)}</td>
                  <td style={cellStyle("center")}>{signed(r.pts_diff ?? r.points_diff)}</td>
                </>
              )
              : <td style={cellStyle("center")}>{signed(r.goal_diff)}</td>}
            <td style={cellStyle("center")}>{isTeam && pointDiff ? r.pts_for : r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const cellStyle = (align) => ({ fontSize: 12.5, padding: "5px 6px", borderBottom: "1px solid #e5e5e5", textAlign: align });

// ── Sơ đồ nhánh (dùng chung cho vòng loại thật và sơ đồ dự kiến) ─────────────
// roundsNodes: [{id, feederIds, ...}], mỗi node cần content(node) -> {top, bottom, isBye, matchNumber}
function BracketDiagram({ roundsNodes, content, roundTitles, thirdPlace, reservedHeight = 170 }) {
  if (!roundsNodes.length) return null;
  const { centers, totalHeight } = computeBracketGeometry(roundsNodes, { boxHeight: BOX_H, minGap: 26 });
  const width = roundsNodes.length * (BOX_W + COL_GAP) + 160; // +160 cho hộp "Vô địch"

  const lines = [];
  roundsNodes.forEach((round, r) => {
    if (r === 0) return;
    const xEnd = r * (BOX_W + COL_GAP);
    const xStart = xEnd - COL_GAP;
    const xMid = xStart + COL_GAP / 2;
    round.forEach((node) => {
      const [a, b] = node.feederIds || [];
      if (a == null || b == null) return;
      const ya = centers[a], yb = centers[b];
      const yMid = centers[node.id];
      lines.push(
        <path key={`${node.id}-line`} d={`M${xStart},${ya} H${xMid} V${yb} M${xStart},${yb} H${xMid} M${xMid},${yMid} H${xEnd}`} />
      );
    });
  });
  const finalId = roundsNodes[roundsNodes.length - 1][0]?.id;
  const finalY = finalId != null ? centers[finalId] : totalHeight / 2;
  const championX = roundsNodes.length * (BOX_W + COL_GAP);
  if (finalId != null) {
    lines.push(<path key="champ-line" d={`M${championX - COL_GAP},${finalY} H${championX}`} />);
  }
  // Ô "Tranh giải 3" đặt NGAY DƯỚI ô Chung kết, cùng cột — trước đây là khối rời ở cuối trang (dưới
  // toàn bộ sơ đồ) nên bị đẩy sang trang sau hoặc người ghi không tìm thấy; với sơ đồ DỰ KIẾN
  // (kết hợp chưa lên vòng loại) thì trước đây hoàn toàn không có ô này dù đã bật.
  const finalX = (roundsNodes.length - 1) * (BOX_W + COL_GAP);
  const thirdTop = finalY + BOX_H / 2 + 24 + 46;
  const innerHeight = Math.max(totalHeight + 30, thirdPlace ? thirdTop + BOX_H + 12 : 0);
  // Thu nhỏ vừa trang theo cả 2 chiều: bracket nhiều vòng rộng hơn khổ ngang (cắt cột phải), bracket
  // 16 ô cao hơn phần còn lại của trang sau header/tiêu đề vòng/ghi chú (reservedHeight) → ngắt trang giữa ô.
  const availH = LANDSCAPE_PRINTABLE_H_PX - reservedHeight;
  const scale = Math.max(BRACKET_MIN_SCALE, Math.min(1, LANDSCAPE_PRINTABLE_PX / width, availH / innerHeight));

  return (
    <div style={{ width: width * scale, height: innerHeight * scale }}>
      <div style={{
        position: "relative", width, height: innerHeight,
        transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: "top left",
      }}>
        {(roundTitles || roundsNodes.map((_, i) => `Vòng ${i + 1}`)).map((t, i) => (
          <div key={t} style={{
            position: "absolute", left: i * (BOX_W + COL_GAP), top: 0,
            fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#555",
          }}>{t}</div>
        ))}
        <div style={{ position: "absolute", left: championX, top: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#555" }}>
          Vô địch
        </div>
        <svg width={width} height={totalHeight} style={{ position: "absolute", left: 0, top: 24 }} stroke="#9aa0a6" strokeWidth="1.6" fill="none">
          {lines}
        </svg>
        {roundsNodes.map((round, r) =>
          round.map((node) => {
            const c = content(node, r);
            const y = centers[node.id] - BOX_H / 2 + 24;
            const x = r * (BOX_W + COL_GAP);
            if (c.isBye) {
              return (
                <div key={node.id} style={{
                  position: "absolute", left: x, top: y, width: BOX_W, height: BOX_H,
                  border: "1.5px solid #ddd", borderRadius: 4, background: "#fafafa",
                  display: "flex", alignItems: "center", padding: "0 10px", fontSize: 12.5, color: "#888",
                }}>
                  {c.top || c.bottom} <span style={{ marginLeft: 6, fontSize: 10.5 }}>{c.byeNote || "(miễn — vào thẳng vòng sau)"}</span>
                </div>
              );
            }
            return (
              <div key={node.id} style={{ position: "absolute", left: x, top: y, width: BOX_W, border: "1.5px solid #333", borderRadius: 4, background: "#fff" }}>
                {c.matchNumber != null && (
                  <div style={{ position: "absolute", right: 6, top: -13, fontSize: 9.5, color: "#aaa" }}>#{c.matchNumber}</div>
                )}
                <Slot label={c.top} score={c.score1} scored={c.scored} isWalkover={c.isWalkover} isWinner={c.winnerIsP1} />
                <Slot label={c.bottom} score={c.score2} scored={c.scored} isWalkover={c.isWalkover} isWinner={c.winnerIsP2} last />
              </div>
            );
          })
        )}
        <div style={{
          position: "absolute", left: championX, top: finalY - 28 + 24, width: 150, height: 56,
          border: "2px solid #b8860b", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "#fffbea",
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#8a6d00" }}>🏆 Vô địch</span>
        </div>
        {thirdPlace && (
          <>
            <div style={{
              position: "absolute", left: finalX, top: thirdTop - 17,
              fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8a6d00",
            }}>
              Tranh giải 3{thirdPlace.projected ? " (dự kiến)" : ""}
            </div>
            <div style={{ position: "absolute", left: finalX, top: thirdTop, width: BOX_W, border: "1.5px solid #b8860b", borderRadius: 4, background: "#fffdf5" }}>
              {thirdPlace.matchNumber != null && (
                <div style={{ position: "absolute", right: 6, top: -13, fontSize: 9.5, color: "#aaa" }}>#{thirdPlace.matchNumber}</div>
              )}
              <Slot label={thirdPlace.top} score={thirdPlace.score1} scored={thirdPlace.scored} isWalkover={thirdPlace.isWalkover} isWinner={thirdPlace.winnerIsP1} />
              <Slot label={thirdPlace.bottom} score={thirdPlace.score2} scored={thirdPlace.scored} isWalkover={thirdPlace.isWalkover} isWinner={thirdPlace.winnerIsP2} last />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Nội dung ô "Tranh giải 3" (trận thật — không nằm trong cây next_match_id, đi theo đường thua của 2 bán kết)
function thirdPlaceContent(thirdPlaceInfo) {
  if (!thirdPlaceInfo) return null;
  const { match: m, feeders } = thirdPlaceInfo;
  const nameFor = (side) => {
    const pid = side === 1 ? m.p1_id : m.p2_id;
    if (pid) return teamLabel(side === 1 ? m.p1 : m.p2);
    const feeder = feeders.find((f) => f.loser_next_match_slot === side);
    return feeder ? `Thua ${feeder.round_name} #${feeder.match_number}` : null;
  };
  const scored = m.status === "completed" && m.score1 != null;
  return {
    top: nameFor(1), bottom: nameFor(2), matchNumber: m.match_number,
    scored, score1: m.score1, score2: m.score2, isWalkover: m.is_walkover,
    winnerIsP1: scored && m.winner_id === m.p1_id, winnerIsP2: scored && m.winner_id === m.p2_id,
  };
}

// Ô "Tranh giải 3" DỰ KIẾN cho sơ đồ chưa có trận thật (kết hợp đang đấu vòng bảng): chỉ khi đã bật
// và sơ đồ dự kiến có đúng 2 bán kết (≥4 suất) — cùng điều kiện backend tạo trận lúc lên vòng loại.
function projectedThirdPlaceContent(tournament, roundsNodes) {
  if (!tournament.third_place_enabled || roundsNodes.length < 2) return null;
  if (roundsNodes[roundsNodes.length - 2].length !== 2) return null;
  return { top: "Thua bán kết (trận trên)", bottom: "Thua bán kết (trận dưới)", projected: true, matchNumber: null,
    scored: false, score1: null, score2: null, isWalkover: false, winnerIsP1: false, winnerIsP2: false };
}

function Slot({ label, score, scored, last, isWalkover, isWinner }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "4px 8px", minHeight: 34,
      borderBottom: last ? "none" : "1px solid #ccc",
      background: isWinner ? "#f6ffed" : "transparent",
    }}>
      <span style={{
        fontSize: 12, lineHeight: 1.25, fontWeight: isWinner ? 700 : 400,
        color: isWinner ? "#237804" : (label ? "#141413" : "#888"),
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word",
      }}>
        {label || " "}
      </span>
      <div style={{
        width: 28, height: 19, borderRadius: 2, flex: "none", textAlign: "center", lineHeight: "17px",
        border: isWalkover ? "1.2px solid #d4b106" : "1.2px solid #333",
        background: isWalkover ? "#fffbe6" : "transparent",
        color: isWalkover ? "#8a6d00" : "inherit",
        fontSize: isWalkover ? 8.5 : 11,
      }}>
        {isWalkover ? "XT" : (scored ? score : " ")}
      </div>
    </div>
  );
}

function realBracketContent(node) {
  const m = node.match;
  const topLabel = m.p1_id ? teamLabel(m.p1) : (node.feeders[0] ? `Thắng ${node.feeders[0].round_name} #${node.feeders[0].match_number}` : null);
  const bottomLabel = m.p2_id ? teamLabel(m.p2) : (node.feeders[1] ? `Thắng ${node.feeders[1].round_name} #${node.feeders[1].match_number}` : null);
  // Bye cấu trúc thật (1 bên trống, không phải bỏ giải) khác với is_walkover (2 bên đều là
  // người thật, 1 bên bỏ giải) — trước đây gộp chung theo "hoàn thành mà không có tỉ số" nên
  // walkover bị hiển thị nhầm thành bye và ẩn mất tên đối thủ còn lại.
  const isBye = m.status === "completed" && (!m.p1_id || !m.p2_id);
  // Bye hoàn thành mà không có người thắng = đội duy nhất trong ô đã bỏ giải → không ai đi tiếp
  const byeNote = isBye && m.winner_id == null ? "(bỏ giải — không vào vòng sau)" : null;
  return {
    top: isBye ? teamLabel(m.p1 || m.p2) : topLabel,
    bottom: bottomLabel,
    isBye,
    byeNote,
    matchNumber: m.match_number,
    scored: m.status === "completed" && m.score1 != null,
    score1: m.score1, score2: m.score2,
    isWalkover: m.is_walkover,
    winnerIsP1: m.status === "completed" && m.winner_id === m.p1_id,
    winnerIsP2: m.status === "completed" && m.winner_id === m.p2_id,
  };
}

function projectedBracketContent(node, roundIndex) {
  // Bye (1 bên trống, tự động miễn vào vòng sau) chỉ có thể xảy ra ở vòng đầu tiên do cấu trúc
  // bracket — từ vòng 2 trở đi, "1 bên đã biết, 1 bên chưa" nghĩa là ĐANG CHỜ đối thủ thật,
  // không phải bye, nên không gắn nhãn "miễn".
  const isBye = roundIndex === 0 && !!((node.top && !node.bottom) || (node.bottom && !node.top));
  return { top: node.top, bottom: node.bottom, isBye, matchNumber: null, scored: false, isWalkover: false, winnerIsP1: false, winnerIsP2: false };
}

// ── Trang: vòng tròn / vòng tròn hai lượt / thi đấu riêng lẻ ─────────────────
function RoundRobinSheet({ tournament, standings, isTeam, pointDiff }) {
  return (
    <div className="print-page print-portrait">
      <SheetHeader tournament={tournament} subtitle={`BẢNG THI ĐẤU — ${FORMAT_LABEL[tournament.format].toUpperCase()}`} />
      <div style={{ display: "flex", gap: 28 }}>
        <div style={{ flex: 1 }}>
          <MatchRows matches={tournament.matches} />
        </div>
        <div style={{ width: isTeam ? 340 : 310 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "#555", textTransform: "uppercase", margin: "0 0 4px", paddingBottom: 3, borderBottom: "2px solid #141413" }}>
            Bảng xếp hạng
          </div>
          <StandingsShell rows={standings} isTeam={isTeam} pointDiff={pointDiff} />
          <div style={{ marginTop: 28, padding: 12, border: "1.3px dashed #bbb", borderRadius: 6, fontSize: 11.5, color: "#666", lineHeight: 1.6 }}>
            <b style={{ color: "#141413" }}>Ghi chú</b><br />
            {isTeam
              ? "Ô tỉ số là kết quả tổng của trận đồng đội (số trận thắng hoặc tổng điểm cộng dồn). Chi tiết từng trận thành phần ghi ở Biên bản trận đồng đội (các trang sau); nhập điểm từng trận thành phần vào ứng dụng — hệ thống tự tính kết quả và bảng xếp hạng."
              : "Điền tỉ số vào 2 ô mỗi trận ngay sau khi kết thúc. Sau buổi đấu, nhập lại vào ứng dụng — hệ thống tự tính bảng xếp hạng."}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Trang: đấu loại trực tiếp (dữ liệu thật) ─────────────────────────────────
function KnockoutSheet({ tournament }) {
  const roundsNodes = buildRealBracketNodes(tournament.matches);
  const roundTitles = roundsNodes.map((r) => r[0]?.match?.round_name || `Vòng`);
  const thirdPlace = thirdPlaceContent(findThirdPlaceMatch(tournament.matches));
  return (
    <div className="print-page print-landscape">
      <SheetHeader tournament={tournament} subtitle="SƠ ĐỒ ĐẤU LOẠI TRỰC TIẾP" />
      <BracketDiagram roundsNodes={roundsNodes} content={realBracketContent} roundTitles={roundTitles} thirdPlace={thirdPlace} />
      {findPlacementMatches(tournament.matches).length > 0 && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <b>Tranh hạng:</b>{" "}
          {findPlacementMatches(tournament.matches).map((m) => (
            <span key={m.id} style={{ marginRight: 14 }}>
              {m.round_name} (#{m.match_number}): {teamLabel(m.p1)} <span style={writeBox(30, 20)}>{m.status === "completed" ? m.score1 : ""}</span>
              {" – "}<span style={writeBox(30, 20)}>{m.status === "completed" ? m.score2 : ""}</span> {teamLabel(m.p2)}
            </span>
          ))}
        </div>
      )}
      <div className="print-footnote">
        Trận có 1 đội trống ("bye") tự động miễn vào vòng sau, không cần ghi điểm.
        {thirdPlace && " Trận tranh giải 3 nằm ngay dưới ô Chung kết."}
      </div>
    </div>
  );
}

// ── Trang: vòng bảng + loại trực tiếp ─────────────────────────────────────────
function CombinedSheet({ tournament, standingsByGroup, isTeam, pointDiff }) {
  const groups = [...new Set(tournament.participants.map((p) => p.group_name).filter(Boolean))].sort();
  const koMatches = tournament.matches.filter((m) => m.phase === "knockout");
  const hasRealKO = koMatches.length > 0;

  let bracketEl;
  if (hasRealKO) {
    const roundsNodes = buildRealBracketNodes(koMatches);
    const roundTitles = roundsNodes.map((r) => r[0]?.match?.round_name || "Vòng");
    const thirdPlace = thirdPlaceContent(findThirdPlaceMatch(koMatches));
    bracketEl = (
      <BracketDiagram roundsNodes={roundsNodes} content={realBracketContent} roundTitles={roundTitles} thirdPlace={thirdPlace} />
    );
  } else {
    // Sĩ số từng bảng: bảng chỉ có 1 đội thì không có "Nhì bảng" (gương với standings backend)
    const groupSizes = groups.map((name) => ({
      name, size: tournament.participants.filter((p) => p.group_name === name).length,
    }));
    const roundsNodes = buildProjectedBracketNodes(projectedKnockoutSlots(groupSizes));
    // Tên vòng khớp backend _round_name (Tứ kết / Vòng N) để bản dự kiến và bản thật đọc giống nhau
    const roundTitles = roundsNodes.map((_, i) => {
      const fromEnd = roundsNodes.length - 1 - i;
      return fromEnd === 0 ? "Chung kết" : fromEnd === 1 ? "Bán kết" : fromEnd === 2 ? "Tứ kết" : `Vòng ${i + 1}`;
    });
    bracketEl = (
      <BracketDiagram roundsNodes={roundsNodes} content={projectedBracketContent} roundTitles={roundTitles}
        thirdPlace={projectedThirdPlaceContent(tournament, roundsNodes)} reservedHeight={230} />
    );
  }

  // 2 trang khổ giấy khác nhau thay vì gộp 1 trang ngang: vòng bảng đọc như danh sách nên hợp
  // giấy dọc, còn sơ đồ nhánh loại trực tiếp cần bề ngang mới đủ chỗ nối các vòng.
  return (
    <>
      <div className="print-page print-portrait">
        <SheetHeader tournament={tournament} subtitle="VÒNG BẢNG" />
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {groups.map((g) => (
            <div key={g}>
              <div style={{ fontSize: 13, fontWeight: 800, background: "#141413", color: "#fff", padding: "4px 10px", borderRadius: 3, display: "inline-block", marginBottom: 6 }}>
                BẢNG {g}
              </div>
              <MatchRows matches={tournament.matches.filter((m) => m.phase === "group" && m.group_name === g)} />
              <div style={{ marginTop: 6 }}>
                <StandingsShell rows={standingsByGroup?.[g]} isTeam={isTeam} pointDiff={pointDiff} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="print-page print-landscape">
        <SheetHeader tournament={tournament} subtitle="VÒNG LOẠI TRỰC TIẾP" />
        {bracketEl}
        {!hasRealKO && (
          <div style={{ marginTop: 12, padding: "10px 12px", border: "1.3px dashed #bbb", borderRadius: 6, fontSize: 11, color: "#666", lineHeight: 1.6 }}>
            <b style={{ color: "#141413" }}>Ghi chú</b><br />
            Sơ đồ trên là DỰ KIẾN theo luật ghép cặp: Nhất A gặp Nhì B, Nhất B gặp Nhì A; các bảng C–D, E–F...
            tương tự. Nếu số suất không đủ luỹ thừa 2: các đội nhất bảng (theo thứ tự A, B, C...) được miễn vòng đầu,
            thiếu nữa mới đến nhì bảng; đội mất đối thủ vì miễn được ghép chéo bảng với nhau (không gặp đội cùng bảng).
            Tên thật chỉ chốt sau khi vòng bảng đấu xong và bấm "Bắt đầu vòng loại trực tiếp" — in lại trang này khi đó.
          </div>
        )}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GIẢI ĐỒNG ĐỘI (team_type="team"): phiếu đăng ký đội hình (tách từng đội × lượt × vòng) + biên bản trận đồng đội.
// Dữ liệu TUỲ CHỌN do trang quản trị truyền vào: teams (TeamOut[]), lineups ({participant_id: LineupOut[]}),
// ties ({match_id: TieOut}). Thiếu teams → bỏ qua phiếu đội hình; thiếu ties[mid] → in khung trống theo rules.
// ══════════════════════════════════════════════════════════════════════════════

const sectionTitleStyle = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "#555", textTransform: "uppercase",
  margin: "12px 0 4px", paddingBottom: 3, borderBottom: "2px solid #141413",
};
const thStyle = (align = "center") => ({
  fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "#666", fontWeight: 700,
  borderBottom: "1.5px solid #141413", padding: "4px 5px", textAlign: align, whiteSpace: "nowrap", overflow: "hidden",
});
const tdStyle = (align = "center", extra = {}) => ({
  fontSize: 12.5, padding: "6px 5px", borderBottom: "1px solid #ccc", textAlign: align, verticalAlign: "middle", ...extra,
});
// Ô ghi tay (tỉ số): viền rõ, cao đủ chữ viết; có dữ liệu thì in sẵn vào ô
const writeBox = (w, h = 24) => ({
  display: "inline-block", width: w, height: h, border: "1.3px solid #333", borderRadius: 2,
  textAlign: "center", fontSize: 12.5, lineHeight: `${h}px`, verticalAlign: "middle", boxSizing: "border-box",
});

function SignatureRow({ labels }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 28, breakInside: "avoid" }}>
      {labels.map((l) => (
        <div key={l} style={{ flex: 1, textAlign: "center", fontSize: 12, minWidth: 0 }}>
          <div style={{ fontWeight: 700, lineHeight: 1.3, wordBreak: "break-word" }}>{l}</div>
          <div style={{ fontSize: 11, color: "#888" }}>(ký, ghi rõ họ tên)</div>
          <div style={{ height: 52, borderBottom: "1px dotted #999" }} />
        </div>
      ))}
    </div>
  );
}

// Tên VĐV trong ô biên bản: mỗi người một dòng; dòng trống chừa chỗ ghi tay (gạch chấm)
function PlayerCell({ names, size }) {
  const lines = Array.from({ length: Math.max(size, names.length) }, (_, i) => names[i] || "");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {lines.map((n, i) => (
        <div key={i} style={{
          minHeight: 20, fontSize: 12.5, lineHeight: "20px", wordBreak: "break-word",
          borderBottom: n ? "none" : "1px dotted #999",
        }}>
          {n}
        </div>
      ))}
    </div>
  );
}

// ── Trang: PHIẾU ĐĂNG KÝ ĐỘI HÌNH — TÁCH RIÊNG từng đội × từng lượt × từng vòng (một trang / trận của đội).
// Điền sẵn từ đội hình giai đoạn đã đăng ký (lineups), đội trưởng có thể sửa tay cho trận này.
// Đội chưa có trận (giải Nháp / chưa xếp lịch) → một trang / giai đoạn (lượt) để vẫn tách theo lượt.
function TeamLineupSheet({ tournament, rules, team, lineups, match, stage, opponent }) {
  const p = team.participant || {};
  const players = [...(team.players || [])].sort((a, b) =>
    (b.is_captain ? 1 : 0) - (a.is_captain ? 1 : 0)
    || (a.display_name || "").localeCompare(b.display_name || "", "vi"));
  const captain = players.find((x) => x.is_captain);
  const byId = playersById(team);
  const rubbers = templateRubbers(rulesForStage(rules, stage));   // vòng loại trực tiếp có thể có bộ thể thức riêng
  const maxSize = Math.max(1, ...rubbers.map((r) => rubberSize(r.code)));
  const lu = (lineups || []).find((l) => l.stage_key === stage);
  const slots = lu?.slots || {};
  const filled = Object.values(slots).some((ids) => (ids || []).length > 0);
  // round_name của vòng tròn 2 lượt đã mang "Lượt đi – Vòng 1" → bỏ tiền tố lượt vì ô "Lượt" đã ghi riêng
  const roundText = match
    ? ((match.round_name || `Vòng ${match.round_number}`).replace(/^Lượt (đi|về)\s*[–-]\s*/i, ""))
    : "Vòng ______";
  const opponentName = match ? (opponent ? teamLabel(opponent) : "(chờ xác định)") : "______________________";

  return (
    <div className="print-page print-portrait">
      <SheetHeader tournament={tournament} subtitle="PHIẾU ĐĂNG KÝ ĐỘI HÌNH" />

      {/* Khối định danh trận: lượt – vòng – trận – bảng – đối thủ (mỗi trang chỉ một trận) */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 12px", padding: "8px 12px",
        border: "1.5px solid #141413", borderRadius: 6, marginBottom: 8, fontSize: 12.5, breakInside: "avoid",
      }}>
        <div><span style={{ color: "#666" }}>Lượt:</span> <b>{stageLabel(stage)}</b></div>
        <div><span style={{ color: "#666" }}>Vòng:</span> <b>{roundText}</b></div>
        <div><span style={{ color: "#666" }}>Trận:</span> <b>{match ? `#${match.match_number}` : "______"}</b>
          {match?.group_name ? <span style={{ color: "#666" }}> · Bảng <b style={{ color: "#141413" }}>{match.group_name}</b></span>
            : p.group_name ? <span style={{ color: "#666" }}> · Bảng <b style={{ color: "#141413" }}>{p.group_name}</b></span> : null}
        </div>
        <div style={{ gridColumn: "1 / span 2", wordBreak: "break-word" }}>
          <span style={{ color: "#666" }}>Đội:</span> <b style={{ fontSize: 15 }}>{teamLabel(p)}</b>
          <span style={{ color: "#666" }}> &nbsp;gặp&nbsp; </span><b style={{ fontSize: 15 }}>{opponentName}</b>
        </div>
        <div><span style={{ color: "#666" }}>Sân:</span> ______ &nbsp;·&nbsp; <span style={{ color: "#666" }}>Giờ:</span> ______</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: "#555", marginBottom: 4 }}>
        <div>{players.length} VĐV{p.status === "withdrawn" ? " · đã bỏ giải" : ""}</div>
        <div style={{ whiteSpace: "nowrap" }}>Đội trưởng: <b>{captain?.display_name || "_______________"}</b></div>
      </div>

      <div style={sectionTitleStyle}>Danh sách VĐV đăng ký</div>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 28 }} /><col /><col style={{ width: 70 }} /><col style={{ width: 110 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={thStyle()}>TT</th>
            <th style={thStyle("left")}>Họ tên</th>
            <th style={thStyle()}>Giới tính</th>
            <th style={thStyle()}>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {players.map((pl, i) => (
            <tr key={pl.id} style={{ breakInside: "avoid" }}>
              <td style={tdStyle()}>{i + 1}</td>
              <td style={tdStyle("left")}>
                {pl.display_name}
                {pl.is_captain ? <span style={{ fontSize: 11, color: "#8a6d00", marginLeft: 6 }}>(đội trưởng)</span> : null}
              </td>
              <td style={tdStyle()}>{genderLabel(pl.gender)}</td>
              <td style={tdStyle()} />
            </tr>
          ))}
          {players.length === 0 && (
            <tr><td colSpan={4} style={tdStyle("left", { color: "#888" })}>Chưa đăng ký VĐV</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ breakInside: "avoid" }}>
        <div style={sectionTitleStyle}>
          Đội hình thi đấu trận này
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 8, color: "#888" }}>
            {filled
              ? (lu?.locked ? "— điền sẵn từ đội hình giai đoạn đã khoá" : "— điền sẵn từ đội hình giai đoạn đã đăng ký, có thể sửa tay")
              : "— đội trưởng điền tay trước giờ thi đấu"}
          </span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 28 }} /><col style={{ width: 150 }} />
            {Array.from({ length: maxSize }, (_, i) => <col key={i} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={thStyle()}>TT</th>
              <th style={thStyle("left")}>Thể thức</th>
              {Array.from({ length: maxSize }, (_, i) => <th key={i} style={thStyle("left")}>VĐV {i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {rubbers.map((r) => {
              const names = playerNames(slots[r.label] || [], byId);
              const size = rubberSize(r.code);
              return (
                <tr key={r.order_index} style={{ breakInside: "avoid" }}>
                  <td style={tdStyle()}>{r.order_index}</td>
                  <td style={tdStyle("left")}>
                    {r.label}
                    <div style={{ fontSize: 11, color: "#888" }}>{rubberCodeLabel(r.code)}</div>
                  </td>
                  {Array.from({ length: maxSize }, (_, i) => (
                    <td key={i} style={tdStyle("left", { height: 36 })}>
                      {i >= size
                        ? <span style={{ color: "#bbb" }}>—</span>
                        : (names[i] || <div style={{ borderBottom: "1px dotted #999", height: 22 }} />)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, padding: "8px 12px", border: "1.3px dashed #bbb", borderRadius: 6, fontSize: 11.5, color: "#666", lineHeight: 1.6 }}>
        <b style={{ color: "#141413" }}>Ghi chú</b><br />
        Thể thức: {scoringLabel(rules)} · {rules.points_per_rubber} điểm/trận{rules.win_by_two ? ", cách biệt 2" : ""}
        {isCumulative(rules) ? ` · mốc tổng ${rules.target_total} điểm` : ""} · mỗi VĐV tối đa {rules.max_rubbers_per_player} trận
        thành phần trong một trận đồng đội. Nộp phiếu cho trọng tài trước giờ thi đấu; đội hình giai đoạn tự khoá khi giai đoạn
        đó có trận thành phần đầu tiên được ghi điểm, thay đổi sau đó phải qua ban tổ chức (có ghi nhận lý do).
      </div>
      <SignatureRow labels={["Đội trưởng đội", "Trọng tài", "Ban tổ chức"]} />
    </div>
  );
}

// ── Trang: BIÊN BẢN TRẬN ĐỒNG ĐỘI — một trang / trận đã đủ 2 đội (tie thật nếu có, không thì khung mẫu) ──
function TieSheet({ tournament, rules, match, tie, teamsById, firstLeg }) {
  const cumulative = isCumulative(rules);
  const stageForRules = tie?.stage_key || stageKeyForMatch(tournament.format, match, firstLeg);
  const rubbers = tie?.rubbers?.length
    ? [...tie.rubbers].sort((a, b) => a.order_index - b.order_index)
    : templateRubbers(rulesForStage(rules, stageForRules));
  const team1 = tie?.team1 || teamsById?.[match.p1_id];
  const team2 = tie?.team2 || teamsById?.[match.p2_id];
  const byId = playersById(team1, team2);
  const stage = tie?.stage_key || stageKeyForMatch(tournament.format, match, firstLeg);
  const res = tie?.result;
  const finished = !!res?.finished || match.status === "completed";
  const name1 = teamLabel(match.p1);
  const name2 = teamLabel(match.p2);
  const total1 = finished ? (res?.score1 ?? match.score1) : null;
  const total2 = finished ? (res?.score2 ?? match.score2) : null;
  const winnerSide = res?.winner_side
    ?? (match.winner_id === match.p1_id ? 1 : match.winner_id === match.p2_id ? 2 : null);
  const winnerName = finished ? (winnerSide === 1 ? name1 : winnerSide === 2 ? name2 : "") : "";
  const scored = (r) => r.status === "completed" && r.score1 != null;
  const sideWinner = (r) => (!scored(r) ? "" : (r.score1 > r.score2 ? name1 : r.score2 > r.score1 ? name2 : ""));
  const showStart = (r) => scored(r) || (r.start1 || 0) > 0 || (r.start2 || 0) > 0;

  return (
    <div className="print-page print-portrait">
      <SheetHeader tournament={tournament} subtitle="BIÊN BẢN TRẬN ĐỒNG ĐỘI" />
      <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
        {match.round_name || `Vòng ${match.round_number}`} · Trận #{match.match_number}
        {match.group_name ? ` · Bảng ${match.group_name}` : ""} · Giai đoạn: {stageLabel(stage)}
        &nbsp;·&nbsp; Sân: ______ &nbsp;·&nbsp; Giờ: ______
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
        border: "1.5px solid #141413", borderRadius: 6, marginBottom: 8, breakInside: "avoid",
      }}>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 800, textAlign: "right", wordBreak: "break-word", minWidth: 0 }}>{name1}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
          <span style={writeBox(44, 32)}>{total1 ?? ""}</span>
          <span style={{ fontSize: 16, color: "#999" }}>–</span>
          <span style={writeBox(44, 32)}>{total2 ?? ""}</span>
        </div>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 800, wordBreak: "break-word", minWidth: 0 }}>{name2}</div>
      </div>
      <div style={{ fontSize: 11.5, color: "#666", marginBottom: 6, lineHeight: 1.6 }}>
        {scoringLabel(rules)} · {rules.points_per_rubber} điểm/trận{rules.win_by_two ? ", cách biệt 2" : ""}
        {cumulative
          ? ` · mốc tổng ${rules.target_total} điểm (cộng dồn qua các trận)`
          : (rules.play_all ? " · đánh hết các trận thành phần" : "")}
        {" · "}tối đa {rules.max_rubbers_per_player} trận/VĐV.
        {" "}Thứ tự thể thức: {tie?.draw_seed
          ? <>đã bốc thăm (seed <code style={{ fontSize: 11 }}>{tie.draw_seed}</code>)</>
          : "theo mẫu — nếu ban tổ chức bốc thăm tại sân, ghi thứ tự thật vào cột TT"}.
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 26 }} /><col style={{ width: 96 }} /><col /><col />
          {cumulative && <><col style={{ width: 40 }} /><col style={{ width: 40 }} /><col style={{ width: 36 }} /></>}
          <col style={{ width: 46 }} /><col style={{ width: 46 }} /><col style={{ width: 84 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={thStyle()}>TT</th>
            <th style={thStyle("left")}>Thể thức</th>
            <th style={thStyle("left")}>VĐV đội 1</th>
            <th style={thStyle("left")}>VĐV đội 2</th>
            {cumulative && <><th style={thStyle()}>XP 1</th><th style={thStyle()}>XP 2</th><th style={thStyle()}>Mốc</th></>}
            <th style={thStyle()}>Đ1</th>
            <th style={thStyle()}>Đ2</th>
            <th style={thStyle("left")}>Thắng</th>
          </tr>
        </thead>
        <tbody>
          {rubbers.map((r) => {
            const s = scored(r);
            return (
              <tr key={r.id ?? r.order_index} style={{ breakInside: "avoid" }}>
                <td style={tdStyle()}>{r.order_index}</td>
                <td style={tdStyle("left")}>
                  {r.label}
                  <div style={{ fontSize: 11, color: "#888" }}>{rubberCodeLabel(r.code)}{r.court ? ` · Sân ${r.court}` : ""}</div>
                </td>
                <td style={tdStyle("left")}><PlayerCell names={playerNames(r.side1_players, byId)} size={rubberSize(r.code)} /></td>
                <td style={tdStyle("left")}><PlayerCell names={playerNames(r.side2_players, byId)} size={rubberSize(r.code)} /></td>
                {cumulative && (
                  <>
                    <td style={tdStyle()}>{showStart(r) ? (r.start1 || 0) : ""}</td>
                    <td style={tdStyle()}>{showStart(r) ? (r.start2 || 0) : ""}</td>
                    <td style={tdStyle()}>{r.target}</td>
                  </>
                )}
                <td style={tdStyle()}><span style={writeBox(36)}>{s ? r.score1 : ""}</span></td>
                <td style={tdStyle()}><span style={writeBox(36)}>{s ? r.score2 : ""}</span></td>
                <td style={tdStyle("left", { fontSize: 11.5, wordBreak: "break-word" })}>
                  {sideWinner(r)}
                  {r.is_walkover ? <div style={{ fontSize: 11, color: "#8a6d00", fontStyle: "italic" }}>xử thua</div> : null}
                </td>
              </tr>
            );
          })}
          <tr style={{ breakInside: "avoid" }}>
            <td colSpan={cumulative ? 7 : 4} style={tdStyle("right", { fontWeight: 700, borderBottom: "none", paddingTop: 10 })}>
              TỔNG KẾT ({cumulative ? "tổng điểm cộng dồn" : "số trận thắng"})
            </td>
            <td style={tdStyle("center", { borderBottom: "none", paddingTop: 10 })}><span style={writeBox(36, 28)}>{total1 ?? ""}</span></td>
            <td style={tdStyle("center", { borderBottom: "none", paddingTop: 10 })}><span style={writeBox(36, 28)}>{total2 ?? ""}</span></td>
            <td style={tdStyle("left", { borderBottom: "none", paddingTop: 10, fontSize: 11.5, fontWeight: 700, wordBreak: "break-word" })}>
              {winnerName}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 12, marginTop: 8 }}>
        Đội thắng: <b>{winnerName || "____________________"}</b>
        {finished && res?.detail ? <span style={{ color: "#555" }}> — {res.detail}</span> : null}
      </div>
      <div style={{ fontSize: 12, marginTop: 6 }}>
        Ghi chú BTC: {match.btc_note
          ? <span style={{ whiteSpace: "pre-wrap" }}>{match.btc_note}</span>
          : <span style={{ display: "inline-block", width: "70%", borderBottom: "1px dotted #999", height: 14, verticalAlign: "bottom" }} />}
      </div>
      <div style={{ fontSize: 11.5, color: "#666", marginTop: 6, lineHeight: 1.6 }}>
        {cumulative
          ? "Cách ghi: XP = điểm xuất phát của mỗi đội trước trận thành phần (= tổng sau trận trước); ghi tỉ số SAU trận (đã cộng dồn). Trận thành phần kết thúc khi một đội chạm Mốc; trận đồng đội kết thúc khi một đội chạm mốc tổng — các trận còn lại không cần đấu."
          : "Cách ghi: điền tỉ số từng trận thành phần; đánh hết các trận dù đã phân định. Hoà số trận → phân định bằng hiệu số điểm nhỏ (tổng điểm ghi − tổng điểm thua); vẫn bằng → đội thắng trận thành phần cuối cùng."}
        {" "}Xử thua: bên vắng / đến trễ nhận 0 − điểm tối đa, ghi "xử thua" ở cột Thắng.
      </div>
      <SignatureRow labels={[`Đội trưởng đội ${name1}`, "Trọng tài", `Đội trưởng đội ${name2}`]} />
    </div>
  );
}

/**
 * Component in bảng thi đấu — render ẩn (display:none khi ở màn hình thường), chỉ hiện khi in
 * (xem quy tắc @media print trong index.css). Gọi onReady() khi đã tải xong dữ liệu cần thiết
 * (bảng xếp hạng) để nơi gọi biết lúc nào an toàn để trigger window.print().
 *
 * Giải đồng đội (team_type="team") — props tuỳ chọn do trang quản trị truyền thêm:
 *   teams:   TeamOut[]                         → in "Phiếu đăng ký đội hình" (1 trang / đội / trận — tách lượt & vòng); thiếu → bỏ qua
 *   lineups: { [participant_id]: LineupOut[] } → điền sẵn đội hình theo giai đoạn (thiếu → ô trống)
 *   ties:    { [match_id]: TieOut }            → điền sẵn biên bản; thiếu → khung trống theo team_rules
 */
export default function TournamentPrintSheet({ tournament, onReady, teams, lineups, ties }) {
  const [standings, setStandings] = useState(null); // { _all: [...] } hoặc { A: [...], B: [...] }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const fmt = tournament.format;
        if (fmt === "combined") {
          const groups = [...new Set(tournament.participants.map((p) => p.group_name).filter(Boolean))].sort();
          const results = await Promise.all(groups.map((g) => tournamentsApi.standings(tournament.id, g)));
          if (!cancelled) setStandings(Object.fromEntries(groups.map((g, i) => [g, results[i].data])));
        } else if (fmt !== "knockout") {
          const r = await tournamentsApi.standings(tournament.id);
          if (!cancelled) setStandings({ _all: r.data });
        } else {
          if (!cancelled) setStandings({});
        }
      } catch {
        if (!cancelled) setStandings({}); // in được vẫn hơn không in, chỉ thiếu bảng xếp hạng
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tournament]);

  useEffect(() => {
    if (standings !== null) onReady?.();
  }, [standings]); // eslint-disable-line react-hooks/exhaustive-deps -- chỉ cần chạy đúng 1 lần khi standings load xong, onReady là callback ổn định từ nơi gọi

  if (standings === null) return null;

  const fmt = tournament.format;
  const isTeam = tournament.team_type === "team";
  const rules = isTeam ? normalizeTeamRules(tournament.team_rules) : null;
  const pointDiff = !!rules && rules.ranking === "point_diff";
  const teamsById = {};
  (teams || []).forEach((t) => { if (t?.participant?.id != null) teamsById[t.participant.id] = t; });
  // Biên bản: mọi trận đã đủ 2 đội (trừ xử thua do bỏ giải — không có trận thành phần);
  // vòng bảng trước (theo bảng, vòng, số trận), loại trực tiếp sau
  const tieMatches = isTeam
    ? (tournament.matches || [])
      .filter((m) => m.p1_id && m.p2_id && !m.is_walkover)
      .sort((a, b) => Number(a.phase === "knockout") - Number(b.phase === "knockout")
        || (a.group_name || "").localeCompare(b.group_name || "")
        || a.round_number - b.round_number
        || a.match_number - b.match_number)
    : [];
  const firstLeg = isTeam ? firstLegRounds(fmt, tournament.matches) : 0;
  // Phiếu đăng ký đội hình: một trang / đội / trận (tách theo lượt và vòng, thứ tự: vòng bảng → loại trực tiếp,
  // theo vòng, số trận). Xử thua do bỏ giải không có trận thành phần → không in. Đội chưa có trận → một trang / lượt.
  const lineupPages = [];
  if (isTeam) {
    const sortedMatches = [...(tournament.matches || [])]
      .filter((m) => !m.is_walkover)
      .sort((a, b) => Number(a.phase === "knockout") - Number(b.phase === "knockout")
        || a.round_number - b.round_number
        || a.match_number - b.match_number);
    (teams || []).forEach((team) => {
      const pid = team.participant?.id;
      if (pid == null || team.participant?.status === "withdrawn") return;
      const mine = sortedMatches.filter((m) => m.p1_id === pid || m.p2_id === pid);
      if (mine.length) {
        mine.forEach((m) => lineupPages.push({
          team, match: m, stage: stageKeyForMatch(fmt, m, firstLeg),
          opponent: m.p1_id === pid ? (m.p2 || teamsById[m.p2_id]?.participant) : (m.p1 || teamsById[m.p1_id]?.participant),
        }));
      } else {
        stagesForFormat(fmt).forEach((stage) => lineupPages.push({ team, match: null, stage, opponent: null }));
      }
    });
  }

  return (
    <div className="print-sheet-root">
      {fmt === "knockout" && <KnockoutSheet tournament={tournament} />}
      {fmt === "combined" && <CombinedSheet tournament={tournament} standingsByGroup={standings} isTeam={isTeam} pointDiff={pointDiff} />}
      {(fmt === "round_robin" || fmt === "round_robin_double" || fmt === "individual") && (
        <RoundRobinSheet tournament={tournament} standings={standings._all} isTeam={isTeam} pointDiff={pointDiff} />
      )}
      {isTeam && lineupPages.map(({ team, match, stage, opponent }) => (
        <TeamLineupSheet
          key={`lineup-${team.participant?.id}-${match ? match.id : stage}`}
          tournament={tournament} rules={rules} team={team}
          lineups={lineups?.[team.participant?.id]} match={match} stage={stage} opponent={opponent}
        />
      ))}
      {isTeam && tieMatches.map((m) => (
        <TieSheet
          key={`tie-${m.id}`}
          tournament={tournament} rules={rules} match={m} tie={ties?.[m.id]}
          teamsById={teamsById} firstLeg={firstLeg}
        />
      ))}
    </div>
  );
}
