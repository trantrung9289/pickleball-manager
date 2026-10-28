// Chạy: npm test (node --test). Hàm thuần "Cài đặt ứng dụng": nền tảng, thanh mời 14 ngày, trình duyệt trong app.
import test from "node:test";
import assert from "node:assert/strict";
import { installPlatform, shouldShowInstallBanner, isInAppBrowser, BANNER_SNOOZE_DAYS } from "./install.js";

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36";
const ZALO = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Zalo/23.0";

test("installPlatform theo UA / standalone / prompt", () => {
  assert.equal(installPlatform({ ua: IOS, standalone: true }), "installed");
  assert.equal(installPlatform({ ua: ZALO }), "in_app_browser");
  assert.equal(installPlatform({ ua: IOS }), "ios");
  assert.equal(installPlatform({ ua: ANDROID, hasPromptEvent: true }), "prompt");
  assert.equal(installPlatform({ ua: ANDROID }), "android_manual");
  assert.equal(installPlatform({ ua: "Mozilla/5.0 (Macintosh) Firefox/120" }), "desktop_manual");
  assert.equal(isInAppBrowser("FBAN/FBIOS"), true);
});

test("shouldShowInstallBanner: ẩn khi đã cài / trong app; 'Để sau' giấu 14 ngày", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldShowInstallBanner({ platform: "installed" }), false);
  assert.equal(shouldShowInstallBanner({ platform: "in_app_browser" }), false);
  assert.equal(shouldShowInstallBanner({ platform: "ios", dismissedAt: null, now }), true);
  assert.equal(shouldShowInstallBanner({ platform: "ios", dismissedAt: now - 3 * 86400000, now }), false);
  assert.equal(shouldShowInstallBanner({ platform: "prompt", dismissedAt: now - (BANNER_SNOOZE_DAYS + 1) * 86400000, now }), true);
});
