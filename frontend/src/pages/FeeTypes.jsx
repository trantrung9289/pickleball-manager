import React, { useEffect, useState } from "react";
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select,
  InputNumber, Switch, message, Typography, Row, Tabs, Statistic, Card, Col,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, SaveOutlined, RiseOutlined, FallOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { feeTypesApi } from "../api";
import useHotkey from "../hooks/useHotkey";

const { Title } = Typography;
const { TextArea } = Input;

const fmt = (n) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n || 0);

const confirm = (opts) =>
  new Promise((resolve) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => resolve(true), onCancel: () => resolve(false) })
  );

export default function FeeTypes() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  useHotkey({
    "n": () => !modalOpen && openCreate(),
    "r": () => load(),
    "ctrl+enter": () => modalOpen && handleSave(),
    "escape": () => modalOpen && handleCancel(),
  }, [modalOpen]);

  const load = async () => {
    setLoading(true);
    try { const r = await feeTypesApi.list(); setData(r.data); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

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

    const action = editing ? "cập nhật" : "tạo mới";
    const ok = await confirm({
      title: `Xác nhận ${action} khoản?`,
      content: (
        <div style={{ lineHeight: 2 }}>
          <div>Tên: <b>{vals.name}</b></div>
          <div>Loại: <Tag color={vals.type === "income" ? "green" : "red"}>{vals.type === "income" ? "Thu" : "Chi"}</Tag></div>
          {vals.default_amount > 0 && <div>Số tiền mặc định: <b>{fmt(vals.default_amount)}</b></div>}
        </div>
      ),
    });
    if (!ok) return;

    setSaving(true);
    try {
      if (editing) {
        await feeTypesApi.update(editing.id, vals);
        message.success("Đã cập nhật khoản");
      } else {
        await feeTypesApi.create(vals);
        message.success("Đã tạo khoản mới");
      }
      setModalOpen(false);
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (r) => {
    const ok = await confirm({
      title: "Xác nhận xóa khoản?",
      content: <div>Khoản <b>{r.name}</b> sẽ bị xóa. Các giao dịch liên quan có thể bị ảnh hưởng.</div>,
      okButtonProps: { danger: true },
      okText: "Xóa",
    });
    if (!ok) return;
    await feeTypesApi.delete(r.id);
    message.success("Đã xóa khoản");
    load();
  };

  const columns = [
    { title: "Tên khoản", dataIndex: "name" },
    {
      title: "Loại", dataIndex: "type",
      render: (v) => <Tag color={v === "income" ? "green" : "red"}>{v === "income" ? "Thu" : "Chi"}</Tag>,
    },
    { title: "Số tiền mặc định", dataIndex: "default_amount", render: (v) => fmt(v) },
    {
      title: "Định kỳ", dataIndex: "is_recurring",
      render: (v) => <Tag color={v ? "blue" : "default"}>{v ? "Có" : "Không"}</Tag>,
    },
    { title: "Mô tả", dataIndex: "description", ellipsis: true },
    { title: "Ngày tạo", dataIndex: "created_at", render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—" },
    {
      title: "Thao tác", width: 100,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} />
        </Space>
      ),
    },
  ];

  const incomeItems = data.filter(d => d.type === "income");
  const expenseItems = data.filter(d => d.type === "expense");

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Danh mục khoản thu/chi</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm khoản mới (N)</Button>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Khoản thu" value={incomeItems.length} suffix="loại"
              prefix={<RiseOutlined />} styles={{ content: { color: "#52c41a" } }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Khoản chi" value={expenseItems.length} suffix="loại"
              prefix={<FallOutlined />} styles={{ content: { color: "#ff4d4f" } }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Tổng danh mục" value={data.length} suffix="loại" />
          </Card>
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="all"
        items={[
          { key: "all", label: `Tất cả (${data.length})`, children: <Table columns={columns} dataSource={data} rowKey="id" loading={loading} size="small" /> },
          { key: "income", label: `Thu (${incomeItems.length})`, children: <Table columns={columns} dataSource={incomeItems} rowKey="id" size="small" /> },
          { key: "expense", label: `Chi (${expenseItems.length})`, children: <Table columns={columns} dataSource={expenseItems} rowKey="id" size="small" /> },
        ]}
      />

      <Modal
        title={editing ? "Sửa khoản thu/chi" : "Thêm khoản thu/chi mới"}
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
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Tên khoản" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="Loại" rules={[{ required: true }]}>
            <Select placeholder="Chọn loại">
              <Select.Option value="income">Thu</Select.Option>
              <Select.Option value="expense">Chi</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="default_amount" label="Số tiền mặc định">
            <InputNumber
              style={{ width: "100%" }}
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
              parser={(v) => v.replace(/,/g, "")}
              min={0}
            />
          </Form.Item>
          <Form.Item name="is_recurring" label="Khoản định kỳ" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
