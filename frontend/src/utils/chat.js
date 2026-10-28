// Trò chuyện trang public (2026-10-28, đợt 1): hàm thuần (test node) + khoá lưu thiết bị.
export const deviceKey = (slug) => `chat_device:${slug}`;
export function readDevice(slug) { try { return localStorage.getItem(deviceKey(slug)) || null; } catch { return null; } }
export function saveDevice(slug, id) { try { localStorage.setItem(deviceKey(slug), id); } catch { /* bỏ qua */ } }

/** Tìm id người được nhắc trong văn bản "@Tên": khớp tên dài trước, không phân biệt hoa thường, mỗi người một lần. */
export function extractMentionIds(text, participants) {
  const t = String(text || "");
  const sorted = [...(participants || [])].sort((a, b) => (b.display_name || "").length - (a.display_name || "").length);
  const out = [];
  let lower = t.toLowerCase();
  for (const p of sorted) {
    const name = (p.display_name || "").toLowerCase();
    if (!name) continue;
    const needle = `@${name}`;
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      const after = lower[idx + needle.length];
      if (after === undefined || !/[\p{L}\p{N}]/u.test(after)) {
        if (!out.includes(p.id)) out.push(p.id);
        // che đoạn đã khớp để tên ngắn hơn (vd "An" trong "An Nguyễn") không khớp lại
        lower = lower.slice(0, idx) + " ".repeat(needle.length) + lower.slice(idx + needle.length);
        idx = lower.indexOf(needle, idx + needle.length);
      } else {
        idx = lower.indexOf(needle, idx + 1);
      }
    }
  }
  return out.slice(0, 10);
}

/** Phần trăm từng lựa chọn theo tổng phiếu (multi → tổng phiếu có thể > số người). */
export function pollPercents(poll) {
  const total = (poll?.options || []).reduce((s, o) => s + (o.count || 0), 0);
  return (poll?.options || []).map((o) => ({ id: o.id, pct: total ? Math.round(((o.count || 0) * 100) / total) : 0 }));
}

/** Nhãn thời gian ngắn: hôm nay → HH:MM, khác → DD/MM HH:MM. created_at là UTC (server lưu utcnow) → đổi sang giờ máy. */
export function shortTime(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return same ? hm : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hm}`;
}

/** Gộp tin mới vào danh sách theo id, bỏ trùng, giữ thứ tự tăng. */
export function mergeMessages(existing, incoming) {
  const map = new Map((existing || []).map((m) => [m.id, m]));
  for (const m of incoming || []) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.id - b.id);
}
