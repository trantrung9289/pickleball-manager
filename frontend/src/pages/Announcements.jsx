/**
 * Trang "Thông báo" (đợt 2, 2026-10-27): quản lý quy tắc thông báo hiện trên chuông admin + trang public.
 * - Hai loại: lịch sinh hoạt (nội dung tự đặt) và khoản thu (nội dung tự sinh từ người chưa đóng, chọn khoản thu định kỳ).
 * - Lặp: một lần / hàng tuần (chọn thứ) / hàng tháng (ngày). Hiện trước N ngày (lead_days).
 * - Đợt 3: push_telegram → cron gửi Telegram tới admin CLB vào ngày đầu cửa sổ và đúng ngày; nút "Gửi ngay" gửi lần gần nhất.
 * - 2026-10-30: loại "Báo cáo" (kind=report): báo cáo định kỳ Tổng hợp thu chi / Giao dịch, khoảng thời gian tương đối kết thúc hết hôm qua,
 *   chỉ đẩy qua kênh đã chọn (mặc định Telegram quản trị viên), không hiện chuông/public; công tắc ẩn tên cho báo cáo giao dịch.
 * - 2026-10-30: giờ đẩy push_time theo từng quy tắc (bắt buộc khi bật đẩy, không mặc định — trước đó cron gửi ngay sau 0h);
 *   nhắc trước giờ bắt đầu remind_before_min (giờ + phút, chỉ lịch có Giờ), gửi đúng ngày diễn ra một lần.
 * - "Xem trước 4 tuần": feed include_later để kiểm tra quy tắc nổ đúng ngày.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Button, Space, Modal, Form, Input, Select, InputNumber, Switch, message, Typography, Row, Col, Card, Radio, Checkbox,
  DatePicker, TimePicker, Tooltip, Empty, Spin, Alert,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, SaveOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import ResponsiveTable from "../components/ResponsiveTable";
import { StatusChip } from "../components/ui";
import { FeedItem } from "../components/NotificationBell";
import { announcementsApi, feeTypesApi } from "../api";
import useHotkey from "../hooks/useHotkey";
import usePublicLink from "../hooks/usePublicLink";
import PushHistoryCard from "../components/PushHistoryCard";
import { WEEKDAY_LABELS, KIND_LABELS, groupByDate, remindLabel, REPORT_TYPE_LABELS, REPORT_RANGE_OPTIONS, REPORT_CHANNEL_LABELS, reportSummaryText } from "../utils/announcements";

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
  report_period: r.report_from && r.report_to ? [dayjs(r.report_from), dayjs(r.report_to)] : null,
  report_channels: r.report_channels?.length ? r.report_channels : ["telegram"],
});

const fromForm = (v) => {
  const isReport = v.kind === "report";
  return {
    kind: v.kind, title: v.title, body: v.body || null,
    fee_type_id: v.kind === "fee" ? v.fee_type_id : null,
    recurrence: v.recurrence,
    weekdays: v.recurrence === "weekly" ? v.weekdays || [] : null,
    day_of_month: v.recurrence === "monthly" ? v.day_of_month : null,
    // Báo cáo không có giờ bắt đầu / thời lượng / hiện trước / public / nhắc trước (backend cũng chuẩn hoá)
    start_time: !isReport && v.start_time ? v.start_time.format("HH:mm") : null,
    duration_min: isReport ? null : v.duration_min ?? null,
    lead_days: isReport ? 0 : v.lead_days ?? 3,
    repeat_daily: isReport ? false : v.repeat_daily ?? false,
    start_date: v.start_date ? v.start_date.format("YYYY-MM-DD") : null,
    end_date: v.end_date ? v.end_date.format("YYYY-MM-DD") : null,
    is_active: v.is_active ?? true, show_public: isReport ? false : v.show_public ?? true, push_telegram: v.push_telegram ?? false,
    push_time: v.push_time ? v.push_time.format("HH:mm") : null,
    remind_before_min: !isReport && v.remind_enabled && v.start_time ? (Number(v.remind_h) || 0) * 60 + (Number(v.remind_m) || 0) : null,
    report_type: isReport ? v.report_type : null,
    report_range: isReport ? v.report_range : null,
    report_range_days: isReport && v.report_range === "last_n" ? v.report_range_days ?? null : null,
    report_from: isReport && v.report_range === "fixed" && v.report_period?.[0] ? v.report_period[0].format("YYYY-MM-DD") : null,
    report_to: isReport && v.report_range === "fixed" && v.report_period?.[1] ? v.report_period[1].format("YYYY-MM-DD") : null,
    report_channels: isReport ? (v.report_channels?.length ? v.report_channels : ["telegram"]) : null,
    report_hide_names: isReport && v.report_type === "transactions" ? !!v.report_hide_names : false,
  };
};

export default function Announcements({ perms, clubName = "" }) {
  const publicUrl = usePublicLink(true);
  const share = { clubName, publicUrl: publicUrl || "" };
  const [data, setData] = useState([]);
  const [feeTypes, setFeeTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [histKey, setHistKey] = useState(0);   // tăng để thẻ Lịch sử đẩy tải lại
  const [form] = Form.useForm();
  const kind = Form.useWatch("kind", form);
  const recurrence = Form.useWatch("recurrence", form);
  const pushOn = Form.useWatch("push_telegram", form);
  const startTime = Form.useWatch("start_time", form);
  const remindOn = Form.useWatch("remind_enabled", form);
  const reportType = Form.useWatch("report_type", form);
  const reportRange = Form.useWatch("report_range", form);
  const reportChannels = Form.useWatch("report_channels", form);
  const isReport = kind === "report";
  const fixedRange = isReport && reportRange === "fixed";
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
      setData(a.data); setFeeTypes((f.data || []).filter((x) => x.type === "income")); setPreview(p.data); setHistKey((k) => k + 1);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ kind: "schedule", recurrence: "weekly", weekdays: [], lead_days: 3, repeat_daily: false, is_active: true, show_public: true, push_telegram: false, push_time: null, remind_enabled: false, remind_h: null, remind_m: null, report_channels: ["telegram"], report_hide_names: false });
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
    const ok = await confirm({
      title: "Gửi ngay?",
      content: r.kind === "report"
        ? <div>Gửi báo cáo <b>{r.title}</b> ngay (khoảng thời gian tính theo hôm nay) tới: {(r.report_channels?.length ? r.report_channels : ["telegram"]).map((c) => REPORT_CHANNEL_LABELS[c]).join(", ")}.</div>
        : <div>Gửi lần xuất hiện gần nhất của <b>{r.title}</b> tới quản trị viên đã liên kết Telegram, thiết bị đã bật thông báo và nhóm Zalo của CLB.</div>,
      okText: "Gửi",
    });
    if (!ok) return;
    try {
      const d = (await announcementsApi.push(r.id)).data;
      const parts = [`Telegram ${d.sent}`, `thiết bị ${d.web_push_sent ?? 0}`, `Zalo ${d.zalo_sent ?? 0}`];
      const errs = (d.errors?.length || 0) + (d.web_push_errors || 0) + (d.zalo_errors || 0);
      message.success(`Đã gửi (ngày ${dayjs(d.date).format("DD/MM")}): ${parts.join(", ")}${errs ? `, ${errs} lỗi` : ""}`);
      setHistKey((k) => k + 1);
    }
    catch (err) { message.error(err.response?.data?.detail || "Không gửi được"); }
  };

  const toggle = async (r, field, value) => {
    try { await announcementsApi.update(r.id, { [field]: value }); load(); }
    catch (err) { message.error(err.response?.data?.detail || "Không cập nhật được"); }
  };

  const columns = [
    {
      title: "Tiêu đề", dataIndex: "title",
      render: (v, r) => (
        <span><b>{v}</b>{r.kind === "fee" && r.fee_type_name && <Text type="secondary"> · {r.fee_type_name}</Text>}
          {r.kind === "report" && <Text type="secondary" style={{ display: "block", fontSize: 12 }}>{reportSummaryText(r)}</Text>}</span>
      ),
    },
    { title: "Loại", dataIndex: "kind", render: (v) => <StatusChip tone={v === "fee" ? "warn" : v === "report" ? "info" : "brand"}>{KIND_LABELS[v] || v}</StatusChip> },
    { title: "Lặp", dataIndex: "recurrence_label" },
    { title: "Hiện trước", dataIndex: "lead_days", render: (v, r) => (r.kind === "report" ? "—" : `${v} ngày${r.repeat_daily ? " · nhắc hằng ngày" : ""}`) },
    { title: "Hiệu lực", render: (_, r) => (r.start_date || r.end_date) ? `${r.start_date ? dayjs(r.start_date).format("DD/MM/YY") : "…"} → ${r.end_date ? dayjs(r.end_date).format("DD/MM/YY") : "…"}` : "—" },
    { title: "Public", dataIndex: "show_public", render: (v, r) => (r.kind === "report" ? <Text type="secondary">—</Text> : <Switch size="small" checked={v} disabled={!canEdit} onChange={(c) => toggle(r, "show_public", c)} />) },
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
          <Tooltip title="Gửi ngay (Telegram, thiết bị, Zalo)"><Button size="small" icon={<SendOutlined />} onClick={() => pushNow(r)} /></Tooltip>
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
          <PushHistoryCard refreshKey={histKey} />
        </Col>
        <Col xs={24} xxl={9}>
          <Card size="small" title={<span>Xem trước 4 tuần tới {preview && <StatusChip tone="brand">{preview.items.length}</StatusChip>}</span>}>
            {!preview ? <Spin /> : !preview.items.length ? <Empty description="Không có lần xuất hiện nào trong 28 ngày tới" />
              : previewGroups.map((g) => (
                <div key={g.date}>
                  {g.items.map((it) => <FeedItem key={`${it.announcement_id}:${it.date}`} it={it} share={share} />)}
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
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}
          onValuesChange={(chg) => {
            // Chọn loại Báo cáo → điền sẵn giá trị hợp lý (người dùng vẫn đổi được): tổng hợp thu chi, tháng trước, ngày 1 hằng tháng, gửi tự động, Telegram
            if (chg.kind === "report") {
              form.setFieldsValue({
                report_type: form.getFieldValue("report_type") || "summary", report_range: form.getFieldValue("report_range") || "last_month",
                recurrence: "monthly", day_of_month: form.getFieldValue("day_of_month") || 1, push_telegram: true,
                report_channels: form.getFieldValue("report_channels") || ["telegram"],
              });
            }
          }}>
          <Form.Item name="kind" label="Loại" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid" options={[{ label: "Lịch sinh hoạt", value: "schedule" }, { label: "Khoản thu", value: "fee" }, { label: "Báo cáo", value: "report" }]} />
          </Form.Item>
          <Form.Item name="title" label="Tiêu đề" rules={[{ required: true, message: "Nhập tiêu đề" }]}>
            <Input placeholder={kind === "fee" ? "Ví dụ: Hội phí tháng" : isReport ? "Ví dụ: Báo cáo thu chi tuần" : "Ví dụ: Sinh hoạt tối thứ 3"} maxLength={200} />
          </Form.Item>
          {kind === "fee" && (
            <Form.Item name="fee_type_id" label="Khoản thu" rules={[{ required: true, message: "Chọn khoản thu" }]}
              extra="Nội dung tự sinh: hạn đóng, số người và tên thành viên chưa đóng trong tháng của ngày đến hạn.">
              <Select placeholder="Chọn khoản thu" options={feeTypes.map((f) => ({ value: f.id, label: f.name }))} showSearch optionFilterProp="label" />
            </Form.Item>
          )}
          {isReport && (
            <>
              <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Báo cáo định kỳ chỉ được đẩy qua kênh bạn chọn, không hiện ở chuông hay trang công khai. Số liệu lấy đến hết hôm qua so với ngày gửi."
                description="Báo cáo gửi cho nhóm Zalo hoặc thiết bị sẽ cho nhiều người thấy số tiền thu chi." />
              <Form.Item name="report_type" label="Loại báo cáo" rules={[{ required: true, message: "Chọn loại báo cáo" }]}>
                <Radio.Group optionType="button" options={Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item name="report_range" label="Khoảng thời gian lấy dữ liệu" rules={[{ required: true, message: "Chọn khoảng thời gian" }]}
                extra="Tính theo ngày gửi và kết thúc ở hết hôm qua (chỉ lấy các ngày trọn vẹn). Tồn đầu kỳ và tồn cuối kỳ tính theo khoảng đã chọn.">
                <Select options={REPORT_RANGE_OPTIONS} placeholder="Chọn khoảng thời gian"
                  onChange={(v) => { if (v === "fixed") form.setFieldsValue({ recurrence: "none" }); }} />
              </Form.Item>
              {reportRange === "last_n" && (
                <Form.Item name="report_range_days" label="Số ngày" rules={[{ required: true, message: "Nhập số ngày" }]}>
                  <InputNumber min={1} max={366} style={{ width: 140 }} addonAfter="ngày" />
                </Form.Item>
              )}
              {reportRange === "fixed" && (
                <Form.Item name="report_period" label="Từ ngày – đến ngày" rules={[{ required: true, message: "Chọn khoảng ngày" }]}
                  extra="Khoảng cố định chỉ gửi một lần vào ngày gửi bên dưới.">
                  <DatePicker.RangePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
                </Form.Item>
              )}
            </>
          )}
          <Form.Item name="body" label={kind === "fee" || isReport ? "Ghi chú thêm (tuỳ chọn)" : "Nội dung"}>
            <TextArea rows={isReport ? 2 : 3} placeholder={kind === "fee" ? "Ví dụ: Chuyển khoản cho thủ quỹ hoặc đóng tại sân." : isReport ? "Dòng ghi chú in ở đầu báo cáo." : "Địa điểm, sân, lưu ý…"} />
          </Form.Item>
          <Form.Item name="recurrence" label="Lặp lại" rules={[{ required: true }]}>
            <Radio.Group optionType="button" options={[{ label: "Một lần", value: "none" }, { label: "Hàng tuần", value: "weekly", disabled: fixedRange }, { label: "Hàng tháng", value: "monthly", disabled: fixedRange }]} />
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
              <Form.Item name="start_date" label={recurrence === "none" ? (isReport ? "Ngày gửi" : "Ngày") : "Hiệu lực từ"} rules={recurrence === "none" ? [{ required: true, message: "Chọn ngày" }] : []}>
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
          {!isReport && (
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
          )}
          <Space size="large" wrap>
            {!isReport && <Form.Item name="show_public" label="Hiện trên trang public" valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>}
            <Form.Item name="is_active" label="Bật" valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
            <Form.Item name="push_telegram"
              label={<Tooltip title={isReport ? "Tự động gửi báo cáo vào ngày gửi, khi tới Giờ đẩy bên dưới. Tắt thì chỉ gửi khi bấm Gửi ngay." : "Gửi Telegram cho admin + đẩy tới thiết bị đã bật vào ngày đầu cửa sổ hiện trước và đúng ngày, khi tới Giờ đẩy bên dưới"}>{isReport ? "Gửi tự động" : "Đẩy thông báo"}</Tooltip>}
              valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
            {!isReport && <Form.Item name="repeat_daily" label={<Tooltip title="Đẩy lại mỗi ngày trong cửa sổ hiện trước (một lần/ngày), thay vì chỉ ngày đầu và đúng ngày. Dùng cho nhắc đóng phí.">Nhắc lại hằng ngày</Tooltip>} valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>}
          </Space>
          {isReport && (
            <div style={{ marginTop: 16 }}>
              <Form.Item name="report_channels" label="Gửi tới" rules={[{ required: true, type: "array", min: 1, message: "Chọn ít nhất một kênh" }]}
                extra="Mặc định chỉ Telegram quản trị viên. Nhóm Zalo (đã duyệt) và thiết bị đã bật thông báo phải bật tay.">
                <Checkbox.Group options={Object.entries(REPORT_CHANNEL_LABELS).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              {(reportChannels || []).some((c) => c === "zalo" || c === "web") && (
                <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Nhóm Zalo và thiết bị sẽ thấy số liệu thu chi" />
              )}
              {reportType === "transactions" && (
                <Form.Item name="report_hide_names" label="Ẩn tên thành viên và ghi chú" valuePropName="checked" style={{ marginBottom: 0 }}
                  extra="Danh sách giao dịch chỉ còn ngày, thu hoặc chi, khoản và số tiền.">
                  <Switch />
                </Form.Item>
              )}
            </div>
          )}
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
