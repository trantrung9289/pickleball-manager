import { Popover, Typography, theme } from "antd";
import { TrophyOutlined } from "@ant-design/icons";
import { buildRealBracketNodes, computeBracketGeometry, findThirdPlaceMatch } from "../utils/bracketLayout";
import { teamLabel, teamRank } from "../utils/tournamentLabels";
import { tieScoreText } from "../utils/teamLabels";

const { Text } = Typography;

/**
 * Sơ đồ nhánh loại trực tiếp (desktop/tablet) — DÙNG CHUNG trang quản trị và trang public (2026-10-31).
 * Cùng logic hình học với bảng in (bracketLayout.js). Màu lấy từ token antd → đúng cả giao diện sáng/tối/Galaxy.
 *
 * Props: matches (đủ trận, kể cả Tranh giải 3), onOpen(match) — bấm ô trận (nhập điểm / mở biên bản; chỉ khi đủ 2 đội),
 *        renderDetail(match) — popover chi tiết trận thành phần của giải đồng đội.
 * Không tự cuộn: khung ngoài (BracketFrame) lo cuộn + zoom.
 */
const BOX_W = 240;
const COL_GAP = 64;
const ROW_H = 40;                 // mỗi bên 1 hàng cao cố định → ô đều nhau, đường nối luôn đúng tâm
const BOX_H = ROW_H * 2 + 2;
const HEADER_H = 48;
const CHAMP_W = 208;
const SIDE_GAP = 28;              // khoảng cách từ thân cây tới khối Tranh giải 3
const SIDE_LABEL_H = 24;

/** Nhãn 2 bên của ô trận; chưa có đội thì "Thắng #n". Bye cấu trúc (1 bên trống thật) chỉ ở vòng đầu. */
function nodeLabels(node) {
  const m = node.match;
  const top = m.p1_id ? teamLabel(m.p1) : (node.feeders[0] ? `Thắng #${node.feeders[0].match_number}` : null);
  const bottom = m.p2_id ? teamLabel(m.p2) : (node.feeders[1] ? `Thắng #${node.feeders[1].match_number}` : null);
  const isStructuralBye = m.status === "completed" && (!m.p1_id || !m.p2_id);
  return {
    top: isStructuralBye ? teamLabel(m.p1 || m.p2) : top,
    bottom,
    isBye: isStructuralBye,
    byeNote: isStructuralBye && m.winner_id == null ? "bỏ giải — không vào vòng sau" : null,
  };
}

function Slot({ t, label, rank, score, state, isWalkover, last }) {
  // state: winner | loser | open (chưa xong) | live (đang đấu dở) | pending (chưa có đội)
  const winner = state === "winner";
  const pending = state === "pending";
  const scoreBg = winner ? t.colorSuccess : isWalkover ? t.colorWarningBg : t.colorFillSecondary;
  const scoreFg = winner ? "#fff" : isWalkover ? t.colorWarning : state === "live" ? t.colorPrimary : pending ? t.colorTextQuaternary : t.colorText;
  return (
    <div style={{
      height: ROW_H, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      padding: "0 8px 0 10px",
      borderBottom: last ? "none" : `1px solid ${t.colorBorderSecondary}`,
      borderLeft: `3px solid ${winner ? t.colorSuccess : "transparent"}`,
      background: winner ? t.colorSuccessBg : "transparent",
    }}>
      <span style={{
        minWidth: 0, fontSize: 13.5, lineHeight: 1.25, fontWeight: winner ? 700 : 500, fontStyle: pending ? "italic" : "normal",
        color: pending ? t.colorTextQuaternary : state === "loser" ? t.colorTextSecondary : t.colorText,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word",
      }} title={label || undefined}>
        {label || "Chờ kết quả"}
        {rank && (
          <span style={{
            marginLeft: 5, padding: "0 5px", fontSize: 10.5, fontWeight: 600, lineHeight: "15px", borderRadius: 4,
            display: "inline-block", verticalAlign: "1px", background: t.colorFillTertiary, color: t.colorTextSecondary,
          }}>{rank}</span>
        )}
      </span>
      <span style={{
        flex: "none", minWidth: 30, height: 24, padding: "0 4px", boxSizing: "border-box", borderRadius: 6, textAlign: "center",
        lineHeight: "24px", fontSize: isWalkover ? 11 : 14, fontWeight: 700, background: scoreBg, color: scoreFg,
      }}>
        {isWalkover ? "XT" : (score ?? "–")}
      </span>
    </div>
  );
}

/** Bọc ô nhánh bằng Popover chi tiết trận thành phần (chỉ khi có renderDetail và trận đủ 2 đội). */
function DetailPopover({ match, renderDetail, children }) {
  if (!renderDetail || !match?.p1_id || !match?.p2_id) return children;
  return (
    <Popover content={<div style={{ maxWidth: 560 }}>{renderDetail(match)}</div>} placement="right" mouseEnterDelay={0.25}
      title={<span style={{ fontSize: 12 }}>{teamLabel(match.p1)} vs {teamLabel(match.p2)}</span>}>
      {children}
    </Popover>
  );
}

/** Ô một trận (cây chính hoặc Tranh giải 3). labels: [trên, dưới] đã tính sẵn. */
function MatchBox({ t, match: m, labels, onOpen, renderDetail, style }) {
  const done = m.status === "completed";
  const live = !done && !!onOpen && tieScoreText(m) != null;   // giải đồng đội: tỉ số tạm của trận đang đấu dở
  const showScore = done || live;
  const clickable = !!onOpen && !!m.p1_id && !!m.p2_id;
  const stateOf = (pid, label) => {
    if (!pid && !done) return "pending";
    if (done && m.winner_id) return m.winner_id === pid ? "winner" : "loser";
    return live ? "live" : (label ? "open" : "pending");
  };
  return (
    <DetailPopover match={m} renderDetail={renderDetail}>
      <div
        className={clickable ? "ui-bracket-box is-click" : "ui-bracket-box"}
        onClick={clickable ? () => onOpen(m) : undefined}
        title={clickable ? "Bấm để mở trận" : undefined}
        style={{
          position: "absolute", width: BOX_W, boxSizing: "border-box", overflow: "hidden", borderRadius: 10,
          background: t.colorBgContainer,
          border: `1.5px solid ${done ? t.colorSuccessBorder : live ? t.colorPrimary : t.colorBorder}`,
          cursor: clickable ? "pointer" : "default", ...style,
        }}
      >
        <Slot t={t} label={labels[0]} rank={teamRank(m.p1)} score={showScore ? m.score1 : null}
          state={stateOf(m.p1_id, labels[0])} isWalkover={m.is_walkover} />
        <Slot t={t} label={labels[1]} rank={teamRank(m.p2)} score={showScore ? m.score2 : null}
          state={stateOf(m.p2_id, labels[1])} isWalkover={m.is_walkover} last />
      </div>
    </DetailPopover>
  );
}

export default function BracketTree({ matches, onOpen, renderDetail }) {
  const { token: t } = theme.useToken();
  const roundsNodes = buildRealBracketNodes(matches);
  if (!roundsNodes.length) return null;
  const thirdInfo = findThirdPlaceMatch(matches);
  const { centers, totalHeight } = computeBracketGeometry(roundsNodes, { boxHeight: BOX_H, minGap: 28 });
  const colX = (r) => r * (BOX_W + COL_GAP);
  const champX = colX(roundsNodes.length);
  const treeWidth = champX + CHAMP_W;
  const bodyBottom = HEADER_H + totalHeight;
  const thirdTop = bodyBottom + SIDE_GAP;
  const treeHeight = thirdInfo ? thirdTop + SIDE_LABEL_H + BOX_H + 12 : bodyBottom + 12;

  const lines = [];
  roundsNodes.forEach((round, r) => {
    if (r === 0) return;
    const xEnd = colX(r), xStart = xEnd - COL_GAP, xMid = xStart + COL_GAP / 2;
    round.forEach((node) => {
      const [a, b] = node.feederIds || [];
      if (a == null || b == null) return;
      const ya = centers[a], yb = centers[b], yMid = centers[node.id];
      lines.push(<path key={`${node.id}-l`} d={`M${xStart},${ya} H${xMid} V${yb} M${xStart},${yb} H${xMid} M${xMid},${yMid} H${xEnd}`} />);
    });
  });
  const finalRound = roundsNodes[roundsNodes.length - 1];
  const finalNode = finalRound[0];
  const finalY = finalNode?.id != null ? centers[finalNode.id] : totalHeight / 2;
  if (finalNode?.id != null) lines.push(<path key="champ" d={`M${champX - COL_GAP},${finalY} H${champX}`} />);
  const finalMatch = finalNode?.match;
  const champion = finalMatch?.status === "completed" && finalMatch.winner_id
    ? teamLabel(finalMatch.winner_id === finalMatch.p1_id ? finalMatch.p1 : finalMatch.p2)
    : null;

  const headStyle = { position: "absolute", top: 0, width: BOX_W };
  const title = (color) => ({ display: "block", color, fontSize: 13, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" });
  const subtitle = { display: "block", color: t.colorTextTertiary, fontSize: 12, marginTop: 2 };

  return (
    <div style={{ position: "relative", width: treeWidth, height: treeHeight }}>
      {roundsNodes.map((round, i) => {
        const done = round.filter((n) => n.match.status === "completed").length;
        return (
          <div key={i} style={{ ...headStyle, left: colX(i) }}>
            <Text style={title(t.colorPrimary)}>{round[0]?.match?.round_name || `Vòng ${i + 1}`}</Text>
            <Text style={subtitle}>{done}/{round.length} đã đấu</Text>
          </div>
        );
      })}
      <div style={{ ...headStyle, left: champX, width: CHAMP_W }}>
        <Text style={title(t.colorWarning)}><TrophyOutlined /> Vô địch</Text>
      </div>

      <svg width={treeWidth} height={totalHeight} style={{ position: "absolute", left: 0, top: HEADER_H }}
        stroke={t.colorTextQuaternary} strokeWidth="2" fill="none">
        {lines}
      </svg>

      {roundsNodes.map((round, r) => round.map((node) => {
        const m = node.match;
        const c = nodeLabels(node);
        const top = HEADER_H + centers[node.id] - BOX_H / 2;
        if (c.isBye) {
          return (
            <div key={node.id} style={{
              position: "absolute", left: colX(r), top, width: BOX_W, height: BOX_H, boxSizing: "border-box", borderRadius: 10,
              border: `1.5px dashed ${t.colorBorder}`, background: t.colorFillQuaternary,
              display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, padding: "0 12px",
            }}>
              <Text style={{ fontSize: 13.5, fontWeight: 500, color: t.colorText }}>{c.top}</Text>
              <Text style={{ fontSize: 11.5, color: t.colorTextTertiary }}>{c.byeNote || "miễn — vào vòng sau"}</Text>
            </div>
          );
        }
        return (
          <div key={node.id}>
            <Text style={{ position: "absolute", left: colX(r) + BOX_W - 60, width: 60, textAlign: "right", top: top - 17, fontSize: 11, color: t.colorTextQuaternary }}>#{m.match_number}</Text>
            <MatchBox t={t} match={m} labels={[c.top, c.bottom]} onOpen={onOpen} renderDetail={renderDetail} style={{ left: colX(r), top }} />
          </div>
        );
      }))}

      <div style={{
        position: "absolute", left: champX, top: HEADER_H + finalY - 48, width: CHAMP_W, height: 96, boxSizing: "border-box", borderRadius: 12,
        border: `1.5px solid ${champion ? t.colorWarning : t.colorBorder}`, background: champion ? t.colorWarningBg : t.colorFillQuaternary,
        display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6, padding: "0 12px", textAlign: "center",
      }}>
        <TrophyOutlined style={{ fontSize: 24, color: champion ? t.colorWarning : t.colorTextQuaternary }} />
        <span style={{
          fontSize: champion ? 15 : 13, fontWeight: champion ? 700 : 500, lineHeight: 1.25, color: champion ? t.colorText : t.colorTextTertiary,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word",
        }}>{champion || "Chưa xác định"}</span>
      </div>

      {thirdInfo && (() => {
        const { match: m, feeders } = thirdInfo;
        const nameFor = (side) => {
          const pid = side === 1 ? m.p1_id : m.p2_id;
          if (pid) return teamLabel(side === 1 ? m.p1 : m.p2);
          const f = feeders.find((x) => x.loser_next_match_slot === side);
          return f ? `Thua #${f.match_number}` : null;
        };
        return (
          <>
            <Text style={{ ...title(t.colorWarning), position: "absolute", left: colX(roundsNodes.length - 1), top: thirdTop, width: BOX_W }}>
              Tranh giải 3
            </Text>
            <MatchBox t={t} match={m} labels={[nameFor(1), nameFor(2)]} onOpen={onOpen} renderDetail={renderDetail}
              style={{ left: colX(roundsNodes.length - 1), top: thirdTop + SIDE_LABEL_H }} />
          </>
        );
      })()}
    </div>
  );
}
