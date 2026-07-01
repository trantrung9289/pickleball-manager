import React, { createContext, useContext, useState, useMemo } from "react";
import { theme as antdTheme } from "antd";

export const THEMES = {
  "ai-minimalist": {
    name: "ai-minimalist",
    label: "Sáng",
    icon: "☀️",
    menuTheme: "light",
    sidebarText: "#1A2E3A",
    sidebarSubText: "#5A7A8A",
    sidebarBorder: "rgba(0,0,0,0.06)",
    antd: {
      algorithm: antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: "#27A063",
        colorSuccess: "#27A063",
        colorError: "#E03E3E",
        colorWarning: "#D97706",
        colorBgBase: "#F7F9FC",
        colorBgContainer: "#FFFFFF",
        colorBgLayout: "#F7F9FC",
        colorBgElevated: "#FFFFFF",
        colorText: "#1A2E3A",
        colorTextSecondary: "#5A7A8A",
        colorBorder: "#E0EAE8",
        colorBorderSecondary: "#EBF0F2",
        borderRadius: 8,
        borderRadiusLG: 12,
        borderRadiusSM: 6,
        boxShadow: "0 2px 12px rgba(0, 60, 30, 0.08)",
        fontFamily: "'Outfit', system-ui, -apple-system, sans-serif",
      },
    },
    sidebar: "#EEF4F1",
    sidebarActive: "#27A063",
    avatar: "#27A063",
  },
  "ai-inspired": {
    name: "ai-inspired",
    label: "Tối",
    icon: "🌙",
    menuTheme: "dark",
    sidebarText: "#EAEDF2",
    sidebarSubText: "#8899AA",
    sidebarBorder: "#2A313C",
    antd: {
      algorithm: antdTheme.darkAlgorithm,
      token: {
        colorPrimary: "#27A063",
        colorSuccess: "#27A063",
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
        borderRadius: 8,
        borderRadiusLG: 12,
        borderRadiusSM: 6,
        boxShadow: "0 2px 16px rgba(0, 0, 0, 0.4)",
        fontFamily: "'Outfit', system-ui, -apple-system, sans-serif",
      },
    },
    sidebar: "#111419",
    sidebarActive: "#27A063",
    avatar: "#27A063",
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
