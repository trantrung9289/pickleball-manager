import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { theme as antdTheme } from "antd";
import { brandPalette, cssVariables, SEMANTIC } from "../utils/color";

// Lớp 1 đổi giao diện (2026-10-26, mẫu FIS + macOS): hai chế độ sáng/tối, MÀU THƯƠNG HIỆU theo CLB đang chọn
// (App.jsx gọi setBrandColor từ selectedClub.brand_color), thanh bên TRUNG TÍNH (mục chọn nền nhạt chữ đậm, không tô kín),
// token ngữ nghĩa có bản nhạt. Phông Be Vietnam Pro tải về (fonts.css). THEMES + useAppTheme cùng file là chủ đích.
const FONT = "'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// eslint-disable-next-line react-refresh/only-export-components
export const MODES = {
  "ai-minimalist": { name: "ai-minimalist", label: "Sáng", icon: "☀️", dark: false },
  "ai-inspired": { name: "ai-inspired", label: "Tối", icon: "🌙", dark: true },
};

/** Dựng cấu hình theme từ chế độ + màu thương hiệu. Xuất ra để test / bản in dùng lại. */
// eslint-disable-next-line react-refresh/only-export-components
export function buildTheme(modeName, brandColor) {
  const mode = MODES[modeName] || MODES["ai-minimalist"];
  const dark = mode.dark;
  const p = brandPalette(brandColor, dark);
  const s = dark ? SEMANTIC.dark : SEMANTIC.light;
  return {
    ...mode,
    brand: p,
    menuTheme: "light",            // Menu light ở cả hai chế độ — màu lấy từ token components.Menu bên dưới
    sidebar: s.sidebar, sidebarText: s.sidebarText, sidebarSubText: s.sidebarMuted, sidebarBorder: s.sidebarLine,
    sidebarActive: p.brandSoft, avatar: p.brand,
    cssVars: cssVariables(brandColor, dark),
    antd: {
      algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: p.brand, colorPrimaryHover: p.brandHover, colorLink: p.brandStrong, colorLinkHover: p.brandHover,
        colorSuccess: s.ok, colorWarning: s.warn, colorError: s.danger, colorInfo: s.info,
        colorBgBase: s.bg, colorBgContainer: s.surface, colorBgLayout: s.bg, colorBgElevated: s.surface,
        colorText: s.ink, colorTextSecondary: s.muted, colorBorder: s.line, colorBorderSecondary: s.line,
        borderRadius: 8, borderRadiusLG: 10, borderRadiusSM: 6,
        boxShadow: dark ? "0 1px 2px rgba(0,0,0,.4)" : "0 1px 2px rgba(16,24,40,.06)",
        boxShadowSecondary: dark ? "0 4px 16px rgba(0,0,0,.45)" : "0 4px 16px rgba(16,24,40,.08)",
        fontFamily: FONT,
        motionDurationMid: "0.15s", motionDurationSlow: "0.2s",
      },
      components: {
        Menu: {
          itemBg: s.sidebar, subMenuItemBg: s.sidebar, itemColor: s.sidebarText, itemHoverBg: dark ? "#1E232B" : "#E9EBEF",
          itemSelectedBg: p.brandSoft, itemSelectedColor: p.brandStrong, itemBorderRadius: 8, itemMarginInline: 8,
        },
        Button: { primaryShadow: "none", defaultShadow: "none", dangerShadow: "none" },
        Card: { boxShadowTertiary: "none" },
        Tabs: { inkBarColor: p.brand, itemSelectedColor: p.brandStrong, itemHoverColor: p.brandStrong },
        Segmented: { itemSelectedBg: s.surface, trackBg: dark ? "#2A313C" : "#E9EBEF" },
        Table: { headerBg: dark ? "#1A1F27" : "#F8F9FB", headerColor: s.muted },
      },
    },
  };
}

// Tương thích ngược: mã cũ đọc THEMES[name].label/icon
export const THEMES = MODES;

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const saved = localStorage.getItem("appTheme");
  const [themeName, setThemeNameState] = useState(MODES[saved] ? saved : "ai-minimalist");
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
    root.dataset.theme = themeConfig.dark ? "dark" : "light";
    document.body.style.background = themeConfig.cssVars["--bg"];
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
