/**
 * ClubBot — nút nổi "BOT CLB" + khung hội thoại trên trang quản lý CLB (2026-10-29). Chỉ hiện khi đã đăng nhập và chọn CLB
 * (App.jsx gắn trong layout chế độ CLB; không có ở AdminPortal / trang public). Mobile: Drawer từ dưới; desktop: panel nổi góc phải
 * (dùng lại CSS .chat-fab/.chat-panel của nút trò chuyện public). Mỗi lần mở là một phiên mới (ClubBotPanel remount).
 */
import { useState } from "react";
import { Button, Drawer, Typography } from "antd";
import { RobotOutlined, CloseOutlined } from "@ant-design/icons";
import { useViewMode } from "../../contexts/ViewModeContext";
import { useAuth } from "../../context/AuthContext";
import ClubBotPanel from "./ClubBotPanel";

const { Text } = Typography;

export default function ClubBot() {
  const { isMobileView } = useViewMode();
  const { user, selectedClub, perms } = useAuth();
  const [open, setOpen] = useState(false);
  if (!selectedClub) return null;

  const fabBottom = isMobileView ? "calc(58px + env(safe-area-inset-bottom, 0px) + 14px)" : 24;
  const panel = open ? <ClubBotPanel key={selectedClub.id} club={selectedClub} user={user} perms={perms} /> : null;
  const title = <Text strong style={{ fontSize: 15 }}><RobotOutlined style={{ marginRight: 8 }} />BOT CLB · {selectedClub.name}</Text>;
  return (
    <>
      {!(open && isMobileView) && (
        <div style={{ position: "fixed", right: isMobileView ? 16 : 24, bottom: fabBottom, zIndex: 950 }} className="chat-fab-wrap">
          <button type="button" className="chat-fab" onClick={() => setOpen((o) => !o)} aria-label={open ? "Đóng BOT CLB" : "Mở BOT CLB"} aria-expanded={open} title="BOT CLB">
            {open ? <CloseOutlined /> : <RobotOutlined />}
          </button>
        </div>
      )}
      {isMobileView ? (
        <Drawer open={open} onClose={() => setOpen(false)} placement="bottom" height="92%" title={title}
          styles={{ body: { padding: "8px 12px 12px", display: "flex", flexDirection: "column" } }}>
          {panel}
        </Drawer>
      ) : open && (
        <div className="chat-panel chat-panel--bot" role="dialog" aria-label="BOT CLB">
          <div className="chat-panel__head">{title}<Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setOpen(false)} aria-label="Đóng" /></div>
          <div className="chat-panel__body">{panel}</div>
        </div>
      )}
    </>
  );
}
