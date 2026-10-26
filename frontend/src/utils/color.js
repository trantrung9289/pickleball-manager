// Hàm thuần về màu — lớp 1 đổi giao diện (2026-10-26). Không import React/antd để chạy được bằng node --test.
// Một màu thương hiệu → bộ biến: brand (đủ tương phản 4.5 với chữ trắng), brandStrong (chữ trên nền nhạt),
// brandSoft (nền chip), brandHover. Bảng màu ngữ nghĩa cố định (đã chỉnh tương phản) cho sáng / tối.

export const DEFAULT_BRAND = "#1F8A52";   // xanh lá CLB, tối hơn #27A063 một bậc để chữ trắng đạt ≥ 4.5

export const isHex = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export const rgbToHex = (r, g, b) => "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("").toUpperCase();

export function luminance(hex) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** Tỉ lệ tương phản WCAG giữa hai màu. */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
/** Trộn `hex` với `target` theo tỉ lệ t (0 → hex, 1 → target). */
export function mix(hex, target, t) {
  const a = hexToRgb(hex), b = hexToRgb(target);
  return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}
/** Tối dần màu cho tới khi chữ `text` trên nó đạt tương phản `min` (tối đa 20 bước 4%). */
export function ensureContrast(hex, text = "#FFFFFF", min = 4.5) {
  let c = hex.toUpperCase();
  for (let i = 0; i < 20 && contrast(c, text) < min; i++) c = mix(c, "#000000", 0.04);
  return c;
}

/**
 * Bộ màu thương hiệu từ một màu gốc. Sáng: nền trắng → brand tối đủ tương phản, soft = 90% trắng, strong = chữ trên soft.
 * Tối: nền #1E232B → brand sáng hơn để nổi, soft = pha 80% nền, strong = brand sáng.
 */
export function brandPalette(input, dark = false) {
  const base = isHex(input) ? input.trim().toUpperCase() : DEFAULT_BRAND;
  if (!dark) {
    const brand = ensureContrast(base, "#FFFFFF", 4.5);
    const soft = mix(base, "#FFFFFF", 0.9);
    const strong = ensureContrast(mix(base, "#000000", 0.15), soft, 4.5);
    return { base, brand, brandHover: mix(brand, "#000000", 0.12), brandSoft: soft, brandStrong: strong, brandLine: mix(base, "#FFFFFF", 0.7) };
  }
  const surface = "#1E232B";
  let brand = base;
  for (let i = 0; i < 20 && contrast(brand, surface) < 4.5; i++) brand = mix(brand, "#FFFFFF", 0.06);
  const soft = mix(base, surface, 0.78);
  return { base, brand, brandHover: mix(brand, "#FFFFFF", 0.1), brandSoft: soft, brandStrong: ensureContrastLight(brand, soft), brandLine: mix(base, surface, 0.55) };
}
function ensureContrastLight(hex, bg, min = 4.5) {
  let c = hex;
  for (let i = 0; i < 20 && contrast(c, bg) < min; i++) c = mix(c, "#FFFFFF", 0.06);
  return c;
}

/** Màu ngữ nghĩa (đã chỉnh để chữ "strong" trên nền "soft" ≥ 4.5 và chữ trắng trên màu chính ≥ 4.5). */
export const SEMANTIC = {
  light: {
    ok: "#0B7A3A", okSoft: "#E6F5EC", okStrong: "#067A35",
    warn: "#B45309", warnSoft: "#FFF7E6", warnStrong: "#8A4B00",
    danger: "#B42318", dangerSoft: "#FEF3F2", dangerStrong: "#991B1B",
    info: "#0065B3", infoSoft: "#EAF3FB", infoStrong: "#004F8C",
    ink: "#1F2430", muted: "#5B6475", line: "#E3E6EC", bg: "#F5F6F8", surface: "#FFFFFF",
    sidebar: "#F3F4F6", sidebarText: "#1F2430", sidebarMuted: "#5B6475", sidebarLine: "#E3E6EC",
  },
  dark: {
    ok: "#34C26B", okSoft: "#163A26", okStrong: "#6EE7A0",
    warn: "#F59E0B", warnSoft: "#3D2A0C", warnStrong: "#FCD34D",
    danger: "#F87171", dangerSoft: "#3F1D1D", dangerStrong: "#FCA5A5",
    info: "#60A5FA", infoSoft: "#172A44", infoStrong: "#93C5FD",
    ink: "#EAEDF2", muted: "#9AA5B4", line: "#2A313C", bg: "#14181F", surface: "#1E232B",
    sidebar: "#15181D", sidebarText: "#EAEDF2", sidebarMuted: "#9AA5B4", sidebarLine: "#2A313C",
  },
};

/** Biến CSS đặt lên :root để component thuần (bản in, chip tự vẽ) dùng cùng màu với antd. */
export function cssVariables(brandColor, dark = false) {
  const p = brandPalette(brandColor, dark);
  const s = dark ? SEMANTIC.dark : SEMANTIC.light;
  return {
    "--brand": p.brand, "--brand-hover": p.brandHover, "--brand-soft": p.brandSoft, "--brand-strong": p.brandStrong, "--brand-line": p.brandLine,
    "--ok": s.ok, "--ok-soft": s.okSoft, "--ok-strong": s.okStrong,
    "--warn": s.warn, "--warn-soft": s.warnSoft, "--warn-strong": s.warnStrong,
    "--danger": s.danger, "--danger-soft": s.dangerSoft, "--danger-strong": s.dangerStrong,
    "--info": s.info, "--info-soft": s.infoSoft, "--info-strong": s.infoStrong,
    "--ink": s.ink, "--muted": s.muted, "--line": s.line, "--bg": s.bg, "--surface": s.surface,
  };
}

/** Bảng màu gợi ý trong bộ chọn màu thương hiệu. */
export const BRAND_PRESETS = [
  { label: "Xanh lá (mặc định)", value: DEFAULT_BRAND }, { label: "Cam", value: "#EC671C" }, { label: "Xanh dương", value: "#0065B3" },
  { label: "Tím", value: "#6D28D9" }, { label: "Đỏ", value: "#B42318" }, { label: "Xanh ngọc", value: "#0F766E" }, { label: "Xám than", value: "#334155" },
];
