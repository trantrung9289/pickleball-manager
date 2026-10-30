// Thông báo trang public / chuông (đợt 2, 2026-10-27): hàm thuần dùng chung cho NotificationBell + trang Thông báo.
// Lần xuất hiện (item) do backend tính (announcements.py); ở đây chỉ: khoá "đã xem" theo trình duyệt, nhãn hiển thị.

export const WEEKDAY_LABELS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"]; // 0 = Thứ 2 (khớp Python weekday)
export const KIND_LABELS = { schedule: "Lịch sinh hoạt", fee: "Khoản thu", report: "Báo cáo" };
export const RECURRENCE_LABELS = { none: "Một lần", weekly: "Hàng tuần", monthly: "Hàng tháng" };
const SEEN_MAX = 200;

/** Khoá duy nhất của một lần xuất hiện: quy tắc + ngày. */
export const itemKey = (it) => `${it.announcement_id}:${it.date}`;

/** Nhãn thứ của ngày ISO "YYYY-MM-DD" (không phụ thuộc múi giờ: parse tay). */
export function weekdayLabelOfDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return "";
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = CN
  return WEEKDAY_LABELS[(js + 6) % 7];
}

/** "Thứ 3, 28/10 · 19:00" */
export function formatWhen(it) {
  const [y, m, d] = String(it.date).split("-");
  const base = `${weekdayLabelOfDate(it.date)}, ${d}/${m}${y ? "" : ""}`;
  return it.start_time ? `${base} · ${it.start_time}` : base;
}

/** Chip trạng thái: { tone, text } */
export function statusChip(it) {
  if (it.status === "today") return { tone: "ok", text: "Hôm nay" };
  if (it.status === "upcoming") return { tone: "info", text: it.days_left === 1 ? "Ngày mai" : `Còn ${it.days_left} ngày` };
  return { tone: "neutral", text: `Còn ${it.days_left} ngày` };
}

/** Số chưa xem = item có khoá chưa nằm trong seen. */
export function unreadCount(items, seen) {
  const s = seen instanceof Set ? seen : new Set(seen || []);
  return (items || []).filter((it) => !s.has(itemKey(it))).length;
}

/** Gộp khoá đã xem, giữ tối đa SEEN_MAX khoá mới nhất (khoá cũ bị cắt đầu). */
export function mergeSeen(seen, items) {
  const arr = [...(seen instanceof Set ? seen : seen || [])];
  for (const it of items || []) { const k = itemKey(it); if (!arr.includes(k)) arr.push(k); }
  return arr.length > SEEN_MAX ? arr.slice(arr.length - SEEN_MAX) : arr;
}

export const seenStorageKey = (scope) => `ann_seen:${scope}`;

export function loadSeen(scope) {
  try { const raw = localStorage.getItem(seenStorageKey(scope)); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

export function saveSeen(scope, arr) {
  try { localStorage.setItem(seenStorageKey(scope), JSON.stringify(arr)); } catch { /* private mode / bị chặn: bỏ qua */ }
}

/** Danh sách tên chưa đóng: tối đa `limit` tên, phần còn lại gộp "và N người nữa". */
export function unpaidPreview(members, limit = 10) {
  const names = (members || []).map((m) => m.full_name);
  if (names.length <= limit) return { shown: names, more: 0 };
  return { shown: names.slice(0, limit), more: names.length - limit };
}

/** Nhóm item theo ngày (giữ thứ tự) → [{ date, items }] */
export function groupByDate(items) {
  const out = [];
  for (const it of items || []) {
    const last = out[out.length - 1];
    if (last && last.date === it.date) last.items.push(it); else out.push({ date: it.date, items: [it] });
  }
  return out;
}

/** Nhắc trước giờ bắt đầu (phút) → "1 giờ 30 phút" / "1 giờ" / "45 phút" (2026-10-30). */
export const remindLabel = (min) => {
  if (min == null) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h} giờ ${m} phút` : h ? `${h} giờ` : `${m} phút`;
};

/**
 * Nội dung chia sẻ thủ công lên Zalo (2026-10-30): admin bấm "Chia sẻ lên Zalo" → Web Share API / sao chép → dán vào nhóm.
 * Không gọi API Zalo, không lưu gì. Văn bản thuần, tối đa 2000 ký tự (giới hạn tin Zalo), cắt danh sách chưa đóng nếu quá dài.
 */
export function shareText(it, { clubName = "", publicUrl = "" } = {}) {
  const head = it.kind === "fee" ? "🔔" : "📅";
  const lines = [`${head} ${it.title}` + (clubName ? ` — ${clubName}` : "")];
  lines.push(formatWhen(it) + (it.duration_min ? ` · ${it.duration_min} phút` : ""));
  if (it.body && String(it.body).trim()) lines.push("", String(it.body).trim());
  if (it.kind === "fee" && it.unpaid_count) {
    const names = (it.unpaid_members || []).map((m) => m.full_name);
    lines.push("", `Chưa đóng (${it.unpaid_count} người):`, ...names.map((n) => `  • ${n}`));
  }
  if (publicUrl) lines.push("", `Xem chi tiết: ${publicUrl}`);
  let text = lines.join("\n");
  if (text.length > 2000) {
    // cắt bớt tên: giữ phần đầu, thêm dòng "… và N người nữa"
    const keep = [];
    let total = 0;
    const tail = publicUrl ? `\n\nXem chi tiết: ${publicUrl}` : "";
    for (const line of lines) {
      if (publicUrl && line.startsWith("Xem chi tiết: ")) break;
      if (total + line.length + 1 + tail.length + 40 > 2000) break;
      keep.push(line); total += line.length + 1;
    }
    const shownNames = keep.filter((l) => l.startsWith("  • ")).length;
    const more = (it.unpaid_count || 0) - shownNames;
    if (more > 0) keep.push(`  … và ${more} người nữa`);
    text = keep.join("\n") + tail;
  }
  return text;
}

// ── Lịch sử đẩy (2026-10-30) ──
export const PUSH_CHANNEL_LABELS = { telegram: "Telegram", web: "Trang Public", zalo: "Zalo" };   // web = thông báo đẩy tới người xem đã bật trên trang public
export const PUSH_SOURCE_LABELS = { cron: "Tự động", save: "Khi lưu", manual: "Gửi ngay" };

/** "2026-10-30T07:05:09Z" → "07:05:09 30/10/2026" theo giờ máy (người dùng Việt Nam); lỗi → "". */
export function formatHistoryTime(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Kết quả một dòng: "✔ 2" / "✖ 1" / "✔ 2 · ✖ 1" (số người nhận/thiết bị/nhóm). */
export function historyResult(row) {
  const parts = [];
  if (row.sent_count) parts.push(`✔ ${row.sent_count}`);
  if (row.error_count) parts.push(`✖ ${row.error_count}`);
  return parts.join(" · ") || "—";
}

// ── Báo cáo định kỳ (2026-10-30) ──
export const REPORT_TYPE_LABELS = { summary: "Tổng hợp thu chi", transactions: "Giao dịch", contributions: "Đóng góp thành viên", fee_status: "Theo dõi phí" };
/** Loại báo cáo liệt kê tên người → có công tắc "Ẩn tên". */
export const REPORT_NAME_TYPES = ["transactions", "contributions", "fee_status"];
/** Loại báo cáo dùng khoản thu: fee_status bắt buộc, contributions tuỳ chọn (lọc một khoản). */
export const REPORT_FEE_TYPES = ["contributions", "fee_status"];
export const REPORT_CHANNEL_LABELS = { telegram: "Telegram quản trị viên", zalo: "Nhóm Zalo", web: "Trang Public" };

/** Cảnh báo lộ số liệu theo ĐÚNG các kênh đang chọn (Telegram quản trị viên không cần cảnh báo); "" khi chỉ Telegram. */
export function reportExposureText(channels) {
  const zalo = (channels || []).includes("zalo");
  const web = (channels || []).includes("web");
  if (zalo && web) return "Nhóm Zalo và người xem Trang Public (đã bật thông báo) sẽ thấy số liệu thu chi";
  if (zalo) return "Nhóm Zalo sẽ thấy số liệu thu chi";
  if (web) return "Người xem Trang Public (đã bật thông báo) sẽ thấy số liệu thu chi";
  return "";
}
/** Khoảng thời gian tương đối theo ngày gửi; luôn kết thúc HẾT HÔM QUA (chỉ lấy ngày trọn vẹn). */
export const REPORT_RANGE_OPTIONS = [
  { value: "yesterday", label: "Hôm qua" },
  { value: "last7", label: "7 ngày gần nhất" },
  { value: "last_week", label: "Tuần trước (Thứ 2 đến Chủ nhật)" },
  { value: "this_month", label: "Tháng này (từ ngày 1 đến hết hôm qua)" },
  { value: "last_month", label: "Tháng trước" },
  { value: "last_quarter", label: "Quý trước" },
  { value: "this_year", label: "Năm nay (từ 1/1 đến hết hôm qua)" },
  { value: "last_n", label: "N ngày gần nhất" },
  { value: "fixed", label: "Khoảng cố định (gửi một lần)" },
];
const RANGE_SHORT = { yesterday: "Hôm qua", last7: "7 ngày gần nhất", last_week: "Tuần trước", this_month: "Tháng này", last_month: "Tháng trước", last_quarter: "Quý trước", this_year: "Năm nay" };
const ddmmyyyy = (iso) => { const [y, m, d] = String(iso || "").slice(0, 10).split("-"); return y && m && d ? `${d}/${m}/${y}` : ""; };

/** "Tháng trước" / "30 ngày gần nhất" / "01/10/2026 – 31/10/2026". */
export function reportRangeText(r) {
  if (r.report_range === "last_n") return `${r.report_range_days || 7} ngày gần nhất`;
  if (r.report_range === "fixed") return `${ddmmyyyy(r.report_from)} – ${ddmmyyyy(r.report_to)}`;
  return RANGE_SHORT[r.report_range] || "";
}

/** Dòng mô tả quy tắc báo cáo trong bảng: "Theo dõi phí · Quỹ CLB · Tháng trước · Telegram quản trị viên, Nhóm Zalo · ẩn tên". */
export function reportSummaryText(r) {
  const chans = (r.report_channels?.length ? r.report_channels : ["telegram"]).map((c) => REPORT_CHANNEL_LABELS[c] || c).join(", ");
  const fee = REPORT_FEE_TYPES.includes(r.report_type) && r.report_fee_type_id ? (r.report_fee_type_name || "khoản đã xoá") : "";
  return [REPORT_TYPE_LABELS[r.report_type] || "", fee, reportRangeText(r), chans, REPORT_NAME_TYPES.includes(r.report_type) && r.report_hide_names ? "ẩn tên" : ""].filter(Boolean).join(" · ");
}
