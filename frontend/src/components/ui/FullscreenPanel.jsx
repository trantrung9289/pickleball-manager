import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Tooltip } from "antd";
import { FullscreenExitOutlined, FullscreenOutlined } from "@ant-design/icons";
import { useViewMode } from "../../contexts/ViewModeContext";

/**
 * Bảng/sơ đồ có nút "Toàn màn hình" (2026-10-30). Chỉ desktop + tablet — giao diện mobile trả nguyên children.
 *
 * Nội dung được vẽ MỘT LẦN vào một nút DOM riêng (host); phóng to chỉ chuyển host đó sang lớp phủ gắn vào <body>.
 * → không mount lại: giữ nguyên trang, sắp xếp, lọc, dòng mở rộng của bảng. Lớp phủ phải ở <body> vì .ant-card có
 * backdrop-filter (kiểu kính) — position: fixed đặt trong Card sẽ bị kẹt trong khung Card.
 *
 * Props: title (tiêu đề lớp phủ), toolbar (nút thêm cạnh nút toàn màn hình, vd điều khiển zoom), enabled (tắt = trả children).
 * z-index 960 < 1000: Modal/Popover/message antd (xem điểm số, chi tiết trận) vẫn nổi lên trên.
 */
// Esc đang dành cho lớp nổi nằm trên (Modal nhập điểm, Drawer, ô chọn đang xổ) — đừng thu nhỏ lớp phủ cùng lúc.
const OPEN_LAYER = ".ant-modal-wrap, .ant-drawer-open, .ant-select-open, .ant-dropdown:not(.ant-dropdown-hidden)";
const hasOpenLayer = () => [...document.querySelectorAll(OPEN_LAYER)].some((el) => getComputedStyle(el).display !== "none");

export default function FullscreenPanel({ title, toolbar, enabled = true, children }) {
  const { isMobileView } = useViewMode();
  const active = enabled && !isMobileView;
  const [full, setFull] = useState(false);
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "ui-fs-host";
    return el;
  });
  const slotRef = useRef(null);
  const bodyRef = useRef(null);
  const closeRef = useRef(null);

  useLayoutEffect(() => {
    if (!active) return;
    const parent = full ? bodyRef.current : slotRef.current;
    if (parent && host.parentNode !== parent) parent.appendChild(host);
  }, [active, full, host]);

  useEffect(() => () => host.remove(), [host]);

  useEffect(() => {
    if (!full) return undefined;
    const opener = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    // pha capture: chạy trước khi Modal kịp tự đóng nên còn thấy được nó đang mở
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented && !hasOpenLayer()) setFull(false); };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === "function") opener.focus();
    };
  }, [full]);

  // Hết quyền (đổi sang giao diện mobile) khi đang mở → đóng lớp phủ
  useEffect(() => {
    if (!active) setTimeout(() => setFull(false), 0);
  }, [active]);

  if (!active) return children;

  return (
    <div className="ui-fs">
      {!full && (
        <div className="ui-fs-bar">
          {toolbar}
          <Tooltip title="Toàn màn hình">
            <Button size="small" type="text" icon={<FullscreenOutlined />} aria-label="Toàn màn hình" onClick={() => setFull(true)} />
          </Tooltip>
        </div>
      )}
      <div ref={slotRef} />
      {createPortal(children, host)}
      {full && createPortal(
        <div className="ui-fs-overlay" role="dialog" aria-modal="true" aria-label={title || "Toàn màn hình"}>
          <div className="ui-fs-head">
            <b className="ui-fs-title">{title}</b>
            {toolbar}
            <Tooltip title="Thu nhỏ (Esc)">
              <Button ref={closeRef} size="small" icon={<FullscreenExitOutlined />} aria-label="Thu nhỏ" onClick={() => setFull(false)}>Thu nhỏ</Button>
            </Tooltip>
          </div>
          <div className="ui-fs-body" ref={bodyRef} />
        </div>,
        document.body,
      )}
    </div>
  );
}
