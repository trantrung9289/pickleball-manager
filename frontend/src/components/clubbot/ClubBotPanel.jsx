/**
 * ClubBotPanel — khung hội thoại BOT CLB (2026-10-29). Mô phỏng wizard của bot Telegram (bot/bot.py WIZARDS) ngay trong trang
 * quản lý CLB: bot hỏi từng bước, người dùng bấm "chip" hoặc gõ; xác nhận rồi ghi qua API sẵn có.
 * Quyết định người dùng: không áp cờ "dùng bot" Telegram, chỉ theo quyền tài khoản (canView/canCreate/canEdit/canDelete); không bật/tắt menu.
 * Đợt 1: Thu tiền, Chi tiền. Đợt 2: Thành viên (danh sách, thêm, đổi hạng, đổi trạng thái, xoá) + Khoản thu chi (danh sách, thêm, xoá).
 * Mọi luồng là dãy bước (FLOWS[name].steps); mỗi bước có prompt/chips/cách nhận trả lời theo STEP; bước cuối gọi finish(flow) ghi dữ liệu.
 * Sau khi ghi phát sự kiện window "clb:data-changed" {entity} để trang đang mở (Giao dịch / Thành viên / Khoản) tải lại.
 */
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Button, Input, Typography } from "antd";
import { SendOutlined, ArrowLeftOutlined, HomeOutlined } from "@ant-design/icons";
import RobotIcon from "./RobotIcon";
import { feeTypesApi, membersApi, transactionsApi } from "../../api";
import { useRankLevels } from "../../hooks/useRankLevels";
import {
  PAYMENT_METHODS, MEMBER_STATUS, statusLabel, parseAmount, parseDateText, searchMembers, buildTransactionPayload, summarizeTransaction,
  buildMemberPayload, summarizeMember, buildFeeTypePayload, normalizePhone, formatVnd, toIsoDate, isoToVn, normText, feeDefault,
} from "../../utils/clubBot";

const { Text } = Typography;
let _mid = 0;
const nid = () => ++_mid;

// ── Menu (gương DEFAULT_TOP_KEYS / DEFAULT_MEMBER_KEYS / DEFAULT_CATEGORY_KEYS của bot Telegram, bỏ Báo cáo/Giao dịch/Hướng dẫn) ──
const MENU = [
  { key: "members", label: "👥 Thành viên", need: "canView", group: true },
  { key: "add_thu", label: "💰 Thu tiền", need: "canCreate" },
  { key: "add_chi", label: "📤 Chi tiền", need: "canCreate" },
  { key: "category", label: "🗂 Khoản thu chi", need: "canView", group: true },
];
const SUBMENU = {
  members: [
    { key: "members_list", label: "📋 Danh sách", need: "canView" },
    { key: "add_member", label: "➕ Thêm thành viên", need: "canCreate" },
    { key: "upd_member_rank", label: "🏆 Cập nhật hạng", need: "canEdit" },
    { key: "upd_member_status", label: "🔄 Cập nhật trạng thái", need: "canEdit" },
    { key: "del_member", label: "🗑 Xoá thành viên", need: "canDelete" },
  ],
  category: [
    { key: "category_list", label: "📋 Danh sách khoản", need: "canView" },
    { key: "add_fee_type", label: "➕ Thêm khoản", need: "canCreate" },
    { key: "del_fee_type", label: "🗑 Xoá khoản", need: "canDelete" },
  ],
};
const FLOWS = {
  add_thu: { kind: "thu", title: "💰 Thu tiền", steps: ["fee_type", "amount", "member", "date", "method", "confirm_tx"], back: "main" },
  add_chi: { kind: "chi", title: "📤 Chi tiền", steps: ["fee_type", "amount", "description", "date", "method", "confirm_tx"], back: "main" },
  add_member: { title: "➕ Thêm thành viên", steps: ["full_name", "rank", "phone", "join_date", "status", "confirm_member"], back: "members" },
  upd_member_rank: { title: "🏆 Cập nhật hạng", steps: ["member_pick", "rank"], back: "members" },
  upd_member_status: { title: "🔄 Cập nhật trạng thái", steps: ["member_pick", "status"], back: "members" },
  del_member: { title: "🗑 Xoá thành viên", steps: ["member_pick", "confirm_delete"], back: "members" },
  add_fee_type: { title: "➕ Thêm khoản", steps: ["name", "ft_type", "default_amount", "confirm_fee"], back: "category" },
  del_fee_type: { title: "🗑 Xoá khoản", steps: ["fee_pick", "confirm_delete"], back: "category" },
};
const TEXT_STEPS = new Set(["amount", "description", "date", "full_name", "phone", "join_date", "name", "default_amount"]);
const FEE_STEPS = new Set(["fee_type", "fee_pick"]);   // khoản thu chi: hiện hàng dọc, mỗi khoản 1 dòng, ngay trong khung hội thoại
const SKIP = "__skip__";

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
            {m.rows.map(([k, v], i) => <tr key={`${k}-${i}`}><td style={{ color: "var(--muted)", paddingRight: 10, verticalAlign: "top", whiteSpace: "nowrap" }}>{k}</td><td style={{ fontWeight: 600 }}>{v}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </div>
  );
}

const allowed = (items, perms) => items.filter((it) => !it.need || perms?.[it.need]);

export default function ClubBotPanel({ club, user, perms }) {
  const { options: rankOptions } = useRankLevels();
  const [messages, setMessages] = useState(() => {
    const items = allowed(MENU, perms);
    return [{ id: nid(), role: "bot", text: `👋 Xin chào ${user?.full_name || user?.username || "bạn"}! Tôi là BOT của CLB ${club?.name || ""}.\nChọn việc cần làm:`, menu: items, noPerm: !items.length }];
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

  const showMenu = useCallback((group) => {
    setFlow(null); setTyped("");
    if (group && SUBMENU[group]) { say(`${MENU.find((m) => m.key === group)?.label} — chọn việc:`, { menu: allowed(SUBMENU[group], perms), menuBack: true }); return; }
    const items = allowed(MENU, perms);
    say("Chọn việc cần làm:", { menu: items, noPerm: !items.length });
  }, [say, perms]);

  const stepKey = flow ? FLOWS[flow.name].steps[flow.step] : null;

  // ── Lời nhắc từng bước ───────────────────────────────────────────────────
  const prompt = useCallback((f) => {
    const k = FLOWS[f.name].steps[f.step]; const no = "①②③④⑤⑥"[f.step] || ""; const d = f.data;
    switch (k) {
      case "fee_type": return `${no} Chọn khoản ${FLOWS[f.name].kind === "thu" ? "thu" : "chi"} (bấm hoặc gõ để lọc):`;
      case "amount": return `${no} Nhập số tiền${d.default_amount ? ` (mặc định ${formatVnd(d.default_amount)})` : ""}. Ví dụ: 150k, 1,5tr, 200.000`;
      case "member": return `${no} Thành viên nộp tiền (gõ tên để tìm, hoặc Bỏ qua):`;
      case "description": return `${no} Ghi chú (gõ nội dung, hoặc Bỏ qua):`;
      case "date": return `${no} Ngày giao dịch: bấm Hôm nay / Hôm qua hoặc gõ DD/MM/YYYY`;
      case "method": return `${no} Phương thức thanh toán:`;
      case "confirm_tx": return `${no} Kiểm tra lại rồi bấm Ghi:`;
      case "full_name": return `${no} Nhập họ và tên thành viên:`;
      case "rank": return f.name === "add_member" ? `${no} Chọn hạng:` : `Chọn hạng mới cho ${d.member_name}:`;
      case "phone": return `${no} Số điện thoại (hoặc Bỏ qua):`;
      case "join_date": return `${no} Ngày tham gia: bấm Hôm nay hoặc gõ DD/MM/YYYY`;
      case "status": return f.name === "add_member" ? `${no} Trạng thái ban đầu:` : `Chọn trạng thái mới cho ${d.member_name} (hiện: ${statusLabel(d.member_status)}):`;
      case "confirm_member": return `${no} Kiểm tra lại rồi bấm Ghi:`;
      case "member_pick": return "Chọn thành viên (gõ tên/mã để tìm):";
      case "confirm_delete": return f.name === "del_member" ? `⚠️ Xoá thành viên ${d.member_name}? Không hoàn tác được.` : `⚠️ Xoá khoản ${d.fee_type_name}? Khoản đã có giao dịch sẽ không xoá được.`;
      case "name": return `${no} Nhập tên khoản:`;
      case "ft_type": return `${no} Loại khoản:`;
      case "default_amount": return `${no} Số tiền mặc định (gõ số, hoặc Bỏ qua):`;
      case "confirm_fee": return `${no} Kiểm tra lại rồi bấm Ghi:`;
      default: return "";
    }
  }, []);

  const goto = useCallback((f) => {
    setFlow(f); setTyped("");
    const k = FLOWS[f.name].steps[f.step];
    const rows = k === "confirm_tx" ? summarizeTransaction(FLOWS[f.name].kind, f.data) : k === "confirm_member" ? summarizeMember(f.data)
      : k === "confirm_fee" ? [["Tên khoản", f.data.name], ["Loại", f.data.type === "income" ? "Thu" : "Chi"], ["Mặc định", f.data.default_amount ? formatVnd(f.data.default_amount) : "—"]] : null;
    say(prompt(f), rows ? { rows } : {});
  }, [say, prompt]);
  // Ô gõ tự nhận focus khi sang bước mới và không còn bận (lúc goto() chạy, busy có thể vẫn true → focus vào ô disabled không ăn)
  useEffect(() => { if (flow && !busy) setTimeout(() => inputRef.current?.focus?.(), 30); }, [flow, busy]);

  const menuOf = useCallback((name) => allowed(SUBMENU[FLOWS[name]?.back] || MENU, perms), [perms]);

  // ── Bắt đầu một việc: nhóm → menu con; danh sách → thẻ; còn lại → wizard ─
  const start = useCallback(async (key) => {
    if (SUBMENU[key]) { showMenu(key); return; }
    setBusy(true);
    try {
      if (key === "members_list") {
        const r = await membersApi.list(); const list = r.data || [];
        const groups = MEMBER_STATUS.map((s) => [s.label, list.filter((m) => m.status === s.value)]).filter(([, arr]) => arr.length);
        const rows = groups.map(([label, arr]) => [`${label} (${arr.length})`, arr.slice(0, 25).map((m) => `${m.full_name}${m.rank ? ` [${m.rank}]` : ""}`).join(", ") + (arr.length > 25 ? ` … và ${arr.length - 25} người nữa` : "")]);
        say(`👥 Thành viên: ${list.length} người`, { rows: rows.length ? rows : [["—", "Chưa có thành viên"]], menu: allowed(SUBMENU.members, perms), menuBack: true });
        return;
      }
      if (key === "category_list") {
        const r = await feeTypesApi.list(); const list = r.data || [];
        const fmtList = (t) => list.filter((x) => x.type === t).map((x) => feeDefault(x) ? `${x.name} (${formatVnd(feeDefault(x))})` : x.name).join(", ") || "—";
        say(`🗂 Khoản thu chi: ${list.length} khoản`, { rows: [["Thu", fmtList("income")], ["Chi", fmtList("expense")]], menu: allowed(SUBMENU.category, perms), menuBack: true });
        return;
      }
      const fl = FLOWS[key]; if (!fl) return;
      const needFee = ["add_thu", "add_chi", "del_fee_type"].includes(key);
      const needMembers = ["add_thu", "upd_member_rank", "upd_member_status", "del_member"].includes(key);
      const [ft, mem] = await Promise.all([
        needFee ? feeTypesApi.list(fl.kind ? { type: fl.kind === "thu" ? "income" : "expense" } : {}) : Promise.resolve({ data: [] }),
        needMembers ? membersApi.list() : Promise.resolve({ data: [] }),
      ]);
      setFeeTypes(ft.data || []); setMembers(mem.data || []);
      if (needFee && !(ft.data || []).length) { say(fl.kind ? `Chưa có khoản ${fl.kind === "thu" ? "thu" : "chi"} nào. Thêm ở "Khoản thu chi" trước.` : "Chưa có khoản nào.", { menu: menuOf(key), menuBack: true }); return; }
      if (needMembers && !(mem.data || []).length && key !== "add_thu") { say("Chưa có thành viên nào.", { menu: menuOf(key), menuBack: true }); return; }
      say(fl.title);
      goto({ name: key, step: 0, data: {} });
    } catch { say("Không tải được dữ liệu. Thử lại sau.", { menu: allowed(MENU, perms) }); }
    finally { setBusy(false); }
  }, [say, goto, perms, showMenu, menuOf]);

  const back = useCallback(() => {
    if (!flow) return;
    echo("⬅️ Quay lại");
    if (flow.step === 0) { showMenu(FLOWS[flow.name].back === "main" ? null : FLOWS[flow.name].back); return; }
    goto({ ...flow, step: flow.step - 1 });
  }, [flow, echo, goto, showMenu]);

  // ── Ghi dữ liệu ở bước cuối ──────────────────────────────────────────────
  const finish = useCallback(async (f) => {
    setBusy(true);
    const d = f.data; const after = { after: f.name, menuKey: FLOWS[f.name].back };
    try {
      if (f.name === "add_thu" || f.name === "add_chi") {
        const tx = (await transactionsApi.create(buildTransactionPayload(FLOWS[f.name].kind, d))).data;
        setFlow(null);
        say(`✅ Đã ghi ${FLOWS[f.name].kind === "thu" ? "Thu" : "Chi"}!`, { rows: [["Khoản", d.fee_type_name], ["Số tiền", formatVnd(tx.amount)], ["Ngày", isoToVn(tx.transaction_date)], ...(d.member_name ? [["Thành viên", d.member_name]] : [])], ...after });
        window.dispatchEvent(new CustomEvent("clb:data-changed", { detail: { entity: "transactions", id: tx.id } }));
      } else if (f.name === "add_member") {
        const m = (await membersApi.create(buildMemberPayload(d))).data;
        setFlow(null);
        say("✅ Đã thêm thành viên!", { rows: [["Mã", m.member_code || "—"], ["Tên", m.full_name], ["Hạng", m.rank || "—"], ["SĐT", m.phone || "—"]], ...after });
        window.dispatchEvent(new CustomEvent("clb:data-changed", { detail: { entity: "members", id: m.id } }));
      } else if (f.name === "upd_member_rank" || f.name === "upd_member_status") {
        const field = f.name === "upd_member_rank" ? "rank" : "status";
        const m = (await membersApi.update(d.member_id, { [field]: d[field] })).data;
        setFlow(null);
        say(`✅ Đã cập nhật ${field === "rank" ? "hạng" : "trạng thái"} ${m.full_name} → ${field === "rank" ? (m.rank || "—") : statusLabel(m.status)}`, after);
        window.dispatchEvent(new CustomEvent("clb:data-changed", { detail: { entity: "members", id: m.id } }));
      } else if (f.name === "del_member") {
        await membersApi.delete(d.member_id);
        setFlow(null);
        say(`✅ Đã xoá thành viên ${d.member_name}.`, after);
        window.dispatchEvent(new CustomEvent("clb:data-changed", { detail: { entity: "members", id: d.member_id } }));
      } else if (f.name === "add_fee_type") {
        const ft = (await feeTypesApi.create(buildFeeTypePayload(d))).data;
        setFlow(null);
        say(`✅ Đã thêm khoản ${ft.type === "income" ? "Thu" : "Chi"}: ${ft.name}${feeDefault(ft) ? ` (mặc định ${formatVnd(feeDefault(ft))})` : ""}`, after);
        window.dispatchEvent(new CustomEvent("clb:data-changed", { detail: { entity: "fee_types", id: ft.id } }));
      } else if (f.name === "del_fee_type") {
        await feeTypesApi.delete(d.fee_type_id);
        setFlow(null);
        say(`✅ Đã xoá khoản ${d.fee_type_name}.`, after);
        window.dispatchEvent(new CustomEvent("clb:data-changed", { detail: { entity: "fee_types", id: d.fee_type_id } }));
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : detail?.message || (Array.isArray(detail) ? detail.map((x) => x.msg).join("; ") : err?.message) || "lỗi không rõ";
      setFlow(null);
      say(`❌ Không thực hiện được: ${msg}`, { retry: f, menuKey: FLOWS[f.name].back });
    } finally { setBusy(false); }
  }, [say]);

  // ── Nhận câu trả lời (chip hoặc gõ) ─────────────────────────────────────
  const answer = useCallback((value, label) => {
    if (!flow || busy) return;
    const f = { ...flow, data: { ...flow.data } };
    const k = FLOWS[f.name].steps[f.step];
    const last = f.step === FLOWS[f.name].steps.length - 1;
    const next = () => (last ? finish(f) : goto({ ...f, step: f.step + 1 }));
    const bad = (t) => { echo(String(value)); say(t); };
    switch (k) {
      case "fee_type": case "fee_pick": {
        const ft = feeTypes.find((x) => x.id === Number(value)); if (!ft) return;
        echo(label || ft.name); f.data.fee_type_id = ft.id; f.data.fee_type_name = ft.name; f.data.default_amount = feeDefault(ft); return next();
      }
      case "amount": {
        const v = value === "__default__" ? f.data.default_amount : parseAmount(value);
        if (!v) return bad("❌ Số tiền không hợp lệ. Ví dụ: 150k, 1,5tr, 200.000");
        echo(label || formatVnd(v)); f.data.amount = v; return next();
      }
      case "member": case "member_pick": {
        if (value === SKIP) { echo("Bỏ qua"); f.data.member_id = null; f.data.member_name = ""; return next(); }
        const m = members.find((x) => x.id === Number(value)); if (!m) return;
        echo(m.full_name); f.data.member_id = m.id; f.data.member_name = m.full_name; f.data.member_status = m.status; f.data.member_rank = m.rank; return next();
      }
      case "description": {
        if (value === SKIP) { echo("Bỏ qua"); f.data.description = ""; return next(); }
        echo(String(value)); f.data.description = String(value).trim(); return next();
      }
      case "date": case "join_date": {
        const iso = value === "__today__" ? toIsoDate(new Date()) : value === "__yesterday__" ? parseDateText("hôm qua") : parseDateText(value);
        if (!iso) return bad("❌ Sai định dạng. Nhập DD/MM/YYYY, ví dụ 05/10/2026");
        echo(label || isoToVn(iso)); f.data[k === "date" ? "transaction_date" : "join_date"] = iso; return next();
      }
      case "method": { if (!PAYMENT_METHODS.includes(value)) return; echo(value); f.data.payment_method = value; return next(); }
      case "full_name": { const t = String(value).trim(); if (t.length < 2) return bad("❌ Tên ít nhất 2 ký tự."); echo(t); f.data.full_name = t; return next(); }
      case "rank": { if (!rankOptions.includes(value)) return; echo(value); f.data.rank = value; return next(); }
      case "phone": {
        if (value === SKIP) { echo("Bỏ qua"); f.data.phone = ""; return next(); }
        const p = normalizePhone(value); if (!p) return bad("❌ SĐT cần 9–11 chữ số."); echo(p); f.data.phone = p; return next();
      }
      case "status": { if (!MEMBER_STATUS.some((s) => s.value === value)) return; echo(statusLabel(value)); f.data.status = value; return next(); }
      case "name": { const t = String(value).trim(); if (t.length < 2) return bad("❌ Tên khoản ít nhất 2 ký tự."); echo(t); f.data.name = t; return next(); }
      case "ft_type": { if (!["income", "expense"].includes(value)) return; echo(value === "income" ? "Thu" : "Chi"); f.data.type = value; return next(); }
      case "default_amount": {
        if (value === SKIP) { echo("Bỏ qua"); f.data.default_amount = null; return next(); }
        const v = parseAmount(value); if (!v) return bad("❌ Số tiền không hợp lệ. Ví dụ: 150k, 200.000"); echo(formatVnd(v)); f.data.default_amount = v; return next();
      }
      case "confirm_tx": case "confirm_member": case "confirm_fee": case "confirm_delete": {
        if (value === "__save__") { echo(k === "confirm_delete" ? "🗑 Xoá" : "✅ Ghi"); setFlow(f); finish(f); }
        else if (value === "__redo__") { echo("✏️ Sửa lại"); goto({ ...f, step: 0, data: {} }); }
        else if (value === "__cancel__") { echo("❌ Huỷ"); showMenu(FLOWS[f.name].back === "main" ? null : FLOWS[f.name].back); }
        return;
      }
      default:
    }
  }, [flow, busy, feeTypes, members, rankOptions, echo, say, goto, finish, showMenu]);

  // ── Chip theo bước (lọc theo ô gõ) ──────────────────────────────────────
  const chips = useMemo(() => {
    if (!flow) return [];
    const q = normText(typed).trim();
    const today = { value: "__today__", label: `Hôm nay ${isoToVn(toIsoDate(new Date()))}`, primary: true };
    switch (stepKey) {
      case "fee_type": case "fee_pick":
        return feeTypes.filter((ft) => !q || normText(ft.name).includes(q)).slice(0, 30)
          .map((ft) => ({ value: ft.id, text: `${stepKey === "fee_pick" ? (ft.type === "income" ? "💰 " : "📤 ") : ""}${ft.name}`,
            extra: feeDefault(ft) ? `mặc định ${formatVnd(feeDefault(ft))}` : "", label: ft.name }));
      case "amount": return flow.data.default_amount ? [{ value: "__default__", label: `Dùng mặc định ${formatVnd(flow.data.default_amount)}`, primary: true }] : [];
      case "member": return [{ value: SKIP, label: "Bỏ qua" }, ...searchMembers(members, typed, 8).map((m) => ({ value: m.id, label: `${m.full_name}${m.member_code ? ` · ${m.member_code}` : ""}` }))];
      case "member_pick": return searchMembers(members, typed, 10).map((m) => ({ value: m.id, label: `${m.full_name}${m.member_code ? ` · ${m.member_code}` : ""}${m.status !== "active" ? ` (${statusLabel(m.status)})` : ""}` }));
      case "description": case "phone": case "default_amount": return [{ value: SKIP, label: "Bỏ qua" }];
      case "date": return [today, { value: "__yesterday__", label: "Hôm qua" }];
      case "join_date": return [today];
      case "method": return PAYMENT_METHODS.map((m) => ({ value: m, label: m === "Tiền mặt" ? "💵 Tiền mặt" : "🏦 Chuyển khoản" }));
      case "rank": return rankOptions.map((r) => ({ value: r, label: r }));
      case "status": return MEMBER_STATUS.filter((s) => s.value !== flow.data.member_status || flow.name === "add_member").map((s) => ({ value: s.value, label: s.label, primary: flow.name === "add_member" && s.value === "active" }));
      case "ft_type": return [{ value: "income", label: "💰 Thu" }, { value: "expense", label: "📤 Chi" }];
      case "confirm_delete": return [{ value: "__save__", label: "🗑 Xoá", danger: true }, { value: "__cancel__", label: "Huỷ" }];
      case "confirm_tx": case "confirm_member": case "confirm_fee":
        return [{ value: "__save__", label: "✅ Ghi", primary: true }, { value: "__redo__", label: "✏️ Sửa lại" }, { value: "__cancel__", label: "❌ Huỷ", danger: true }];
      default: return [];
    }
  }, [flow, stepKey, typed, feeTypes, members, rankOptions]);

  // cuộn xuống đáy khi có tin mới / đổi bước / danh sách lựa chọn đổi (đặt SAU chips để tránh TDZ)
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, flow, chips]);

  const textAllowed = TEXT_STEPS.has(stepKey);
  const onEnter = () => {
    const t = typed.trim();
    if (!flow || busy) return;
    if (textAllowed) { if (t) { setTyped(""); answer(t); } return; }
    const first = chips.find((c) => !String(c.value).startsWith("__")) || chips[0];   // bước chọn: Enter lấy chip đầu tiên khớp bộ lọc
    if (first) { setTyped(""); answer(first.value, first.label); }
  };
  const placeholder = !flow ? "Chọn việc ở trên…" : ({
    amount: "Số tiền, ví dụ 150k", default_amount: "Số tiền, ví dụ 150k", date: "DD/MM/YYYY", join_date: "DD/MM/YYYY", member: "Gõ tên để tìm", member_pick: "Gõ tên hoặc mã để tìm",
    fee_type: "Gõ để lọc khoản", fee_pick: "Gõ để lọc khoản", description: "Nội dung ghi chú", full_name: "Họ và tên", phone: "Số điện thoại", name: "Tên khoản",
  }[stepKey] || "");
  const inputOff = !flow || busy || !(textAllowed || ["fee_type", "fee_pick", "member", "member_pick"].includes(stepKey));

  const last = messages[messages.length - 1];
  const tail = last?.role === "bot" && !flow && (last.menu || last.after || last.retry || last.noPerm);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 4px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)" }}>
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        {flow && chips.length > 0 && (FEE_STEPS.has(stepKey) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 2px 6px", maxWidth: "88%" }}>
            {chips.map((c) => (
              <Button key={String(c.value)} size="small" disabled={busy} onClick={() => answer(c.value, c.label)}
                style={{ justifyContent: "space-between", textAlign: "left", height: "auto", padding: "5px 10px", whiteSpace: "normal" }}>
                <span>{c.text}</span>{c.extra && <span style={{ color: "var(--muted)", marginLeft: 12, fontSize: 12 }}>{c.extra}</span>}
              </Button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 2px 6px" }}>
            {chips.map((c) => (
              <Button key={String(c.value)} size="small" type={c.primary ? "primary" : "default"} danger={c.danger} disabled={busy} onClick={() => answer(c.value, c.label)}>{c.label}</Button>
            ))}
          </div>
        ))}
        {flow && ["member", "member_pick"].includes(stepKey) && chips.filter((c) => c.value !== SKIP).length === 0 && <Text type="secondary" style={{ fontSize: 12, padding: "0 4px" }}>Không thấy thành viên nào.</Text>}
        {flow && FEE_STEPS.has(stepKey) && chips.length === 0 && <Text type="secondary" style={{ fontSize: 12, padding: "0 4px" }}>Không có khoản nào khớp.</Text>}
        {tail && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 2px 6px" }}>
            {last.noPerm && <Text type="secondary" style={{ fontSize: 12 }}>Tài khoản của bạn chưa có quyền xem hoặc tạo dữ liệu.</Text>}
            {last.after && <Button size="small" type="primary" onClick={() => { echo("➕ Làm tiếp"); start(last.after); }} disabled={busy}>➕ Làm tiếp</Button>}
            {last.retry && <Button size="small" type="primary" onClick={() => { echo("🔁 Thử lại"); finish(last.retry); }} disabled={busy}>🔁 Thử lại</Button>}
            {last.menu?.map((it) => <Button key={it.key} size="small" onClick={() => { echo(it.label); start(it.key); }} disabled={busy}>{it.label}</Button>)}
            {(last.after || last.retry) && last.menuKey && last.menuKey !== "main" && <Button size="small" onClick={() => { echo("⬅️ Quay lại"); showMenu(last.menuKey); }} disabled={busy}>⬅️ {MENU.find((m) => m.key === last.menuKey)?.label}</Button>}
            {(last.after || last.retry || last.menuBack) && <Button size="small" icon={<HomeOutlined />} onClick={() => { echo("🏠 Menu"); showMenu(null); }} disabled={busy}>Menu</Button>}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
        {flow ? <Button icon={<ArrowLeftOutlined />} onClick={back} disabled={busy} title="Quay lại" /> : <Button icon={<RobotIcon size="18px" />} disabled />}
        <Input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} onPressEnter={onEnter} disabled={inputOff} placeholder={placeholder}
          inputMode={["amount", "default_amount", "phone"].includes(stepKey) ? "decimal" : undefined} />
        <Button type="primary" icon={<SendOutlined />} onClick={onEnter} disabled={inputOff || (!textAllowed && !chips.length)} loading={busy} />
        {flow && <Button icon={<HomeOutlined />} onClick={() => { echo("🏠 Menu"); showMenu(null); }} disabled={busy} title="Menu" />}
      </div>
    </div>
  );
}
