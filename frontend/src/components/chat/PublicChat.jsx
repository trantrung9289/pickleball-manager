/**
 * PublicChat — tab "Trò chuyện" trên trang public (2026-10-28, đợt 1). Danh tính theo THIẾT BỊ: nhập biệt danh một lần,
 * máy chủ cấp device_id lưu localStorage (utils/chat.js), gửi kèm header X-Chat-Device (api.js). Văn bản ≤500 ký tự, trả lời,
 * nhắc tên bằng @ (antd Mentions), bình chọn kiểu Zalo (PollCard). Lấy tin mới mỗi 4s theo after_id; cuộn lên tải tin cũ.
 * Không file/ảnh/video. Admin khoá kênh → chỉ đọc. Đợt 2: quản trị (ghim/xoá/tắt tiếng) ở trang admin.
 * 2026-10-29: nhúng trong nút trò chuyện nổi (ChatBubble) — prop embedded → cao theo khung chứa; ghi mốc "đã đọc" (utils/chat saveLastRead)
 * khi đang ở đáy danh sách để nút nổi đếm tin chưa đọc.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, DatePicker, Empty, Form, Input, Mentions, Modal, Space, Tag, Typography, message } from "antd";
import { SendOutlined, BarChartOutlined, LockOutlined, CloseOutlined, DeleteOutlined } from "@ant-design/icons";
import PollCard from "./PollCard";
import { StatusChip } from "../ui";
import { saveDevice, extractMentionIds, mergeMessages, shortTime, saveLastRead } from "../../utils/chat";

const { Text } = Typography;
const POLL_MS = 4000;

function JoinCard({ api, slug, onJoined }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const join = async () => {
    const n = name.trim();
    if (n.length < 2) { message.warning("Tên ít nhất 2 ký tự"); return; }
    setBusy(true);
    try {
      const r = await api.join(n);
      saveDevice(slug, r.data.device_id);
      onJoined(r.data.participant);
    } catch (err) { message.error(err?.response?.data?.detail || "Không vào được"); }
    finally { setBusy(false); }
  };
  return (
    <Card size="small" style={{ maxWidth: 420, margin: "24px auto", textAlign: "center" }}>
      <Text strong style={{ fontSize: 16, display: "block" }}>Vào trò chuyện của CLB</Text>
      <Text type="secondary" style={{ display: "block", margin: "6px 0 14px" }}>Nhập tên để mọi người nhận ra bạn. Tên gắn với thiết bị này, đổi được sau.</Text>
      <Space.Compact style={{ width: "100%" }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Tên hiển thị" onPressEnter={join} autoFocus />
        <Button type="primary" onClick={join} loading={busy}>Vào</Button>
      </Space.Compact>
    </Card>
  );
}

function MessageRow({ m, meId, onReply, onDelete, onPollUpdated, api }) {
  const mine = m.mine || m.participant_id === meId;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", padding: "3px 0" }}>
      <div style={{ maxWidth: "88%", minWidth: m.kind === "poll" ? "min(100%, 360px)" : undefined }}>
        <div style={{ fontSize: 11, color: "var(--muted)", margin: mine ? "0 4px 2px 0" : "0 0 2px 4px", textAlign: mine ? "right" : "left" }}>
          {!mine && <b style={{ color: "var(--ink)" }}>{m.name}</b>}{!mine && " · "}{shortTime(m.created_at)}{m.pinned && <Tag color="gold" style={{ marginLeft: 6, fontSize: 10, lineHeight: "16px" }}>Ghim</Tag>}
        </div>
        {m.kind === "poll" && m.poll ? (
          <PollCard poll={m.poll} meId={meId} api={api} onUpdated={(p) => onPollUpdated(m.id, p)} />
        ) : (
          <div style={{
            background: mine ? "var(--brand)" : "var(--surface)", color: mine ? "#fff" : "var(--ink)",
            border: mine ? "none" : "1px solid var(--line)", borderRadius: 14, padding: "8px 12px", whiteSpace: "pre-wrap", wordBreak: "break-word",
            opacity: m.deleted ? 0.6 : 1, fontStyle: m.deleted ? "italic" : "normal",
          }}>
            {m.reply_to && (
              <div style={{ borderLeft: "3px solid rgba(255,255,255,0.6)", paddingLeft: 8, marginBottom: 6, fontSize: 12, opacity: 0.85 }}>
                <b>{m.reply_to.name}</b>: {m.reply_to.body == null ? "Tin đã thu hồi" : m.reply_to.body}
              </div>
            )}
            {m.deleted ? "Tin đã thu hồi" : m.body}
          </div>
        )}
        {!m.deleted && m.kind === "text" && (
          <div style={{ display: "flex", gap: 10, justifyContent: mine ? "flex-end" : "flex-start", marginTop: 2 }}>
            <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: 11 }} onClick={() => onReply(m)}>Trả lời</Button>
            {mine && <Button type="link" size="small" danger style={{ padding: 0, height: "auto", fontSize: 11 }} icon={<DeleteOutlined />} onClick={() => onDelete(m)}>Thu hồi</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

export function PollModal({ open, onClose, api, onCreated }) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    const options = (v.options || "").split("\n").map((x) => x.trim()).filter(Boolean);
    if (options.length < 2) { message.warning("Cần ít nhất 2 lựa chọn, mỗi dòng một lựa chọn"); return; }
    setBusy(true);
    try {
      const r = await api.createPoll({ question: v.question.trim(), options, multi: !!v.multi, anonymous: !!v.anonymous, allow_add: !!v.allow_add,
        closes_at: v.closes_at ? v.closes_at.toDate().toISOString() : null });
      onCreated(r.data); form.resetFields(); onClose();
      message.success(`Đã tạo bình chọn${r.data.pushed ? `, đã báo ${r.data.pushed} thiết bị` : ""}`);
    } catch (err) { message.error(err?.response?.data?.detail || "Không tạo được bình chọn"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Tạo bình chọn" open={open} onCancel={onClose} onOk={submit} okText="Tạo" cancelText="Huỷ" confirmLoading={busy}>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="question" label="Câu hỏi" rules={[{ required: true, min: 3, message: "Nhập câu hỏi" }]}><Input maxLength={200} placeholder="Ví dụ: Tối nay đánh sân nào?" /></Form.Item>
        <Form.Item name="options" label="Lựa chọn (mỗi dòng một lựa chọn, 2 đến 10)" rules={[{ required: true, message: "Nhập lựa chọn" }]}>
          <Input.TextArea rows={4} placeholder={"Sân A\nSân B"} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="multi" valuePropName="checked" style={{ marginBottom: 0 }}><Checkbox>Chọn nhiều</Checkbox></Form.Item>
          <Form.Item name="anonymous" valuePropName="checked" style={{ marginBottom: 0 }}><Checkbox>Ẩn danh</Checkbox></Form.Item>
          <Form.Item name="allow_add" valuePropName="checked" style={{ marginBottom: 0 }}><Checkbox>Cho thêm lựa chọn</Checkbox></Form.Item>
        </Space>
        <Form.Item name="closes_at" label="Hạn chót (tuỳ chọn)" style={{ marginTop: 12 }}><DatePicker showTime format="DD/MM/YYYY HH:mm" style={{ width: "100%" }} /></Form.Item>
      </Form>
    </Modal>
  );
}

export default function PublicChat({ api, slug, embedded = false }) {
  const [me, setMe] = useState(undefined);        // undefined = đang kiểm tra, null = chưa vào
  const [locked, setLocked] = useState(false);
  const [messages, setMessages] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const listRef = useRef(null);
  const lastIdRef = useRef(0);
  const stickBottomRef = useRef(true);

  const scrollBottom = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; };

  const loadMe = useCallback(() => api.me().then((r) => { setMe(r.data.participant); setLocked(r.data.locked); }).catch(() => setMe(null)), [api]);
  const loadParticipants = useCallback(() => api.participants().then((r) => setParticipants(r.data)).catch(() => {}), [api]);

  const applyIncoming = useCallback((data, initial) => {
    setMessages((prev) => {
      const next = mergeMessages(initial ? [] : prev, data.messages);
      if (next.length) lastIdRef.current = Math.max(lastIdRef.current, next[next.length - 1].id);
      return next;
    });
    if (data.pinned) setPinned(data.pinned);
    if (typeof data.locked === "boolean") setLocked(data.locked);
    if (initial) setHasOlder((data.messages || []).length >= 50);
    // đang ở đáy (hoặc tải lần đầu) → mọi tin vừa nhận coi như đã đọc
    if (initial || stickBottomRef.current) { const mx = Math.max(0, ...(data.messages || []).map((m) => m.id)); if (mx) saveLastRead(slug, mx); }
  }, [slug]);

  useEffect(() => { loadMe(); loadParticipants(); }, [loadMe, loadParticipants]);
  useEffect(() => {
    let alive = true;
    api.messages().then((r) => { if (alive) { applyIncoming(r.data, true); setTimeout(scrollBottom, 50); } }).catch(() => {});
    const t = setInterval(() => {
      api.messages({ after_id: lastIdRef.current || undefined }).then((r) => {
        if (!alive) return;
        if (r.data.messages.length) { applyIncoming(r.data, false); if (stickBottomRef.current) setTimeout(scrollBottom, 30); }
        if (typeof r.data.locked === "boolean") setLocked(r.data.locked);
      }).catch(() => {});
    }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [api, applyIncoming]);

  const onScroll = async () => {
    const el = listRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (stickBottomRef.current && lastIdRef.current) saveLastRead(slug, lastIdRef.current);   // cuộn xuống đáy → đã đọc hết
    if (el.scrollTop < 30 && hasOlder && !loadingOlder && messages.length) {
      setLoadingOlder(true);
      const before = messages[0].id; const h = el.scrollHeight;
      try {
        const r = await api.messages({ before_id: before });
        if (r.data.messages.length < 50) setHasOlder(false);
        setMessages((prev) => mergeMessages(prev, r.data.messages));
        setTimeout(() => { el.scrollTop = el.scrollHeight - h; }, 0);
      } catch { /* bỏ qua */ }
      finally { setLoadingOlder(false); }
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await api.send({ body, reply_to_id: replyTo?.id || null, mention_ids: extractMentionIds(body, participants) });
      setMessages((prev) => mergeMessages(prev, [r.data])); lastIdRef.current = Math.max(lastIdRef.current, r.data.id); saveLastRead(slug, r.data.id);
      setText(""); setReplyTo(null); stickBottomRef.current = true; setTimeout(scrollBottom, 30);
    } catch (err) {
      const code = err?.response?.data?.detail?.code;
      if (code === "chat_join_required") { setMe(null); }
      message.error(err?.response?.data?.detail?.message || err?.response?.data?.detail || "Không gửi được");
    } finally { setSending(false); }
  };
  const deleteOwn = (m) => Modal.confirm({ title: "Thu hồi tin này?", okText: "Thu hồi", cancelText: "Huỷ", onOk: async () => {
    await api.deleteOwn(m.id); setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, deleted: true, body: null } : x));
  } });
  const onPollUpdated = (mid, poll) => setMessages((prev) => prev.map((x) => x.id === mid ? { ...x, poll } : x));
  const mentionOptions = useMemo(() => participants.filter((p) => p.id !== me?.id).map((p) => ({ value: p.display_name, label: p.display_name })), [participants, me]);

  if (me === undefined) return null;
  return (
    <div style={embedded ? { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" } : { display: "flex", flexDirection: "column", height: "calc(100vh - 230px)", minHeight: 420 }}>
      {locked && <Alert type="warning" showIcon icon={<LockOutlined />} message="Kênh đang được khoá: chỉ đọc" style={{ marginBottom: 8 }} />}
      {pinned.length > 0 && (
        <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 10, background: "var(--warn-soft)", border: "1px solid var(--warn)", fontSize: 13 }}>
          {pinned.map((p) => <div key={p.id}>📌 <b>{p.name}</b>: {p.kind === "poll" ? `Bình chọn: ${p.body}` : p.body}</div>)}
        </div>
      )}
      <div ref={listRef} onScroll={onScroll} style={{ flex: 1, overflowY: "auto", padding: "4px 6px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)" }}>
        {loadingOlder && <Text type="secondary" style={{ display: "block", textAlign: "center", fontSize: 12 }}>Đang tải tin cũ…</Text>}
        {!messages.length && <Empty description="Chưa có tin nhắn. Hãy mở lời!" style={{ padding: 40 }} />}
        {messages.map((m) => <MessageRow key={m.id} m={m} meId={me?.id} api={api} onReply={setReplyTo} onDelete={deleteOwn} onPollUpdated={onPollUpdated} />)}
      </div>
      {me === null ? (
        <JoinCard api={api} slug={slug} onJoined={(p) => { setMe(p); loadParticipants(); }} />
      ) : (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <StatusChip tone="brand">{me.display_name}</StatusChip>
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setMe(null)}>Đổi tên</Button>
            {me.muted && <Tag color="red">Bạn đang bị tắt tiếng</Tag>}
            {replyTo && <Tag closable onClose={() => setReplyTo(null)} closeIcon={<CloseOutlined />}>Trả lời {replyTo.name}: {(replyTo.body || "").slice(0, 30)}</Tag>}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <Mentions value={text} onChange={setText} options={mentionOptions} placeholder="Nhập tin nhắn, gõ @ để nhắc tên…" autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={locked || me.muted} maxLength={500} style={{ flex: 1 }}
              onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); send(); } }} />
            <Button icon={<BarChartOutlined />} onClick={() => setPollOpen(true)} disabled={locked || me.muted} title="Tạo bình chọn" />
            <Button type="primary" icon={<SendOutlined />} onClick={send} loading={sending} disabled={locked || me.muted || !text.trim()} />
          </div>
        </div>
      )}
      <PollModal open={pollOpen} onClose={() => setPollOpen(false)} api={api} onCreated={(m) => { setMessages((prev) => mergeMessages(prev, [m])); lastIdRef.current = Math.max(lastIdRef.current, m.id); saveLastRead(slug, m.id); setTimeout(scrollBottom, 30); }} />
    </div>
  );
}
