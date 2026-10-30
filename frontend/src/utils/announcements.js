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
