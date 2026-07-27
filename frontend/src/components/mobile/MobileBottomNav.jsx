import React from "react";
import { AppstoreOutlined } from "@ant-design/icons";

export default function MobileBottomNav({ items, current, onSelect, onMore, moreActive }) {
  const tabs = [
    ...items.map((it) => ({ ...it, type: "page" })),
    ...(onMore ? [{ key: "__more__", label: "Thêm", icon: <AppstoreOutlined />, type: "more" }] : []),
  ];

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: "#fff",
        borderTop: "1px solid #d9d9d9",
        boxShadow: "0 -2px 12px rgba(0,0,0,0.10)",
        display: "flex",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.type === "more" ? moreActive : current === tab.key && !moreActive;
        return (
          <button
            key={tab.key}
            onClick={() => (tab.type === "more" ? onMore() : onSelect(tab.key))}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              padding: "6px 0 8px",
              minHeight: 58,
              color: active ? "#1677ff" : "#434343",
              transition: "color 0.15s",
              position: "relative",
            }}
          >
            {active && (
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 32,
                  height: 3,
                  borderRadius: "0 0 3px 3px",
                  background: "#1677ff",
                }}
              />
            )}
            <span style={{ fontSize: 24, lineHeight: 1, display: "flex" }}>
              {tab.icon}
            </span>
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, lineHeight: 1.2 }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
