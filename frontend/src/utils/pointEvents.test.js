// Chạy: npm test (node --test). Ghim luật xếp hạng / hợp nhất state cho sự kiện thành tích cá nhân.
import test from "node:test";
import assert from "node:assert/strict";
import {
  rankParticipants, removedParticipants, mergeState, appendLogs, lastLogId, formatDelta,
  isStaleSnapshot, shiftPoints, withPending, pendingAdd, pendingRemove, pendingTotals, pendingCount, applyOrderLock,
} from "./pointEvents.js";

const P = (id, points, seq, status = "active") => ({ id, points, seq, status, display_name: `Người ${id}` });

test("rankParticipants: điểm giảm dần, đồng điểm cùng hạng, hạng kế tiếp nhảy (1,1,3)", () => {
  const out = rankParticipants([P(1, 5, 1), P(2, 7, 2), P(3, 5, 3), P(4, 2, 4)]);
  assert.deepEqual(out.map((p) => [p.id, p.rank]), [[2, 1], [1, 2], [3, 2], [4, 4]]);
});

test("rankParticipants: cùng điểm thì theo thứ tự thêm (seq); người removed bị loại; không sửa mảng gốc", () => {
  const input = [P(9, 3, 5), P(8, 3, 2), P(7, 10, 9, "removed")];
  const snapshot = JSON.stringify(input);
  const out = rankParticipants(input);
  assert.deepEqual(out.map((p) => p.id), [8, 9]);
  assert.deepEqual(out.map((p) => p.rank), [1, 1]);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(removedParticipants(input).map((p) => p.id), [7]);
});

test("rankParticipants: rỗng / thiếu status → coi là active, điểm thiếu = 0", () => {
  assert.deepEqual(rankParticipants([]), []);
  assert.deepEqual(rankParticipants(null), []);
  const out = rankParticipants([{ id: 1, seq: 2 }, { id: 2, seq: 1, points: 0 }]);
  assert.deepEqual(out.map((p) => [p.id, p.rank]), [[2, 1], [1, 1]]);
});

test("mergeState: chỉ áp khi version mới hơn; cộng pending; participant lạ hoặc đổi status → needFull", () => {
  const ev = { id: 1, status: "active", version: 5, participants: [P(1, 2, 1), P(2, 0, 2)] };
  // version cũ hơn/bằng → giữ nguyên object
  assert.equal(mergeState(ev, { version: 5, status: "active", participants: [] }).event, ev);
  assert.equal(mergeState(ev, { version: 4, status: "active", participants: [] }).event, ev);
  // version mới → cập nhật điểm + pending, participant_count đếm người active
  const r = mergeState(ev, {
    version: 6, status: "active",
    participants: [{ id: 1, points: 4, status: "active" }, { id: 2, points: 1, status: "removed" }],
  }, { 1: 1 });
  assert.equal(r.needFull, false);
  assert.equal(r.event.version, 6);
  assert.deepEqual(r.event.participants.map((p) => [p.id, p.points, p.status]), [[1, 5, "active"], [2, 1, "removed"]]);
  assert.equal(r.event.participant_count, 1);
  // người lạ (thêm ở máy khác) → cần tải bản đầy đủ
  assert.equal(mergeState(ev, { version: 7, status: "active", participants: [{ id: 99, points: 0, status: "active" }] }).needFull, true);
  // đổi trạng thái sự kiện → cần tải bản đầy đủ
  assert.equal(mergeState(ev, { version: 7, status: "completed", participants: [] }).needFull, true);
});

test("appendLogs / lastLogId / formatDelta", () => {
  const a = appendLogs([], [{ id: 1 }, { id: 2 }]);
  const b = appendLogs(a, [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(b.map((l) => l.id), [1, 2, 3]);
  assert.equal(appendLogs(b, []), b);            // không tạo mảng mới khi không có gì thêm
  assert.deepEqual(appendLogs([{ id: 5 }], [{ id: 4 }]).map((l) => l.id), [4, 5]); // chunk lệch thứ tự vẫn tăng dần
  assert.equal(lastLogId(b), 3);
  assert.equal(lastLogId([]), 0);
  assert.equal(formatDelta(1), "+1");
  assert.equal(formatDelta(-1), "−1");
  assert.equal(formatDelta(0), "0");
});

// ── F4: người bị xoá cứng ở máy khác vắng trong /state → phải tải lại bản đầy đủ ──
test("mergeState: participant đang hiển thị vắng trong state (xoá cứng) → needFull, giữ nguyên event", () => {
  const ev = { id: 1, status: "active", version: 5, log_count: 3, participants: [P(1, 2, 1), P(2, 0, 2), P(3, 1, 3)] };
  const r = mergeState(ev, {
    version: 6, status: "active", log_count: 2,
    participants: [{ id: 1, points: 2, status: "active" }, { id: 3, points: 1, status: "active" }],   // id 2 biến mất
  });
  assert.equal(r.needFull, true);
  assert.equal(r.event, ev);
});

test("mergeState: người rời có điểm vẫn nằm trong state với status removed → KHÔNG needFull", () => {
  const ev = { id: 1, status: "active", version: 5, participants: [P(1, 2, 1), P(2, 4, 2)] };
  const r = mergeState(ev, {
    version: 6, status: "active",
    participants: [{ id: 1, points: 2, status: "active" }, { id: 2, points: 4, status: "removed" }],
  });
  assert.equal(r.needFull, false);
  assert.deepEqual(r.event.participants.map((p) => [p.id, p.status]), [[1, "active"], [2, "removed"]]);
  assert.equal(r.event.participant_count, 1);
});

test("mergeState: state.participants rỗng khi event có người → needFull (mọi người đều vắng)", () => {
  const ev = { id: 1, status: "active", version: 5, participants: [P(1, 2, 1)] };
  assert.equal(mergeState(ev, { version: 6, status: "active", participants: [] }).needFull, true);
});

test("mergeState: người mới (id lạ) → needFull; version không mới hơn thì bỏ qua cả hai trường hợp", () => {
  const ev = { id: 1, status: "active", version: 5, participants: [P(1, 2, 1)] };
  const withNew = { version: 6, status: "active", participants: [{ id: 1, points: 2, status: "active" }, { id: 7, points: 0, status: "active" }] };
  const r = mergeState(ev, withNew);
  assert.equal(r.needFull, true);
  assert.equal(r.event, ev);
  const old = mergeState(ev, { ...withNew, version: 5 });
  assert.equal(old.needFull, false);
  assert.equal(old.event, ev);
  // event bản nhẹ (chưa có participants) nhận state có người → tải bản đầy đủ
  assert.equal(mergeState({ id: 1, status: "active", version: 1 }, withNew).needFull, true);
});

// ── F5: log_count đi theo /state ──
test("mergeState: log_count lấy từ state; state không có log_count thì giữ của event", () => {
  const ev = { id: 1, status: "active", version: 5, log_count: 3, participants: [P(1, 2, 1)] };
  const a = mergeState(ev, { version: 6, status: "active", log_count: 9, participants: [{ id: 1, points: 3, status: "active" }] });
  assert.equal(a.needFull, false);
  assert.equal(a.event.log_count, 9);
  assert.equal(a.event.participants[0].points, 3);
  const b = mergeState(ev, { version: 6, status: "active", participants: [{ id: 1, points: 3, status: "active" }] });
  assert.equal(b.event.log_count, 3);
  // log_count = 0 là giá trị hợp lệ, không bị `??` nuốt thành giá trị cũ
  const c = mergeState(ev, { version: 6, status: "active", log_count: 0, participants: [{ id: 1, points: 0, status: "active" }] });
  assert.equal(c.event.log_count, 0);
});

// ── F6: bỏ phản hồi cũ; pending chỉ tính lượt chưa được xác nhận ──
test("isStaleSnapshot: cũ hơn → true; bằng/mới hơn/khác sự kiện/thiếu version → false", () => {
  const cur = { id: 1, version: 10 };
  assert.equal(isStaleSnapshot(cur, { id: 1, version: 9 }), true);
  assert.equal(isStaleSnapshot(cur, { id: 1, version: 10 }), false);   // đổi tên/mô tả không tăng version → vẫn áp
  assert.equal(isStaleSnapshot(cur, { id: 1, version: 11 }), false);
  assert.equal(isStaleSnapshot(cur, { id: 2, version: 1 }), false);
  assert.equal(isStaleSnapshot(cur, { id: 1 }), false);
  assert.equal(isStaleSnapshot({ id: 1 }, { id: 1, version: 3 }), false);   // bản nhẹ chưa có version = 0
  assert.equal(isStaleSnapshot(null, { id: 1, version: 1 }), false);
});

test("pending: gỡ theo opId (2 lượt +1 giống nhau không nhầm), tổng theo pid, đếm op", () => {
  const m = new Map();
  pendingAdd(m, 1, "a", 1);
  pendingAdd(m, 1, "b", 1);
  pendingAdd(m, 2, "c", -1);
  assert.deepEqual(pendingTotals(m), { 1: 2, 2: -1 });
  assert.equal(pendingCount(m), 3);
  assert.equal(pendingRemove(m, 1, "a"), 1);
  assert.deepEqual(pendingTotals(m), { 1: 1, 2: -1 });
  assert.equal(pendingRemove(m, 1, "a"), null);   // đã gỡ rồi → không gỡ lần 2
  assert.equal(pendingRemove(m, 9, "zzz"), null);
  pendingAdd(m, 3, "d", 1);
  pendingAdd(m, 3, "e", -1);
  assert.deepEqual(pendingTotals(m), { 1: 1, 2: -1 });   // tổng 0 bị bỏ khỏi kết quả
  pendingRemove(m, 1, "b"); pendingRemove(m, 2, "c"); pendingRemove(m, 3, "d"); pendingRemove(m, 3, "e");
  assert.equal(pendingCount(m), 0);
  assert.equal(m.size, 0);
});

test("shiftPoints / withPending: bản sao, không đụng event gốc; pid lạ trả lại nguyên event", () => {
  const ev = { id: 1, participants: [P(1, 2, 1), P(2, 5, 2)] };
  const a = shiftPoints(ev, 1, 1);
  assert.deepEqual(a.participants.map((p) => p.points), [3, 5]);
  assert.deepEqual(ev.participants.map((p) => p.points), [2, 5]);
  assert.equal(shiftPoints(ev, 99, 1), ev);
  const w = withPending({ id: 1, participants: [P(1, 2, 1), P(2, 5, 2)] }, { 2: -1 });
  assert.deepEqual(w.participants.map((p) => p.points), [2, 4]);
});

test("kịch bản 2 phản hồi đảo thứ tự: phản hồi cũ không ghi đè bản mới và không cộng đôi pending", () => {
  // Máy bấm +1 cho A (pid 1) rồi +1 cho B (pid 2) gần như cùng lúc; server xử lý A (v11) trước B (v12)
  // nhưng phản hồi của B về TRƯỚC. Kết quả hiển thị cuối phải là A=3, B=6 — không đếm đôi lượt của A.
  const pending = new Map();
  let ev = { id: 1, status: "active", version: 10, participants: [P(1, 2, 1), P(2, 5, 2)] };
  pendingAdd(pending, 1, "opA", 1); ev = shiftPoints(ev, 1, 1);   // hiển thị A=3
  pendingAdd(pending, 2, "opB", 1); ev = shiftPoints(ev, 2, 1);   // hiển thị B=6
  // phản hồi B (v12, đã gồm cả lượt của A) về trước: gỡ opB, áp bản server + pending còn lại (opA)
  pendingRemove(pending, 2, "opB");
  const rB = { id: 1, version: 12, participants: [P(1, 3, 1), P(2, 6, 2)] };
  assert.equal(isStaleSnapshot(ev, rB), false);
  ev = withPending(rB, pendingTotals(pending));
  assert.deepEqual(ev.participants.map((p) => p.points), [4, 6]);   // A đang bị đếm đôi (3 + pending 1)
  // phản hồi A (v11) về sau: cũ hơn bản đang hiển thị → không ghi đè, trả lại phần cộng lạc quan đã đếm đôi
  pendingRemove(pending, 1, "opA");
  const rA = { id: 1, version: 11, participants: [P(1, 3, 1), P(2, 5, 2)] };
  assert.equal(isStaleSnapshot(ev, rA), true);
  ev = shiftPoints(ev, 1, -1);
  assert.deepEqual(ev.participants.map((p) => p.points), [3, 6]);
  assert.equal(pendingCount(pending), 0);
});

// ── F7: đóng băng thứ tự hàng ──
test("applyOrderLock: giữ thứ tự đã chụp, id mới nối cuối, id mất bị bỏ, hạng vẫn là hạng thật", () => {
  const before = rankParticipants([P(1, 5, 1), P(2, 4, 2), P(3, 3, 3)]);
  const locked = before.map((p) => p.id);                                  // [1, 2, 3]
  // sau khi bấm: người 3 vượt lên đầu
  const after = rankParticipants([P(1, 5, 1), P(2, 4, 2), P(3, 9, 3)]);
  assert.deepEqual(after.map((p) => p.id), [3, 1, 2]);
  const shown = applyOrderLock(after, locked);
  assert.deepEqual(shown.map((p) => p.id), [1, 2, 3]);                     // thứ tự đóng băng
  assert.deepEqual(shown.map((p) => p.rank), [2, 3, 1]);                   // hạng hiển thị vẫn theo điểm thật
  // người mới (id 4) không có trong khoá → nối cuối; người 2 đã rời → bị bỏ
  const changed = rankParticipants([P(1, 5, 1), P(3, 9, 3), P(4, 0, 4)]);
  assert.deepEqual(applyOrderLock(changed, locked).map((p) => p.id), [1, 3, 4]);
  // không khoá → trả lại đúng mảng đầu vào
  assert.equal(applyOrderLock(after, null), after);
  assert.equal(applyOrderLock(after, []), after);
});
