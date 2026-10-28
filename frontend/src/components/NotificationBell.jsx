/**
 * NotificationBell — chuông thông báo (đợt 2, 2026-10-27) dùng chung cho header admin và trang public.
 * Props:
 *  - fetchFeed: async () => { today, items }  (admin: announcementsApi.feed(); public: api.announcements())
 *  - scope: khoá lưu "đã xem" trong localStorage của trình duyệt (public: slug; admin: club:<id>). Không lưu server.
 *  - onManage: (tuỳ chọn) mở trang quản lý thông báo (admin).
 *  - dark: kiểu nút như ThemeSwitcher (dark=false → nút viền màu thương hiệu trên nền sáng).
 *  - topPanel: (tuỳ chọn) khối hiện trên đầu Drawer (trang public: PushSettings "Thông báo trên thiết bị").
 * Hành vi: badge = số lần xuất hiện CHƯA XEM (tối đa "9+"); mở Drawer (phải trên desktop, dưới trên mobile) → đánh dấu đã xem;
 * làm mới khi mở và mỗi 60s; rung nhẹ một lần khi có chưa xem (tắt khi prefers-reduced-motion, xem index.css).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Drawer, Empty, Spin, Typography, Space } from "antd";
import { BellOutlined, CalendarOutlined, DollarOutlined, SettingOutlined } from "@ant-design/icons";
import { useViewMode } from "../contexts/ViewModeContext";
import { StatusChip } from "./ui";
import { formatWhen, statusChip, unreadCount, mergeSeen, loadSeen, saveSeen, unpaidPreview, groupByDate, KIND_LABELS } from "../utils/announcements";

const { Text } = Typography;
const REFRESH_MS = 60_000;

function FeeDetail({ it }) {
  const [expanded, setExpanded] = useState(false);
  const { shown, more } = unpaidPreview(it.unpaid_members, expanded ? 1000 : 10);
  if (!it.unpaid_count) return <Text type="secondary" style={{ fontSize: 12 }}>Tất cả thành viên đã đóng.</Text>;
  return (
    <div style={{ fontSize: 13, marginTop: 4 }}>
      <Text strong style={{ color: "var(--danger-strong)" }}>Chưa đóng ({it.unpaid_count}):</Text>{" "}
      <Text>{shown.join(", ")}</Text>
      {more > 0 && (
        <Button type="link" size="small" style={{ padding: "0 4px", height: "auto" }} onClick={() => setExpanded(true)}>
          và {more} người nữa
        </Button>
      )}
    </div>
  );
}

export function FeedItem({ it }) {
  const chip = statusChip(it);
  const isFee = it.kind === "fee";
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div aria-hidden="true" style={{
        flexShrink: 0, width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
        background: isFee ? "var(--warn-soft)" : "var(--brand-soft)", color: isFee ? "var(--warn-strong)" : "var(--brand-strong)", fontSize: 18,
      }}>
        {isFee ? <DollarOutlined /> : <CalendarOutlined />}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text strong style={{ fontSize: 14 }}>{it.title}</Text>
          <StatusChip tone={chip.tone} dot={it.status === "today"}>{chip.text}</StatusChip>
        </div>
        <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
          {KIND_LABELS[it.kind] || it.kind} · {formatWhen(it)}{it.duration_min ? ` · ${it.duration_min} phút` : ""}
        </Text>
        {it.body && <div style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 4 }}>{it.body}</div>}
        {isFee && <FeeDetail it={it} />}
      </div>
    </div>
  );
}

export default function NotificationBell({ fetchFeed, scope, onManage, dark = false, topPanel = null, openSignal = 0 }) {
  const { isMobileView } = useViewMode();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);          // null = chưa tải lần nào
  const [seen, setSeen] = useState(() => loadSeen(scope));   // đổi scope → caller đặt key={scope} để remount
  const openRef = useRef(false);

  // Gộp khoá đã xem bằng setState hàm → không cần ref tới seen; chỉ ghi localStorage khi có khoá mới
  const markSeen = useCallback((list) => {
    setSeen((prev) => {
      const next = mergeSeen(prev, list);
      if (next.length === prev.length) return prev;
      saveSeen(scope, next);
      return next;
    });
  }, [scope]);

  // Tải feed: setState trong callback .then (không đồng bộ trong effect) — lỗi mạng giữ danh sách cũ
  const load = useCallback(() => fetchFeed().then((r) => {
    const list = r?.data?.items || r?.items || [];
    setItems(list);
    if (openRef.current) markSeen(list);   // đang mở Drawer thì mục mới về cũng coi như đã xem
  }).catch(() => {}), [fetchFeed, markSeen]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const list = items || [];
  const unread = unreadCount(list, seen);
  const loading = items === null;

  const handleOpen = () => {
    openRef.current = true;
    setOpen(true);
    markSeen(list);
    load();
  };
  const handleClose = () => { openRef.current = false; setOpen(false); };
  // openSignal đổi (>0) → mở Drawer từ bên ngoài (PublicReport mời bật thông báo lần đầu chạy từ màn hình chính)
  useEffect(() => {
    if (!openSignal) return;
    Promise.resolve().then(() => { openRef.current = true; setOpen(true); load(); });
  }, [openSignal, load]);

  const btnStyle = dark
    ? { border: "1px solid rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.08)" }
    : { border: "1px solid var(--line)", color: "var(--ink)", background: "var(--surface)" };   // biến CSS → luôn đủ tương phản sáng/tối

  const groups = groupByDate(list);
  return (
    <>
      <Badge count={unread} overflowCount={9} size="small" offset={[-2, 2]}>
        <Button type="text" size="small" aria-label={`Thông báo${unread ? `, ${unread} chưa xem` : ""}`} onClick={handleOpen}
          className={unread ? "ui-bell ui-bell--ring" : "ui-bell"} style={{ ...btnStyle, height: 28, padding: "0 10px" }}>
          <BellOutlined />
          <span style={{ marginLeft: 6, fontSize: 13 }}>Thông báo</span>
        </Button>
      </Badge>
      <Drawer
        title={<Space>Thông báo{list.length ? <StatusChip tone="brand">{list.length}</StatusChip> : null}</Space>}
        open={open} onClose={handleClose}
        placement={isMobileView ? "bottom" : "right"} height={isMobileView ? "75%" : undefined} width={isMobileView ? undefined : 400}
        styles={{ body: { padding: "4px 16px 16px" } }}
        extra={onManage ? <Button size="small" icon={<SettingOutlined />} onClick={() => { handleClose(); onManage(); }}>Quản lý</Button> : null}
      >
        {topPanel}
        {loading ? <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
          : !list.length ? <Empty description="Chưa có thông báo nào" style={{ padding: 24 }} />
          : groups.map((g) => (
            <div key={g.date}>
              {g.items.map((it) => <FeedItem key={`${it.announcement_id}:${it.date}`} it={it} />)}
            </div>
          ))}
      </Drawer>
    </>
  );
}
