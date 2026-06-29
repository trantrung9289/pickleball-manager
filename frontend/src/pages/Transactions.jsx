import React, { useEffect, useState, useRef } from "react";
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select,
  InputNumber, DatePicker, message, Typography,
  Row, Col, Alert, Upload, Divider, Progress,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, CloseOutlined, SaveOutlined, SearchOutlined, DownloadOutlined, FileExcelOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { transactionsApi, feeTypesApi, membersApi } from "../api";
import useHotkey from "../hooks/useHotkey";

const { Title } = Typography;
const { TextArea } = Input;

const fmt = (n) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n || 0);

const confirm = (opts) =>
  new Promise((resolve) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => resolve(true), onCancel: () => resolve(false) })
  );

export default function Transactions() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feeTypes, setFeeTypes] = useState([]);
  const [members, setMembers] = useState([]);
  const [filters, setFilters] = useState({ month: null, year: dayjs().year(), type: null, search: "" });
  const searchRef = useRef(null);
  const currentYear = dayjs().year();
  const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedFeeType, setSelectedFeeType] = useState(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [form] = Form.useForm();
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.month) params.month = filters.month;
      if (filters.year) params.year = filters.year;
      if (filters.type) params.type = filters.type;
      if (filters.search) params.search = filters.search;
      const r = await transactionsApi.list(params);
      setData(r.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filters]);
  useEffect(() => {
    feeTypesApi.list().then((r) => setFeeTypes(r.data));
    membersApi.list().then((r) => setMembers(r.data));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setSelectedFeeType(null);
    form.resetFields();
    form.setFieldsValue({ transaction_date: dayjs(), payment_method: "Chuyển khoản" });
    setModalOpen(true);
  };

  const openEdit = (r) => {
    setEditing(r);
    const ft = feeTypes.find((f) => f.id === r.fee_type_id);
    setSelectedFeeType(ft || null);
    form.setFieldsValue({
      ...r,
      transaction_date: r.transaction_date ? dayjs(r.transaction_date) : dayjs(),
    });
    setModalOpen(true);
  };

  const handleFeeTypeChange = (id) => {
    const ft = feeTypes.find((f) => f.id === id);
    setSelectedFeeType(ft || null);
    if (ft?.default_amount) form.setFieldValue("amount", ft.default_amount);
  };

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

    const ft = feeTypes.find((f) => f.id === vals.fee_type_id);
    const member = members.find((m) => m.id === vals.member_id);
    const action = editing ? "cập nhật" : "ghi nhận";
    const ok = await confirm({
      title: `Xác nhận ${action} giao dịch?`,
      content: (
        <div style={{ lineHeight: 2 }}>
          <div>Khoản: <b>{ft?.name}</b></div>
          {member && <div>Thành viên: <b>{member.full_name}</b></div>}
          <div>Số tiền: <b style={{ color: "#1677ff" }}>{fmt(vals.amount)}</b></div>
          <div>Ngày: <b>{vals.transaction_date?.format("DD/MM/YYYY")}</b></div>
        </div>
      ),
    });
    if (!ok) return;

    setSaving(true);
    try {
      const payload = { ...vals, transaction_date: vals.transaction_date.format("YYYY-MM-DD") };
      if (editing) {
        await transactionsApi.update(editing.id, payload);
        message.success("Đã cập nhật giao dịch");
      } else {
        await transactionsApi.create(payload);
        message.success("Đã ghi nhận giao dịch");
      }
      setModalOpen(false);
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id, record) => {
    const ok = await confirm({
      title: "Xác nhận xóa giao dịch?",
      content: <div>Khoản <b>{record.fee_type?.name}</b> – <b style={{ color: "#ff4d4f" }}>{fmt(record.amount)}</b> ngày {dayjs(record.transaction_date).format("DD/MM/YYYY")}</div>,
      okButtonProps: { danger: true },
      okText: "Xóa",
    });
    if (!ok) return;
    await transactionsApi.delete(id);
    message.success("Đã xóa giao dịch");
    setSelectedRowKeys((prev) => prev.filter((k) => k !== id));
    load();
  };

  const handleDeleteSelected = async () => {
    const ok = await confirm({
      title: `Xác nhận xóa ${selectedRowKeys.length} giao dịch đã chọn?`,
      content: "Thao tác này không thể hoàn tác.",
      okButtonProps: { danger: true },
      okText: "Xóa tất cả",
    });
    if (!ok) return;
    await Promise.all(selectedRowKeys.map((id) => transactionsApi.delete(id)));
    message.success(`Đã xóa ${selectedRowKeys.length} giao dịch`);
    setSelectedRowKeys([]);
    load();
  };

  const handleExportExcel = async () => {
    try {
      const params = {};
      if (filters.month) params.month = filters.month;
      if (filters.year) params.year = filters.year;
      const res = await transactionsApi.exportExcel(params);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url;
      a.download = `giao-dich-${filters.month ? `T${filters.month}-` : ""}${filters.year || dayjs().year()}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
    } catch { message.error("Không thể xuất file Excel"); }
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await transactionsApi.downloadTemplate();
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url;
      a.download = "mau_giao_dich.xlsx"; a.click(); URL.revokeObjectURL(url);
    } catch { message.error("Không thể tải file mẫu"); }
  };

  const handleImportFile = async (file) => {
    setImportLoading(true); setImportResult(null);
    try {
      const res = await transactionsApi.importExcel(file);
      setImportResult(res.data);
      if (res.data.imported > 0) load();
    } catch (err) { message.error(err.response?.data?.detail || "Import thất bại"); }
    finally { setImportLoading(false); }
    return false;
  };

  useHotkey({
    "n": () => !modalOpen && openCreate(),
    "r": () => load(),
    "/": () => searchRef.current?.focus(),
    "ctrl+enter": () => modalOpen && handleSave(),
    "escape": () => { if (modalOpen) handleCancel(); else setSelectedRowKeys([]); },
    "delete": () => selectedRowKeys.length > 0 && !modalOpen && handleDeleteSelected(),
    "ctrl+a": () => !modalOpen && setSelectedRowKeys(data.map((d) => d.id)),
  }, [modalOpen, selectedRowKeys, data]);

  const rowSelection = {
    selectedRowKeys,
    onChange: setSelectedRowKeys,
    selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
  };

  const columns = [
    { title: "Ngày", dataIndex: "transaction_date", render: (v) => dayjs(v).format("DD/MM/YYYY"), sorter: (a, b) => a.transaction_date.localeCompare(b.transaction_date) },
    { title: "Loại", dataIndex: "type", render: (v) => <Tag color={v === "income" ? "green" : "red"}>{v === "income" ? "Thu" : "Chi"}</Tag> },
    { title: "Khoản", render: (_, r) => r.fee_type?.name || "—" },
    { title: "Thành viên", render: (_, r) => r.member?.full_name || "—" },
    { title: "Số tiền", dataIndex: "amount", render: (v) => <b style={{ color: "#333" }}>{fmt(v)}</b>, align: "right" },
    { title: "PT thanh toán", dataIndex: "payment_method" },
    { title: "Ghi chú", dataIndex: "description", ellipsis: true },
    {
      title: "Thao tác", width: 100,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.id, r)} />
        </Space>
      ),
    },
  ];

  const totalIncome = data.filter((t) => t.type === "income").reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalExpense = data.filter((t) => t.type === "expense").reduce((s, t) => s + parseFloat(t.amount), 0);

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Giao dịch thu/chi</Title>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>File mẫu</Button>
          <Button icon={<FileExcelOutlined />} onClick={handleExportExcel}>Xuất Excel</Button>
          <Button icon={<UploadOutlined />} style={{ background: "#52c41a", borderColor: "#52c41a", color: "#fff" }} onClick={() => { setImportOpen(true); setImportResult(null); }}>Nhập từ Excel</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Ghi nhận giao dịch (N)</Button>
        </Space>
      </Row>

      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Input
            ref={searchRef}
            prefix={<SearchOutlined />}
            placeholder="Tìm theo ghi chú, thành viên... (phím /)"
            allowClear
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </Col>
        <Col>
          <Select placeholder="Tháng" allowClear style={{ width: 100 }} onChange={(v) => setFilters((f) => ({ ...f, month: v }))}>
            {Array.from({ length: 12 }, (_, i) => (
              <Select.Option key={i + 1} value={i + 1}>Tháng {i + 1}</Select.Option>
            ))}
          </Select>
        </Col>
        <Col>
          <Select value={filters.year} style={{ width: 90 }} onChange={(v) => setFilters((f) => ({ ...f, year: v }))}>
            {YEARS.map((y) => <Select.Option key={y} value={y}>{y}</Select.Option>)}
          </Select>
        </Col>
        <Col>
          <Select placeholder="Loại" allowClear style={{ width: 100 }} onChange={(v) => setFilters((f) => ({ ...f, type: v }))}>
            <Select.Option value="income">Thu</Select.Option>
            <Select.Option value="expense">Chi</Select.Option>
          </Select>
        </Col>
      </Row>
      <Row style={{ marginBottom: 12 }}>
        <Col flex="auto">
          <Space>
            <Tag color="green">Thu: {fmt(totalIncome)}</Tag>
            <Tag color="red">Chi: {fmt(totalExpense)}</Tag>
            <Tag color="blue">Còn lại: {fmt(totalIncome - totalExpense)}</Tag>
          </Space>
        </Col>
      </Row>

      {selectedRowKeys.length > 0 && (
        <Alert
          style={{ marginBottom: 12 }}
          message={
            <Row justify="space-between" align="middle">
              <span>Đã chọn <b>{selectedRowKeys.length}</b> giao dịch</span>
              <Space>
                <Button danger size="small" icon={<DeleteOutlined />} onClick={handleDeleteSelected}>
                  Xóa {selectedRowKeys.length} giao dịch (Delete)
                </Button>
                <Button size="small" icon={<CloseOutlined />} onClick={() => setSelectedRowKeys([])}>
                  Bỏ chọn (Esc)
                </Button>
              </Space>
            </Row>
          }
          type="info"
          showIcon={false}
        />
      )}

      <Table rowSelection={rowSelection} columns={columns} dataSource={data} rowKey="id" loading={loading} size="small" pagination={{ pageSize: 20 }} />

      <Modal
        title={editing ? "Sửa giao dịch" : "Ghi nhận giao dịch mới"}
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
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item name="fee_type_id" label="Khoản thu/chi" rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="children" placeholder="Chọn khoản" onChange={handleFeeTypeChange}>
                  {feeTypes.map((ft) => (
                    <Select.Option key={ft.id} value={ft.id}>
                      <Tag color={ft.type === "income" ? "green" : "red"} style={{ marginRight: 4 }}>
                        {ft.type === "income" ? "Thu" : "Chi"}
                      </Tag>
                      {ft.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="transaction_date" label="Ngày giao dịch" rules={[{ required: true }]}>
                <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>

          {(!selectedFeeType || selectedFeeType.type === "income") && (
            <Form.Item name="member_id" label="Thành viên">
              <Select showSearch optionFilterProp="children" placeholder="Chọn thành viên (khoản thu)" allowClear>
                {members.map((m) => (
                  <Select.Option key={m.id} value={m.id}>{m.member_code} - {m.full_name}</Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="amount" label="Số tiền (VNĐ)" rules={[{ required: true }]}>
                <InputNumber
                  style={{ width: "100%" }}
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                  parser={(v) => v.replace(/,/g, "")}
                  min={0}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="payment_method" label="Phương thức" initialValue="Chuyển khoản">
                <Select>
                  <Select.Option value="Tiền mặt">Tiền mặt</Select.Option>
                  <Select.Option value="Chuyển khoản">Chuyển khoản</Select.Option>
                  <Select.Option value="Momo">Momo</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="Ghi chú">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title="Nhập giao dịch từ Excel" open={importOpen} onCancel={() => setImportOpen(false)} footer={null} width={600}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert message='File Excel cần các cột: fee_type_name, amount, transaction_date (DD/MM/YYYY), member_code (tuỳ chọn), payment_method, description' type="info" showIcon />
          <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>Tải file mẫu (có sheet danh mục + thành viên)</Button>
          <Divider />
          <Upload.Dragger beforeUpload={handleImportFile} showUploadList={false} accept=".xlsx,.xls" disabled={importLoading}>
            <p className="ant-upload-drag-icon"><UploadOutlined /></p>
            <p>Kéo thả hoặc click để chọn file Excel</p>
          </Upload.Dragger>
          {importLoading && <Progress percent={100} status="active" />}
          {importResult && (
            <Alert
              type={importResult.errors?.length ? "warning" : "success"}
              message={`Đã nhập ${importResult.imported} giao dịch, bỏ qua ${importResult.skipped}`}
              description={importResult.errors?.length ? (
                <ul style={{ paddingLeft: 16, margin: 0 }}>
                  {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              ) : null}
              showIcon
            />
          )}
        </Space>
      </Modal>
    </div>
  );
}
