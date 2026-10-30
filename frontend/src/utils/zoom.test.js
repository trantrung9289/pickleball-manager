// Chạy: npm test (node --test). Mức phóng to sơ đồ nhánh: ép bậc, bước, đọc/lưu an toàn.
import test from "node:test";
import assert from "node:assert/strict";
import { ZOOM_DEFAULT, ZOOM_KEY, ZOOM_STEPS, clampZoom, readZoom, saveZoom, stepZoom } from "./zoom.js";

const memStore = (init = {}) => {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m };
};

test("clampZoom: về bậc gần nhất, giá trị lạ → mặc định", () => {
  assert.equal(clampZoom(1), 1);
  assert.equal(clampZoom(1.2), 1.25);
  assert.equal(clampZoom(9), 2);
  assert.equal(clampZoom(0.1), 0.5);
  for (const bad of [NaN, null, undefined, "abc", 0, -1]) assert.equal(clampZoom(bad), ZOOM_DEFAULT);
});

test("stepZoom: đi từng bậc, đứng yên ở hai đầu", () => {
  assert.equal(stepZoom(1, 1), 1.1);
  assert.equal(stepZoom(1, -1), 0.9);
  assert.equal(stepZoom(2, 1), 2);
  assert.equal(stepZoom(0.5, -1), 0.5);
  assert.equal(stepZoom(1.2, 1), 1.5);   // 1.2 → 1.25 rồi lên 1.5
});

test("ZOOM_STEPS tăng dần và chứa mặc định", () => {
  assert.deepEqual([...ZOOM_STEPS].sort((a, b) => a - b), ZOOM_STEPS);
  assert.ok(ZOOM_STEPS.includes(ZOOM_DEFAULT));
});

test("readZoom/saveZoom: lưu bậc đã ép; lỗi lưu trữ không làm hỏng", () => {
  const s = memStore();
  assert.equal(readZoom(s), 1);
  saveZoom(s, 1.2);
  assert.equal(s.m[ZOOM_KEY], "1.25");
  assert.equal(readZoom(s), 1.25);
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readZoom(boom), 1);
  assert.doesNotThrow(() => saveZoom(boom, 1.5));
  assert.equal(readZoom(null), 1);
});
