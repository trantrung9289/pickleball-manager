import React, { createContext, useContext, useState, useMemo } from "react";
import { theme as antdTheme } from "antd";

export const THEMES = {
  "sport-blue": {
    name: "sport-blue",
    label: "Sport Blue",
    icon: "🏆",
    antd: {
      algorithm: antdTheme.defaultAlgorithm,
      token: { colorPrimary: "#1677ff", colorSuccess: "#52c41a" },
    },
    sidebar: "#001529",
    sidebarActive: "#1677ff",
    avatar: "#1677ff",
  },
  "dark-pro": {
    name: "dark-pro",
    label: "Dark Pro",
    icon: "🌙",
    antd: {
      algorithm: antdTheme.darkAlgorithm,
      token: { colorPrimary: "#7c3aed", colorSuccess: "#34d399" },
    },
    sidebar: "#16162a",
    sidebarActive: "#7c3aed",
    avatar: "#7c3aed",
  },
  "nature-green": {
    name: "nature-green",
    label: "Nature Green",
    icon: "🌿",
    antd: {
      algorithm: antdTheme.defaultAlgorithm,
      token: { colorPrimary: "#059669", colorSuccess: "#10b981" },
    },
    sidebar: "#064e3b",
    sidebarActive: "#10b981",
    avatar: "#059669",
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const saved = localStorage.getItem("appTheme");
  const [themeName, setThemeNameState] = useState(
    THEMES[saved] ? saved : "sport-blue"
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
