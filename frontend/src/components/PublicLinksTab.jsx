/**
 * PublicLinksTab — "Link công khai" trong Cài đặt CLB (2026-10-28, chuyển từ trang Báo cáo).
 * Mỗi CLB chỉ MỘT link (backend chặn tạo thêm). Mã PIN 4 hoặc 6 chữ số bảo vệ link: người xem nhập một lần trên mỗi thiết bị,
 * Web Push vẫn hoạt động khi app đóng (đẩy từ server). Link cũ (nếu CLB có nhiều) vẫn liệt kê để xoá bớt.
 */
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, Modal, Select, Space, Tag, Typography, Tooltip, message, Badge } from "antd";
import { PlusOutlined, CopyOutlined, DeleteOutlined, LinkOutlined, EyeOutlined, StopOutlined, CheckCircleOutlined, LockOutlined, UnlockOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { reportLinksApi } from "../api";
import { isValidPin, forceNumericInputs } from "../utils/publicPin";

const { Text } = Typography;
const EXPIRY_OPTIONS = [
  { label: "1 tháng", value: 1 }, { label: "3 tháng", value: 3 }, { label: "6 tháng", value: 6 }, { label: "1 năm", value: 12 }, { label: "Vĩnh viễn", value: 0 },
];

function PinModal({ link, open, onClose, onSaved }) {
  // Caller đặt key={link.id} → mỗi lần mở cho link khác là component mới, state tự về mặc định (không setState trong effect)
  const [len, setLen] = useState(4);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => { forceNumericInputs(boxRef.current); }, [len]);   // bàn phím số trên di động
  const save = async () => {
    if (!isValidPin(pin) || pin.length !== len) { message.error(`Nhập đủ ${len} chữ số`); return; }
    setBusy(true);
    try { await reportLinksApi.setPin(link.id, pin); message.success("Đã đặt mã PIN. Người xem phải nhập PIN mới."); onSaved(); onClose(); }
    catch (err) { message.error(err?.response?.data?.detail || "Không đặt được PIN"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Đặt mã PIN cho link" open={open} onCancel={onClose} onOk={save} okText="Lưu PIN" cancelText="Huỷ" confirmLoading={busy} width={420}>
      <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 8 }}>
        <Select value={len} onChange={(v) => { setLen(v); setPin(""); }} options={[{ value: 4, label: "4 chữ số" }, { value: 6, label: "6 chữ số" }]} style={{ width: 140 }} />
        <div ref={boxRef}><Input.OTP key={len} length={len} value={pin} onInput={(c) => setPin(c.join(""))} onChange={setPin} formatter={(v) => v.replace(/\D/g, "")} /></div>
        <Text type="secondary" style={{ fontSize: 12 }}>Người xem nhập PIN một lần trên mỗi thiết bị. Thông báo đẩy vẫn tới dù app đang đóng. Đổi PIN thì mọi người phải nhập lại.</Text>
      </Space>
    </Modal>
  );
}

export default function PublicLinksTab() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [pinFor, setPinFor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = () => reportLinksApi.list().then((r) => setLinks(r.data)).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    let vals;
    try { vals = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const expires_at = vals.expiry_months > 0 ? dayjs().add(vals.expiry_months, "month").toISOString() : null;
      await reportLinksApi.create({ label: vals.label, expires_at });
      message.success("Đã tạo link công khai"); setModalOpen(false); form.resetFields(); load();
    } catch (err) { message.error(err?.response?.data?.detail || "Không tạo được link"); }
    finally { setSaving(false); }
  };
  const handleToggle = async (id) => { await reportLinksApi.toggle(id); load(); };
  const handleDelete = (r) => Modal.confirm({
    title: "Xoá link công khai?", content: `Link "${r.label}" sẽ bị xoá vĩnh viễn; thiết bị đã đăng ký thông báo qua link này sẽ không nhận nữa.`,
    okText: "Xoá", okButtonProps: { danger: true }, cancelText: "Huỷ",
    onOk: async () => { await reportLinksApi.delete(r.id); message.success("Đã xoá link"); load(); },
  });
  const removePin = (r) => Modal.confirm({
    title: "Bỏ mã PIN?", content: "Ai có link đều xem được.", okText: "Bỏ PIN", cancelText: "Huỷ",
    onOk: async () => { await reportLinksApi.setPin(r.id, null); message.success("Đã bỏ PIN"); load(); },
  });
  const url = (r) => `${window.location.origin}/public/report/${r.slug || r.token}`;
  const copyLink = (r) => navigator.clipboard.writeText(url(r)).then(() => message.success("Đã sao chép link"));

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Text type="secondary"><LinkOutlined /> Link cho thành viên xem báo cáo, giải đấu, thông báo và cài app không cần đăng nhập. Mỗi CLB có một link.</Text>
      {!loading && links.length === 0 && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Tạo link công khai</Button>
      )}
      {links.length > 1 && <Alert type="warning" showIcon message="CLB đang có nhiều link từ trước. Hãy giữ một link và xoá các link còn lại." />}
      {links.map((r) => (
        <div key={r.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text strong>{r.label}</Text>
            {r.is_active ? <Badge status="success" text="Đang hoạt động" /> : <Badge status="default" text="Đã tắt" />}
            {r.has_pin ? <Tag icon={<LockOutlined />} color="gold">Có PIN</Tag> : <Tag icon={<UnlockOutlined />}>Không PIN</Tag>}
            <Tag color={r.expires_at ? (dayjs(r.expires_at).isBefore(dayjs()) ? "red" : "orange") : "green"}>{r.expires_at ? `Hết hạn ${dayjs(r.expires_at).format("DD/MM/YYYY")}` : "Vĩnh viễn"}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}><EyeOutlined /> {r.view_count} lượt xem</Text>
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", margin: "8px 0", color: "var(--muted)" }}>{url(r)}</div>
          <Space wrap>
            <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(r)}>Sao chép</Button>
            <Button size="small" icon={<LockOutlined />} onClick={() => setPinFor(r)}>{r.has_pin ? "Đổi PIN" : "Đặt PIN"}</Button>
            {r.has_pin && <Button size="small" icon={<UnlockOutlined />} onClick={() => removePin(r)}>Bỏ PIN</Button>}
            <Tooltip title={r.is_active ? "Tắt link" : "Bật link"}>
              <Button size="small" icon={r.is_active ? <StopOutlined /> : <CheckCircleOutlined />} onClick={() => handleToggle(r.id)}>{r.is_active ? "Tắt" : "Bật"}</Button>
            </Tooltip>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>Xoá</Button>
          </Space>
        </div>
      ))}
      <Modal title="Tạo link công khai" open={modalOpen} onCancel={() => { setModalOpen(false); form.resetFields(); }} onOk={handleCreate} okText="Tạo link" cancelText="Huỷ" confirmLoading={saving}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} initialValues={{ expiry_months: 0 }}>
          <Form.Item name="label" label="Nhãn link" rules={[{ required: true, message: "Nhập nhãn cho link" }]}>
            <Input placeholder="VD: Trang CLB cho thành viên" />
          </Form.Item>
          <Form.Item name="expiry_months" label="Thời hạn"><Select options={EXPIRY_OPTIONS} /></Form.Item>
        </Form>
      </Modal>
      {pinFor && <PinModal key={pinFor.id} link={pinFor} open onClose={() => setPinFor(null)} onSaved={load} />}
    </Space>
  );
}
