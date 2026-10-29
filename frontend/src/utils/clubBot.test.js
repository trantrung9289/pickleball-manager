// Chạy: npm test (node --test). BOT CLB: phân tích số tiền, ngày, tìm thành viên, dựng payload giao dịch.
import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseDateText, searchMembers, buildTransactionPayload, summarizeTransaction, formatVnd, normText, feeDefault } from "./clubBot.js";

test("parseAmount: hậu tố k/tr, dấu nghìn, số thuần, sai → null", () => {
  assert.equal(parseAmount("150k"), 150000);
  assert.equal(parseAmount("150K "), 150000);
  assert.equal(parseAmount("1,5tr"), 1500000);
  assert.equal(parseAmount("1.5tr"), 1500000);
  assert.equal(parseAmount("1tr5"), 1500000);
  assert.equal(parseAmount("2tr"), 2000000);
  assert.equal(parseAmount("200.000"), 200000);
  assert.equal(parseAmount("200,000"), 200000);
  assert.equal(parseAmount("200000"), 200000);
  assert.equal(parseAmount("150000đ"), 150000);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("12.34"), null);   // không phải dấu nghìn hợp lệ
});

test("parseDateText: hôm nay/hôm qua, DD/MM/YYYY, DD/MM, ngày không tồn tại → null", () => {
  const today = new Date(2026, 9, 29);
  assert.equal(parseDateText("hôm nay", today), "2026-10-29");
  assert.equal(parseDateText("hq", today), "2026-10-28");
  assert.equal(parseDateText("05/10/2026", today), "2026-10-05");
  assert.equal(parseDateText("5/10", today), "2026-10-05");
  assert.equal(parseDateText("05-10-26", today), "2026-10-05");
  assert.equal(parseDateText("31/02/2026", today), null);
  assert.equal(parseDateText("abc", today), null);
});

test("searchMembers: không dấu, hoạt động lên trước, giới hạn", () => {
  const list = [
    { id: 1, full_name: "Nguyễn Văn Bình", member_code: "M01", status: "inactive" },
    { id: 2, full_name: "Trần Bình An", member_code: "M02", status: "active", phone: "0909" },
    { id: 3, full_name: "Lê Cường", member_code: "M03", status: "active" },
  ];
  assert.deepEqual(searchMembers(list, "binh").map((m) => m.id), [2, 1]);
  assert.deepEqual(searchMembers(list, "0909").map((m) => m.id), [2]);
  assert.deepEqual(searchMembers(list, "", 2).map((m) => m.id), [3, 2]);
});

test("buildTransactionPayload + summarizeTransaction: thu gắn thành viên, chi có ghi chú", () => {
  const today = new Date(2026, 9, 29);
  const thu = buildTransactionPayload("thu", { fee_type_id: "3", amount: 150000, member_id: "7", payment_method: "Chuyển khoản" }, today);
  assert.deepEqual(thu, { fee_type_id: 3, amount: 150000, transaction_date: "2026-10-29", payment_method: "Chuyển khoản", description: "", member_id: 7 });
  const chi = buildTransactionPayload("chi", { fee_type_id: 4, amount: "200000", description: "Nước", transaction_date: "2026-10-28" }, today);
  assert.deepEqual(chi, { fee_type_id: 4, amount: 200000, transaction_date: "2026-10-28", payment_method: "Tiền mặt", description: "Nước" });
  const rows = summarizeTransaction("thu", { fee_type_name: "Phí tháng", amount: 150000, transaction_date: "2026-10-29", payment_method: "Tiền mặt" });
  assert.equal(rows[0][1], "Phí tháng"); assert.equal(rows[1][1], formatVnd(150000)); assert.equal(rows[2][1], "— không gắn —"); assert.equal(rows[3][1], "29/10/2026");
});

test("normText + feeDefault: bỏ dấu; mặc định 0/null → null", () => {
  assert.equal(normText("Nước uống Đá"), "nuoc uong da");
  assert.equal(feeDefault({ default_amount: "0" }), null);
  assert.equal(feeDefault({ default_amount: null }), null);
  assert.equal(feeDefault({ default_amount: "500000" }), 500000);
});

test("đợt 2: buildMemberPayload, summarizeMember, buildFeeTypePayload, normalizePhone", async () => {
  const { buildMemberPayload, summarizeMember, buildFeeTypePayload, normalizePhone, statusLabel } = await import("./clubBot.js");
  const today = new Date(2026, 9, 29);
  assert.deepEqual(buildMemberPayload({ full_name: " An ", rank: "B", phone: "0909", status: "active" }, today), { full_name: "An", status: "active", join_date: "2026-10-29", phone: "0909", rank: "B" });
  assert.deepEqual(buildMemberPayload({ full_name: "Bình", join_date: "2026-01-02" }, today), { full_name: "Bình", status: "active", join_date: "2026-01-02" });
  assert.equal(summarizeMember({ full_name: "An", status: "suspended" })[4][1], "Tạm ngưng");
  assert.deepEqual(buildFeeTypePayload({ name: " Nước ", type: "expense", default_amount: 0 }), { name: "Nước", type: "expense" });
  assert.deepEqual(buildFeeTypePayload({ name: "Phí", type: "income", default_amount: 150000 }), { name: "Phí", type: "income", default_amount: 150000 });
  assert.equal(normalizePhone("0909 123 456"), "0909123456");
  assert.equal(normalizePhone("12"), null);
  assert.equal(statusLabel("inactive"), "Không hoạt động");
});

test("thời gian: toDate coi chuỗi không hậu tố là UTC; fmtClock/fmtDay/fmtStamp/dayKey", async () => {
  const { toDate, fmtClock, fmtDay, fmtStamp, dayKey } = await import("./clubBot.js");
  const d = new Date(2026, 9, 29, 8, 5, 9);
  assert.equal(fmtClock(d), "08:05:09"); assert.equal(fmtDay(d), "29/10/2026"); assert.equal(fmtStamp(d), "08:05:09 29/10/2026"); assert.equal(dayKey(d), "2026-10-29");
  assert.equal(toDate("2026-10-29T01:00:00").getTime(), Date.UTC(2026, 9, 29, 1, 0, 0));
  assert.equal(toDate("2026-10-29T01:00:00Z").getTime(), Date.UTC(2026, 9, 29, 1, 0, 0));
  assert.equal(fmtStamp(null), "");
});
