/**
 * Trang "Thông báo" (đợt 2, 2026-10-27): quản lý quy tắc thông báo hiện trên chuông admin + trang public.
 * - Hai loại: lịch sinh hoạt (nội dung tự đặt) và khoản thu (nội dung tự sinh từ người chưa đóng, chọn khoản thu định kỳ).
 * - Lặp: một lần / hàng tuần (chọn thứ) / hàng tháng (ngày). Hiện trước N ngày (lead_days).
 * - Đợt 3: push_telegram → cron gửi Telegram tới admin CLB vào ngày đầu cửa sổ và đúng ngày; nút "Gửi ngay" gửi lần gần nhất.
 * - 2026-10-30: giờ đẩy push_time theo từng quy tắc (bắt buộc khi bật đẩy, không mặc định — trước đó cron gửi ngay sau 0h);
 *   nhắc trước giờ bắt đầu remind_before_min (giờ + phút, chỉ lịch có Giờ), gửi đúng ngày diễn ra một lần.
 * - "Xem trước 4 tuần": feed include_later để kiểm tra quy tắc nổ đúng ngày.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Button, Space, Modal, Form, Input, Select, InputNumber, Switch, message, Typography, Row, Col, Card, Radio, Checkbox,
  DatePicker, TimePicker, Tooltip, Empty, Spin,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, SaveOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import ResponsiveTable from "../components/ResponsiveTable";
import { StatusChip } from "../components/ui";
import { FeedItem } from "../components/NotificationBell";
import { announcementsApi, feeTypesApi } from "../api";
import useHotkey from "../hooks/useHotkey";
import { WEEKDAY_LABELS, KIND_LABELS, groupByDate, remindLabel } from "../utils/announcements";

const { Title, Text } = Typography;
const { TextArea } = Input;

const confirm = (opts) =>
  new Promise((resolve) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => resolve(true), onCancel: () => resolve(false) })
  );

const toForm = (r) => ({
  ...r,
  start_date: r.start_date ? dayjs(r.start_date) : null,
  end_date: r.end_date ? dayjs(r.end_date) : null,
  start_time: r.start_time ? dayjs(r.start_time, "HH:mm") : null,
  push_time: r.push_time ? dayjs(r.push_time, "HH:mm") : null,
  remind_enabled: r.remind_before_min != null,
  remind_h: r.remind_before_min != null ? Math.floor(r.remind_before_min / 60) : null,
  remind_m: r.remind_before_min != null ? r.remind_before_min % 60 : null,
});

const fromForm = (v) => ({
  kind: v.kind, title: v.title, body: v.body || null,
  fee_type_id: v.kind === "fee" ? v.fee_type_id : null,
  recurrence: v.recurrence,
  weekdays: v.recurrence === "weekly" ? v.weekdays || [] : null,
  day_of_month: v.recurrence === "monthly" ? v.day_of_month : null,
  start_time: v.start_time ? v.start_time.format("HH:mm") : null,
  duration_min: v.duration_min ?? null,
  lead_days: v.lead_days ?? 3,
  repeat_daily: v.repeat_daily ?? false,
  start_date: v.start_date ? v.start_date.format("YYYY-MM-DD") : null,
  end_date: v.end_date ? v.end_date.format("YYYY-MM-DD") : null,
  is_active: v.is_active ?? true, show_public: v.show_public ?? true, push_telegram: v.push_telegram ?? false,
  push_time: v.push_time ? v.push_time.format("HH:mm") : null,
  remind_before_min: v.remind_enabled && v.start_time ? (Number(v.remind_h) || 0) * 60 + (Number(v.remind_m) || 0) : null,
});

export default function Announcements({ perms }) {
  const [data, setData] = useState([]);
  const [feeTypes, setFeeTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form] = Form.useForm();
  const kind = Form.useWatch("kind", form);
  const recurrence = Form.useWatch("recurrence", form);
  const pushOn = Form.useWatch("push_telegram", form);
  const startTime = Form.useWatch("start_time", form);
  const remindOn = Form.useWatch("remind_enabled", form);
  const canEdit = perms?.canEdit ?? true;

  useHotkey({
    "n": () => !modalOpen && canEdit && openCreate(),
    "r": () => load(),
    "ctrl+enter": () => modalOpen && handleSave(),
    "escape": () => modalOpen && setModalOpen(false),
  });

  const load = async () => {
    setLoading(true);
    try {
      const [a, f, p] = await Promise.all([
        announcementsApi.list(), feeTypesApi.list(), announcementsApi.feed({ days: 28, include_later: true }),
      ]);
      setData(a.data); setFeeTypes((f.data || []).filter((x) => x.type === "income")); setPreview(p.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ kind: "schedule", recurrence: "weekly", weekdays: [], lead_days: 3, repeat_daily: false, is_active: true, show_public: true, push_telegram: false, push_time: null, remind_enabled: false, remind_h: null, remind_m: null });
    setModalOpen(true);
  };
  const openEdit = (r) => { setEditing(r); form.setFieldsValue(toForm(r)); setModalOpen(true); };

  const handleSave = async () => {
    let vals;
    try { vals = await form.validateFields(); } catch { return; }
    const payload = fromForm(vals);
    setSaving(true);
    try {
      if (editing) { await announcementsApi.update(editing.id, payload); message.success("Đã cập nhật thông báo"); }
      else { await announcementsApi.create(payload); message.success("Đã tạo thông báo"); }
      setModalOpen(false); load();
    } catch (err) { message.error(err.response?.data?.detail || "Không lưu được"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (r) => {
    const ok = await confirm({ title: "Xoá thông báo?", content: <div>Quy tắc <b>{r.title}</b> sẽ bị xoá khỏi chuông và trang public.</div>, okText: "Xoá", okButtonProps: { danger: true } });
    if (!ok) return;
    await announcementsApi.delete(r.id); message.success("Đã xoá"); load();
  };

  const pushNow = async (r) => {
    const ok = await confirm({ title: "Gửi Telegram ngay?", content: <div>Gửi lần xuất hiện gần nhất của <b>{r.title}</b> tới các quản trị viên đã liên kết Telegram.</div>, okText: "Gửi" });
    if (!ok) return;
    try { const res = await announcementsApi.push(r.id); message.success(`Đã gửi ${res.data.sent} tin (ngày ${dayjs(res.data.date).format("DD/MM")})${res.data.errors?.length ? `, ${res.data.errors.length} lỗi` : ""}`); }
    catch (err) { message.error(err.response?.data?.detail || "Không gửi được"); }
  };

  const toggle = async (r, field, value) => {
    try { await announcementsApi.update(r.id, { [field]: value }); load(); }
    catch (err) { message.error(err.response?.data?.detail || "Không cập nhật được"); }
  };

  const columns = [
    { title: "Tiêu đề", dataIndex: "title", render: (v, r) => <span><b>{v}</b>{r.kind === "fee" && r.fee_type_name && <Text type="secondary"> · {r.fee_type_name}</Text>}</span> },
    { title: "Loại", dataIndex: "kind", render: (v) => <StatusChip tone={v === "fee" ? "warn" : "brand"}>{KIND_LABELS[v] || v}</StatusChip> },
    { title: "Lặp", dataIndex: "recurrence_label" },
    { title: "Hiện trước", dataIndex: "lead_days", render: (v, r) => `${v} ngày${r.repeat_daily ? " · nhắc hằng ngày" : ""}` },
    { title: "Hiệu lực", render: (_, r) => (r.start_date || r.end_date) ? `${r.start_date ? dayjs(r.start_date).format("DD/MM/YY") : "…"} → ${r.end_date ? dayjs(r.end_date).format("DD/MM/YY") : "…"}` : "—" },
    { title: "Public", dataIndex: "show_public", render: (v, r) => <Switch size="small" checked={v} disabled={!canEdit} onChange={(c) => toggle(r, "show_public", c)} /> },
    { title: "Bật", dataIndex: "is_active", render: (v, r) => <Switch size="small" checked={v} disabled={!canEdit} onChange={(c) => toggle(r, "is_active", c)} /> },
    { title: "Đẩy", dataIndex: "push_telegram", render: (v, r) => <Tooltip title="Gửi Telegram cho admin + đẩy tới thiết bị đã bật vào ngày đầu cửa sổ hiện trước và đúng ngày, khi tới Giờ đẩy (cron 15 phút); không gửi trùng trong ngày"><Switch size="small" checked={v} disabled={!canEdit} onChange={(c) => toggle(r, "push_telegram", c)} /></Tooltip> },
    {
      title: "Giờ đẩy", dataIndex: "push_time",
      render: (v, r) => (
        <span>
          {v ? v : r.push_telegram ? <StatusChip tone="danger">Chưa đặt giờ</StatusChip> : <Text type="secondary">—</Text>}
          {r.remind_before_min != null && <Text type="secondary" style={{ display: "block", fontSize: 12 }}>nhắc trước {remindLabel(r.remind_before_min)}</Text>}
        </span>
      ),
    },
    {
      title: "Thao tác", width: 130,
      render: (_, r) => canEdit ? (
        <Space>
          <Tooltip title="Gửi Telegram ngay"><Button size="small" icon={<SendOutlined />} onClick={() => pushNow(r)} /></Tooltip>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} />
        </Space>
      ) : null,
    },
  ];

  const previewGroups = useMemo(() => groupByDate(preview?.items || []), [preview]);

  return (
    <div>
      <Row justify="space-between" align="middle" gutter={[8, 8]} style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Thông báo</Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load}>Làm mới (R)</Button>
          {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm thông báo (N)</Button>}
        </Space>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xxl={15}>
          <Card size="small" title="Quy tắc thông báo">
            <ResponsiveTable columns={columns} dataSource={data} rowKey="id" loading={loading} size="small" pagination={false}
              mobileTitle={(r) => r.title} mobileHideColumns={["Tiêu đề"]} />
          </Card>
        </Col>
        <Col xs={24} xxl={9}>
          <Card size="small" title={<span>Xem trước 4 tuần tới {preview && <StatusChip tone="brand">{preview.items.length}</StatusChip>}</span>}>
            {!preview ? <Spin /> : !preview.items.length ? <Empty description="Không có lần xuất hiện nào trong 28 ngày tới" />
              : previewGroups.map((g) => (
                <div key={g.date}>
                  {g.items.map((it) => <FeedItem key={`${it.announcement_id}:${it.date}`} it={it} />)}
                </div>
              ))}
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
              Chuông và trang public chỉ hiện các mục đã vào cửa sổ "hiện trước N ngày"; danh sách này hiện cả mục chưa tới cửa sổ.
            </Text>
          </Card>
        </Col>
      </Row>

      <Modal
        title={editing ? "Sửa thông báo" : "Thêm thông báo"}
        open={modalOpen} onCancel={() => setModalOpen(false)} width={560}
        footer={<Space><Button onClick={() => setModalOpen(false)}>Hủy (Esc)</Button><Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>Lưu (Ctrl+Enter)</Button></Space>}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="kind" label="Loại" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid" options={[{ label: "Lịch sinh hoạt", value: "schedule" }, { label: "Khoản thu", value: "fee" }]} />
          </Form.Item>
          <Form.Item name="title" label="Tiêu đề" rules={[{ required: true, message: "Nhập tiêu đề" }]}>
            <Input placeholder={kind === "fee" ? "Ví dụ: Hội phí tháng" : "Ví dụ: Sinh hoạt tối thứ 3"} maxLength={200} />
          </Form.Item>
          {kind === "fee" && (
            <Form.Item name="fee_type_id" label="Khoản thu" rules={[{ required: true, message: "Chọn khoản thu" }]}
              extra="Nội dung tự sinh: hạn đóng, số người và tên thành viên chưa đóng trong tháng của ngày đến hạn.">
              <Select placeholder="Chọn khoản thu" options={feeTypes.map((f) => ({ value: f.id, label: f.name }))} showSearch optionFilterProp="label" />
            </Form.Item>
          )}
          <Form.Item name="body" label={kind === "fee" ? "Ghi chú thêm (tuỳ chọn)" : "Nội dung"}>
            <TextArea rows={3} placeholder={kind === "fee" ? "Ví dụ: Chuyển khoản cho thủ quỹ hoặc đóng tại sân." : "Địa điểm, sân, lưu ý…"} />
          </Form.Item>
          <Form.Item name="recurrence" label="Lặp lại" rules={[{ required: true }]}>
            <Radio.Group optionType="button" options={[{ label: "Một lần", value: "none" }, { label: "Hàng tuần", value: "weekly" }, { label: "Hàng tháng", value: "monthly" }]} />
          </Form.Item>
          {recurrence === "weekly" && (
            <Form.Item name="weekdays" label="Các thứ trong tuần" rules={[{ required: true, type: "array", min: 1, message: "Chọn ít nhất một thứ" }]}>
              <Checkbox.Group options={WEEKDAY_LABELS.map((l, i) => ({ label: l, value: i }))} />
            </Form.Item>
          )}
          {recurrence === "monthly" && (
            <Form.Item name="day_of_month" label={kind === "fee" ? "Ngày đến hạn trong tháng" : "Ngày trong tháng"} rules={[{ required: true, message: "Nhập ngày 1–31" }]}
              extra="Tháng không đủ ngày thì lấy ngày cuối tháng.">
              <InputNumber min={1} max={31} style={{ width: 120 }} />
            </Form.Item>
          )}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="start_date" label={recurrence === "none" ? "Ngày" : "Hiệu lực từ"} rules={recurrence === "none" ? [{ required: true, message: "Chọn ngày" }] : []}>
                <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            {recurrence !== "none" && (
              <Col span={12}>
                <Form.Item name="end_date" label="Hiệu lực đến">
                  <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            )}
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="start_time" label="Giờ"><TimePicker format="HH:mm" minuteStep={5} style={{ width: "100%" }} /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="duration_min" label="Thời lượng (phút)"><InputNumber min={0} max={1440} step={15} style={{ width: "100%" }} /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="lead_days" label="Hiện trước (ngày)" rules={[{ required: true }]}><InputNumber min={0} max={60} style={{ width: "100%" }} /></Form.Item>
            </Col>
          </Row>
          <Space size="large" wrap>
            <Form.Item name="show_public" label="Hiện trên trang public" valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
            <Form.Item name="is_active" label="Bật" valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
            <Form.Item name="push_telegram" label={<Tooltip title="Gửi Telegram cho admin + đẩy tới thiết bị đã bật vào ngày đầu cửa sổ hiện trước và đúng ngày, khi tới Giờ đẩy bên dưới">Đẩy thông báo</Tooltip>} valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
            <Form.Item name="repeat_daily" label={<Tooltip title="Đẩy lại mỗi ngày trong cửa sổ hiện trước (một lần/ngày), thay vì chỉ ngày đầu và đúng ngày. Dùng cho nhắc đóng phí.">Nhắc lại hằng ngày</Tooltip>} valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
          </Space>
          {pushOn && (
            <Row gutter={12} style={{ marginTop: 16 }}>
              <Col span={8}>
                <Form.Item name="push_time" label="Giờ đẩy" rules={[{ required: true, message: "Đặt giờ đẩy" }]}
                  extra="Giờ VN. Tin đến trong vòng 15 phút sau giờ này; không có giờ mặc định.">
                  <TimePicker format="HH:mm" minuteStep={5} style={{ width: "100%" }} placeholder="Chọn giờ" />
                </Form.Item>
              </Col>
              {kind === "schedule" && (
                <Col span={16}>
                  <Form.Item label={<Tooltip title="Đúng ngày diễn ra, gửi thêm một lần trước giờ bắt đầu (cần đặt Giờ ở trên). Mỗi lần diễn ra chỉ nhắc một lần.">Nhắc trước giờ bắt đầu</Tooltip>}
                    extra={!startTime ? "Cần đặt Giờ bắt đầu ở trên." : remindOn ? "Không được lùi sang hôm trước." : null} style={{ marginBottom: 0 }}>
                    <Space align="start" wrap>
                      <Form.Item name="remind_enabled" valuePropName="checked" noStyle><Switch disabled={!startTime} /></Form.Item>
                      {remindOn && startTime && (
                        <>
                          <Form.Item name="remind_h" noStyle><InputNumber min={0} max={23} placeholder="giờ" style={{ width: 80 }} addonAfter="giờ" /></Form.Item>
                          <Form.Item name="remind_m" noStyle><InputNumber min={0} max={59} step={5} placeholder="phút" style={{ width: 96 }} addonAfter="phút" /></Form.Item>
                        </>
                      )}
                    </Space>
                  </Form.Item>
                </Col>
              )}
            </Row>
          )}
        </Form>
      </Modal>
    </div>
  );
}
