/**
 * TeamStandingsTable — bảng xếp hạng GIẢI ĐỒNG ĐỘI (admin & public), mẫu FIS + yêu cầu 2026-10-23:
 *  - cột theo từng THỂ LOẠI (thắng–thua trận thành phần), HS trận, HS điểm, điểm ghi/mất, điểm bảng;
 *  - chọn LƯỢT (cả giải / lượt đi / lượt về) với vòng tròn hai lượt — API /standings?leg=;
 *  - hàng mở rộng: từng CẶP ĐẤU với mỗi đối thủ, từng lượt, kết quả từng thể loại;
 *  - thứ tự cột/chú thích theo cách xếp hạng của giải (tie_points | point_diff).
 * Props: { tournament, rules, group?, fetchStandings(group, leg) → Promise, onOpenMatch?(match) }
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Segmented, Space, Table, Tag, Tooltip, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";

const { Text } = Typography;
const LEG_LABEL = { leg1: "Lượt đi", leg2: "Lượt về", knockout: "Loại trực tiếp" };
const signed = (v) => <Text style={{ color: v > 0 ? "#52c41a" : v < 0 ? "#ff4d4f" : "inherit" }}>{v > 0 ? `+${v}` : (v ?? 0)}</Text>;

function H2HDetail({ row, matchesById, onOpenMatch }) {
  const h2h = row.breakdown?.h2h || [];
  if (!h2h.length) return <Text type="secondary">Chưa có cặp đấu nào.</Text>;
  const legs = [...new Set(h2h.flatMap((x) => Object.keys(x.legs || {})))].sort();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {h2h.map((x) => (
        <div key={x.opponent_id} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: "6px 10px" }}>
          <Text strong>gặp {x.opponent_name}</Text>
          <div style={{ display: "grid", gridTemplateColumns: legs.length > 1 ? "repeat(auto-fit, minmax(260px, 1fr))" : "1fr", gap: 8, marginTop: 4 }}>
            {legs.map((lg) => {
              const e = x.legs?.[lg];
              if (!e) return <div key={lg}><Text type="secondary">{LEG_LABEL[lg] || lg}: —</Text></div>;
              const m = matchesById[e.match_id];
              const clickable = onOpenMatch && m;
              return (
                <div key={lg} onClick={clickable ? () => onOpenMatch(m) : undefined} style={{ cursor: clickable ? "pointer" : "default" }}>
                  <Space size={4} wrap style={{ marginBottom: 2 }}>
                    <Tag style={{ margin: 0 }}>{LEG_LABEL[lg] || lg}{e.round_name ? ` · ${e.round_name.replace(/^Lượt (đi|về)\s*[–-]\s*/i, "")}` : ""}</Tag>
                    {e.result === "W" && <Tag color="success" style={{ margin: 0 }}>Thắng {e.score_for}–{e.score_against}</Tag>}
                    {e.result === "L" && <Tag color="error" style={{ margin: 0 }}>Thua {e.score_for}–{e.score_against}</Tag>}
                    {!e.result && <Tag color={e.status === "pending" ? "default" : "processing"} style={{ margin: 0 }}>{e.status === "pending" ? "Chưa đấu" : "Đang đấu"}</Tag>}
                    {e.is_walkover && <Tag color="gold" style={{ margin: 0 }}>Xử thua</Tag>}
                  </Space>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {(e.rubbers || []).map((r, i) => (
                      <Tag key={i} color={r.win === true ? "green" : r.win === false ? "red" : "default"} style={{ margin: 0, fontSize: 11 }}>
                        {r.label}: {r.for == null ? "–" : `${r.for}–${r.against}`}{r.walkover ? " (xt)" : ""}
                      </Tag>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TeamStandingsTable({ tournament, rules, group, fetchStandings, onOpenMatch }) {
  const [rows, setRows] = useState([]);
  const [leg, setLeg] = useState(null);
  const twoLegs = tournament.format === "round_robin_double";
  const doneCount = tournament.matches?.filter((m) => m.status === "completed").length ?? 0;
  const rubberDone = tournament.matches?.reduce((n, m) => n + (m.rubbers || []).filter((r) => r.status === "completed").length, 0) ?? 0;
  const matchesById = useMemo(() => Object.fromEntries((tournament.matches || []).map((m) => [m.id, m])), [tournament.matches]);
  const ranking = rules?.ranking === "point_diff" ? "point_diff" : "tie_points";
  const labels = (rules?.rubbers || []).map((r) => r.label);

  useEffect(() => {
    let cancelled = false;
    fetchStandings(group, leg).then((r) => { if (!cancelled) setRows(r?.data ?? r ?? []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [fetchStandings, group, leg, doneCount, rubberDone]);

  const catCols = labels.map((lb) => ({
    title: <Tooltip title={`${lb}: trận thành phần thắng–thua`}><span style={{ fontSize: 12 }}>{lb}</span></Tooltip>,
    key: `cat-${lb}`, width: 74, align: "center", responsive: ["md"],
    render: (_, r) => {
      const c = r.breakdown?.by_category?.[lb];
      if (!c || !c.played) return <Text type="secondary">–</Text>;
      return <span><Text style={{ color: "#52c41a", fontWeight: 600 }}>{c.won}</Text>–<Text style={{ color: "#ff4d4f" }}>{c.lost}</Text></span>;
    },
  }));
  const cols = [
    { title: "#", dataIndex: "rank", width: 40, align: "center", render: (v) => (v <= 2 ? <b style={{ color: v === 1 ? "#faad14" : "#1677ff" }}>{v}</b> : v) },
    {
      title: "Đội", dataIndex: "team_name",
      render: (v, r) => (
        <span>
          {v || r.full_name}
          {r.needs_draw && (
            <Tooltip title={ranking === "point_diff" ? "Bằng hiệu số, điểm ghi và đối đầu — BTC đánh tie-break / bốc thăm" : "Bằng điểm, hiệu số trận và hiệu số điểm — cần bốc thăm để phân hạng"}>
              <Tag color="warning" style={{ marginLeft: 6 }}>{ranking === "point_diff" ? "Tie-break" : "Cần bốc thăm"}</Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    { title: "T.đấu", dataIndex: "played", width: 60, align: "center" },
    { title: "Thắng", dataIndex: "won", width: 60, align: "center", render: (v, r) => <Text style={{ color: "#52c41a", fontWeight: 600 }}>{v}{ranking === "point_diff" ? `/${r.played}` : ""}</Text> },
    ...catCols,
    { title: "HS trận", dataIndex: "rubber_diff", width: 72, align: "center", render: (v) => signed(v ?? 0) },
    { title: "HS điểm", dataIndex: "pts_diff", width: 72, align: "center", render: (v) => <b>{v > 0 ? `+${v}` : (v ?? 0)}</b> },
    { title: "Đ.ghi", dataIndex: "pts_for", width: 64, align: "center", responsive: ["md"] },
    { title: "Đ.mất", dataIndex: "pts_against", width: 64, align: "center", responsive: ["md"] },
    ...(ranking === "tie_points"
      ? [{ title: "Điểm", dataIndex: "points", width: 56, align: "center", render: (v) => <b style={{ color: "#1677ff", fontSize: 15 }}>{v}</b> }]
      : []),
  ];

  // In riêng bảng xếp hạng (mẫu FIS "In bảng xếp hạng"): mở cửa sổ mới chỉ có bảng này rồi gọi in
  const printStandings = () => {
    const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const head = ["#", "Đội", "T.đấu", "Thắng", ...labels, "HS trận", "HS điểm", "Đ.ghi", "Đ.mất", ...(ranking === "tie_points" ? ["Điểm"] : [])];
    const body = rows.map((r) => {
      const cats = labels.map((lb) => { const c = r.breakdown?.by_category?.[lb]; return c && c.played ? `${c.won}–${c.lost}` : "–"; });
      const sg = (v) => (v > 0 ? `+${v}` : (v ?? 0));
      return [r.rank, `${r.team_name || r.full_name}${r.needs_draw ? " (tie-break)" : ""}`, r.played,
        ranking === "point_diff" ? `${r.won}/${r.played}` : r.won, ...cats, sg(r.rubber_diff), sg(r.pts_diff), r.pts_for, r.pts_against,
        ...(ranking === "tie_points" ? [r.points] : [])];
    });
    const title = `${tournament.name || "Giải đấu"} — Bảng xếp hạng${group ? ` bảng ${group}` : ""}${leg ? ` (${leg === "leg1" ? "lượt đi" : "lượt về"})` : ""}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;color:#141413}h2{margin:0 0 4px}p{margin:0 0 10px;color:#555;font-size:12px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:5px 7px;font-size:12.5px;text-align:center}th{background:#eef3f8}td:nth-child(2){text-align:left;font-weight:600}
@media print{body{padding:0}}</style></head><body><h2>${esc(title)}</h2>
<p>${ranking === "point_diff" ? "Xếp theo tổng hiệu số điểm trận thành phần → điểm ghi → đối đầu." : "Xếp theo điểm bảng (1 điểm/trận đồng đội thắng) rồi tie-break điều lệ."} Cột thể loại: trận thành phần thắng–thua. In lúc ${new Date().toLocaleString("vi-VN")}.</p>
<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
<script>window.onload=function(){window.print();}</script></body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 8, justifyContent: "space-between", width: "100%" }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {ranking === "point_diff"
            ? "Xếp theo tổng hiệu số điểm trận thành phần → điểm ghi → đối đầu (kiểu FIS). Thắng = trận đồng đội thắng/đã đấu."
            : "Xếp theo điểm bảng (1 điểm/trận đồng đội thắng) rồi tie-break điều lệ. Cột thể loại: trận thành phần thắng–thua."}
          {" "}Bấm vào hàng để xem từng cặp đấu.
        </Text>
        <Space size={6}>
          {twoLegs && (
            <Segmented size="small" value={leg || "all"} onChange={(v) => setLeg(v === "all" ? null : v)}
              options={[{ label: "Cả giải", value: "all" }, { label: "Lượt đi", value: "leg1" }, { label: "Lượt về", value: "leg2" }]} />
          )}
          <Button size="small" icon={<PrinterOutlined />} onClick={printStandings} disabled={!rows.length}>In BXH</Button>
        </Space>
      </Space>
      <Table columns={cols} dataSource={rows} rowKey="participant_id" size="small" pagination={false}
        scroll={{ x: "max-content" }}
        rowClassName={(_, i) => (i < 2 ? "ant-table-row-selected" : "")}
        expandable={{
          expandedRowRender: (r) => <H2HDetail row={r} matchesById={matchesById} onOpenMatch={onOpenMatch} />,
          expandRowByClick: true,
        }} />
    </div>
  );
}
