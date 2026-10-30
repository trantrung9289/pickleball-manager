// Chạy: npm test (node --test). Hàm thuần của thông báo/chuông: khoá đã xem, đếm chưa xem, nhãn ngày, gộp tên chưa đóng.
import test from "node:test";
import assert from "node:assert/strict";
import { itemKey, weekdayLabelOfDate, formatWhen, statusChip, unreadCount, mergeSeen, unpaidPreview, groupByDate, shareText, formatHistoryTime, historyResult, PUSH_CHANNEL_LABELS, PUSH_SOURCE_LABELS, KIND_LABELS, REPORT_RANGE_OPTIONS, reportRangeText, reportSummaryText, REPORT_TYPE_LABELS, REPORT_NAME_TYPES, REPORT_FEE_TYPES, REPORT_CHANNEL_LABELS, reportExposureText } from "./announcements.js";

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
  assert.deepEqual(PUSH_CHANNEL_LABELS, { telegram: "Telegram", web: "Trang Public", zalo: "Zalo" });
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

test("báo cáo định kỳ: nhãn loại, khoảng thời gian, mô tả quy tắc", () => {
  assert.equal(KIND_LABELS.report, "Báo cáo");
  assert.deepEqual(REPORT_RANGE_OPTIONS.map((o) => o.value), ["yesterday", "last7", "last_week", "this_month", "last_month", "last_quarter", "this_year", "last_n", "fixed"]);
  assert.equal(reportRangeText({ report_range: "last_month" }), "Tháng trước");
  assert.equal(reportRangeText({ report_range: "last_n", report_range_days: 30 }), "30 ngày gần nhất");
  assert.equal(reportRangeText({ report_range: "fixed", report_from: "2026-10-01", report_to: "2026-10-31" }), "01/10/2026 – 31/10/2026");
  assert.equal(reportSummaryText({ report_type: "summary", report_range: "last_week" }), "Tổng hợp thu chi · Tuần trước · Telegram quản trị viên");
  assert.equal(reportSummaryText({ report_type: "transactions", report_range: "yesterday", report_channels: ["telegram", "zalo"], report_hide_names: true }),
    "Giao dịch · Hôm qua · Telegram quản trị viên, Nhóm Zalo · ẩn tên");
  assert.equal(reportSummaryText({ report_type: "summary", report_range: "yesterday", report_channels: ["web"], report_hide_names: true }), "Tổng hợp thu chi · Hôm qua · Trang Public");   // ẩn tên chỉ áp cho báo cáo giao dịch
});

test("báo cáo đợt 2: nhãn loại, loại dùng khoản thu / ẩn tên, mô tả có tên khoản", () => {
  assert.deepEqual(Object.keys(REPORT_TYPE_LABELS), ["summary", "transactions", "contributions", "fee_status"]);
  assert.equal(REPORT_TYPE_LABELS.fee_status, "Theo dõi phí");
  assert.deepEqual(REPORT_FEE_TYPES, ["contributions", "fee_status"]);
  assert.deepEqual(REPORT_NAME_TYPES, ["transactions", "contributions", "fee_status"]);
  assert.equal(reportSummaryText({ report_type: "fee_status", report_fee_type_id: 3, report_fee_type_name: "Quỹ CLB", report_range: "last_month", report_hide_names: true }),
    "Theo dõi phí · Quỹ CLB · Tháng trước · Telegram quản trị viên · ẩn tên");
  assert.equal(reportSummaryText({ report_type: "contributions", report_range: "last7", report_channels: ["zalo"] }), "Đóng góp thành viên · 7 ngày gần nhất · Nhóm Zalo");   // không lọc khoản
  assert.equal(reportSummaryText({ report_type: "contributions", report_fee_type_id: 9, report_fee_type_name: null, report_range: "yesterday" }), "Đóng góp thành viên · khoản đã xoá · Hôm qua · Telegram quản trị viên");
  assert.equal(reportSummaryText({ report_type: "summary", report_fee_type_id: 3, report_fee_type_name: "X", report_range: "yesterday", report_hide_names: true }), "Tổng hợp thu chi · Hôm qua · Telegram quản trị viên");   // loại khác bỏ qua khoản và ẩn tên
});

test("cảnh báo lộ số liệu theo đúng kênh đang chọn; kênh web gọi là Trang Public", () => {
  assert.deepEqual(REPORT_CHANNEL_LABELS, { telegram: "Telegram quản trị viên", zalo: "Nhóm Zalo", web: "Trang Public" });
  assert.equal(reportExposureText(["telegram"]), "");
  assert.equal(reportExposureText(undefined), "");
  assert.equal(reportExposureText(["telegram", "zalo"]), "Nhóm Zalo sẽ thấy số liệu thu chi");                     // chỉ tick thêm Zalo → không nhắc Trang Public
  assert.equal(reportExposureText(["telegram", "web"]), "Người xem Trang Public (đã bật thông báo) sẽ thấy số liệu thu chi");
  assert.equal(reportExposureText(["zalo", "web", "telegram"]), "Nhóm Zalo và người xem Trang Public (đã bật thông báo) sẽ thấy số liệu thu chi");
});
