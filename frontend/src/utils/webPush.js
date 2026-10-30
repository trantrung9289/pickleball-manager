// Web Push cho người xem public (2026-10-28): hàm thuần (test node) + lớp mỏng quanh Notification/pushManager.

/** base64url (khoá VAPID công khai) → Uint8Array cho pushManager.subscribe(applicationServerKey). */
export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const isIos = (ua) => /iPhone|iPad|iPod/i.test(ua || "") || (/Macintosh/.test(ua || "") && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);

/**
 * Trạng thái hỗ trợ: "unsupported" | "ios_not_installed" (iOS phải thêm vào màn hình chính) | "denied" | "ready".
 * env: { ua, standalone, hasSW, hasPush, hasNotification, permission }
 */
export function pushSupportState(env) {
  const { ua = "", standalone = false, hasSW = false, hasPush = false, hasNotification = false, permission = "default" } = env || {};
  if (isIos(ua) && !standalone) return "ios_not_installed";
  if (!hasSW || !hasPush || !hasNotification) return "unsupported";
  if (permission === "denied") return "denied";
  return "ready";
}

/** Đọc môi trường trình duyệt thật. */
export function readPushEnv() {
  if (typeof window === "undefined") return {};
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  return {
    ua: navigator.userAgent, standalone,
    hasSW: "serviceWorker" in navigator, hasPush: "PushManager" in window, hasNotification: "Notification" in window,
    permission: typeof Notification !== "undefined" ? Notification.permission : "default",
  };
}

/** Subscription hiện có của trình duyệt (null nếu chưa). */
export async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Xin quyền + đăng ký với khoá VAPID; trả PushSubscription.toJSON() hoặc ném lỗi có message tiếng Việt. */
export async function subscribeBrowser(publicKey) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Bạn chưa cho phép thông báo");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  return sub.toJSON();
}

export async function unsubscribeBrowser() {
  const sub = await currentSubscription();
  if (!sub) return null;
  const json = sub.toJSON();
  await sub.unsubscribe();
  return json;
}

/** Sự kiện cửa sổ: đăng ký thông báo vừa thay đổi (useAutoPush) → PushSettings tải lại trạng thái. */
export const PUSH_CHANGED_EVENT = "clb:push-changed";

/**
 * Kế hoạch tự bật thông báo trên trang public (2026-10-30: mặc định BẬT, không có nút tắt):
 *  - "none"      : chưa thể (trình duyệt không hỗ trợ / iOS chưa thêm vào màn hình chính / máy chủ chưa bật / thiếu khoá / bị chặn quyền)
 *  - "resync"    : đã có subscription → gửi lại cho máy chủ (làm mới liên kết CLB/link, xoá bộ đếm lỗi)
 *  - "subscribe" : đã cấp quyền nhưng chưa có subscription (vd bản cũ đã Tắt) → đăng ký ngầm, không hỏi
 *  - "arm"       : chưa hỏi quyền → chờ lần chạm đầu tiên của người dùng rồi mới hỏi (Safari/iOS bắt buộc có thao tác người dùng)
 * Không thể ép quyền: người dùng vẫn có thể chặn ở trình duyệt/điện thoại.
 */
export function autoPushPlan({ state, enabledOnServer, hasKey, permission, hasSubscription }) {
  if (state !== "ready" || !enabledOnServer || !hasKey) return "none";
  if (hasSubscription) return "resync";
  if (permission === "granted") return "subscribe";
  if (permission === "default") return "arm";
  return "none";
}
