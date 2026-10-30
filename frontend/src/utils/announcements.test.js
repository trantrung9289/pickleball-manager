// Chạy: npm test (node --test). Hàm thuần của thông báo/chuông: khoá đã xem, đếm chưa xem, nhãn ngày, gộp tên chưa đóng.
import test from "node:test";
import assert from "node:assert/strict";
import { itemKey, weekdayLabelOfDate, formatWhen, statusChip, unreadCount, mergeSeen, unpaidPreview, groupByDate, shareText, formatHistoryTime, historyResult, PUSH_CHANNEL_LABELS, PUSH_SOURCE_LABELS } from "./announcements.js";

test("weekdayLabelOfDate + formatWhen: 2026-10-27 là Thứ 3, có giờ thì nối giờ", () => {
  assert.equal(weekdayLabelOfDate("2026-10-27"), "Thứ 3");
  assert.equal(weekdayLabelOfDate("2026-11-01"), "Chủ nhật");
  assert.equal(formatWhen({ date: "2026-10-27", start_time: "19:00" }), "Thứ 3, 27/10 · 19:00");
  assert.equal(formatWhen({ date: "2026-10-27" }), "Thứ 3, 27/10");
});

test("statusChip: hôm nay / ngày mai / còn N ngày", () => {
  assert.deepEqual(statusChip({ status: "today", days_left: 0 }), { tone: "ok", text: "Hôm nay" });
  assert.deepEqual(statusChip({ status: "upcoming", days_left: 1 }), { tone: "info", text: "Ngày mai" });
  assert.deepEqual(statusChip({ status: "upcoming", days_left: 3 }), { tone: "info", text: "Còn 3 ngày" });
  assert.equal(statusChip({ status: "later", days_left: 9 }).tone, "neutral");
});

test("unreadCount + mergeSeen: đếm theo khoá quy tắc:ngày, gộp không trùng, cắt còn 200", () => {
  const items = [{ announcement_id: 1, date: "2026-10-27" }, { announcement_id: 1, date: "2026-10-29" }, { announcement_id: 2, date: "2026-10-27" }];
  assert.equal(itemKey(items[0]), "1:2026-10-27");
  assert.equal(unreadCount(items, []), 3);
  const seen = mergeSeen([], items.slice(0, 2));
  assert.equal(unreadCount(items, seen), 1);
  assert.deepEqual(mergeSeen(seen, items), ["1:2026-10-27", "1:2026-10-29", "2:2026-10-27"]);
  const big = Array.from({ length: 205 }, (_, i) => ({ announcement_id: i, date: "2026-01-01" }));
  const merged = mergeSeen([], big);
  assert.equal(merged.length, 200);
  assert.equal(merged[0], "5:2026-01-01");
});

test("unpaidPreview + groupByDate", () => {
  const ms = Array.from({ length: 12 }, (_, i) => ({ full_name: `M${i + 1}` }));
  assert.deepEqual(unpaidPreview(ms.slice(0, 3)), { shown: ["M1", "M2", "M3"], more: 0 });
  const p = unpaidPreview(ms);
  assert.equal(p.shown.length, 10); assert.equal(p.more, 2);
  const g = groupByDate([{ date: "a", announcement_id: 1 }, { date: "a", announcement_id: 2 }, { date: "b", announcement_id: 3 }]);
  assert.deepEqual(g.map((x) => [x.date, x.items.length]), [["a", 2], ["b", 1]]);
});

test("shareText: lịch có CLB + link; phí liệt kê tên; quá 2000 ký tự thì cắt tên và giữ link", () => {
  const sched = shareText({ kind: "schedule", title: "Đánh tối", date: "2026-10-27", start_time: "19:00", duration_min: 120, body: "Sân 3" },
    { clubName: "CLB A", publicUrl: "https://x.vn/public/report/abc" });
  assert.equal(sched, "📅 Đánh tối — CLB A\nThứ 3, 27/10 · 19:00 · 120 phút\n\nSân 3\n\nXem chi tiết: https://x.vn/public/report/abc");
  const fee = shareText({ kind: "fee", title: "Hội phí", date: "2026-11-05", unpaid_count: 2, unpaid_members: [{ full_name: "An" }, { full_name: "Bình" }] });
  assert.equal(fee, "🔔 Hội phí\nThứ 5, 05/11\n\nChưa đóng (2 người):\n  • An\n  • Bình");
  const many = Array.from({ length: 300 }, (_, i) => ({ full_name: `Thành viên số ${i + 1}` }));
  const long = shareText({ kind: "fee", title: "Hội phí", date: "2026-11-05", unpaid_count: 300, unpaid_members: many }, { publicUrl: "https://x.vn/p" });
  assert.ok(long.length <= 2000);
  assert.ok(long.endsWith("Xem chi tiết: https://x.vn/p"));
  assert.match(long, /… và \d+ người nữa/);
});

test("lịch sử đẩy: nhãn kênh/nguồn, kết quả ✔/✖, định dạng giờ HH:mm:ss DD/MM/YYYY", () => {
  assert.deepEqual(PUSH_CHANNEL_LABELS, { telegram: "Telegram", web: "Thiết bị", zalo: "Zalo" });
  assert.equal(PUSH_SOURCE_LABELS.cron, "Tự động");
  assert.equal(historyResult({ sent_count: 2, error_count: 0 }), "✔ 2");
  assert.equal(historyResult({ sent_count: 0, error_count: 1 }), "✖ 1");
  assert.equal(historyResult({ sent_count: 2, error_count: 1 }), "✔ 2 · ✖ 1");
  assert.equal(historyResult({ sent_count: 0, error_count: 0 }), "—");
  const d = new Date(2026, 9, 5, 7, 5, 9);   // giờ máy, 05/10/2026 07:05:09
  assert.equal(formatHistoryTime(d.toISOString()), "07:05:09 05/10/2026");
  assert.equal(formatHistoryTime(""), "");
  assert.equal(formatHistoryTime("không phải ngày"), "");
});
