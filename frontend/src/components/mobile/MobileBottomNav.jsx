import React from "react";
import { MoreOutlined } from "@ant-design/icons";

/**
 * Thanh điều hướng dưới cùng cho mobile.
 * Wire trực tiếp vào state navigation hiện có (current/onSelect) — KHÔNG dùng react-router.
 *
 * Props:
 *  - items: [{ key, label, icon }]  — các tab chính (tối đa 4)
 *  - current: string                — key trang đang chọn
 *  - onSelect: (key) => void
 *  - onMore: () => void             — mở sheet "Thêm"
 *  - moreActive: boolean            — sheet đang mở / trang hiện tại nằm trong "Thêm"
 */
export default function MobileBottomNav({ items, current, onSelect, onMore, moreActive }) {
  const tabs = [
    ...items.map((it) => ({ ...it, type: "page" })),
    { key: "__more__", label: "Thêm", icon: <MoreOutlined />, type: "more" },
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
        borderTop: "1px solid #f0f0f0",
        boxShadow: "0 -2px 8px rgba(0,0,0,0.06)",
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
              gap: 2,
              padding: "8px 0",
              minHeight: 56,
              color: active ? "#1677ff" : "#8c8c8c",
              transition: "color 0.2s",
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 400, lineHeight: 1.2 }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
