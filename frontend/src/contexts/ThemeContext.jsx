import React, { createContext, useContext, useState, useMemo } from "react";
import { theme as antdTheme } from "antd";

export const THEMES = {
  "ai-minimalist": {
    name: "ai-minimalist",
    label: "AI Minimalist",
    icon: "✨",
    menuTheme: "light",
    sidebarText: "#1A2E3A",
    sidebarSubText: "#5A7A8A",
    sidebarBorder: "rgba(0,0,0,0.06)",
    antd: {
      algorithm: antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: "#2BA56C",
        colorSuccess: "#34A853",
        colorError: "#EA4335",
        colorWarning: "#F59E0B",
        colorBgBase: "#F7F9FC",
        colorBgContainer: "#FFFFFF",
        colorBgLayout: "#F7F9FC",
        colorBgElevated: "#FFFFFF",
        colorText: "#1A2E3A",
        colorTextSecondary: "#5A7A8A",
        colorBorder: "#E8F0F0",
        colorBorderSecondary: "#EBF0F2",
        borderRadius: 16,
        borderRadiusLG: 20,
        borderRadiusSM: 10,
        boxShadow: "0 2px 16px rgba(0, 20, 30, 0.06)",
        fontFamily: "Inter, 'SF Pro Display', system-ui, -apple-system, sans-serif",
      },
    },
    sidebar: "#EEF4F1",
    sidebarActive: "#2BA56C",
    avatar: "#2BA56C",
  },
  "ai-inspired": {
    name: "ai-inspired",
    label: "AI Inspired",
    icon: "🔮",
    menuTheme: "dark",
    sidebarText: "#EAEDF2",
    sidebarSubText: "#8899AA",
    sidebarBorder: "#2A313C",
    antd: {
      algorithm: antdTheme.darkAlgorithm,
      token: {
        colorPrimary: "#2DD4BF",
        colorSuccess: "#4ADE80",
        colorError: "#F87171",
        colorWarning: "#FB923C",
        colorInfo: "#60A5FA",
        colorBgBase: "#14181F",
        colorBgContainer: "#1E232B",
        colorBgLayout: "#14181F",
        colorBgElevated: "#252B35",
        colorText: "#EAEDF2",
        colorTextSecondary: "#8899AA",
        colorBorder: "#2A313C",
        colorBorderSecondary: "#2C3440",
        borderRadius: 16,
        borderRadiusLG: 20,
        borderRadiusSM: 10,
        boxShadow: "0 2px 16px rgba(0,0,0,0.5)",
        fontFamily: "Inter, 'SF Pro Display', system-ui, -apple-system, sans-serif",
      },
    },
    sidebar: "#111419",
    sidebarActive: "#2DD4BF",
    avatar: "#2DD4BF",
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const saved = localStorage.getItem("appTheme");
  const [themeName, setThemeNameState] = useState(
    THEMES[saved] ? saved : "ai-minimalist"
  );

  const setThemeName = (name) => {
    if (!THEMES[name]) return;
    localStorage.setItem("appTheme", name);
    setThemeNameState(name);
  };

  const themeConfig = useMemo(() => THEMES[themeName], [themeName]);

  return (
    <ThemeContext.Provider value={{ themeName, setThemeName, themeConfig }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
