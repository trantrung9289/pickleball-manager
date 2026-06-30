import React from "react";
import { Button, Dropdown, Space } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { useAppTheme, THEMES } from "../contexts/ThemeContext";

export default function ThemeSwitcher() {
  const { themeName, setThemeName, themeConfig } = useAppTheme();

  const items = Object.values(THEMES).map((t) => ({
    key: t.name,
    label: (
      <Space>
        <span>{t.icon}</span>
        <span>{t.label}</span>
        {themeName === t.name && <span style={{ color: "#1890ff" }}>✓</span>}
      </Space>
    ),
    onClick: () => setThemeName(t.name),
  }));

  return (
    <Dropdown menu={{ items }} placement="bottomRight" trigger={["click"]}>
      <Button
        type="text"
        size="small"
        style={{
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 8,
          color: "rgba(255,255,255,0.85)",
          background: "rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 10px",
          height: 30,
        }}
      >
        <span style={{ fontSize: 14 }}>{themeConfig.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{themeConfig.label}</span>
        <DownOutlined style={{ fontSize: 10 }} />
      </Button>
    </Dropdown>
  );
}
