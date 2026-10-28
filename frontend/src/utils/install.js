// "Cài đặt ứng dụng" trên trang public (2026-10-28): hàm thuần (test node) cho nền tảng, thanh mời, trình duyệt trong app.
import { isIos } from "./webPush.js";

const IN_APP_RE = /FBAN|FBAV|FB_IAB|Instagram|Zalo|Line\/|Messenger|MicroMessenger|TikTok|Twitter/i;
export const isInAppBrowser = (ua) => IN_APP_RE.test(ua || "");
export const isAndroid = (ua) => /Android/i.test(ua || "");

/**
 * Nền tảng cài đặt:
 *  "installed"      — đang chạy ở chế độ đã cài (display-mode standalone) → ẩn nút
 *  "in_app_browser" — trình duyệt trong Zalo/Messenger… → hướng dẫn mở bằng Safari/Chrome
 *  "ios"            — iPhone/iPad Safari → hướng dẫn Chia sẻ → Thêm vào MH chính
 *  "prompt"         — trình duyệt đã phát beforeinstallprompt → nút gọi hộp thoại cài của máy
 *  "android_manual" — Android không có prompt (Firefox…) → hướng dẫn menu ⋮
 *  "desktop_manual" — máy tính không có prompt → hướng dẫn biểu tượng cài trên thanh địa chỉ
 */
export function installPlatform({ ua = "", standalone = false, hasPromptEvent = false } = {}) {
  if (standalone) return "installed";
  if (isInAppBrowser(ua)) return "in_app_browser";
  if (isIos(ua)) return "ios";
  if (hasPromptEvent) return "prompt";
  return isAndroid(ua) ? "android_manual" : "desktop_manual";
}

export const BANNER_SNOOZE_DAYS = 14;

/** Thanh mời lần đầu: hiện khi chưa cài, không ở trong app khác, và chưa "Để sau" trong 14 ngày. */
export function shouldShowInstallBanner({ platform, dismissedAt, now = Date.now() }) {
  if (platform === "installed" || platform === "in_app_browser") return false;
  if (!dismissedAt) return true;
  return now - Number(dismissedAt) > BANNER_SNOOZE_DAYS * 86400000;
}

export const bannerKey = (slug) => `install_dismissed:${slug}`;
export const nudgeKey = (slug) => `push_nudged:${slug}`;

export function readLS(key) { try { return localStorage.getItem(key); } catch { return null; } }
export function writeLS(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* bỏ qua */ } }
