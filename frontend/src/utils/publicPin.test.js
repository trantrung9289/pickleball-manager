// Chạy: npm test (node --test). Mã PIN link công khai: kiểm tra định dạng, đọc mã lỗi 401.
import test from "node:test";
import assert from "node:assert/strict";
import { isValidPin, pinErrorCode, pinKey } from "./publicPin.js";

test("isValidPin: 4 hoặc 6 chữ số", () => {
  assert.equal(isValidPin("1234"), true);
  assert.equal(isValidPin("123456"), true);
  assert.equal(isValidPin("12345"), false);
  assert.equal(isValidPin("12ab"), false);
  assert.equal(isValidPin(""), false);
});

test("pinErrorCode: chỉ 401 có detail.code", () => {
  assert.equal(pinErrorCode({ response: { status: 401, data: { detail: { code: "pin_required" } } } }), "pin_required");
  assert.equal(pinErrorCode({ response: { status: 401, data: { detail: "Unauthorized" } } }), null);
  assert.equal(pinErrorCode({ response: { status: 404, data: { detail: { code: "x" } } } }), null);
  assert.equal(pinKey("abc"), "public_pin:abc");
});
