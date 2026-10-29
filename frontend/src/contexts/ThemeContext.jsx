import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { theme as antdTheme } from "antd";
import { brandPalette, cssVariables, semanticFor } from "../utils/color";

// Lớp 1 đổi giao diện (2026-10-26): hai chế độ sáng/tối, MÀU THƯƠNG HIỆU theo CLB đang chọn
// (App.jsx gọi setBrandColor từ selectedClub.brand_color), thanh bên TRUNG TÍNH (mục chọn nền nhạt chữ đậm, không tô kín),
// token ngữ nghĩa có bản nhạt. Phông Be Vietnam Pro tải về (fonts.css). THEMES + useAppTheme cùng file là chủ đích.
const FONT = "'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Mặc định toàn hệ thống (quyết định người dùng 2026-10-29): GALAXY cho thiết bị chưa chọn chế độ (admin, trang public, CLB mới).
// Giao diện lưu theo THIẾT BỊ (localStorage appTheme), không theo CLB. index.html có script đặt data-theme/data-mode trước khi React chạy → không loé nền trắng.
export const DEFAULT_MODE = "galaxy";

// eslint-disable-next-line react-refresh/only-export-components
export const MODES = {
  "ai-minimalist": { name: "ai-minimalist", label: "Sáng", icon: "☀️", dark: false, palette: "light" },
  "ai-inspired": { name: "ai-inspired", label: "Tối", icon: "🌙", dark: true, palette: "dark" },
  // Phương án A (2026-10-28): chế độ thứ ba kiểu "Galaxy" — nền tinh vân, thẻ kính blur mạnh, viền sáng; màu CLB vẫn là màu nhấn
  galaxy: { name: "galaxy", label: "Galaxy", icon: "🌌", dark: true, palette: "galaxy" },
};

/** Dựng cấu hình theme từ chế độ + màu thương hiệu. Xuất ra để test / bản in dùng lại. */
// eslint-disable-next-line react-refresh/only-export-components
export function buildTheme(modeName, brandColor) {
  const mode = MODES[modeName] || MODES[DEFAULT_MODE];
  const dark = mode.dark;
  const galaxy = mode.palette === "galaxy";
  const s = semanticFor(mode.palette);
  const p = brandPalette(brandColor, dark, galaxy ? s.surface : null);
  return {
    ...mode,
    brand: p,
    menuTheme: "light",            // Menu light ở cả hai chế độ — màu lấy từ token components.Menu bên dưới
    sidebar: s.sidebar, sidebarText: s.sidebarText, sidebarSubText: s.sidebarMuted, sidebarBorder: s.sidebarLine,
    sidebarActive: p.brandSoft, avatar: p.brand,
    cssVars: cssVariables(brandColor, mode.palette),
    antd: {
      algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: p.brand, colorPrimaryHover: p.brandHover, colorLink: p.brandStrong, colorLinkHover: p.brandHover,
        colorSuccess: s.ok, colorWarning: s.warn, colorError: s.danger, colorInfo: s.info,
        colorBgBase: s.bg, colorBgContainer: s.surface, colorBgLayout: s.bg, colorBgElevated: s.surface,
        colorText: s.ink, colorTextSecondary: s.muted, colorBorder: s.line, colorBorderSecondary: s.line,
        borderRadius: galaxy ? 12 : 8, borderRadiusLG: galaxy ? 16 : 10, borderRadiusSM: galaxy ? 8 : 6,
        boxShadow: dark ? "0 1px 2px rgba(0,0,0,.4)" : "0 1px 2px rgba(16,24,40,.06)",
        boxShadowSecondary: galaxy ? "0 12px 40px rgba(0,0,0,.55)" : dark ? "0 4px 16px rgba(0,0,0,.45)" : "0 4px 16px rgba(16,24,40,.08)",
        fontFamily: FONT,
        motionDurationMid: "0.15s", motionDurationSlow: "0.2s",
      },
      components: {
        Menu: {
          itemBg: s.sidebar, subMenuItemBg: s.sidebar, itemColor: s.sidebarText, itemHoverBg: galaxy ? "#1A2038" : dark ? "#1E232B" : "#E9EBEF",
          itemSelectedBg: p.brandSoft, itemSelectedColor: p.brandStrong, itemBorderRadius: 8, itemMarginInline: 8,
        },
        Button: { primaryShadow: "none", defaultShadow: "none", dangerShadow: "none" },
        Card: { boxShadowTertiary: "none" },
        Tabs: { inkBarColor: p.brand, itemSelectedColor: p.brandStrong, itemHoverColor: p.brandStrong },
        Segmented: { itemSelectedBg: s.surface, trackBg: galaxy ? "#232A45" : dark ? "#2A313C" : "#E9EBEF" },
        Table: { headerBg: galaxy ? "#1C2238" : dark ? "#1A1F27" : "#F8F9FB", headerColor: s.muted },
      },
    },
  };
}

// Tương thích ngược: mã cũ đọc THEMES[name].label/icon
export const THEMES = MODES;

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const saved = localStorage.getItem("appTheme");
  const [themeName, setThemeNameState] = useState(MODES[saved] ? saved : DEFAULT_MODE);
  const [brandColor, setBrandColor] = useState(null);   // App.jsx đặt theo CLB đang chọn; null = mặc định

  const setThemeName = (name) => {
    if (!MODES[name]) return;
    localStorage.setItem("appTheme", name);
    setThemeNameState(name);
  };

  const themeConfig = useMemo(() => buildTheme(themeName, brandColor), [themeName, brandColor]);

  // Biến CSS lên :root để CSS thuần / bản in dùng cùng bộ màu
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(themeConfig.cssVars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.theme = themeConfig.dark ? "dark" : "light";   // CSS tối dùng chung cho Tối + Galaxy
    root.dataset.mode = themeConfig.palette;                     // "galaxy" → nền tinh vân + kính mạnh (index.css)
    document.body.style.background = themeConfig.palette === "galaxy" ? "" : themeConfig.cssVars["--bg"];
    root.style.background = themeConfig.palette === "galaxy" ? "" : themeConfig.cssVars["--bg"];   // index.html đặt sẵn trước khi mount; Galaxy để CSS lo
  }, [themeConfig]);

  return (
    <ThemeContext.Provider value={{ themeName, setThemeName, themeConfig, brandColor, setBrandColor }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppTheme() {
  return useContext(ThemeContext);
}
