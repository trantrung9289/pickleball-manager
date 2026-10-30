// Thông báo trang public / chuông (đợt 2, 2026-10-27): hàm thuần dùng chung cho NotificationBell + trang Thông báo.
// Lần xuất hiện (item) do backend tính (announcements.py); ở đây chỉ: khoá "đã xem" theo trình duyệt, nhãn hiển thị.

export const WEEKDAY_LABELS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"]; // 0 = Thứ 2 (khớp Python weekday)
export const KIND_LABELS = { schedule: "Lịch sinh hoạt", fee: "Khoản thu" };
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
