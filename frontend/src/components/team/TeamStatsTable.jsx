/**
 * TeamStatsTable — tab "Thống kê" giải đồng đội: số liệu TOÀN GIẢI (mọi giai đoạn) từng đội, tính thẳng từ
 * matches[].rubbers đã có trong dữ liệu giải (không gọi API). Một bảng / bảng đấu (hoặc một bảng chung).
 * Props: { tournament, rules }
 */
import { useMemo } from "react";
import { Card, Typography } from "antd";
import ResponsiveTable from "../ResponsiveTable";
import { teamAllStageStats } from "../../utils/teamOverview";

const { Text } = Typography;
const signed = (v) => <Text style={{ color: v > 0 ? "#52c41a" : v < 0 ? "#ff4d4f" : "inherit", fontWeight: 600 }}>{v > 0 ? `+${v}` : v}</Text>;

export default function TeamStatsTable({ tournament, rules }) {
  const rows = useMemo(() => teamAllStageStats(tournament.matches, tournament.participants, rules), [tournament.matches, tournament.participants, rules]);
  const groups = [...new Set(rows.map((r) => r.group_name).filter(Boolean))].sort();
  const cols = [
    { title: "Đội", dataIndex: "team_name", render: (v, r) => <span style={r.status === "withdrawn" ? { textDecoration: "line-through", color: "#999" } : undefined}>{v}</span> },
    { title: "Trận ĐĐ", key: "ties", width: 90, align: "center", render: (_, r) => `${r.ties_won}/${r.ties_played}` },
    { title: "TP thắng", dataIndex: "rubbers_won", width: 85, align: "center", render: (v) => <Text style={{ color: "#52c41a", fontWeight: 600 }}>{v}</Text> },
    { title: "TP thua", dataIndex: "rubbers_lost", width: 80, align: "center", render: (v) => <Text style={{ color: "#ff4d4f" }}>{v}</Text> },
    { title: "Điểm ghi", dataIndex: "pts_for", width: 85, align: "center" },
    { title: "Điểm mất", dataIndex: "pts_against", width: 85, align: "center" },
    { title: "Hiệu số", dataIndex: "diff", width: 80, align: "center", render: signed },
  ];
  const table = (data) => (
    <ResponsiveTable columns={cols} dataSource={data} rowKey="participant_id" size="small" pagination={false}
      mobileTitle={(r) => <span><b>{r.team_name}</b> <Text type="secondary">· {r.ties_won}/{r.ties_played} trận ĐĐ · HS {r.diff > 0 ? `+${r.diff}` : r.diff}</Text></span>}
      mobileHideColumns={["Đội", "Trận ĐĐ", "Hiệu số"]} />
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Tính trên mọi trận đồng đội đã kết thúc, gồm cả vòng bảng và vòng loại trực tiếp. Trận ĐĐ = thắng/đã đấu;
        TP = trận thành phần; điểm = điểm nhỏ ghi được / để mất trong các trận thành phần.
      </Text>
      {groups.length > 1
        ? groups.map((g) => <Card key={g} size="small" title={`Bảng ${g}`}>{table(rows.filter((r) => r.group_name === g))}</Card>)
        : <Card size="small">{table(rows)}</Card>}
    </div>
  );
}
