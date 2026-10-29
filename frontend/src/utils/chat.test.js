// Chạy: npm test (node --test). Hàm thuần trò chuyện: nhắc tên, phần trăm bình chọn, gộp tin, nhãn giờ.
import test from "node:test";
import assert from "node:assert/strict";
import { extractMentionIds, pollPercents, mergeMessages, shortTime, previewLine, readLastRead, saveLastRead } from "./chat.js";

test("extractMentionIds: khớp tên dài trước, không phân biệt hoa thường, không khớp một phần", () => {
  const ps = [{ id: 1, display_name: "An" }, { id: 2, display_name: "An Nguyễn" }, { id: 3, display_name: "Bình" }];
  assert.deepEqual(extractMentionIds("@An Nguyễn và @bình đi không?", ps), [2, 3]);
  assert.deepEqual(extractMentionIds("@An ơi", ps), [1]);
  assert.deepEqual(extractMentionIds("@Anh ơi", ps), []);
  assert.deepEqual(extractMentionIds("không nhắc ai", ps), []);
});

test("pollPercents + mergeMessages", () => {
  assert.deepEqual(pollPercents({ options: [{ id: "a", count: 3 }, { id: "b", count: 1 }] }), [{ id: "a", pct: 75 }, { id: "b", pct: 25 }]);
  assert.deepEqual(pollPercents({ options: [{ id: "a", count: 0 }] }), [{ id: "a", pct: 0 }]);
  const merged = mergeMessages([{ id: 1, body: "a" }, { id: 2, body: "b" }], [{ id: 2, body: "b2" }, { id: 3, body: "c" }]);
  assert.deepEqual(merged.map((m) => `${m.id}${m.body}`), ["1a", "2b2", "3c"]);
});

test("shortTime: hôm nay chỉ giờ, khác ngày có DD/MM", () => {
  const now = new Date(2026, 9, 28, 15, 0);
  const todayIso = new Date(2026, 9, 28, 9, 5).toISOString();
  assert.equal(shortTime(todayIso, now), "09:05");
  const otherIso = new Date(2026, 9, 27, 21, 30).toISOString();
  assert.equal(shortTime(otherIso, now), "27/10 21:30");
});

test("previewLine: gộp khoảng trắng, cắt gọn theo max, giữ tên", () => {
  assert.equal(previewLine({ name: "An", body: "Tối  nay\nđánh không?" }), "An: Tối nay đánh không?");
  assert.equal(previewLine({ name: "Bình", body: "a".repeat(100) }, 20), `Bình: ${"a".repeat(19)}…`);
  assert.equal(previewLine(null), "");
  assert.equal(previewLine({ name: "Ban quản trị", body: "Bình chọn: Sân nào?" }), "Ban quản trị: Bình chọn: Sân nào?");
});

test("readLastRead/saveLastRead: không có localStorage → null và không ném lỗi; mốc chỉ tiến", () => {
  assert.equal(readLastRead("x"), null);
  saveLastRead("x", 5);   // không có localStorage trong node → bỏ qua, không throw
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  try {
    assert.equal(readLastRead("x"), null);
    saveLastRead("x", 5); assert.equal(readLastRead("x"), 5);
    saveLastRead("x", 3); assert.equal(readLastRead("x"), 5);
    saveLastRead("x", 9); assert.equal(readLastRead("x"), 9);
    saveLastRead("x", "abc"); assert.equal(readLastRead("x"), 9);
  } finally { delete globalThis.localStorage; }
});
