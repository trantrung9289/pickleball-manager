/**
 * ScoreBox — cặp ô tỉ số lớn (lớp 2, mẫu FIS): bên thắng nền nhạt màu nhấn + chữ đậm, bên thua nền xám; chưa đấu "–".
 * Props: { a, b, winner (1|2|null), size: "lg"|"md"|"sm", live?: bool (viền chấm xanh dương), walkover?: bool }
 */
import StatusChip from "./StatusChip";

const SIZES = { lg: { w: 56, h: 44, fs: 24 }, md: { w: 42, h: 34, fs: 18 }, sm: { w: 32, h: 26, fs: 14 } };

function Box({ v, win, s, live }) {
  const empty = v === null || v === undefined;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: s.w, height: s.h, padding: "0 6px",
      borderRadius: 8, fontSize: s.fs, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1,
      background: win ? "var(--brand-soft)" : "var(--line)", color: win ? "var(--brand-strong)" : empty ? "var(--muted)" : "var(--ink)",
      border: live ? "1.5px dashed var(--info)" : "1.5px solid transparent",
    }}>
      {empty ? "–" : v}
    </span>
  );
}

export default function ScoreBox({ a, b, winner = null, size = "md", live = false, walkover = false, style }) {
  const s = SIZES[size] || SIZES.md;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...style }}>
      <Box v={a} win={winner === 1} s={s} live={live} />
      <span style={{ color: "var(--muted)", fontSize: s.fs - 6, fontWeight: 600 }}>–</span>
      <Box v={b} win={winner === 2} s={s} live={live} />
      {walkover && <StatusChip tone="warn">Xử thua</StatusChip>}
    </span>
  );
}
