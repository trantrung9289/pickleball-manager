/**
 * useAutoPush — thông báo đẩy trên trang public MẶC ĐỊNH BẬT, người xem không có nút tắt (2026-10-30).
 * Chạy khi trang đã vào được (qua PIN nếu có): xem utils/webPush.autoPushPlan.
 *  - đã có subscription → gửi lại máy chủ (làm mới); đã cấp quyền nhưng chưa đăng ký → đăng ký ngầm;
 *  - chưa hỏi quyền → chờ LẦN CHẠM ĐẦU TIÊN rồi mới hỏi (trình duyệt/Safari yêu cầu thao tác người dùng), mỗi phiên chỉ hỏi một lần.
 * Không ép được quyền: bị chặn thì giữ nguyên (PushSettings hướng dẫn mở lại trong cài đặt).
 */
import { useEffect } from "react";
import { pushSupportState, readPushEnv, currentSubscription, subscribeBrowser, autoPushPlan, PUSH_CHANGED_EVENT } from "../utils/webPush";

const SESSION_KEY = "push_autoprompt_done";
const readSession = () => { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } };
const writeSession = () => { try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* bỏ qua */ } };

export default function useAutoPush(push, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let detach = () => {};
    const register = (json) => push.subscribe({ endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent.slice(0, 300) });
    (async () => {
      const env = readPushEnv();
      const state = pushSupportState(env);
      let cfg = null;
      try { cfg = (await push.config()).data; } catch { return; }
      let sub = null;
      if (state === "ready") { try { sub = await currentSubscription(); } catch { sub = null; } }
      if (!alive) return;
      const plan = autoPushPlan({ state, enabledOnServer: !!cfg?.enabled, hasKey: !!cfg?.public_key, permission: env.permission, hasSubscription: !!sub });
      if (plan === "resync") {
        try { await register(sub.toJSON()); } catch { /* im lặng: lần mở sau sẽ thử lại */ }
      } else if (plan === "subscribe") {
        try { await register(await subscribeBrowser(cfg.public_key)); window.dispatchEvent(new Event(PUSH_CHANGED_EVENT)); } catch { /* im lặng */ }
      } else if (plan === "arm" && !readSession()) {
        const onGesture = () => {
          detach();
          writeSession();
          // gọi subscribeBrowser ĐỒNG BỘ trong handler: requestPermission phải nằm trong thao tác người dùng
          subscribeBrowser(cfg.public_key).then(register).then(() => window.dispatchEvent(new Event(PUSH_CHANGED_EVENT))).catch(() => {});
        };
        document.addEventListener("pointerdown", onGesture, { once: true });
        document.addEventListener("keydown", onGesture, { once: true });
        detach = () => { document.removeEventListener("pointerdown", onGesture); document.removeEventListener("keydown", onGesture); };
      }
    })();
    return () => { alive = false; detach(); };
  }, [push, enabled]);
}
