/** RobotIcon — mặt robot AI (SVG thuần, theo currentColor, cỡ 1em) dùng cho nút nổi và tiêu đề BOT CLB (2026-10-29). */
export default function RobotIcon({ size = "1em", style, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"
      style={{ display: "inline-block", verticalAlign: "-0.125em", ...style }} {...rest}>
      {/* ăng-ten */}
      <circle cx="32" cy="7" r="4" fill="currentColor" />
      <rect x="30" y="10" width="4" height="7" rx="2" fill="currentColor" />
      {/* tai */}
      <rect x="3" y="28" width="7" height="14" rx="3" fill="currentColor" />
      <rect x="54" y="28" width="7" height="14" rx="3" fill="currentColor" />
      {/* đầu */}
      <rect x="11" y="17" width="42" height="38" rx="11" stroke="currentColor" strokeWidth="4" />
      {/* mắt */}
      <circle cx="24" cy="34" r="5" fill="currentColor" />
      <circle cx="40" cy="34" r="5" fill="currentColor" />
      <circle cx="25.5" cy="32.5" r="1.6" fill="#fff" opacity="0.9" />
      <circle cx="41.5" cy="32.5" r="1.6" fill="#fff" opacity="0.9" />
      {/* miệng cười */}
      <path d="M23 44.5c2.5 3.2 5.5 4.8 9 4.8s6.5-1.6 9-4.8" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}
