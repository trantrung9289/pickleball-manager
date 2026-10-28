/**
 * Trang "Trò chuyện" (quản trị, đợt 2 — 2026-10-28): xem kênh public của CLB, ghim/xoá tin, tắt tiếng người tham gia,
 * khoá kênh, xoá cứng tin theo khoảng ngày (người dùng chọn: không tự xoá, admin xoá tuỳ chọn), tạo bình chọn tên "Ban quản trị".
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Col, DatePicker, Modal, Row, Space, Switch, Tag, Typography, message, Tooltip } from "antd";
import { PushpinOutlined, PushpinFilled, DeleteOutlined, LockOutlined, BarChartOutlined, ReloadOutlined, ClearOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import ResponsiveTable from "../components/ResponsiveTable";
import { StatusChip } from "../components/ui";
import { PollModal } from "../components/chat/PublicChat";
import { chatAdminApi } from "../api";
import { shortTime, mergeMessages } from "../utils/chat";

const { Title, Text } = Typography;

export default function Chat({ perms }) {
  const canEdit = perms?.canEdit ?? true;
  const canDelete = perms?.canDelete ?? true;
  const [messages, setMessages] = useState([]);
  const [meta, setMeta] = useState({ locked: false, total: 0, participants: 0 });
  const [parts, setParts] = useState([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [range, setRange] = useState(null);

  const load = useCallback(() => Promise.all([chatAdminApi.messages({ limit: 50 }), chatAdminApi.participants()]).then(([m, p]) => {
    setMessages(m.data.messages); setMeta({ locked: m.data.locked, total: m.data.total, participants: m.data.participants });
    setHasOlder(m.data.messages.length >= 50); setParts(p.data);
  }).catch(() => message.error("Không tải được trò chuyện")), []);
  useEffect(() => { load(); }, [load]);

  const older = async () => {
    const first = messages[0]; if (!first) return;
    const r = await chatAdminApi.messages({ before_id: first.id, limit: 50 });
    setMessages((prev) => mergeMessages(prev, r.data.messages)); setHasOlder(r.data.messages.length >= 50);
  };
  const act = async (fn, ok) => { try { await fn(); if (ok) message.success(ok); load(); } catch (err) { message.error(err?.response?.data?.detail || "Không thực hiện được"); } };
  const purge = () => {
    if (!range?.[1]) { message.warning("Chọn khoảng ngày"); return; }
    const before = range[1].format("YYYY-MM-DD"), after = range[0] ? range[0].format("YYYY-MM-DD") : null;
    Modal.confirm({
      title: "Xoá vĩnh viễn tin nhắn?", okText: "Xoá", okButtonProps: { danger: true }, cancelText: "Huỷ",
      content: <div>Mọi tin nhắn và bình chọn {after ? `từ ${range[0].format("DD/MM/YYYY")} ` : ""}đến hết <b>{range[1].format("DD/MM/YYYY")}</b> sẽ bị xoá cứng, không khôi phục được.</div>,
      onOk: () => act(async () => { const r = await chatAdminApi.purge({ before, after }); message.success(`Đã xoá ${r.data.deleted} tin`); }),
    });
  };

  const msgColumns = [
    { title: "Thời gian", dataIndex: "created_at", width: 110, render: (v) => shortTime(v) },
    { title: "Người gửi", dataIndex: "name", width: 140, render: (v, r) => <span>{v}{r.pinned && <Tag color="gold" style={{ marginLeft: 6 }}>Ghim</Tag>}</span> },
    { title: "Nội dung", render: (_, r) => r.deleted ? <Text type="secondary" italic>Tin đã thu hồi</Text>
      : r.kind === "poll" ? <span>📊 <b>{r.body}</b>{r.poll && <Text type="secondary"> · {r.poll.total_voters} người chọn{r.poll.closed ? " · đã đóng" : ""}</Text>}
          {r.poll && <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.poll.options.map((o) => `${o.text}: ${o.count}`).join(" · ")}</div>}</span>
      : <span style={{ whiteSpace: "pre-wrap" }}>{r.reply_to && <Text type="secondary">↩ {r.reply_to.name}: </Text>}{r.body}</span> },
    {
      title: "Thao tác", width: 120, render: (_, r) => canEdit && !r.deleted ? (
        <Space>
          <Tooltip title={r.pinned ? "Bỏ ghim" : "Ghim"}><Button size="small" icon={r.pinned ? <PushpinFilled /> : <PushpinOutlined />} onClick={() => act(() => chatAdminApi.pin(r.id))} /></Tooltip>
          {r.kind === "poll" && r.poll && !r.poll.closed && <Tooltip title="Đóng bình chọn"><Button size="small" icon={<LockOutlined />} onClick={() => act(() => chatAdminApi.closePoll(r.poll.id), "Đã đóng bình chọn")} /></Tooltip>}
          <Tooltip title="Thu hồi tin"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => act(() => chatAdminApi.delete(r.id), "Đã thu hồi")} /></Tooltip>
        </Space>
      ) : null,
    },
  ];
  const partColumns = [
    { title: "Tên", dataIndex: "display_name" },
    { title: "Tin", dataIndex: "messages", width: 60 },
    { title: "Vào lúc", dataIndex: "created_at", width: 110, render: (v) => v ? dayjs(v.endsWith("Z") ? v : `${v}Z`).format("DD/MM HH:mm") : "—" },
    { title: "Tắt tiếng", dataIndex: "muted", width: 90, render: (v, r) => <Switch size="small" checked={v} disabled={!canEdit} onChange={() => act(() => chatAdminApi.mute(r.id))} /> },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" gutter={[8, 8]} style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Trò chuyện <StatusChip tone="brand">{meta.total} tin</StatusChip> <StatusChip tone="info">{meta.participants} người</StatusChip></Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load}>Làm mới</Button>
          {canEdit && <Button type="primary" icon={<BarChartOutlined />} onClick={() => setPollOpen(true)}>Tạo bình chọn</Button>}
        </Space>
      </Row>
      {meta.locked && <Alert type="warning" showIcon icon={<LockOutlined />} message="Kênh đang khoá: thành viên chỉ đọc" style={{ marginBottom: 12 }} />}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card size="small" title="Tin nhắn trong kênh public" extra={hasOlder && <Button size="small" onClick={older}>Tải tin cũ hơn</Button>}>
            <ResponsiveTable columns={msgColumns} dataSource={[...messages].reverse()} rowKey="id" size="small" pagination={false}
              mobileTitle={(r) => `${r.name} · ${shortTime(r.created_at)}`} mobileHideColumns={["Thời gian", "Người gửi"]} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card size="small" title="Cài đặt kênh" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span><LockOutlined /> Khoá kênh (chỉ đọc)</span>
                <Switch checked={meta.locked} disabled={!canEdit} onChange={(v) => act(() => chatAdminApi.settings(v), v ? "Đã khoá kênh" : "Đã mở kênh")} />
              </div>
              {canDelete && (
                <div>
                  <Text strong style={{ display: "block", marginBottom: 6 }}><ClearOutlined /> Xoá tin theo khoảng ngày</Text>
                  <Space wrap>
                    <DatePicker.RangePicker value={range} onChange={setRange} format="DD/MM/YYYY" allowEmpty={[true, false]} />
                    <Button danger onClick={purge}>Xoá vĩnh viễn</Button>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>Lịch sử không tự xoá. Xoá cứng cả bình chọn và phiếu trong khoảng đã chọn.</Text>
                </div>
              )}
            </Space>
          </Card>
          <Card size="small" title="Người tham gia">
            <ResponsiveTable columns={partColumns} dataSource={parts} rowKey="id" size="small" pagination={false} mobileTitle={(r) => r.display_name} mobileHideColumns={["Tên"]} />
          </Card>
        </Col>
      </Row>
      <PollModal open={pollOpen} onClose={() => setPollOpen(false)} api={chatAdminApi} onCreated={() => load()} />
    </div>
  );
}
