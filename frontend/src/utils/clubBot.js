/**
 * BOT CLB (2026-10-29, đợt 1): hàm thuần cho khung hội thoại nhập liệu trong trang quản lý CLB — gương với WIZARDS của bot Telegram
 * (bot/bot.py). Không phụ thuộc React → test node. Ghi dữ liệu qua API sẵn có (transactionsApi…), payload giống bot Telegram.
 */
export const PAYMENT_METHODS = ["Tiền mặt", "Chuyển khoản"];

/** "150k" → 150000; "1,5tr"/"1.5tr"/"1tr5" → 1500000; "200.000"/"200,000"/"200000" → 200000. Sai/≤0 → null. Số thuần giữ nguyên (không tự nhân nghìn). */
export function parseAmount(text) {
  const raw = String(text ?? "").trim().toLowerCase().replace(/\s+/g, "").replace(/[đ₫]|vnd|vnđ/g, "");
  if (!raw) return null;
  let m = raw.match(/^(\d+)(?:[.,](\d+))?(k|n|ng|tr|m|t)$/);   // hậu tố
  if (m) {
    const whole = Number(m[1]); const frac = m[2] ? Number(`0.${m[2]}`) : 0;
    const mult = { k: 1e3, n: 1e3, ng: 1e3, tr: 1e6, m: 1e6, t: 1e6 }[m[3]];
    const v = Math.round((whole + frac) * mult);
    return v > 0 ? v : null;
  }
  m = raw.match(/^(\d+)tr(\d{1,3})$/);   // "1tr5" = 1 triệu 5 = 1.500.000; "1tr500" = 1.500.000
  if (m) {
    const tail = m[2].length === 1 ? Number(m[2]) * 100000 : m[2].length === 2 ? Number(m[2]) * 10000 : Number(m[2]) * 1000;
    const v = Number(m[1]) * 1e6 + tail;
    return v > 0 ? v : null;
  }
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) { const v = Number(raw.replace(/[.,]/g, "")); return v > 0 ? v : null; }
  if (/^\d+$/.test(raw)) { const v = Number(raw); return v > 0 ? v : null; }
  return null;
}

export function formatVnd(n) {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString("vi-VN")} ₫`;
}

const pad = (n) => String(n).padStart(2, "0");
export const toIsoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoToVn = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

/** "hôm nay"/"hn"/"nay", "hôm qua"/"hq"/"qua", "DD/MM/YYYY", "DD/MM" (năm nay), "DD-MM-YYYY" → "YYYY-MM-DD"; sai/ngày không tồn tại → null. */
export function parseDateText(text, today = new Date()) {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  if (["hôm nay", "hom nay", "hn", "nay", "today"].includes(t)) return toIsoDate(today);
  if (["hôm qua", "hom qua", "hq", "qua", "yesterday"].includes(t)) { const d = new Date(today); d.setDate(d.getDate() - 1); return toIsoDate(d); }
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (!m) return null;
  const dd = Number(m[1]); const mm = Number(m[2]);
  let yy = m[3] ? Number(m[3]) : today.getFullYear();
  if (m[3] && m[3].length === 2) yy += 2000;
  const d = new Date(yy, mm - 1, dd);
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return toIsoDate(d);
}

/** Chuẩn hoá để so khớp: thường, bỏ dấu, đ → d. */
export const normText = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
/** Mặc định của khoản: >0 mới tính (0/null = không có mặc định). */
export const feeDefault = (ft) => { const v = Number(ft?.default_amount); return v > 0 ? v : null; };

/** Lọc thành viên theo tên/mã/SĐT (không dấu hoa thường), đang hoạt động lên trước, tối đa `limit`. */
export function searchMembers(list, query, limit = 8) {
  const norm = normText;
  const q = norm(query).trim();
  const order = { active: 0, inactive: 1, suspended: 2 };
  const hit = (list || []).filter((m) => !q || norm(m.full_name).includes(q) || norm(m.member_code).includes(q) || norm(m.phone).includes(q));
  hit.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || norm(a.full_name).localeCompare(norm(b.full_name)));
  return hit.slice(0, limit);
}

/** Payload POST /api/transactions như bot Telegram: fee_type_id, amount, member_id?, transaction_date, payment_method, description. */
export function buildTransactionPayload(kind, data, today = new Date()) {
  const out = {
    fee_type_id: Number(data.fee_type_id),
    amount: Number(data.amount),
    transaction_date: data.transaction_date || toIsoDate(today),
    payment_method: data.payment_method || "Tiền mặt",
    description: kind === "chi" ? (data.description || "") : (data.description || ""),
  };
  if (kind === "thu" && data.member_id) out.member_id = Number(data.member_id);
  return out;
}

/** Tóm tắt trước khi ghi (dòng → [nhãn, giá trị]). */
export function summarizeTransaction(kind, data) {
  const rows = [
    [kind === "thu" ? "Khoản thu" : "Khoản chi", data.fee_type_name || ""],
    ["Số tiền", formatVnd(data.amount)],
  ];
  if (kind === "thu") rows.push(["Thành viên", data.member_name || "— không gắn —"]);
  else rows.push(["Ghi chú", data.description || "—"]);
  rows.push(["Ngày", isoToVn(data.transaction_date)], ["Phương thức", data.payment_method || ""]);
  return rows;
}
