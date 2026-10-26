// Màu nhận diện BẢNG ĐẤU (A, B, C…) dùng cho viền trái thẻ trận và chip bảng — lớp 2 (2026-10-26).
// Lấy từ biến CSS ngữ nghĩa để tự đổi theo sáng/tối: A xanh dương, B xanh lá, C cam, D tím, rồi lặp lại.
const GROUP_VARS = ["--info", "--ok", "--warn", "--brand", "--danger"];
export function groupColor(groupName) {
  if (!groupName) return "var(--line)";
  const code = String(groupName).trim().toUpperCase().charCodeAt(0) - 65;
  const idx = Number.isFinite(code) && code >= 0 ? code % GROUP_VARS.length : 0;
  return `var(${GROUP_VARS[idx]})`;
}
/** Style thẻ trận trên mobile: viền trái 4px theo bảng (không có bảng → theo vòng loại trực tiếp = màu nhấn nhạt). */
export const matchCardStyle = (m) => ({ borderLeft: `4px solid ${m?.group_name ? groupColor(m.group_name) : (m?.phase === "knockout" ? "var(--brand-line)" : "var(--line)")}` });
