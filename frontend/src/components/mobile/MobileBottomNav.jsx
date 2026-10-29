/**
 * MobileBottomNav — thanh điều hướng dưới cùng trên mobile (admin + trang public).
 * 2026-10-29: màu theo biến CSS (--surface/--line/--brand/--muted) → theo màu thương hiệu CLB và chế độ tối/Galaxy (index.css .ui-bottom-nav).
 */
import { AppstoreOutlined } from "@ant-design/icons";

export default function MobileBottomNav({ items, current, onSelect, onMore, moreActive }) {
  const tabs = [
    ...items.map((it) => ({ ...it, type: "page" })),
    ...(onMore ? [{ key: "__more__", label: "Thêm", icon: <AppstoreOutlined />, type: "more" }] : []),
  ];

  return (
    <nav className="ui-bottom-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1000, display: "flex", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      {tabs.map((tab) => {
        const active = tab.type === "more" ? moreActive : current === tab.key && !moreActive;
        return (
          <button
            key={tab.key}
            type="button"
            className={`ui-bottom-nav__item${active ? " is-active" : ""}`}
            onClick={() => (tab.type === "more" ? onMore() : onSelect(tab.key))}
            aria-current={active ? "page" : undefined}
          >
            {active && <span className="ui-bottom-nav__bar" />}
            <span style={{ fontSize: 24, lineHeight: 1, display: "flex" }}>{tab.icon}</span>
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, lineHeight: 1.2 }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
