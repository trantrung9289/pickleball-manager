import { useEffect, useState } from "react";
import { Button, Empty, Modal, Spin, Tag, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { tournamentsApi } from "../../api";
import ResponsiveTable from "../ResponsiveTable";
import { useViewMode } from "../../contexts/ViewModeContext";

const { Text } = Typography;

const KIND_MAP = {
  lineup_set: { label: "Đội hình", color: "blue" },
  lineup_lock: { label: "Khoá đội hình", color: "default" },
  lineup_unlock: { label: "Mở khoá", color: "orange" },
  draw_order: { label: "Bốc thăm", color: "purple" },
  rubber_players: { label: "Đổi VĐV", color: "cyan" },
  score: { label: "Điểm", color: "green" },
  walkover: { label: "Xử thua", color: "gold" },
  score_reset: { label: "Xoá điểm", color: "red" },
};

/** Nhật ký thao tác giải đồng đội (200 dòng mới nhất). Props: { tournament, onClose } */
export default function TeamLogsModal({ tournament, onClose }) {
  const { isMobileView } = useViewMode();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const matchById = Object.fromEntries((tournament.matches || []).map((m) => [m.id, m]));
  const teamById = Object.fromEntries((tournament.participants || []).map((p) => [p.id, p.team_name]));

  const tid = tournament.id;
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    tournamentsApi.teamLogs(tid, 200)
      .then((r) => { if (!cancelled) setRows(r.data || []); })
      .catch((err) => { if (!cancelled) message.error(err?.response?.data?.detail || "Không tải được nhật ký"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tid, reloadKey]);
  const load = () => { setLoading(true); setReloadKey((k) => k + 1); };

  const cols = [
    { title: "Thời gian", dataIndex: "created_at", width: 120, render: (v) => (v ? dayjs(v).format("DD/MM HH:mm") : "—") },
    { title: "Loại", dataIndex: "kind", width: 120, render: (v) => { const k = KIND_MAP[v] || { label: v, color: "default" }; return <Tag color={k.color}>{k.label}</Tag>; } },
    {
      title: "Nội dung", dataIndex: "note",
      render: (v, r) => (
        <span>
          {r.match_id && matchById[r.match_id] && <Text type="secondary">#{matchById[r.match_id].match_number} · </Text>}
          {r.participant_id && teamById[r.participant_id] && <Text strong>{teamById[r.participant_id]}: </Text>}
          {v}
        </span>
      ),
    },
    { title: "Người thao tác", dataIndex: "actor_name", width: 140, render: (v) => v || "—" },
  ];

  return (
    <Modal open onCancel={onClose} destroyOnHidden title="Nhật ký giải đồng đội"
      width={isMobileView ? "100vw" : 820}
      style={isMobileView ? { top: 0, margin: 0, maxWidth: "100vw", paddingBottom: 0 } : undefined}
      footer={<Button onClick={onClose}>Đóng</Button>}>
      <div style={{ marginBottom: 8, textAlign: "right" }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>Làm mới</Button>
      </div>
      {loading && rows.length === 0 ? <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
        : rows.length === 0 ? <Empty description="Chưa có thao tác nào" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : <ResponsiveTable columns={cols} dataSource={rows} rowKey="id" size="small" pagination={{ pageSize: 25 }}
              mobileTitle={(r) => <span>{r.created_at ? dayjs(r.created_at).format("DD/MM HH:mm") : ""} · {(KIND_MAP[r.kind] || { label: r.kind }).label}</span>}
              mobileHideColumns={["Thời gian", "Loại"]} />}
    </Modal>
  );
}
