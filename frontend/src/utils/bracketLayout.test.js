// Chạy: npm test (node --test). Bản gương đầy đủ được đối chiếu với backend trong
// backend/tests/test_batch15_knockout_pairing_rule.py; file này ghim các trường hợp hay gặp nhất.
import test from "node:test";
import assert from "node:assert/strict";
import { projectedKnockoutSlots, buildProjectedBracketNodes, knockoutLayoutFromGroups } from "./bracketLayout.js";

test("2 bảng: Nhất A gặp Nhì B, Nhất B gặp Nhì A", () => {
  assert.deepEqual(projectedKnockoutSlots(["A", "B"]), ["Nhất bảng A", "Nhì bảng B", "Nhất bảng B", "Nhì bảng A"]);
});

test("4 bảng: khối (A,B) rồi (C,D), 2 trận cùng khối kề nhau", () => {
  assert.deepEqual(projectedKnockoutSlots(["A", "B", "C", "D"]), [
    "Nhất bảng A", "Nhì bảng B", "Nhất bảng B", "Nhì bảng A",
    "Nhất bảng C", "Nhì bảng D", "Nhất bảng D", "Nhì bảng C",
  ]);
});

test("3 bảng: 2 bye cho Nhất A, Nhất B; đội tự do ghép chéo bảng", () => {
  assert.deepEqual(projectedKnockoutSlots(["C", "A", "B"]), [
    "Nhất bảng A", null, "Nhì bảng B", "Nhì bảng C", "Nhất bảng B", null, "Nhì bảng A", "Nhất bảng C",
  ]);
});

test("6 bảng: khối E–F còn nguyên dù có bye", () => {
  const slots = projectedKnockoutSlots(["A", "B", "C", "D", "E", "F"]);
  const pairs = [];
  for (let i = 0; i < slots.length; i += 2) pairs.push([slots[i], slots[i + 1]]);
  assert.deepEqual(pairs.filter((p) => p.includes("Nhất bảng E") || p.includes("Nhất bảng F")),
    [["Nhất bảng E", "Nhì bảng F"], ["Nhất bảng F", "Nhì bảng E"]]);
});

test("bảng chỉ 1 đội thì không có Nhì", () => {
  assert.deepEqual(projectedKnockoutSlots([{ name: "A", size: 2 }, { name: "B", size: 1 }]),
    ["Nhất bảng A", null, "Nhất bảng B", "Nhì bảng A"]);
});

test("buildProjectedBracketNodes vẽ đúng ô đã xếp và phân giải bye lên vòng sau", () => {
  const rounds = buildProjectedBracketNodes(knockoutLayoutFromGroups(["A", "B", "C"],
    { A: "1A", B: "1B", C: "1C" }, { A: "2A", B: "2B", C: "2C" }));
  assert.equal(rounds.length, 3);
  assert.deepEqual(rounds[0].map((n) => [n.top, n.bottom]), [["1A", null], ["2B", "2C"], ["1B", null], ["2A", "1C"]]);
  assert.deepEqual(rounds[1].map((n) => [n.top, n.bottom]), [["1A", null], ["1B", null]]);
});
