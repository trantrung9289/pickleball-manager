/**
 * DrawStage — KHUNG dùng chung cho các lễ bốc thăm (bốc cặp đấu, ghép đội đôi): overlay portal toàn
 * màn hình (.draw-stage-root, z-index 900 < Modal antd) hoặc khối inline; header (tiêu đề / tag / dòng
 * luật / nút Đóng); lưới 2 cột (vòng quay + thẻ + nút | bảng + minh bạch) hay 1 cột khi hẹp; khoá scroll
 * body khi overlay mở. KHÔNG chứa logic quay — ceremony truyền node đã render.
 *
 * Props: { title, tags (node|node[]), ruleText, wheel, underWheel, board,
 *          transparency: {seedCommit, seedHex, formulaText, onVerify, verifyState} | node,
 *          fullscreen = true, narrow (bool, tự tính nếu không truyền), onClose, closeLabel = "Đóng" }
 */
import { isValidElement, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Space, theme } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import TransparencyPanel from "./TransparencyPanel";
import { useViewMode } from "../../contexts/ViewModeContext";

// Overlay tối dùng màu cố định (không theo theme app) để chiếu tại sân nhất quán
const DARK = { bg: "#0f172a", text: "#e2e8f0", muted: "#94a3b8", panel: "rgba(255,255,255,.05)", border: "rgba(255,255,255,.12)" };

// Hook + helper dùng chung với các ceremony đặt cùng file là chủ đích (co-location);
// chúng chỉ phục vụ khung này nên không tách file riêng.
// eslint-disable-next-line react-refresh/only-export-components
export function useStageColors(fullscreen) {
  const { token } = theme.useToken();
  // Overlay: màu cố định; inline: theo token antd để hợp cả theme sáng/tối
  return fullscreen
    ? DARK
    : { bg: "transparent", text: token.colorText, muted: token.colorTextSecondary, panel: token.colorFillQuaternary, border: token.colorBorderSecondary };
}

/** Kích thước viewport + cờ hẹp + cỡ vòng quay gợi ý (cập nhật khi resize/xoay máy). */
// eslint-disable-next-line react-refresh/only-export-components
export function useStageViewport(fullscreen) {
  const { isMobileView } = useViewMode();
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Xếp 1 cột khi là chế độ mobile HOẶC cửa sổ thật sự hẹp (< 768px): người dùng có thể ép chế độ
  // "desktop" trong app nhưng bảng ô đích 2 cột trên màn hình hẹp sẽ bị cắt mất bên phải.
  const narrow = isMobileView || vp.w < 768;
  const wheelSize = (() => {
    if (fullscreen) {
      if (narrow) return Math.max(200, Math.min(vp.w - 32, vp.h * 0.55));
      return Math.max(240, Math.min(vp.w * 0.55 - 96, vp.h - 250, 640));
    }
    return narrow ? Math.max(200, Math.min(vp.w - 80, vp.h * 0.55)) : 380;
  })();
  return { vp, narrow, wheelSize };
}

export default function DrawStage({
  title, tags, ruleText, wheel, underWheel, board, transparency,
  fullscreen = true, narrow, onClose, closeLabel = "Đóng",
}) {
  const c = useStageColors(fullscreen);
  const auto = useStageViewport(fullscreen);
  const isNarrow = typeof narrow === "boolean" ? narrow : auto.narrow;

  // Khoá scroll body khi overlay mở
  useEffect(() => {
    if (!fullscreen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  const header = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: fullscreen ? 20 : 16, fontWeight: 700, color: c.text, lineHeight: 1.3 }}>
          {title}
        </div>
        {tags && (
          <Space size={8} wrap style={{ marginTop: 4 }}>{tags}</Space>
        )}
        {ruleText && (
          <div style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>{ruleText}</div>
        )}
      </div>
      {fullscreen && onClose && (
        <Button icon={<CloseOutlined />} onClick={onClose}>{closeLabel}</Button>
      )}
    </div>
  );

  const transparencyNode = !transparency
    ? null
    : isValidElement(transparency)
      ? transparency
      : <TransparencyPanel {...transparency} colors={c} />;

  const twoCols = !isNarrow;
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {header}
      <div style={{
        display: "grid", gap: 16,
        gridTemplateColumns: twoCols ? (fullscreen ? "55fr 45fr" : "minmax(0, 420px) 1fr") : "1fr",
        alignItems: "start",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {wheel}
          {underWheel}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {board}
          {transparencyNode}
        </div>
      </div>
    </div>
  );

  if (!fullscreen) return <div style={{ color: c.text }}>{body}</div>;

  // Overlay portal: z-index 900 (< 1000) để Modal.confirm / message của antd vẫn nổi lên trên
  return createPortal(
    <div className="draw-stage-root" style={{ background: DARK.bg, color: DARK.text }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: isNarrow ? "12px 16px 24px" : "20px 28px 32px" }}>
        {body}
      </div>
    </div>,
    document.body
  );
}
