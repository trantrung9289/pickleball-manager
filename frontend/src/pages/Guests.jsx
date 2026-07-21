import React, { useEffect, useState, useRef } from "react";
import {
  Table, Button, Space, Input, Select, Tag, Modal, Form,
  message, Typography, Row, Col, Empty, List, Spin,
} from "antd";
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  SaveOutlined, UserSwitchOutlined, HistoryOutlined,
} from "@ant-design/icons";
import { playersApi } from "../api";
import useHotkey from "../hooks/useHotkey";
import ResponsiveTable from "../components/ResponsiveTable";

const { Title, Text } = Typography;
const { Option } = Select;

const RANKS = ["A", "B", "C", "D", "Hạt giống 1", "Hạt giống 2", "Hạt giống 3", "Chưa xếp hạng"];

const TOURNAMENT_STATUS_MAP = {
  draft: { color: "default", label: "Nháp" },
  active: { color: "blue", label: "Đang diễn ra" },
  completed: { color: "green", label: "Đã kết thúc" },
};

const confirm = (opts) =>
  new Promise((resolve) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => resolve(true), onCancel: () => resolve(false) })
  );

export default function Guests({ perms }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const searchRef = useRef(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyGuest, setHistoryGuest] = useState(null);
  const [history, setHistory] = useState([]);

  useHotkey({
    "n": () => !modalOpen && openCreate(),
    "r": () => load(),
    "/": () => searchRef.current?.focus(),
    "ctrl+enter": () => modalOpen && handleSave(),
    "escape": () => modalOpen && handleCancel(),
  }, [modalOpen]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await playersApi.list("guest");
      setData(res.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = search
    ? data.filter((g) =>
        g.name.toLowerCase().includes(search.toLowerCase()) ||
        (g.phone || "").includes(search)
      )
    : data;

  const openCreate = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (r) => { setEditing(r); form.setFieldsValue(r); setModalOpen(true); };

  const handleCancel = async () => {
    const touched = form.isFieldsTouched();
    if (touched) {
      const ok = await confirm({ title: "Hủy thao tác?", content: "Dữ liệu chưa lưu sẽ bị mất." });
      if (!ok) return;
    }
    setModalOpen(false);
  };

  const handleSave = async () => {
    let vals;
    try { vals = await form.validateFields(); } catch { return; }

    const action = editing ? "cập nhật" : "thêm mới";
    const ok = await confirm({
      title: `Xác nhận ${action} khách mời?`,
      content: (
        <div style={{ lineHeight: 2 }}>
          <div>Họ tên: <b>{vals.name}</b></div>
          {vals.phone && <div>SĐT: <b>{vals.phone}</b></div>}
        </div>
      ),
    });
    if (!ok) return;

    setSaving(true);
    try {
      if (editing) {
        await playersApi.update(editing.id, vals);
        message.success("Đã cập nhật khách mời");
      } else {
        await playersApi.create(vals);
        message.success("Đã thêm khách mời mới");
      }
      setModalOpen(false);
      load();
    } catch (err) {
      message.error(err.response?.data?.detail || "Thao tác thất bại");
    } finally { setSaving(false); }
  };

  const handleDelete = async (r) => {
    const ok = await confirm({
      title: "Xác nhận xóa khách mời?",
      content: <div>Khách mời <b>{r.name}</b> sẽ bị xóa khỏi hệ thống.</div>,
      okButtonProps: { danger: true },
      okText: "Xóa",
    });
    if (!ok) return;
    try {
      await playersApi.delete(r.id);
      message.success("Đã xóa khách mời");
      load();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể xóa khách mời");
    }
  };

  const handleConvert = async (r) => {
    const ok = await confirm({
      title: "Chuyển thành thành viên CLB?",
      content: (
        <div>
          <b>{r.name}</b> sẽ được tạo thành thành viên chính thức của CLB (mã thành viên tự động cấp).
          Lịch sử tham gia giải đấu trước đó sẽ được giữ nguyên.
        </div>
      ),
    });
    if (!ok) return;
    try {
      const res = await playersApi.convertToMember(r.id);
      message.success(`Đã chuyển "${r.name}" thành thành viên CLB (mã ${res.data.member_code})`);
      load();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể chuyển thành thành viên");
    }
  };

  const openHistory = async (r) => {
    setHistoryGuest(r);
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await playersApi.tournaments(r.id);
      setHistory(res.data);
    } finally { setHistoryLoading(false); }
  };

  const columns = [
    { title: "Họ và tên", dataIndex: "name", sorter: (a, b) => a.name.localeCompare(b.name) },
    { title: "Điện thoại", dataIndex: "phone", render: (v) => v || "—" },
    { title: "Email", dataIndex: "email", render: (v) => v || "—" },
    {
      title: "Hạng", dataIndex: "rank", width: 100,
      render: (v) => v ? <Tag color="purple">{v}</Tag> : "—",
      filters: RANKS.map(r => ({ text: r, value: r })),
      onFilter: (value, record) => record.rank === value,
    },
    {
      title: "Thao tác", width: 180,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => openHistory(r)} title="Lịch sử giải đấu" />
          <Button size="small" icon={<UserSwitchOutlined />} onClick={() => handleConvert(r)} title="Chuyển thành thành viên" />
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" gutter={[8, 8]} style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Quản lý khách mời</Title>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm khách mời (N)</Button>
        </Space>
      </Row>

      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Input.Search
            ref={searchRef}
            placeholder="Tìm kiếm theo tên, SĐT... (phím /)"
            prefix={<SearchOutlined />}
            onSearch={setSearch}
            onChange={(e) => !e.target.value && setSearch("")}
            allowClear
          />
        </Col>
      </Row>

      <ResponsiveTable
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 15 }}
        size="small"
        mobileTitle={(r) => (
          <span>
            {r.name}
            {r.rank && <Tag color="purple" style={{ marginLeft: 6 }}>{r.rank}</Tag>}
          </span>
        )}
        mobileHideColumns={["Họ và tên", "Hạng"]}
      />

      <Modal
        title={editing ? "Sửa khách mời" : "Thêm khách mời mới"}
        open={modalOpen}
        onCancel={handleCancel}
        footer={
          <Space>
            <Button onClick={handleCancel}>Hủy (Esc)</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
              Lưu (Ctrl+Enter)
            </Button>
          </Space>
        }
        width={500}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Họ và tên" rules={[{ required: true, message: "Vui lòng nhập tên" }]}>
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="phone" label="Số điện thoại">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="Email">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="rank" label="Hạng (Rank)" initialValue="Chưa xếp hạng">
            <Select placeholder="Chọn hoặc nhập hạng" allowClear showSearch>
              {RANKS.map(r => <Option key={r} value={r}>{r}</Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Lịch sử giải đấu — ${historyGuest?.name || ""}`}
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={<Button onClick={() => setHistoryOpen(false)}>Đóng</Button>}
        width={520}
      >
        {historyLoading ? (
          <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
        ) : history.length === 0 ? (
          <Empty description="Chưa tham gia giải đấu nào" />
        ) : (
          <List
            dataSource={history}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space>
                      {item.tournament_name}
                      <Tag color={TOURNAMENT_STATUS_MAP[item.status]?.color}>
                        {TOURNAMENT_STATUS_MAP[item.status]?.label || item.status}
                      </Tag>
                    </Space>
                  }
                  description={
                    <Text type="secondary">
                      {item.team_type === "doubles" ? "Đấu đôi" : "Đấu đơn"}
                      {item.team_name ? ` — ${item.team_name}` : ""}
                      {item.as_partner ? " (vai trò: đối tác)" : ""}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Modal>
    </div>
  );
}
