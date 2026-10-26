/**
 * StatusChip — chip trạng thái dùng chung (lớp 2 đổi giao diện, 2026-10-26): nền nhạt + chữ đậm cùng họ màu,
 * LUÔN có chữ (không báo trạng thái bằng màu đơn thuần), tuỳ chọn chấm tròn (dot) cho "đang diễn ra".
 * tone: ok | warn | danger | info | brand | neutral — màu lấy từ biến CSS của ThemeContext (sáng/tối tự đổi).
 */
const TONES = {
  ok: ["--ok-soft", "--ok-strong"], warn: ["--warn-soft", "--warn-strong"], danger: ["--danger-soft", "--danger-strong"],
  info: ["--info-soft", "--info-strong"], brand: ["--brand-soft", "--brand-strong"], neutral: ["--line", "--muted"],
};

export default function StatusChip({ tone = "neutral", dot = false, pulse = false, size = "sm", style, children, title }) {
  const [bg, fg] = TONES[tone] || TONES.neutral;
  const small = size === "sm";
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
      padding: small ? "1px 7px" : "3px 10px", borderRadius: 999, fontSize: small ? 11.5 : 12.5, fontWeight: 600, lineHeight: small ? "18px" : "20px",
      background: `var(${bg})`, color: `var(${fg})`, ...style,
    }}>
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor", animation: pulse ? "ui-pulse 1.4s ease-in-out infinite" : undefined }} />
      )}
      {children}
    </span>
  );
}
