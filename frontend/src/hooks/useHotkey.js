import { useEffect } from "react";

/**
 * @param {Record<string, () => void>} bindings - { "n": fn, "ctrl+d": fn, ... }
 * @param {boolean[]} deps
 */
export default function useHotkey(bindings, deps = []) {
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

      const fn = bindings[combo] ?? bindings[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(e); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, deps);
}
