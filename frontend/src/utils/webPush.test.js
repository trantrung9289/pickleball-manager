// Chạy: npm test (node --test). Hàm thuần Web Push: giải mã khoá VAPID, trạng thái hỗ trợ theo nền tảng.
import test from "node:test";
import assert from "node:assert/strict";
import { urlBase64ToUint8Array, pushSupportState, isIos } from "./webPush.js";

test("urlBase64ToUint8Array: base64url không padding → bytes đúng", () => {
  const bytes = urlBase64ToUint8Array("AQID_-8");   // 01 02 03 ff ef
  assert.deepEqual([...bytes], [1, 2, 3, 255, 239]);
});

test("pushSupportState: iOS chưa thêm vào màn hình chính → ios_not_installed; đã cài → theo quyền", () => {
  const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
  assert.equal(isIos(ios), true);
  assert.equal(pushSupportState({ ua: ios, standalone: false, hasSW: true, hasPush: true, hasNotification: true }), "ios_not_installed");
  assert.equal(pushSupportState({ ua: ios, standalone: true, hasSW: true, hasPush: true, hasNotification: true, permission: "default" }), "ready");
  assert.equal(pushSupportState({ ua: ios, standalone: true, hasSW: true, hasPush: true, hasNotification: true, permission: "denied" }), "denied");
});

test("pushSupportState: Android/desktop thiếu API → unsupported; đủ → ready", () => {
  const android = "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile";
  assert.equal(pushSupportState({ ua: android, hasSW: true, hasPush: false, hasNotification: true }), "unsupported");
  assert.equal(pushSupportState({ ua: android, hasSW: true, hasPush: true, hasNotification: true, permission: "granted" }), "ready");
});
