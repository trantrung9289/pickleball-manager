import { useSyncExternalStore } from "react";
import { readZoom, saveZoom, stepZoom, ZOOM_DEFAULT } from "../utils/zoom";

// Một mức chung cho mọi sơ đồ nhánh đang mở (kể cả hai sơ đồ cùng trang) — lưu ở localStorage.
let current = readZoom(typeof localStorage === "undefined" ? null : localStorage);
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function setZoom(v) {
  const next = Math.abs(v - current) < 1e-9 ? current : v;
  if (next === current) return;
  current = next;
  saveZoom(typeof localStorage === "undefined" ? null : localStorage, next);
  listeners.forEach((fn) => fn());
}

export default function useBracketZoom() {
  const zoom = useSyncExternalStore(subscribe, () => current, () => ZOOM_DEFAULT);
  return {
    zoom,
    zoomIn: () => setZoom(stepZoom(current, 1)),
    zoomOut: () => setZoom(stepZoom(current, -1)),
    reset: () => setZoom(ZOOM_DEFAULT),
  };
}
