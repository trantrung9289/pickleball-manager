/**
 * StatCard — ô số liệu dùng chung (lớp 2): nhãn nhỏ, số lớn, tuỳ chọn "/ tổng" + thanh tiến độ, dòng phụ.
 * tone đổi màu số + khối icon: ok | warn | danger | info | brand | ink (mặc định). Không dùng antd Statistic để kiểm soát cỡ/màu theo token.
 * 2026-10-27: hiệu ứng kính (lớp .ui-stat-card trong index.css: nền mờ + backdrop-filter, nhấc 2px khi rê chuột, tắt khi
 * prefers-reduced-motion), khối icon 32px tô màu theo tone ở góc phải hàng tiêu đề (chỉ khi không compact; không đè lên số dài), StatCardSkeleton khi đang tải.
 * Props: { title, value, total?, note?, tone?, icon?, progress? (mặc định true khi có total), compact?, glass? (mặc định true) }
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Card, Progress, Typography, Skeleton } from "antd";

const { Text } = Typography;
const TONE_VAR = { ok: "--ok", warn: "--warn", danger: "--danger", info: "--info", brand: "--brand", ink: "--ink" };
// Khối icon: nền "soft" + chữ "strong" cùng tone; tone ink (mặc định) dùng màu thương hiệu để khối không xám xịt
const ICON_VARS = (tone) => {
  const t = tone === "ink" || !TONE_VAR[tone] ? "brand" : tone;
  return { background: `var(--${t}-soft)`, color: `var(--${t}-strong)` };
};

/** Co cỡ chữ từng bước 1px (max → min) cho tới khi nội dung không tràn bề rộng phần tử; đo lại khi đổi kích thước. */
function useFitFontSize(max, min, deps) {
  const ref = useRef(null);
  const [fontSize, setFontSize] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      let size = max;
      el.style.fontSize = `${size}px`;
      while (size > min && el.scrollWidth > el.clientWidth) { size -= 1; el.style.fontSize = `${size}px`; }
      setFontSize(size);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max, min, ...deps]);
  return { ref, fontSize };
}

export default function StatCard({ title, value, total, note, tone = "ink", icon, progress, compact = false, glass = true, style }) {
  const hasTotal = total !== undefined && total !== null;
  const pct = hasTotal && total > 0 ? Math.round((Number(value) / Number(total)) * 100) : 0;
  const showBar = progress ?? hasTotal;
  const iconBlock = icon && !compact;
  // Số dài (vd "32.900.000 đ") trên thẻ hẹp: tự co cỡ chữ theo bề rộng thật (ResizeObserver), không gãy dòng, tối thiểu 16px
  const baseSize = compact ? 22 : 26;
  const { ref: valueRef, fontSize } = useFitFontSize(baseSize, 16, [value, total, compact]);
  return (
    <Card size="small" className={glass ? "ui-stat-card" : undefined} style={{ height: "100%", ...style }}
      styles={{ body: { padding: compact ? "10px 12px" : "12px 16px" } }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 2 }}>
        <Text type="secondary" ellipsis style={{ fontSize: 12, display: "block", minWidth: 0, flex: 1 }}>
          {icon && !iconBlock && <span style={{ marginRight: 6 }}>{icon}</span>}{title}
        </Text>
        {iconBlock && (
          <div aria-hidden="true" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, ...ICON_VARS(tone) }}>
            {icon}
          </div>
        )}
      </div>
      <div ref={valueRef} style={{ fontSize, fontWeight: 700, lineHeight: 1.15, color: `var(${TONE_VAR[tone] || "--ink"})`, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden" }}>
        {value ?? "—"}
        {hasTotal && <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500 }}> / {total}</span>}
      </div>
      {showBar && hasTotal && (
        <Progress percent={pct} size="small" showInfo={false} strokeColor={pct >= 100 ? "var(--ok)" : "var(--brand)"} style={{ margin: "4px 0 0" }} />
      )}
      {note && <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 2 }}>{note}</Text>}
    </Card>
  );
}

/** Khung chờ cùng kích thước StatCard: dùng khi dữ liệu chưa về để bố cục không nhảy. */
export function StatCardSkeleton({ compact = false, style }) {
  return (
    <Card size="small" className="ui-stat-card" aria-busy="true" aria-label="Đang tải" style={{ height: "100%", ...style }}
      styles={{ body: { padding: compact ? "10px 12px" : "12px 16px" } }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Skeleton active title={{ width: 96 }} paragraph={false} style={{ flex: 1 }} />
        {!compact && <Skeleton.Avatar active shape="square" size={32} style={{ borderRadius: 10 }} />}
      </div>
      <Skeleton active title={{ width: "60%" }} paragraph={false} style={{ marginTop: 6 }} />
    </Card>
  );
}
