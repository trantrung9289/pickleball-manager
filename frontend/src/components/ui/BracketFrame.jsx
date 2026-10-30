import { useEffect, useRef, useState } from "react";
import { Button, Space, Tooltip } from "antd";
import { ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import FullscreenPanel from "./FullscreenPanel";
import useBracketZoom from "../../hooks/useBracketZoom";
import { ZOOM_DEFAULT, ZOOM_STEPS } from "../../utils/zoom";

/** Nút − / % / + : bấm % để về 100%. */
function ZoomControls({ zoom, zoomIn, zoomOut, reset }) {
  return (
    <Space.Compact size="small">
      <Tooltip title="Thu nhỏ"><Button icon={<ZoomOutOutlined />} aria-label="Thu nhỏ sơ đồ" disabled={zoom <= ZOOM_STEPS[0]} onClick={zoomOut} /></Tooltip>
      <Tooltip title="Về 100%"><Button aria-label="Về 100%" onClick={reset} style={{ minWidth: 56 }} disabled={zoom === ZOOM_DEFAULT}>{Math.round(zoom * 100)}%</Button></Tooltip>
      <Tooltip title="Phóng to"><Button icon={<ZoomInOutlined />} aria-label="Phóng to sơ đồ" disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={zoomIn} /></Tooltip>
    </Space.Compact>
  );
}

/**
 * Phóng to bằng transform: scale; khung ngoài đặt đúng kích thước đã nhân tỉ lệ để thanh cuộn khớp nội dung.
 * (offsetWidth/Height không bị transform ảnh hưởng nên đo được kích thước gốc.)
 */
function ZoomBox({ zoom, children }) {
  const innerRef = useRef(null);
  const [size, setSize] = useState(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scaled = zoom !== 1;
  return (
    <div style={{ overflow: "auto", paddingBottom: 8 }}>
      <div style={scaled && size ? { width: size.w * zoom, height: size.h * zoom } : undefined}>
        <div ref={innerRef} style={{ width: "max-content", ...(scaled ? { transform: `scale(${zoom})`, transformOrigin: "0 0" } : {}) }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Sơ đồ nhánh giải đấu (desktop/tablet): phóng to/thu nhỏ (mức chung, nhớ trong trình duyệt) + toàn màn hình. */
export default function BracketFrame({ title = "Sơ đồ nhánh", children }) {
  const z = useBracketZoom();
  return (
    <FullscreenPanel title={title} toolbar={<ZoomControls {...z} />}>
      <ZoomBox zoom={z.zoom}>{children}</ZoomBox>
    </FullscreenPanel>
  );
}
