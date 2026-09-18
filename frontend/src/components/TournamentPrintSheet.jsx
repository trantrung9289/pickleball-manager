import { useEffect, useState } from "react";
import { tournamentsApi } from "../api";
import {
  projectedQualifierLabels, buildProjectedBracketNodes, buildRealBracketNodes, computeBracketGeometry,
  findThirdPlaceMatch,
} from "../utils/bracketLayout";

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

const BOX_W = 200;
const BOX_H = 60;
const COL_GAP = 70;

// ── Khối tiêu đề dùng chung mọi trang in ─────────────────────────────────────
function SheetHeader({ tournament, subtitle }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      borderBottom: "3px solid #141413", paddingBottom: 10, marginBottom: 10,
    }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#888" }}>
          CLB Pickleball ___________________
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>{subtitle}</div>
        <div style={{ fontSize: 12.5, color: "#555", marginTop: 2 }}>Tên giải: {tournament.name}</div>
      </div>
      <div style={{ textAlign: "right", fontSize: 12, color: "#555", lineHeight: 1.6, whiteSpace: "nowrap" }}>
        Ngày: ____ / ____ / 2026 &nbsp;·&nbsp; Số đội: <b>{tournament.participants.length}</b>
        &nbsp;·&nbsp; {tournament.team_type === "doubles" ? "Đấu đôi" : "Đấu đơn"}
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

function StandingsShell({ rows }) {
  if (!rows) return null;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <colgroup>
        {STANDINGS_COLS.map((c) => <col key={c.label} style={c.width ? { width: c.width } : undefined} />)}
      </colgroup>
      <thead>
        <tr>
          {STANDINGS_COLS.map((c, i) => (
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
          <tr key={r.participant_id}>
            <td style={cellStyle("center")}>{i + 1}</td>
            <td style={{ ...cellStyle("left"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.team_name}</td>
            <td style={cellStyle("center")}>{r.played}</td>
            <td style={cellStyle("center")}>{r.won}</td>
            <td style={cellStyle("center")}>{r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}</td>
            <td style={cellStyle("center")}>{r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const cellStyle = (align) => ({ fontSize: 12.5, padding: "5px 6px", borderBottom: "1px solid #e5e5e5", textAlign: align });

// ── Sơ đồ nhánh (dùng chung cho vòng loại thật và sơ đồ dự kiến) ─────────────
// roundsNodes: [{id, feederIds, ...}], mỗi node cần content(node) -> {top, bottom, isBye, matchNumber}
function BracketDiagram({ roundsNodes, content, roundTitles }) {
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

  return (
    <div style={{ position: "relative", width, height: totalHeight + 30 }}>
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
                {c.top || c.bottom} <span style={{ marginLeft: 6, fontSize: 10.5 }}>(miễn — vào thẳng vòng sau)</span>
              </div>
            );
          }
          return (
            <div key={node.id} style={{ position: "absolute", left: x, top: y, width: BOX_W, border: "1.5px solid #333", borderRadius: 4, background: "#fff" }}>
              {c.matchNumber != null && (
                <div style={{ position: "absolute", right: 6, top: -13, fontSize: 9.5, color: "#aaa" }}>#{c.matchNumber}</div>
              )}
              <Slot label={c.top} score={c.score1} scored={c.scored} />
              <Slot label={c.bottom} score={c.score2} scored={c.scored} last />
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
    </div>
  );
}

// Ô "Hạng 3" hiển thị riêng cạnh sơ đồ chính (trận này không nằm trong cây next_match_id)
function ThirdPlaceBox({ thirdPlaceInfo }) {
  if (!thirdPlaceInfo) return null;
  const { match: m, feeders } = thirdPlaceInfo;
  const nameFor = (side) => {
    const pid = side === 1 ? m.p1_id : m.p2_id;
    if (pid) return teamLabel(side === 1 ? m.p1 : m.p2);
    const feeder = feeders.find((f) => f.loser_next_match_slot === side);
    return feeder ? `Thua ${feeder.round_name} #${feeder.match_number}` : null;
  };
  const scored = m.status === "completed" && m.score1 != null;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#555", marginBottom: 4 }}>
        Tranh giải 3
      </div>
      <div style={{ width: BOX_W, border: "1.5px solid #333", borderRadius: 4, background: "#fff" }}>
        <Slot label={nameFor(1)} score={m.score1} scored={scored} />
        <Slot label={nameFor(2)} score={m.score2} scored={scored} last />
      </div>
    </div>
  );
}

function Slot({ label, score, scored, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "0 8px", height: 30,
      borderBottom: last ? "none" : "1px solid #ccc",
    }}>
      <span style={{ fontSize: 12.5, color: label ? "#141413" : "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label || " "}
      </span>
      <div style={{ width: 26, height: 19, border: "1.2px solid #333", borderRadius: 2, flex: "none", textAlign: "center", fontSize: 11, lineHeight: "17px" }}>
        {scored ? score : " "}
      </div>
    </div>
  );
}

function realBracketContent(node) {
  const m = node.match;
  const topLabel = m.p1_id ? teamLabel(m.p1) : (node.feeders[0] ? `Thắng ${node.feeders[0].round_name} #${node.feeders[0].match_number}` : null);
  const bottomLabel = m.p2_id ? teamLabel(m.p2) : (node.feeders[1] ? `Thắng ${node.feeders[1].round_name} #${node.feeders[1].match_number}` : null);
  const isBye = m.status === "completed" && m.score1 == null; // bye tự hoàn thành, không có tỉ số
  return {
    top: isBye ? teamLabel(m.p1 || m.p2) : topLabel,
    bottom: bottomLabel,
    isBye,
    matchNumber: m.match_number,
    scored: m.status === "completed" && m.score1 != null,
    score1: m.score1, score2: m.score2,
  };
}

function projectedBracketContent(node, roundIndex) {
  // Bye (1 bên trống, tự động miễn vào vòng sau) chỉ có thể xảy ra ở vòng đầu tiên do cấu trúc
  // bracket — từ vòng 2 trở đi, "1 bên đã biết, 1 bên chưa" nghĩa là ĐANG CHỜ đối thủ thật,
  // không phải bye, nên không gắn nhãn "miễn".
  const isBye = roundIndex === 0 && !!((node.top && !node.bottom) || (node.bottom && !node.top));
  return { top: node.top, bottom: node.bottom, isBye, matchNumber: null, scored: false };
}

// ── Trang: vòng tròn / vòng tròn hai lượt / thi đấu riêng lẻ ─────────────────
function RoundRobinSheet({ tournament, standings }) {
  return (
    <div className="print-page print-portrait">
      <SheetHeader tournament={tournament} subtitle={`BẢNG THI ĐẤU — ${FORMAT_LABEL[tournament.format].toUpperCase()}`} />
      <div style={{ display: "flex", gap: 28 }}>
        <div style={{ flex: 1 }}>
          <MatchRows matches={tournament.matches} />
        </div>
        <div style={{ width: 270 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "#555", textTransform: "uppercase", margin: "0 0 4px", paddingBottom: 3, borderBottom: "2px solid #141413" }}>
            Bảng xếp hạng
          </div>
          <StandingsShell rows={standings} />
          <div style={{ marginTop: 28, padding: 12, border: "1.3px dashed #bbb", borderRadius: 6, fontSize: 11.5, color: "#666", lineHeight: 1.6 }}>
            <b style={{ color: "#141413" }}>Ghi chú</b><br />
            Điền tỉ số vào 2 ô mỗi trận ngay sau khi kết thúc. Sau buổi đấu, nhập lại vào ứng dụng — hệ thống tự tính bảng xếp hạng.
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
  const thirdPlaceInfo = findThirdPlaceMatch(tournament.matches);
  return (
    <div className="print-page print-landscape">
      <SheetHeader tournament={tournament} subtitle="SƠ ĐỒ ĐẤU LOẠI TRỰC TIẾP" />
      <BracketDiagram roundsNodes={roundsNodes} content={realBracketContent} roundTitles={roundTitles} />
      <ThirdPlaceBox thirdPlaceInfo={thirdPlaceInfo} />
      <div className="print-footnote">
        Trận có 1 đội trống ("bye") tự động miễn vào vòng sau, không cần ghi điểm.
      </div>
    </div>
  );
}

// ── Trang: vòng bảng + loại trực tiếp ─────────────────────────────────────────
function CombinedSheet({ tournament, standingsByGroup }) {
  const groups = [...new Set(tournament.participants.map((p) => p.group_name).filter(Boolean))].sort();
  const koMatches = tournament.matches.filter((m) => m.phase === "knockout");
  const hasRealKO = koMatches.length > 0;

  let bracketEl;
  if (hasRealKO) {
    const roundsNodes = buildRealBracketNodes(koMatches);
    const roundTitles = roundsNodes.map((r) => r[0]?.match?.round_name || "Vòng");
    const thirdPlaceInfo = findThirdPlaceMatch(koMatches);
    bracketEl = (
      <>
        <BracketDiagram roundsNodes={roundsNodes} content={realBracketContent} roundTitles={roundTitles} />
        <ThirdPlaceBox thirdPlaceInfo={thirdPlaceInfo} />
      </>
    );
  } else {
    const labels = projectedQualifierLabels(groups);
    const roundsNodes = buildProjectedBracketNodes(labels);
    const roundTitles = roundsNodes.map((_, i) => {
      const fromEnd = roundsNodes.length - 1 - i;
      return fromEnd === 0 ? "Chung kết" : fromEnd === 1 ? "Bán kết" : `Vòng loại ${i + 1}`;
    });
    bracketEl = <BracketDiagram roundsNodes={roundsNodes} content={projectedBracketContent} roundTitles={roundTitles} />;
  }

  return (
    <div className="print-page print-landscape">
      <SheetHeader tournament={tournament} subtitle="VÒNG BẢNG + LOẠI TRỰC TIẾP" />
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ width: 430, display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.map((g) => (
            <div key={g}>
              <div style={{ fontSize: 13, fontWeight: 800, background: "#141413", color: "#fff", padding: "4px 10px", borderRadius: 3, display: "inline-block", marginBottom: 6 }}>
                BẢNG {g}
              </div>
              <MatchRows matches={tournament.matches.filter((m) => m.phase === "group" && m.group_name === g)} />
              <div style={{ marginTop: 6 }}>
                <StandingsShell rows={standingsByGroup?.[g]} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {bracketEl}
          {!hasRealKO && (
            <div style={{ marginTop: 12, padding: "10px 12px", border: "1.3px dashed #bbb", borderRadius: 6, fontSize: 11, color: "#666", lineHeight: 1.6 }}>
              <b style={{ color: "#141413" }}>Ghi chú</b><br />
              Sơ đồ trên là DỰ KIẾN theo luật ghép cặp của hệ thống — tên thật chỉ chốt sau khi vòng bảng
              đấu xong và bấm "Bắt đầu vòng loại trực tiếp". In lại trang này khi đó để có tên thật.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Component in bảng thi đấu — render ẩn (display:none khi ở màn hình thường), chỉ hiện khi in
 * (xem quy tắc @media print trong index.css). Gọi onReady() khi đã tải xong dữ liệu cần thiết
 * (bảng xếp hạng) để nơi gọi biết lúc nào an toàn để trigger window.print().
 */
export default function TournamentPrintSheet({ tournament, onReady }) {
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
  return (
    <div className="print-sheet-root">
      {fmt === "knockout" && <KnockoutSheet tournament={tournament} />}
      {fmt === "combined" && <CombinedSheet tournament={tournament} standingsByGroup={standings} />}
      {(fmt === "round_robin" || fmt === "round_robin_double" || fmt === "individual") && (
        <RoundRobinSheet tournament={tournament} standings={standings._all} />
      )}
    </div>
  );
}
