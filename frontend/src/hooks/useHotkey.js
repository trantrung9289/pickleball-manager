import { useEffect, useRef } from "react";

/**
 * Đăng ký phím tắt toàn cục. Object `bindings` có thể chứa closure đóng gói state/props
 * mới nhất của component gọi — hook lưu nó vào ref và cập nhật mỗi render, nên listener
 * (chỉ gắn 1 lần) luôn gọi đúng phiên bản mới nhất, không cần component tự khai deps
 * (trước đây phải tự liệt kê deps thủ công, dễ thiếu và dùng nhầm dữ liệu cũ — xem
 * lịch sử: 4 trang Members/Guests/FeeTypes/Transactions đều từng thiếu ít nhất 1 dependency).
 *
 * @param {Record<string, (e: KeyboardEvent) => void>} bindings - { "n": fn, "ctrl+d": fn, ... }
 */
export default function useHotkey(bindings) {
  const bindingsRef = useRef(bindings);
  // KHÔNG gán ref trong lúc render (React coi đó là thao tác không an toàn cho concurrent
  // rendering) — cập nhật trong effect chạy sau mỗi render, không cần mảng deps.
  useEffect(() => {
    bindingsRef.current = bindings;
  });

  useEffect(() => {
    const handler = (e) => {
      // Bỏ qua khi đang gõ trong input / textarea / select
      const tag = e.target.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.target.isContentEditable) return;

      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push("ctrl");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      parts.push(e.key.toLowerCase());
      const combo = parts.join("+");

      const fn = bindingsRef.current[combo] ?? bindingsRef.current[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(e); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // đăng ký listener đúng 1 lần; bindingsRef luôn trỏ tới bản mới nhất
}
