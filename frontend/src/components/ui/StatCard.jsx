/**
 * StatCard — ô số liệu dùng chung (lớp 2, mẫu FIS): nhãn nhỏ, số lớn, tuỳ chọn "/ tổng" + thanh tiến độ, dòng phụ.
 * tone đổi màu số: ok | warn | danger | info | brand | ink (mặc định). Không dùng antd Statistic để kiểm soát cỡ/màu theo token.
 * Props: { title, value, total?, note?, tone?, icon?, progress? (mặc định true khi có total), compact? }
 */
import { Card, Progress, Typography } from "antd";

const { Text } = Typography;
const TONE_VAR = { ok: "--ok", warn: "--warn", danger: "--danger", info: "--info", brand: "--brand", ink: "--ink" };

export default function StatCard({ title, value, total, note, tone = "ink", icon, progress, compact = false, style }) {
  const hasTotal = total !== undefined && total !== null;
  const pct = hasTotal && total > 0 ? Math.round((Number(value) / Number(total)) * 100) : 0;
  const showBar = progress ?? hasTotal;
  return (
    <Card size="small" style={{ height: "100%", ...style }} styles={{ body: { padding: compact ? "10px 12px" : "12px 16px" } }}>
      <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 2 }}>{icon && <span style={{ marginRight: 6 }}>{icon}</span>}{title}</Text>
      <div style={{ fontSize: compact ? 22 : 26, fontWeight: 700, lineHeight: 1.15, color: `var(${TONE_VAR[tone] || "--ink"})`, fontVariantNumeric: "tabular-nums" }}>
        {value}
        {hasTotal && <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500 }}> / {total}</span>}
      </div>
      {showBar && hasTotal && (
        <Progress percent={pct} size="small" showInfo={false} strokeColor={pct >= 100 ? "var(--ok)" : "var(--brand)"} style={{ margin: "4px 0 0" }} />
      )}
      {note && <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 2 }}>{note}</Text>}
    </Card>
  );
}
