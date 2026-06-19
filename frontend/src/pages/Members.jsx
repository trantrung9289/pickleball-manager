import React, { useEffect, useState, useRef } from "react";
import {
  Table, Button, Space, Input, Select, Tag, Modal, Form,
  DatePicker, message, Typography, Row, Col, Popover,
  Upload, Alert, Divider, Progress,
} from "antd";
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  SaveOutlined, InfoCircleOutlined, DownloadOutlined,
  FileExcelOutlined, UploadOutlined, CheckCircleOutlined,
  CloseCircleOutlined, WarningOutlined, FileAddOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { membersApi } from "../api";
import useHotkey from "../hooks/useHotkey";

const { Title } = Typography;
const { Option } = Select;

const RANKS = ["A", "B", "C", "D", "Hạt giống 1", "Hạt giống 2", "Hạt giống 3", "Chưa xếp hạng"];

const STATUS_MAP = {
  active: { color: "green", label: "Hoạt động" },
  inactive: { color: "default", label: "Tạm nghỉ" },
  suspended: { color: "red", label: "Đình chỉ" },
};

const confirm = (opts) =>
  new Promise((resolve) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => resolve(true), onCancel: () => resolve(false) })
  );

export default function Members() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const searchRef = useRef(null);

  // Excel import state
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

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
      const res = await membersApi.list({ search: search || undefined, status: statusFilter || undefined });
      setData(res.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [search, statusFilter]);

  const openCreate = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (r) => {
    setEditing(r);
    form.setFieldsValue({
      ...r,
      dob: r.dob ? dayjs(r.dob) : null,
      join_date: r.join_date ? dayjs(r.join_date) : null,
    });
    setModalOpen(true);
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

    const action = editing ? "cập nhật" : "thêm mới";
    const ok = await confirm({
      title: `Xác nhận ${action} thành viên?`,
      content: (
        <div style={{ lineHeight: 2 }}>
          <div>Họ tên: <b>{vals.full_name}</b></div>
          {vals.phone && <div>SĐT: <b>{vals.phone}</b></div>}
          <div>Trạng thái: <b>{STATUS_MAP[vals.status]?.label}</b></div>
        </div>
      ),
    });
    if (!ok) return;

    setSaving(true);
    try {
      const payload = {
        ...vals,
        dob: vals.dob ? vals.dob.format("YYYY-MM-DD") : null,
        join_date: vals.join_date ? vals.join_date.format("YYYY-MM-DD") : null,
      };
      if (editing) {
        await membersApi.update(editing.id, payload);
        message.success("Đã cập nhật thành viên");
      } else {
        await membersApi.create(payload);
        message.success("Đã thêm thành viên mới");
      }
      setModalOpen(false);
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (r) => {
    const ok = await confirm({
      title: "Xác nhận xóa thành viên?",
      content: <div>Thành viên <b>{r.full_name}</b> ({r.member_code}) sẽ bị xóa khỏi hệ thống.</div>,
      okButtonProps: { danger: true },
      okText: "Xóa",
    });
    if (!ok) return;
    await membersApi.delete(r.id);
    message.success("Đã xóa thành viên");
    load();
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await membersApi.downloadTemplate();
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "mau_nhap_thanh_vien.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error("Không thể tải file mẫu");
    }
  };

  const handleImportFile = async (file) => {
    setImportLoading(true);
    setImportResult(null);
    try {
      const res = await membersApi.importExcel(file);
      setImportResult(res.data);
      if (res.data.imported > 0) load();
    } catch (err) {
      message.error(err.response?.data?.detail || "Import thất bại");
    } finally {
      setImportLoading(false);
    }
    return false; // ngăn Upload tự upload
  };

  const handleExportExcel = async () => {
    try {
      const res = await membersApi.exportExcel();
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `thanh-vien-${dayjs().format("YYYY-MM-DD")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error("Không thể xuất file Excel");
    }
  };

  const columns = [
    { title: "Mã TV", dataIndex: "member_code", width: 90 },
    {
      title: "Họ và tên", dataIndex: "full_name",
      sorter: (a, b) => a.full_name.localeCompare(b.full_name),
      render: (v, r) => (
        <Space>
          {v}
          {(r.notes || r.address) && (
            <Popover content={
              <div style={{ maxWidth: 200 }}>
                {r.address && <div><b>Địa chỉ:</b> {r.address}</div>}
                {r.notes && <div><b>Ghi chú:</b> {r.notes}</div>}
              </div>
            }>
              <InfoCircleOutlined style={{ color: "#1677ff", cursor: "pointer" }} />
            </Popover>
          )}
        </Space>
      ),
    },
    { title: "Điện thoại", dataIndex: "phone" },
    {
      title: "Hạng", dataIndex: "rank", width: 90,
      render: (v) => v ? <Tag color="purple">{v}</Tag> : "—",
      filters: RANKS.map(r => ({ text: r, value: r })),
      onFilter: (value, record) => record.rank === value,
    },
    { title: "Ngày tham gia", dataIndex: "join_date", render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—" },
    {
      title: "Trạng thái", dataIndex: "status",
      render: (v) => <Tag color={STATUS_MAP[v]?.color}>{STATUS_MAP[v]?.label}</Tag>,
      filters: Object.entries(STATUS_MAP).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (value, record) => record.status === value,
    },
    {
      title: "Thao tác", width: 120,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Quản lý thành viên</Title>
        <Space>
          <Button icon={<FileExcelOutlined />} onClick={handleExportExcel}>Xuất Excel</Button>
          <Button icon={<FileExcelOutlined />} style={{ color: "#52c41a", borderColor: "#52c41a" }} onClick={() => { setImportResult(null); setImportOpen(true); }}>
            Nhập từ Excel
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm thành viên (N)</Button>
        </Space>
      </Row>

      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Input.Search
            ref={searchRef}
            placeholder="Tìm kiếm theo tên, mã số, SĐT... (phím /)"
            prefix={<SearchOutlined />}
            onSearch={setSearch}
            allowClear
          />
        </Col>
        <Col>
          <Select placeholder="Trạng thái" allowClear style={{ width: 150 }} onChange={setStatusFilter}>
            <Option value="active">Hoạt động</Option>
            <Option value="inactive">Tạm nghỉ</Option>
            <Option value="suspended">Đình chỉ</Option>
          </Select>
        </Col>
      </Row>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} pagination={{ pageSize: 15 }} size="small" />

      {/* Modal Import Excel */}
      <Modal
        title={<Space><FileExcelOutlined style={{ color: "#52c41a" }} />Nhập thành viên từ Excel</Space>}
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={<Button onClick={() => setImportOpen(false)}>Đóng</Button>}
        width={620}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Alert
            message="Hướng dẫn"
            description={
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>Tải file Excel mẫu bên dưới</li>
                <li>Điền dữ liệu vào file (xóa dòng ví dụ màu xanh trước khi nhập)</li>
                <li>Upload file đã điền — hệ thống tự xử lý</li>
              </ol>
            }
            type="info"
            showIcon
          />

          <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate} style={{ borderColor: "#1677ff", color: "#1677ff" }}>
            Tải file Excel mẫu
          </Button>

          <Divider style={{ margin: "8px 0" }} />

          <Upload.Dragger
            accept=".xlsx,.xls"
            beforeUpload={handleImportFile}
            showUploadList={false}
            disabled={importLoading}
          >
            <p className="ant-upload-drag-icon">
              <UploadOutlined style={{ fontSize: 32, color: "#52c41a" }} />
            </p>
            <p className="ant-upload-text">Kéo thả file Excel vào đây hoặc nhấn để chọn file</p>
            <p className="ant-upload-hint">Chỉ chấp nhận file .xlsx hoặc .xls (tối đa 500 thành viên)</p>
          </Upload.Dragger>

          {importLoading && <Progress percent={99} status="active" showInfo={false} />}

          {importResult && (
            <div style={{ background: "#fafafa", borderRadius: 8, padding: 16, border: "1px solid #f0f0f0" }}>
              <Space style={{ marginBottom: 8 }}>
                <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 16 }} />
                <span><b style={{ color: "#52c41a" }}>{importResult.imported}</b> thành viên đã nhập thành công</span>
              </Space>
              {importResult.skipped > 0 && (
                <div>
                  <Space style={{ marginBottom: 4 }}>
                    <WarningOutlined style={{ color: "#faad14" }} />
                    <span><b>{importResult.skipped}</b> hàng bỏ qua (mã đã tồn tại):</span>
                  </Space>
                  <ul style={{ margin: "4px 0 8px 20px", color: "#595959", fontSize: 13 }}>
                    {importResult.skipped_list.map((s, i) => (
                      <li key={i}>Hàng {s.row}: {s.name} — {s.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {importResult.errors > 0 && (
                <div>
                  <Space style={{ marginBottom: 4 }}>
                    <CloseCircleOutlined style={{ color: "#f5222d" }} />
                    <span><b>{importResult.errors}</b> hàng lỗi:</span>
                  </Space>
                  <ul style={{ margin: "4px 0 0 20px", color: "#595959", fontSize: 13 }}>
                    {importResult.error_list.map((e, i) => (
                      <li key={i}>Hàng {e.row}: {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Space>
      </Modal>

      <Modal
        title={editing ? "Sửa thành viên" : "Thêm thành viên mới"}
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
            <Col span={16}>
              <Form.Item name="full_name" label="Họ và tên" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="member_code" label="Mã thành viên">
                <Input placeholder="Tự động nếu để trống" />
              </Form.Item>
            </Col>
          </Row>
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
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="dob" label="Ngày sinh">
                <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="join_date" label="Ngày tham gia">
                <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="status" label="Trạng thái" initialValue="active">
                <Select>
                  <Option value="active">Hoạt động</Option>
                  <Option value="inactive">Tạm nghỉ</Option>
                  <Option value="suspended">Đình chỉ</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="rank" label="Hạng (Rank)">
                <Select placeholder="Chọn hoặc nhập hạng" allowClear showSearch>
                  {RANKS.map(r => <Option key={r} value={r}>{r}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address" label="Địa chỉ">
            <Input placeholder="Số nhà, đường, phường/xã, quận/huyện..." />
          </Form.Item>
          <Form.Item name="notes" label="Ghi chú">
            <Input.TextArea rows={2} placeholder="Thông tin thêm về thành viên..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
