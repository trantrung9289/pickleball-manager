/**
 * PushHistoryCard — "Lịch sử đẩy" trong trang Thông báo (2026-10-30): mỗi tin hệ thống đã gửi thật, theo kênh (Telegram, thiết bị, Zalo),
 * nguồn (tự động / khi lưu quy tắc / Gửi ngay) và kết quả. Chỉ giữ 7 ngày gần nhất, xoá ngày xa nhất (backend tự dọn).
 * Props: { refreshKey } — đổi giá trị để tải lại (sau khi Gửi ngay / Làm mới trang).
 */
import { useEffect, useState } from "react";
import { Button, Card, Select, Space, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import ResponsiveTable from "./ResponsiveTable";
import { StatusChip } from "./ui";
import { announcementsApi } from "../api";
import { PUSH_CHANNEL_LABELS, PUSH_SOURCE_LABELS, formatHistoryTime, historyResult } from "../utils/announcements";

const { Text } = Typography;
const CHANNEL_COLORS = { telegram: "blue", web: "purple", zalo: "cyan" };

export default function PushHistoryCard({ refreshKey = 0 }) {
  const [rows, setRows] = useState([]);
  const [days, setDays] = useState(7);
  const [channel, setChannel] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);   // nút "Làm mới" bấm → tăng để tải lại

  // Tải trong .then (lint React compiler cấm setState đồng bộ trong effect); loading bật ở sự kiện bấm / lần mount đầu
  useEffect(() => {
    let alive = true;
    announcementsApi.pushHistory({ channel: channel || undefined })
      .then((r) => { if (alive) { setRows(r.data.items || []); setDays(r.data.retention_days || 7); } })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [channel, refreshKey, tick]);
  const reload = () => { setLoading(true); setTick((t) => t + 1); };

  const columns = [
    { title: "Thời gian", dataIndex: "sent_at", width: 170, render: (v) => <Text style={{ whiteSpace: "nowrap" }}>{formatHistoryTime(v)}</Text> },
    {
      title: "Thông báo", dataIndex: "title",
      render: (v, r) => (
        <Space size={6} wrap>
          <b>{v}</b>
          {r.pre && <StatusChip tone="warn">Nhắc trước giờ</StatusChip>}
        </Space>
      ),
    },
    { title: "Kênh", dataIndex: "channel", width: 100, render: (v) => <Tag color={CHANNEL_COLORS[v]}>{PUSH_CHANNEL_LABELS[v] || v}</Tag> },
    {
      title: "Kết quả", width: 110,
      render: (_, r) => <Text type={r.error_count ? "danger" : undefined}>{historyResult(r)}</Text>,
    },
    { title: "Nguồn", dataIndex: "source", width: 100, render: (v) => PUSH_SOURCE_LABELS[v] || v },
    { title: "Chi tiết", dataIndex: "detail", render: (v) => (v ? <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> : null) },
  ];

  return (
    <Card size="small" style={{ marginTop: 16 }}
      title={<span>Lịch sử đẩy {rows.length > 0 && <StatusChip tone="brand">{rows.length}</StatusChip>}</span>}
      extra={
        <Space wrap>
          <Select size="small" value={channel} onChange={(v) => { setLoading(true); setChannel(v); }} style={{ width: 130 }}
            options={[{ value: "", label: "Mọi kênh" }, ...Object.entries(PUSH_CHANNEL_LABELS).map(([value, label]) => ({ value, label }))]} />
          <Button size="small" icon={<ReloadOutlined />} onClick={reload} loading={loading}>Làm mới</Button>
        </Space>
      }
    >
      <Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
        Chỉ giữ {days} ngày gần nhất; ngày xa nhất tự xoá. Ghi mỗi lần gửi thật, không ghi các lượt bỏ qua vì đã gửi trong ngày.
        ✔ là số thiết bị, quản trị viên hoặc nhóm nhận được; ✖ là số lỗi.
      </Text>
      <ResponsiveTable columns={columns} dataSource={rows} rowKey="id" loading={loading} size="small"
        pagination={{ pageSize: 15, showSizeChanger: false, hideOnSinglePage: true }}
        mobileTitle={(r) => r.title} mobileHideColumns={["Thông báo"]}
        locale={{ emptyText: "Chưa có lần gửi nào trong 7 ngày gần nhất" }} />
    </Card>
  );
}
