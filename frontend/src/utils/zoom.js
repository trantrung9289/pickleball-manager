// Mức phóng to/thu nhỏ sơ đồ nhánh (2026-10-30): một mức chung cho mọi sơ đồ, nhớ trong trình duyệt.
export const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const ZOOM_DEFAULT = 1;
export const ZOOM_KEY = "bracket_zoom";

/** Ép về bậc hợp lệ gần nhất; giá trị lạ (NaN, null, chữ) → mặc định. */
export function clampZoom(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return ZOOM_DEFAULT;
  return ZOOM_STEPS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), ZOOM_STEPS[0]);
}

/** Bậc kế tiếp theo hướng dir (+1 phóng to, −1 thu nhỏ); đứng yên ở hai đầu. */
export function stepZoom(v, dir) {
  const i = ZOOM_STEPS.indexOf(clampZoom(v));
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)))];
}

export function readZoom(storage) {
  try { return clampZoom(storage?.getItem(ZOOM_KEY) ?? ZOOM_DEFAULT); } catch { return ZOOM_DEFAULT; }
}
export function saveZoom(storage, v) {
  try { storage?.setItem(ZOOM_KEY, String(clampZoom(v))); } catch { /* bỏ qua: trình duyệt chặn lưu trữ */ }
}
