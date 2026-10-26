import { Tag, Typography } from "antd";
import { matchRubbersForDisplay, rubberName, rubberScoreView } from "../../utils/teamFormat";

const { Text } = Typography;

const STATUS = {
  completed: { label: "Đã đấu", color: "success" },
  walkover: { label: "Xử thua", color: "gold" },
  ready: { label: "Chờ đấu", color: "processing" },
  pending: { label: "Chưa xếp", color: "default" },
};

const statusOf = (r) => {
  if (r.is_walkover) return STATUS.walkover;
  if (r.status === "completed") return STATUS.completed;
  if ((r.side1_players || []).length || (r.side2_players || []).length) return STATUS.ready;
  return STATUS.pending;
};

function Names({ ids, byId, win, align }) {
  const names = (ids || []).map((id) => byId?.[id]?.display_name || `#${id}`);
  if (!names.length) return <span style={{ display: "block", textAlign: align }}><Text type="secondary" style={{ fontSize: 12 }}>—</Text></span>;
  return (
    <span style={{ fontWeight: win ? 700 : 400, color: win ? "#237804" : undefined, textAlign: align, display: "block", wordBreak: "break-word" }}>
      {names.join(" / ")}
    </span>
  );
}

/**
 * Chi tiết các trận thành phần của MỘT trận đồng đội, hiển thị ngay trong lịch (hàng mở rộng), thẻ di động và
 * popover sơ đồ nhánh — dùng chung admin & public, không gọi API. Dữ liệu: match.rubbers (nhúng trong
 * TournamentOut/PublicTournamentOut) + bản đồ id → VĐV (tournament.team_players). Chưa có biên bản → mẫu theo
 * team_rules kèm ghi chú.
 * Props: { match, rules (team_rules đã/ chưa chuẩn hoá), playersById, compact (popover: chữ nhỏ, không ghi chú) }
 */
export default function TieRubbersInline({ match, rules, playersById, compact = false }) {
  const { rubbers, template } = matchRubbersForDisplay(match, rules);
  if (!rubbers.length) return null;
  const fs = compact ? 12 : 13;
  return (
    <div style={{ fontSize: fs }}>
      {template && !compact && (
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
          Chưa mở biên bản — thứ tự thi đấu sẽ bốc thăm khi mở biên bản.
        </Text>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto minmax(0,1fr) auto", columnGap: compact ? 8 : 12, rowGap: 4, alignItems: "center" }}>
        {rubbers.map((r) => {
          const sv = rubberScoreView(r, rules);
          const st = statusOf(r);
          return [
            <span key={`${r.id}-l`} style={{ whiteSpace: "nowrap" }}>
              <Text type="secondary" style={{ fontSize: fs - 1 }}>{template ? "" : `${r.order_index}. `}</Text>
              <Text strong style={{ fontSize: fs }}>{r.label}</Text>
              {r.label !== rubberName(r.code) && !compact && <Text type="secondary" style={{ fontSize: 11 }}> ({rubberName(r.code)})</Text>}
              {r.court && <Tag color="geekblue" style={{ marginLeft: 6, fontSize: 11, lineHeight: "18px", padding: "0 5px" }}>Sân {r.court}</Tag>}
            </span>,
            <Names key={`${r.id}-1`} ids={r.side1_players} byId={playersById} win={sv.winner === 1} align="left" />,
            <span key={`${r.id}-s`} style={{ textAlign: "center", whiteSpace: "nowrap", minWidth: 48 }}>
              {sv.text
                ? <b style={{ fontSize: fs + 1 }}>{sv.text}</b>
                : <Text type="secondary">–</Text>}
              {sv.own && <div><Text type="secondary" style={{ fontSize: 11 }}>+{sv.own}</Text></div>}
            </span>,
            <Names key={`${r.id}-2`} ids={r.side2_players} byId={playersById} win={sv.winner === 2} align="right" />,
            <Tag key={`${r.id}-t`} color={st.color} style={{ margin: 0, fontSize: 11, lineHeight: "18px", padding: "0 6px" }}>{st.label}</Tag>,
          ];
        })}
      </div>
      {!compact && match?.btc_note && (
        <Text type="secondary" style={{ display: "block", marginTop: 6, fontSize: 12 }}>📝 Ghi chú BTC: {match.btc_note}</Text>
      )}
    </div>
  );
}
