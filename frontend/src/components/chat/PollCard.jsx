/** PollCard — bình chọn kiểu Zalo trong kênh trò chuyện public: chọn một/nhiều, ẩn danh, thêm lựa chọn, đóng (người tạo), kết quả trực tiếp. */
import { useState } from "react";
import { Button, Input, Progress, Space, Tag, Typography, message } from "antd";
import { CheckCircleFilled, LockOutlined, PlusOutlined } from "@ant-design/icons";
import { pollPercents } from "../../utils/chat";

const { Text } = Typography;

export default function PollCard({ poll, meId, api, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newOpt, setNewOpt] = useState("");
  const pct = Object.fromEntries(pollPercents(poll).map((x) => [x.id, x.pct]));
  const mine = new Set(poll.my_votes || []);
  const canVote = !!meId && !poll.closed;

  const toggle = async (optId) => {
    if (!canVote || busy) return;
    let next;
    if (poll.multi) next = mine.has(optId) ? [...mine].filter((x) => x !== optId) : [...mine, optId];
    else next = mine.has(optId) ? [] : [optId];
    setBusy(true);
    try { const r = await api.vote(poll.id, next); onUpdated(r.data); }
    catch (err) { message.error(err?.response?.data?.detail || "Không bỏ phiếu được"); }
    finally { setBusy(false); }
  };
  const add = async () => {
    const t = newOpt.trim();
    if (!t) return;
    setBusy(true);
    try { const r = await api.addOption(poll.id, t); onUpdated(r.data); setNewOpt(""); setAdding(false); }
    catch (err) { message.error(err?.response?.data?.detail || "Không thêm được"); }
    finally { setBusy(false); }
  };
  const close = async () => {
    setBusy(true);
    try { const r = await api.closePoll(poll.id); onUpdated(r.data); message.success("Đã đóng bình chọn"); }
    catch (err) { message.error(err?.response?.data?.detail || "Không đóng được"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ border: "1px solid var(--brand-line)", borderRadius: 12, padding: 12, background: "var(--brand-soft)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Text strong style={{ flex: 1, minWidth: 0 }}>📊 {poll.question}</Text>
        {poll.closed && <Tag icon={<LockOutlined />}>Đã đóng</Tag>}
        {poll.multi && <Tag>Chọn nhiều</Tag>}
        {poll.anonymous && <Tag>Ẩn danh</Tag>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {poll.options.map((o) => {
          const chosen = mine.has(o.id);
          return (
            <button key={o.id} type="button" onClick={() => toggle(o.id)} disabled={!canVote || busy}
              style={{ textAlign: "left", border: `1px solid ${chosen ? "var(--brand)" : "var(--line)"}`, borderRadius: 10, padding: "8px 10px",
                background: "var(--surface)", cursor: canVote ? "pointer" : "default", color: "var(--ink)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{chosen && <CheckCircleFilled style={{ color: "var(--brand)", marginRight: 6 }} />}{o.text}</span>
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>{o.count} · {pct[o.id]}%</span>
              </div>
              <Progress percent={pct[o.id]} showInfo={false} size="small" strokeColor="var(--brand)" style={{ margin: "4px 0 0" }} />
              {!poll.anonymous && o.voters?.length > 0 && <Text type="secondary" style={{ fontSize: 12 }}>{o.voters.join(", ")}</Text>}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 8, flexWrap: "wrap" }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {poll.total_voters} người đã chọn{poll.closes_at && !poll.closed ? ` · hết hạn ${new Date(poll.closes_at.endsWith("Z") ? poll.closes_at : `${poll.closes_at}Z`).toLocaleString("vi-VN")}` : ""}
          {poll.creator_name ? ` · tạo bởi ${poll.creator_name}` : ""}
        </Text>
        <Space size={4}>
          {canVote && (poll.allow_add || poll.creator_id === meId) && !adding && <Button size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Thêm lựa chọn</Button>}
          {!poll.closed && poll.creator_id === meId && <Button size="small" onClick={close} loading={busy}>Đóng</Button>}
        </Space>
      </div>
      {adding && (
        <Space.Compact style={{ width: "100%", marginTop: 8 }}>
          <Input value={newOpt} onChange={(e) => setNewOpt(e.target.value)} maxLength={80} placeholder="Lựa chọn mới" onPressEnter={add} />
          <Button type="primary" onClick={add} loading={busy}>Thêm</Button>
          <Button onClick={() => { setAdding(false); setNewOpt(""); }}>Huỷ</Button>
        </Space.Compact>
      )}
    </div>
  );
}
