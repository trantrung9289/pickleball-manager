/**
 * ChatBubble — nút trò chuyện nổi trên trang public (2026-10-29, phương án A, lối vào duy nhất của trò chuyện).
 *  - Nút tròn màu CLB góc dưới phải (mobile: trên thanh điều hướng, chừa vùng an toàn), badge số tin chưa đọc (trần 99).
 *  - Đóng: hỏi GET chat/unread mỗi UNREAD_MS theo mốc "đã đọc" của thiết bị (utils/chat readLastRead); dừng khi trang ẩn
 *    để đẩy thông báo hệ điều hành vẫn hoạt động (server coi lượt hỏi này là "đang mở app" và không đẩy tin thường).
 *  - Có tin mới → bong bóng xem trước "Tên: nội dung" cạnh nút trong PREVIEW_MS, bấm vào mở chat (quyết định người dùng: 3 giây).
 *  - Mở: mobile → Drawer từ dưới (90%); desktop → panel nổi góc phải kiểu Messenger. Nhúng PublicChat (embedded) → đủ trả lời,
 *    nhắc tên, bình chọn, ghim, khoá kênh; PublicChat tự ghi mốc đã đọc. Chỉ gắn PublicChat khi mở → vòng lấy tin 4s chỉ chạy lúc đó.
 *  - #chat trên URL (link từ thông báo đẩy) → tự mở; đóng → bỏ #chat để lần bấm thông báo sau vẫn mở được (SW navigate → hashchange).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Drawer, Typography } from "antd";
import { MessageOutlined, CloseOutlined } from "@ant-design/icons";
import PublicChat from "./PublicChat";
import { useViewMode } from "../../contexts/ViewModeContext";
import { readLastRead, saveLastRead, previewLine } from "../../utils/chat";

const { Text } = Typography;
const UNREAD_MS = 10_000;
const PREVIEW_MS = 3_000;
const hashWantsChat = () => typeof window !== "undefined" && window.location.hash === "#chat";

export default function ChatBubble({ api, slug }) {
  const { isMobileView } = useViewMode();
  const [open, setOpen] = useState(() => hashWantsChat());
  const [unread, setUnread] = useState(0);
  const [preview, setPreview] = useState(null);     // { id, name, body }
  const openRef = useRef(open);
  const previewedRef = useRef(0);                   // id tin đã hiện xem trước → không hiện lại

  const tick = useCallback(() => {
    if (openRef.current || document.hidden) return;
    const last = readLastRead(slug);
    api.unread(last == null ? {} : { after_id: last }).then((r) => {
      const d = r.data || {};
      if (last == null) { saveLastRead(slug, d.last_id || 0); return; }   // lần đầu: chỉ ghi mốc, không đếm tin cũ
      setUnread(d.count || 0);
      if (d.latest && d.latest.id > previewedRef.current) { previewedRef.current = d.latest.id; setPreview(d.latest); }
    }).catch(() => {});
  }, [api, slug]);

  useEffect(() => {
    tick();
    const t = setInterval(tick, UNREAD_MS);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [tick]);

  // bong bóng xem trước tự ẩn
  useEffect(() => {
    if (!preview) return undefined;
    const t = setTimeout(() => setPreview(null), PREVIEW_MS);
    return () => clearTimeout(t);
  }, [preview]);

  const show = useCallback(() => { openRef.current = true; setOpen(true); setUnread(0); setPreview(null); }, []);
  const hide = useCallback(() => {
    openRef.current = false; setOpen(false);
    if (hashWantsChat()) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setTimeout(tick, 300);
  }, [tick]);

  // mở từ link thông báo đẩy khi trang đã mở sẵn (service worker navigate → chỉ đổi hash)
  useEffect(() => {
    const onHash = () => { if (hashWantsChat()) show(); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [show]);

  const fabBottom = isMobileView ? "calc(58px + env(safe-area-inset-bottom, 0px) + 14px)" : 24;
  const panel = open ? <PublicChat api={api} slug={slug} embedded /> : null;

  return (
    <>
      {/* bong bóng xem trước */}
      {!open && preview && (
        <button type="button" className="chat-preview" onClick={show} style={{ bottom: `calc(${typeof fabBottom === "number" ? `${fabBottom}px` : fabBottom} + 64px)` }}
          aria-label="Mở trò chuyện">
          {previewLine(preview)}
        </button>
      )}
      {/* nút nổi — mobile ẩn khi Drawer mở (Drawer che toàn bộ) */}
      {!(open && isMobileView) && (
        <Badge count={unread} overflowCount={99} size="small" offset={[-6, 6]} style={{ zIndex: 951 }}
          className="chat-fab-wrap" styles={{ root: { position: "fixed", right: isMobileView ? 16 : 24, bottom: fabBottom, zIndex: 950 } }}>
          <button type="button" className={`chat-fab${unread ? " chat-fab--pulse" : ""}`} onClick={open ? hide : show}
            aria-label={open ? "Đóng trò chuyện" : `Trò chuyện${unread ? `, ${unread} tin chưa đọc` : ""}`} aria-expanded={open}>
            {open ? <CloseOutlined /> : <MessageOutlined />}
          </button>
        </Badge>
      )}
      {isMobileView ? (
        <Drawer open={open} onClose={hide} placement="bottom" height="90%" title="Trò chuyện CLB"
          styles={{ body: { padding: "8px 12px 12px", display: "flex", flexDirection: "column" } }}>
          {panel}
        </Drawer>
      ) : open && (
        <div className="chat-panel" role="dialog" aria-label="Trò chuyện CLB">
          <div className="chat-panel__head">
            <Text strong style={{ fontSize: 15 }}><MessageOutlined style={{ marginRight: 8 }} />Trò chuyện CLB</Text>
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={hide} aria-label="Đóng" />
          </div>
          <div className="chat-panel__body">{panel}</div>
        </div>
      )}
    </>
  );
}
