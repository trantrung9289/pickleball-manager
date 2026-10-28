// Mã PIN link công khai (2026-10-28): nhớ theo slug trong trình duyệt để mở lại (kể cả PWA từ màn hình chính) không phải nhập lại.
export const pinKey = (slug) => `public_pin:${slug}`;
export function readPin(slug) { try { return localStorage.getItem(pinKey(slug)) || null; } catch { return null; } }
export function savePin(slug, pin) { try { localStorage.setItem(pinKey(slug), pin); } catch { /* bỏ qua */ } }
export function clearPin(slug) { try { localStorage.removeItem(pinKey(slug)); } catch { /* bỏ qua */ } }
/** Lỗi 401 từ API public: trả "pin_required" | "pin_invalid" | null */
export function pinErrorCode(err) {
  const d = err?.response?.status === 401 ? err.response?.data?.detail : null;
  return d && typeof d === "object" ? d.code || null : null;
}
export const isValidPin = (v) => /^(\d{4}|\d{6})$/.test(v || "");
