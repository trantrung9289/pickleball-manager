/**
 * StatCard — ô số liệu dùng chung (lớp 2): nhãn nhỏ, số lớn, tuỳ chọn "/ tổng" + thanh tiến độ, dòng phụ.
 * tone đổi màu số + khối icon: ok | warn | danger | info | brand | ink (mặc định). Không dùng antd Statistic để kiểm soát cỡ/màu theo token.
 * 2026-10-27: hiệu ứng kính (lớp .ui-stat-card trong index.css: nền mờ + backdrop-filter, nhấc 2px khi rê chuột, tắt khi
 * prefers-reduced-motion), khối icon tô màu theo tone ở bên phải (chỉ khi không compact), StatCardSkeleton khi đang tải.
 * Props: { title, value, total?, note?, tone?, icon?, progress? (mặc định true khi có total), compact?, glass? (mặc định true) }
 */
import { Card, Progress, Typography, Skeleton } from "antd";

const { Text } = Typography;
const TONE_VAR = { ok: "--ok", warn: "--warn", danger: "--danger", info: "--info", brand: "--brand", ink: "--ink" };
// Khối icon: nền "soft" + chữ "strong" cùng tone; tone ink (mặc định) dùng màu thương hiệu để khối không xám xịt
const ICON_VARS = (tone) => {
  const t = tone === "ink" || !TONE_VAR[tone] ? "brand" : tone;
  return { background: `var(--${t}-soft)`, color: `var(--${t}-strong)` };
};

export default function StatCard({ title, value, total, note, tone = "ink", icon, progress, compact = false, glass = true, style }) {
  const hasTotal = total !== undefined && total !== null;
  const pct = hasTotal && total > 0 ? Math.round((Number(value) / Number(total)) * 100) : 0;
  const showBar = progress ?? hasTotal;
  const iconBlock = icon && !compact;
  return (
    <Card size="small" className={glass ? "ui-stat-card" : undefined} style={{ height: "100%", ...style }}
      styles={{ body: { padding: compact ? "10px 12px" : "12px 16px" } }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text type="secondary" ellipsis style={{ fontSize: 12, display: "block", marginBottom: 2 }}>
            {icon && !iconBlock && <span style={{ marginRight: 6 }}>{icon}</span>}{title}
          </Text>
          <div style={{ fontSize: compact ? 22 : 26, fontWeight: 700, lineHeight: 1.15, color: `var(${TONE_VAR[tone] || "--ink"})`, fontVariantNumeric: "tabular-nums" }}>
            {value ?? "—"}
            {hasTotal && <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500 }}> / {total}</span>}
          </div>
          {showBar && hasTotal && (
            <Progress percent={pct} size="small" showInfo={false} strokeColor={pct >= 100 ? "var(--ok)" : "var(--brand)"} style={{ margin: "4px 0 0" }} />
          )}
          {note && <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 2 }}>{note}</Text>}
        </div>
        {iconBlock && (
          <div aria-hidden="true" style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, ...ICON_VARS(tone) }}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Khung chờ cùng kích thước StatCard: dùng khi dữ liệu chưa về để bố cục không nhảy. */
export function StatCardSkeleton({ compact = false, style }) {
  return (
    <Card size="small" className="ui-stat-card" aria-busy="true" aria-label="Đang tải" style={{ height: "100%", ...style }}
      styles={{ body: { padding: compact ? "10px 12px" : "12px 16px" } }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Skeleton active title={{ width: 96 }} paragraph={{ rows: 1, width: ["60%"] }} />
        </div>
        {!compact && <Skeleton.Avatar active shape="square" size={44} style={{ borderRadius: 12 }} />}
      </div>
    </Card>
  );
}
