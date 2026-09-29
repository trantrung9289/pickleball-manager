/**
 * DrawWheel — vòng quay SVG + CSS thuần (không dependency), dùng chung admin/public.
 * Kim cố định ở ĐỈNH; rotor quay theo chiều kim đồng hồ tới góc do targetRotation tính,
 * nên mọi máy nhận cùng (winnerId, spinKey, extraTurns) sẽ dừng ở cùng một quạt.
 * Props: items [{id,label,withdrawn?}], winnerId, spinKey, durationMs, revealAtMs (mốc client ms —
 * nếu có thì ưu tiên hơn durationMs), extraTurns, size, onSettled(winnerId).
 */
import { useCallback, useEffect, useRef } from "react";
import {
  sectorPath, sectorMidDeg, targetRotation, deterministicJitterDeg,
} from "../../utils/drawMath";

const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#eab308", "#ec4899", "#14b8a6", "#8b5cf6", "#ef4444"];
const WITHDRAWN_COLOR = "#94a3b8";
const MAX_LABEL = 14;
const LEGEND_THRESHOLD = 20; // n > 20 → quạt chỉ ghi số thứ tự, tên đưa ra chú giải bên ngoài

const shorten = (s, max = MAX_LABEL) => {
  const t = String(s ?? "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

export default function DrawWheel({
  items = [], winnerId = null, spinKey = null, durationMs = 5000, revealAtMs = null,
  extraTurns = 4, size = 360, onSettled,
}) {
  const n = items.length;
  const rotorRef = useRef(null);
  const degRef = useRef(0);          // góc tích luỹ — không reset giữa các lượt để quay liên tục
  const spinRef = useRef(null);      // { key, target, dur } của lượt đang/vừa quay — chống quay đúp khi re-render
  const settledKeyRef = useRef(null);
  const onSettledRef = useRef(onSettled);
  useEffect(() => { onSettledRef.current = onSettled; });

  const settle = useCallback((key, id) => {
    if (settledKeyRef.current === key) return;   // transitionend + timer dự phòng chỉ báo 1 lần
    settledKeyRef.current = key;
    onSettledRef.current?.(id);
  }, []);

  // Điều khiển rotor trực tiếp qua DOM (external system) thay vì state: không setState trong effect,
  // và chạy lại effect (StrictMode / re-render khi poll) không làm vòng quay khởi động lại.
  useEffect(() => {
    if (winnerId == null || spinKey == null) return undefined;
    const el = rotorRef.current;
    if (!el) return undefined;
    const reduced = prefersReducedMotion();
    let spin = spinRef.current;
    if (!spin || spin.key !== spinKey) {
      const idx = items.findIndex((it) => it.id === winnerId);
      // Thời lượng: ưu tiên mốc tuyệt đối revealAtMs (đồng bộ giờ server) — tính trong effect, không trong render
      const wanted = revealAtMs != null ? revealAtMs - Date.now() : durationMs;
      const instant = reduced || wanted <= 600 || idx < 0;
      const from = degRef.current;
      // Dữ liệu lệch (đội thắng không có trong pool hiển thị): không quay, vẫn báo xong để luồng reveal không kẹt
      const target = idx < 0 ? from : targetRotation(
        from, idx, n, extraTurns, deterministicJitterDeg(typeof spinKey === "number" ? spinKey : 0, n),
      );
      degRef.current = target;
      spin = { key: spinKey, target, dur: instant ? 0 : wanted, reduced };
      spinRef.current = spin;
      if (instant) {
        el.style.transition = "none";
        el.style.transform = `rotate(${target}deg)`;
      } else {
        // Chốt góc hiện tại rồi ép reflow để transition chạy từ đúng góc đó
        el.style.transition = "none";
        el.style.transform = `rotate(${from}deg)`;
        el.getBoundingClientRect();
        el.style.transition = `transform ${spin.dur}ms cubic-bezier(0.12, 0.8, 0.1, 1)`;
        el.style.transform = `rotate(${target}deg)`;
      }
    }
    // Timer dự phòng (transitionend không bắn khi tab ẩn / Safari cũ); reduced-motion chờ 300ms cho kịp nhìn
    const wait = spin.dur === 0 ? (spin.reduced ? 300 : 0) : spin.dur + 400;
    const t = setTimeout(() => settle(spinKey, winnerId), wait);
    return () => clearTimeout(t);
  }, [spinKey, winnerId, items, n, extraTurns, durationMs, revealAtMs, settle]);

  const handleTransitionEnd = (e) => {
    if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
    settle(spinKey, winnerId);
  };

  const useLegend = n > LEGEND_THRESHOLD;
  // Cỡ chữ theo số quạt (đơn vị viewBox); quạt càng hẹp chữ càng nhỏ
  const fontSize = Math.min(0.095, Math.max(0.04, ((2 * Math.PI * 0.6) / Math.max(n, 1)) * 0.45));
  const pointerSize = Math.max(10, Math.round(size / 26));

  return (
    <div style={{ width: size, maxWidth: "100%", margin: "0 auto" }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1" }}>
        {/* Rotor: quay bằng DIV bọc (transform trên <g> SVG không transition mượt trên Safari) */}
        <div
          ref={rotorRef}
          className="draw-wheel-rotor"
          onTransitionEnd={handleTransitionEnd}
          style={{ width: "100%", height: "100%" }}   /* transform/transition đặt qua ref trong effect */
        >
          <svg viewBox="-1.05 -1.05 2.1 2.1" width="100%" height="100%" style={{ display: "block" }} role="img"
            aria-label={n ? `Vòng quay ${n} đội` : "Vòng quay trống"}>
            <circle r="1.04" fill="#1e293b" />
            {n === 0 && (
              <text y="0.03" textAnchor="middle" fontSize="0.12" fill="#94a3b8">Hết đội</text>
            )}
            {items.map((it, i) => {
              const mid = sectorMidDeg(i, n);
              const a = mid - 90;
              const leftHalf = mid > 180;
              const fill = it.withdrawn ? WITHDRAWN_COLOR : COLORS[i % COLORS.length];
              const text = useLegend
                ? String(i + 1)
                : (it.withdrawn ? `${shorten(it.label, 9)} (bỏ giải)` : shorten(it.label));
              return (
                <g key={it.id}>
                  <path d={sectorPath(i, n, 1)} fill={fill} stroke="#0f172a" strokeWidth="0.008" />
                  <text
                    transform={`rotate(${a}) translate(0.96 0)${leftHalf ? " rotate(180)" : ""}`}
                    textAnchor={leftHalf ? "start" : "end"}
                    dominantBaseline="middle"
                    fontSize={fontSize}
                    fontWeight="600"
                    fill="#fff"
                    stroke="#0f172a" strokeWidth="0.012" paintOrder="stroke"
                    style={{ pointerEvents: "none", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}
                  >
                    {text}
                  </text>
                </g>
              );
            })}
            <circle r="0.11" fill="#f8fafc" stroke="#0f172a" strokeWidth="0.02" />
          </svg>
        </div>
        {/* Kim tam giác cố định, nằm NGOÀI div quay */}
        <div
          aria-hidden
          style={{
            position: "absolute", top: -Math.round(pointerSize * 0.6), left: "50%",
            transform: "translateX(-50%)", width: 0, height: 0,
            borderLeft: `${pointerSize}px solid transparent`,
            borderRight: `${pointerSize}px solid transparent`,
            borderTop: `${pointerSize * 2}px solid #fbbf24`,
            filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))",
          }}
        />
      </div>
      {useLegend && (
        <div style={{
          marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "2px 10px", fontSize: 12, lineHeight: 1.4,
        }}>
          {items.map((it, i) => (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 6, opacity: it.withdrawn ? 0.7 : 1 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2, flex: "0 0 auto",
                background: it.withdrawn ? WITHDRAWN_COLOR : COLORS[i % COLORS.length],
              }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {i + 1}. {it.label}{it.withdrawn ? " (bỏ giải)" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
