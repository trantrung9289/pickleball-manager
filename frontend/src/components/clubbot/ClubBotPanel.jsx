/**
 * ClubBotPanel — khung hội thoại BOT CLB (2026-10-29, đợt 1: Thu tiền, Chi tiền). Mô phỏng wizard của bot Telegram (bot/bot.py WIZARDS)
 * ngay trong trang quản lý CLB: bot hỏi từng bước, người dùng bấm "chip" hoặc gõ; xác nhận rồi ghi qua API sẵn có.
 * Quyết định người dùng: không áp cờ "dùng bot" Telegram, chỉ theo quyền tài khoản; không có bật/tắt menu; đợt 2 thêm Thành viên + Khoản thu chi.
 * Luồng: menu → add_thu | add_chi → các bước (fee_type → amount → member|description → date → method → confirm) → ghi → "Ghi tiếp"/"Menu".
 * Sau khi ghi phát sự kiện window "clb:data-changed" {entity:"transactions"} để trang Giao dịch đang mở tải lại.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Typography } from "antd";
import { RobotOutlined, SendOutlined, ArrowLeftOutlined, HomeOutlined } from "@ant-design/icons";
import { feeTypesApi, membersApi, transactionsApi } from "../../api";
import { PAYMENT_METHODS, parseAmount, parseDateText, searchMembers, buildTransactionPayload, summarizeTransaction, formatVnd, toIsoDate, isoToVn, normText, feeDefault } from "../../utils/clubBot";

const { Text } = Typography;
let _mid = 0;
const nid = () => ++_mid;

const FLOWS = {
  add_thu: { kind: "thu", title: "Thu tiền", steps: ["fee_type", "amount", "member", "date", "method", "confirm"] },
  add_chi: { kind: "chi", title: "Chi tiền", steps: ["fee_type", "amount", "description", "date", "method", "confirm"] },
};
const MENU = [
  { key: "add_thu", label: "💰 Thu tiền", need: "canCreate" },
  { key: "add_chi", label: "📤 Chi tiền", need: "canCreate" },
];
const STEP_NO = { fee_type: "①", amount: "②", member: "③", description: "③", date: "④", method: "⑤", confirm: "⑥" };

function Bubble({ m }) {
  const mine = m.role === "me";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", padding: "3px 0" }}>
      <div style={{
        maxWidth: "88%", borderRadius: 14, padding: "8px 12px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14,
        background: mine ? "var(--brand)" : "var(--surface)", color: mine ? "#fff" : "var(--ink)", border: mine ? "none" : "1px solid var(--line)",
      }}>
        {m.text}
        {m.rows && (
          <table style={{ marginTop: 6, borderCollapse: "collapse", fontSize: 13 }}><tbody>
            {m.rows.map(([k, v]) => <tr key={k}><td style={{ color: "var(--muted)", paddingRight: 10, verticalAlign: "top" }}>{k}</td><td style={{ fontWeight: 600 }}>{v}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </div>
  );
}

export default function ClubBotPanel({ club, user, perms, onClose }) {
  // Lời chào + menu là trạng thái ban đầu (không setState trong effect)
  const [messages, setMessages] = useState(() => {
    const allowed = MENU.filter((it) => !it.need || perms?.[it.need]);
    return [{ id: nid(), role: "bot", text: `👋 Xin chào ${user?.full_name || user?.username || "bạn"}! Tôi là BOT của CLB ${club?.name || ""}.\nChọn việc cần làm:`, menu: allowed.length ? allowed : null, noPerm: !allowed.length }];
  });
  const [flow, setFlow] = useState(null);            // { name, step, data } | null
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [feeTypes, setFeeTypes] = useState([]);
  const [members, setMembers] = useState([]);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const say = useCallback((text, extra = {}) => setMessages((prev) => [...prev, { id: nid(), role: "bot", text, ...extra }]), []);
  const echo = useCallback((text) => setMessages((prev) => [...prev, { id: nid(), role: "me", text }]), []);

  const showMenu = useCallback(() => {
    setFlow(null);
    const allowed = MENU.filter((it) => !it.need || perms?.[it.need]);
    say("Chọn việc cần làm:", { menu: allowed.length ? allowed : null, noPerm: !allowed.length });
  }, [say, perms]);

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, flow]);

  const stepKey = flow ? FLOWS[flow.name].steps[flow.step] : null;

  // ── Lời nhắc từng bước ───────────────────────────────────────────────────
  const prompt = useCallback((f) => {
    const k = FLOWS[f.name].steps[f.step]; const no = STEP_NO[k]; const d = f.data;
    if (k === "fee_type") return `${no} Chọn khoản ${FLOWS[f.name].kind === "thu" ? "thu" : "chi"} (bấm hoặc gõ để lọc):`;
    if (k === "amount") return `${no} Nhập số tiền${d.default_amount ? ` (mặc định ${formatVnd(d.default_amount)})` : ""}. Ví dụ: 150k, 1,5tr, 200.000`;
    if (k === "member") return `${no} Thành viên nộp tiền (gõ tên để tìm, hoặc Bỏ qua):`;
    if (k === "description") return `${no} Ghi chú (gõ nội dung, hoặc Bỏ qua):`;
    if (k === "date") return `${no} Ngày giao dịch: bấm Hôm nay / Hôm qua hoặc gõ DD/MM/YYYY`;
    if (k === "method") return `${no} Phương thức thanh toán:`;
    if (k === "confirm") return `${no} Kiểm tra lại rồi bấm Ghi:`;
    return "";
  }, []);

  const goto = useCallback((f) => {
    setFlow(f); setTyped("");
    const k = FLOWS[f.name].steps[f.step];
    say(prompt(f), k === "confirm" ? { rows: summarizeTransaction(FLOWS[f.name].kind, f.data) } : {});
    setTimeout(() => inputRef.current?.focus?.(), 50);
  }, [say, prompt]);

  const startFlow = useCallback(async (name) => {
    const k = FLOWS[name].kind;
    setBusy(true);
    try {
      const [ft, mem] = await Promise.all([
        feeTypesApi.list({ type: k === "thu" ? "income" : "expense" }),
        k === "thu" ? membersApi.list() : Promise.resolve({ data: [] }),
      ]);
      setFeeTypes(ft.data || []); setMembers(mem.data || []);
      if (!(ft.data || []).length) { say(`Chưa có khoản ${k === "thu" ? "thu" : "chi"} nào. Vào trang Khoản thu chi để thêm trước.`, { menu: MENU.filter((it) => perms?.[it.need]) }); return; }
      say(`🧾 ${FLOWS[name].title}`);
      goto({ name, step: 0, data: {} });
    } catch { say("Không tải được danh mục. Thử lại sau.", { menu: MENU.filter((it) => perms?.[it.need]) }); }
    finally { setBusy(false); }
  }, [say, goto, perms]);

  const back = useCallback(() => {
    if (!flow) return;
    if (flow.step === 0) { echo("⬅️ Quay lại"); showMenu(); return; }
    echo("⬅️ Quay lại");
    goto({ ...flow, step: flow.step - 1 });
  }, [flow, echo, goto, showMenu]);

  const submit = useCallback(async (f) => {
    setBusy(true);
    try {
      const r = await transactionsApi.create(buildTransactionPayload(FLOWS[f.name].kind, f.data));
      const tx = r.data;
      setFlow(null);
      say(`✅ Đã ghi ${FLOWS[f.name].kind === "thu" ? "Thu" : "Chi"}!`, {
        rows: [["Khoản", f.data.fee_type_name], ["Số tiền", formatVnd(tx.amount)], ["Ngày", isoToVn(tx.transaction_date)], ...(f.data.member_name ? [["Thành viên", f.data.member_name]] : [])],
        after: f.name,
      });
      window.dispatchEvent(new CustomEvent("clb:data-changed", { detail: { entity: "transactions", id: tx.id } }));
    } catch (err) {
      const detail = err?.response?.data?.detail;
      say(`❌ Không ghi được: ${typeof detail === "string" ? detail : detail?.message || err?.message || "lỗi không rõ"}`, { retry: f });
    } finally { setBusy(false); }
  }, [say]);

  // ── Nhận câu trả lời (chip hoặc gõ) ─────────────────────────────────────
  const answer = useCallback((value, label) => {
    if (!flow || busy) return;
    const f = { ...flow, data: { ...flow.data } };
    const k = FLOWS[f.name].steps[f.step];
    const next = () => goto({ ...f, step: f.step + 1 });
    if (k === "fee_type") {
      const ft = feeTypes.find((x) => x.id === Number(value)); if (!ft) return;
      echo(label || ft.name);
      f.data.fee_type_id = ft.id; f.data.fee_type_name = ft.name; f.data.default_amount = feeDefault(ft);
      return next();
    }
    if (k === "amount") {
      const v = value === "__default__" ? f.data.default_amount : parseAmount(value);
      if (!v) { echo(String(value)); say("❌ Số tiền không hợp lệ. Ví dụ: 150k, 1,5tr, 200.000"); return; }
      echo(label || formatVnd(v)); f.data.amount = v; return next();
    }
    if (k === "member") {
      if (value === "__skip__") { echo("Bỏ qua"); f.data.member_id = null; f.data.member_name = ""; return next(); }
      const m = members.find((x) => x.id === Number(value)); if (!m) return;
      echo(m.full_name); f.data.member_id = m.id; f.data.member_name = m.full_name; return next();
    }
    if (k === "description") {
      if (value === "__skip__") { echo("Bỏ qua"); f.data.description = ""; return next(); }
      echo(String(value)); f.data.description = String(value).trim(); return next();
    }
    if (k === "date") {
      const iso = value === "__today__" ? toIsoDate(new Date()) : value === "__yesterday__" ? parseDateText("hôm qua") : parseDateText(value);
      if (!iso) { echo(String(value)); say("❌ Sai định dạng. Nhập DD/MM/YYYY, ví dụ 05/10/2026"); return; }
      echo(label || isoToVn(iso)); f.data.transaction_date = iso; return next();
    }
    if (k === "method") {
      if (!PAYMENT_METHODS.includes(value)) return;
      echo(value); f.data.payment_method = value; return next();
    }
    if (k === "confirm") {
      if (value === "__save__") { echo("✅ Ghi"); setFlow(f); submit(f); }
      else if (value === "__redo__") { echo("✏️ Sửa lại"); goto({ ...f, step: 0, data: {} }); }
      else if (value === "__cancel__") { echo("❌ Huỷ"); showMenu(); }
    }
  }, [flow, busy, feeTypes, members, echo, say, goto, submit, showMenu]);

  // ── Chip theo bước (lọc theo ô gõ) ──────────────────────────────────────
  const chips = useMemo(() => {
    if (!flow) return [];
    const q = normText(typed).trim();
    if (stepKey === "fee_type") {
      return feeTypes.filter((ft) => !q || normText(ft.name).includes(q)).slice(0, 12)
        .map((ft) => ({ value: ft.id, label: feeDefault(ft) ? `${ft.name} · ${formatVnd(feeDefault(ft))}` : ft.name }));
    }
    if (stepKey === "amount") return flow.data.default_amount ? [{ value: "__default__", label: `Dùng mặc định ${formatVnd(flow.data.default_amount)}`, primary: true }] : [];
    if (stepKey === "member") return [{ value: "__skip__", label: "Bỏ qua" }, ...searchMembers(members, typed, 8).map((m) => ({ value: m.id, label: `${m.full_name}${m.member_code ? ` · ${m.member_code}` : ""}` }))];
    if (stepKey === "description") return [{ value: "__skip__", label: "Bỏ qua" }];
    if (stepKey === "date") return [{ value: "__today__", label: `Hôm nay ${isoToVn(toIsoDate(new Date()))}`, primary: true }, { value: "__yesterday__", label: "Hôm qua" }];
    if (stepKey === "method") return PAYMENT_METHODS.map((m) => ({ value: m, label: m === "Tiền mặt" ? "💵 Tiền mặt" : "🏦 Chuyển khoản" }));
    if (stepKey === "confirm") return [{ value: "__save__", label: "✅ Ghi", primary: true }, { value: "__redo__", label: "✏️ Sửa lại" }, { value: "__cancel__", label: "❌ Huỷ", danger: true }];
    return [];
  }, [flow, stepKey, typed, feeTypes, members]);

  const textAllowed = ["amount", "description", "date"].includes(stepKey);
  const onEnter = () => {
    const t = typed.trim();
    if (!flow || busy) return;
    if (textAllowed) { if (t) { setTyped(""); answer(t); } return; }
    // bước chọn: Enter lấy chip đầu tiên khớp bộ lọc
    const first = chips.find((c) => !String(c.value).startsWith("__")) || chips[0];
    if (first) { setTyped(""); answer(first.value, first.label); }
  };

  const last = messages[messages.length - 1];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 4px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)" }}>
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        {/* nút gắn sau tin cuối của bot: menu / ghi tiếp / thử lại */}
        {last?.role === "bot" && !flow && (last.menu || last.after || last.retry || last.noPerm) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 2px 6px" }}>
            {last.noPerm && <Text type="secondary" style={{ fontSize: 12 }}>Tài khoản của bạn chưa có quyền tạo dữ liệu.</Text>}
            {last.menu?.map((it) => <Button key={it.key} size="small" onClick={() => { echo(it.label); startFlow(it.key); }} disabled={busy}>{it.label}</Button>)}
            {last.after && <Button size="small" type="primary" onClick={() => { echo("➕ Ghi tiếp"); startFlow(last.after); }} disabled={busy}>➕ Ghi tiếp</Button>}
            {last.retry && <Button size="small" type="primary" onClick={() => { echo("🔁 Thử lại"); submit(last.retry); }} disabled={busy}>🔁 Thử lại</Button>}
            {(last.after || last.retry) && <Button size="small" icon={<HomeOutlined />} onClick={() => { echo("🏠 Menu"); showMenu(); }} disabled={busy}>Menu</Button>}
          </div>
        )}
      </div>
      {flow && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 0 2px", maxHeight: 132, overflowY: "auto" }}>
          {chips.map((c) => (
            <Button key={String(c.value)} size="small" type={c.primary ? "primary" : "default"} danger={c.danger} disabled={busy} onClick={() => answer(c.value, c.label)}>{c.label}</Button>
          ))}
          {stepKey !== "confirm" && chips.length === 0 && stepKey === "member" && <Text type="secondary" style={{ fontSize: 12 }}>Không thấy thành viên nào.</Text>}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
        {flow ? <Button icon={<ArrowLeftOutlined />} onClick={back} disabled={busy} title="Quay lại" /> : <Button icon={<RobotOutlined />} disabled />}
        <Input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} onPressEnter={onEnter} disabled={!flow || busy || stepKey === "confirm" || stepKey === "method"}
          placeholder={!flow ? "Chọn việc ở trên…" : stepKey === "amount" ? "Số tiền, ví dụ 150k" : stepKey === "date" ? "DD/MM/YYYY" : stepKey === "member" ? "Gõ tên để tìm" : stepKey === "fee_type" ? "Gõ để lọc khoản" : stepKey === "description" ? "Nội dung ghi chú" : ""}
          inputMode={stepKey === "amount" ? "decimal" : undefined} />
        <Button type="primary" icon={<SendOutlined />} onClick={onEnter} disabled={!flow || busy || (!textAllowed && !chips.length)} loading={busy} />
        {flow && <Button icon={<HomeOutlined />} onClick={() => { echo("🏠 Menu"); showMenu(); }} disabled={busy} title="Menu" />}
      </div>
      {onClose ? null : null}
    </div>
  );
}
