import React, { useEffect, useState } from "react";
import {
  Typography, Row, Select, Tabs, Button, Space, Table, Tag, Modal,
  Form, Input, message, Tooltip, Badge,
} from "antd";
import {
  PlusOutlined, CopyOutlined, DeleteOutlined, LinkOutlined,
  EyeOutlined, StopOutlined, CheckCircleOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { reportsApi, transactionsApi, feeTypesApi, reportLinksApi } from "../api";
import { YearlySummary, MonthlyStats, MemberContributions, FeeStatusTracker } from "../components/ReportContent";

const { Title } = Typography;

// API object truyền xuống các sub-component
const DEFAULT_API = {
  reports: reportsApi,
  transactions: transactionsApi,
  feeTypes: feeTypesApi,
};

const EXPIRY_OPTIONS = [
  { label: "1 tháng", value: 1 },
  { label: "3 tháng", value: 3 },
  { label: "6 tháng", value: 6 },
  { label: "1 năm", value: 12 },
  { label: "Vĩnh viễn", value: 0 },
];

function PublicLinksManager() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const r = await reportLinksApi.list();
      setLinks(r.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    let vals;
    try { vals = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const months = vals.expiry_months;
      const expires_at = months > 0
        ? dayjs().add(months, "month").toISOString()
        : null;
      await reportLinksApi.create({ label: vals.label, expires_at });
      message.success("Đã tạo link công khai");
      setModalOpen(false);
      form.resetFields();
      load();
    } finally { setSaving(false); }
  };

  const handleToggle = async (id) => {
    await reportLinksApi.toggle(id);
    load();
  };

  const handleDelete = async (id, label) => {
    Modal.confirm({
      title: "Xóa link công khai?",
      content: `Link "${label}" sẽ bị xóa vĩnh viễn.`,
      okText: "Xóa", okButtonProps: { danger: true },
      cancelText: "Hủy",
      onOk: async () => {
        await reportLinksApi.delete(id);
        message.success("Đã xóa link");
        load();
      },
    });
  };

  const copyLink = (slug, token) => {
    const id = slug || token;
    const url = `${window.location.origin}/public/report/${id}`;
    navigator.clipboard.writeText(url).then(() => message.success("Đã sao chép link"));
  };

  const columns = [
    { title: "Nhãn", dataIndex: "label", ellipsis: true },
    {
      title: "Trạng thái", dataIndex: "is_active", width: 110,
      render: (v) => v
        ? <Badge status="success" text="Đang hoạt động" />
        : <Badge status="default" text="Đã tắt" />,
    },
    {
      title: "Lượt xem", dataIndex: "view_count", width: 100, align: "center",
      render: (v) => <span><EyeOutlined /> {v}</span>,
    },
    {
      title: "Hết hạn", dataIndex: "expires_at", width: 140,
      render: (v) => {
        if (!v) return <Tag color="green">Vĩnh viễn</Tag>;
        const d = dayjs(v);
        const expired = d.isBefore(dayjs());
        return <Tag color={expired ? "red" : "orange"}>{d.format("DD/MM/YYYY")}</Tag>;
      },
    },
    {
      title: "Ngày tạo", dataIndex: "created_at", width: 120,
      render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—",
    },
    {
      title: "Thao tác", width: 150,
      render: (_, r) => (
        <Space>
          <Tooltip title="Sao chép link">
            <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(r.slug, r.token)} />
          </Tooltip>
          <Tooltip title={r.is_active ? "Tắt link" : "Bật link"}>
            <Button
              size="small"
              icon={r.is_active ? <StopOutlined /> : <CheckCircleOutlined />}
              onClick={() => handleToggle(r.id)}
            />
          </Tooltip>
          <Tooltip title="Xóa link">
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.id, r.label)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <span style={{ color: "#8c8c8c", fontSize: 13 }}>
          <LinkOutlined /> Link công khai cho phép thành viên xem báo cáo mà không cần đăng nhập.
        </span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Tạo link mới
        </Button>
      </Row>

      <Table
        columns={columns}
        dataSource={links}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "Chưa có link công khai nào. Tạo link đầu tiên để chia sẻ báo cáo." }}
      />

      {/* Preview link của từng record */}
      {links.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {links.map((r) => (
            <div key={r.id} style={{ fontSize: 12, color: "#8c8c8c", padding: "2px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <Tag color={r.is_active ? "blue" : "default"} style={{ fontSize: 11 }}>{r.label}</Tag>
              <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                {window.location.origin}/public/report/{r.slug || r.token}
              </span>
            </div>
          ))}
        </div>
      )}

      <Modal
        title="Tạo link công khai mới"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        onOk={handleCreate}
        okText="Tạo link"
        cancelText="Hủy"
        confirmLoading={saving}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}
          initialValues={{ expiry_months: 0 }}>
          <Form.Item name="label" label="Nhãn link" rules={[{ required: true, message: "Nhập nhãn cho link" }]}>
            <Input placeholder="VD: Báo cáo Q1/2026, Chia sẻ cho thành viên..." />
          </Form.Item>
          <Form.Item name="expiry_months" label="Thời hạn">
            <Select>
              {EXPIRY_OPTIONS.map((o) => (
                <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Reports() {
  const [year, setYear] = useState(dayjs().year());
  const currentYear = dayjs().year();
  const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Báo cáo & Thống kê</Title>
        <Select value={year} onChange={setYear} style={{ width: 100 }}>
          {YEARS.map((y) => (
            <Select.Option key={y} value={y}>{y}</Select.Option>
          ))}
        </Select>
      </Row>

      <Tabs
        defaultActiveKey="monthly-detail"
        items={[
          { key: "monthly-detail", label: "Thống kê theo tháng", children: <MonthlyStats year={year} api={DEFAULT_API} /> },
          { key: "yearly", label: "Tổng hợp cả năm", children: <YearlySummary year={year} api={DEFAULT_API} /> },
          { key: "contributions", label: "Đóng góp thành viên", children: <MemberContributions year={year} api={DEFAULT_API} /> },
          { key: "fee-status", label: "Theo dõi phí", children: <FeeStatusTracker year={year} api={DEFAULT_API} /> },
          { key: "public-links", label: <span><LinkOutlined /> Link công khai</span>, children: <PublicLinksManager /> },
        ]}
      />
    </div>
  );
}
