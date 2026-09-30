import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button, Space, Tag, Modal, Form, Input, message, Typography, Row, Card, Tabs, Badge, Empty, Tooltip, Alert, Spin,
  Collapse, theme,
} from "antd";
import {
  PlusOutlined, MinusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, CheckCircleOutlined,
  ThunderboltOutlined, UserAddOutlined, UserDeleteOutlined, PrinterOutlined, StarOutlined, UndoOutlined,
  HistoryOutlined, TrophyOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { pointEventsApi } from "../api";
import ResponsiveTable from "../components/ResponsiveTable";
import PointEventPrintSheet from "../components/PointEventPrintSheet";
import { useViewMode } from "../contexts/ViewModeContext";
import { useAuth } from "../context/AuthContext";
import { useFastPoll } from "../hooks/useFastPoll";
import {
  rankParticipants, removedParticipants, mergeState, appendLogs, lastLogId, formatDelta,
  isStaleSnapshot, shiftPoints, withPending, pendingAdd, pendingRemove, pendingTotals, pendingCount, applyOrderLock,
} from "../utils/pointEvents";
import { AddParticipantsModal } from "../components/AddParticipantsModal";

const { Title, Text } = Typography;

// Bản sao STATUS_MAP của Tournament.jsx (file đó không export hằng để giữ Fast Refresh) — cùng enum trạng thái.
const STATUS_MAP = {
  draft:     { label: "Nháp", color: "default" },
  active:    { label: "Đang diễn ra", color: "processing" },
  completed: { label: "Kết thúc", color: "success" },
};
const STATE_POLL_MS = 3000;        // poll bản rút gọn /state khi sự kiện đang diễn ra
const STATE_POLL_SLOW_MS = 10000;  // giãn khi server trả 429
const LOG_PAGE = 200;              // trang tải lịch sử (backend giới hạn ≤ 500)
const PRINT_LOG_PAGE = 500;
const ORDER_LOCK_MS = 2500;        // giữ nguyên thứ tự hàng sau mỗi lần bấm để lần chạm kế tiếp không trúng người khác

const confirm = (opts) =>
  new Promise((res) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => res(true), onCancel: () => res(false) })
  );

/** Mã thao tác duy nhất (≤ 40 ký tự) để backend bỏ qua request trùng khi client gửi lại. */
const newOpId = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Lỗi không có phản hồi từ server (mất mạng) hoặc quá thời gian chờ của axios → an toàn để gửi lại cùng client_op_id. */
const isNetworkError = (err) => !err?.response || err?.code === "ECONNABORTED";

const fmtDateTime = (v) => (v ? dayjs(v).format("HH:mm DD/MM/YYYY") : "—");
const fmtLogTime = (v) => (v ? dayjs(v).format("HH:mm:ss DD/MM") : "—");
const rankTag = (v) => (v ? <Tag color="purple" style={{ margin: 0 }}>{v}</Tag> : <Text type="secondary">—</Text>);
const MEDAL_COLOR = { 1: "#d4a017", 2: "#8c8c8c", 3: "#b87333" };

// ── Modal khởi tạo sự kiện (dùng ở trang danh sách Tournament.jsx) ─────────────
/** Props: { onCreated(PointEventOut), onClose }. Sau khi tạo, trang chi tiết tự mở modal chọn người. */
export function CreatePointEventModal({ onCreated, onClose }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const handleOk = async () => {
    let vals;
    try { vals = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const res = await pointEventsApi.create({
        name: (vals.name || "").trim(),
        description: vals.description || null,
        member_ids: [],
        player_ids: [],
      });
      message.success("Đã tạo sự kiện — thêm người tham gia ngay trên trang sự kiện");
      onCreated(res.data);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể tạo sự kiện");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      title={<span><StarOutlined style={{ color: "#faad14" }} /> Khởi tạo sự kiện thành tích</span>}
      open onCancel={onClose} onOk={handleOk} okText="Tạo sự kiện" cancelText="Hủy" confirmLoading={saving}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="Mini game: cộng/trừ điểm từng người bằng nút + / −, không có trận đấu."
        description="Sau khi tạo, thêm người tham gia rồi bấm 'Bắt đầu' để chấm điểm. Trang public hiện bảng điểm trực tiếp khi sự kiện đã bắt đầu." />
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Tên sự kiện" initialValue={`Mini game ${dayjs().format("DD/MM/YYYY")}`}
          rules={[{ required: true, whitespace: true, message: "Nhập tên sự kiện" }]}>
          <Input autoFocus maxLength={200} />
        </Form.Item>
        <Form.Item name="description" label="Mô tả (không bắt buộc)">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ── Một hàng chấm điểm: [−]  tên (hạng)  ĐIỂM  [+] — nút ≥ 52px để bấm được bằng ngón tay ──
function ScoreRow({ p, canEdit, isMobileView, onPoint, onRemove }) {
  const { token } = theme.useToken();
  const size = isMobileView ? 52 : 56;
  const btnStyle = { width: size, height: size, minWidth: size, fontSize: 22, flexShrink: 0 };
  const medal = MEDAL_COLOR[p.rank];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: isMobileView ? 8 : 12, padding: "8px 0",
      borderBottom: `1px solid ${token.colorBorderSecondary}`,
    }}>
      <div style={{ width: 28, textAlign: "center", fontWeight: 700, fontSize: 16, color: medal || token.colorTextSecondary, flexShrink: 0 }}>
        {p.rank}
      </div>
      {canEdit && (
        <Button shape="circle" icon={<MinusOutlined />} style={btnStyle} disabled={(p.points ?? 0) <= 0}
          aria-label={`Trừ 1 điểm ${p.display_name}`} onClick={() => onPoint(p, -1)} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: isMobileView ? 15 : 16, lineHeight: 1.3, overflowWrap: "anywhere" }}>
          {p.display_name}
        </div>
        <Space size={6} wrap style={{ marginTop: 2 }}>
          {p.rank_snapshot ? <Tag color="purple" style={{ margin: 0, fontSize: 11, lineHeight: "18px" }}>{p.rank_snapshot}</Tag> : null}
          {canEdit && (
            <Button type="link" size="small" danger icon={<UserDeleteOutlined />}
              style={{ padding: 0, height: "auto", fontSize: 12 }} onClick={() => onRemove(p)}>
              Rời
            </Button>
          )}
        </Space>
      </div>
      <div style={{
        minWidth: 44, textAlign: "center", fontSize: isMobileView ? 26 : 30, fontWeight: 800,
        fontVariantNumeric: "tabular-nums", flexShrink: 0, color: medal || undefined,
      }}>
        {p.points ?? 0}
      </div>
      {canEdit && (
        <Button type="primary" shape="circle" icon={<PlusOutlined />} style={btnStyle}
          aria-label={`Cộng 1 điểm ${p.display_name}`} onClick={() => onPoint(p, 1)} />
      )}
    </div>
  );
}

// ── Lịch sử chấm điểm: mới nhất trước; log trạng thái / thêm-rời người hiện dòng xám ──
function LogList({ logs, loading, onRefresh, isMobileView }) {
  const { token } = theme.useToken();
  const items = useMemo(() => [...(logs || [])].reverse(), [logs]);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {items.length ? `${items.length} dòng · mới nhất ở trên` : ""}
        </Text>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>Tải lại</Button>
      </div>
      {!items.length && loading && <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>}
      {!items.length && !loading && (
        <Empty description="Chưa có lượt chấm nào" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
      {items.map((l) => {
        const time = fmtLogTime(l.created_at);
        if (l.kind === "score") {
          const up = (l.delta ?? 0) > 0;
          return (
            <div key={l.id} style={{
              display: "flex", alignItems: "baseline", gap: 8, padding: "6px 0",
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              fontSize: isMobileView ? 14 : 13, flexWrap: "wrap",
            }}>
              <Text type="secondary" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{time}</Text>
              <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{l.display_name || "—"}</span>
              <Tag color={up ? "green" : "red"} style={{ margin: 0 }}>{formatDelta(l.delta)}</Tag>
              <span>→ <b>{l.points_after}</b></span>
              {l.actor_name && <Text type="secondary" style={{ fontSize: 12 }}>· {l.actor_name}</Text>}
            </div>
          );
        }
        const label = l.kind === "participant"
          ? `${l.note || "Thay đổi người"}${l.display_name ? `: ${l.display_name}` : ""}`
          : (l.note || "Đổi trạng thái");
        return (
          <div key={l.id} style={{
            display: "flex", alignItems: "baseline", gap: 8, padding: "6px 0",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            fontSize: isMobileView ? 13 : 12, color: token.colorTextSecondary, fontStyle: "italic", flexWrap: "wrap",
          }}>
            <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{time}</span>
            <span>{label}</span>
            {l.actor_name && <span>· {l.actor_name}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Trang chi tiết sự kiện thành tích cá nhân ─────────────────────────────────
/**
 * Props: { event (PointEventOut hoặc PointEventListOut — sẽ tải bản đầy đủ khi mount), autoOpenAdd (vừa tạo →
 * mở ngay modal chọn người), onBack, onUpdated(PointEventOut) }.
 * Điểm: cập nhật lạc quan ngay khi bấm, gửi tuần tự theo từng người (không gửi song song cùng 1 người), điểm
 * hiển thị = điểm server + delta của các lượt bấm CHƯA được xác nhận (gắn opId, gỡ khi phản hồi của chính nó về);
 * phản hồi có version cũ hơn bản đang hiển thị bị bỏ qua; poll /state mỗi 3s khi đang diễn ra để đồng bộ giữa các
 * máy. Màn chấm điểm đóng băng thứ tự hàng ORDER_LOCK_MS sau mỗi lần bấm để không chạm nhầm người khác.
 */
export default function PointEventDetail({ event: initData, autoOpenAdd = false, onBack, onUpdated }) {
  const { isMobileView } = useViewMode();
  const { token } = theme.useToken();
  const perms = useAuth()?.perms;
  const canEdit = !!perms?.canEdit;
  const canDelete = !!perms?.canDelete;
  const eventId = initData.id;

  const [event, setEvent] = useState(initData);
  const [loaded, setLoaded] = useState(Array.isArray(initData.participants));
  const [addOpen, setAddOpen] = useState(() => !!autoOpenAdd);
  const [editModal, setEditModal] = useState(false);
  const [editForm] = Form.useForm();
  const [tab, setTab] = useState("board");
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printLogs, setPrintLogs] = useState([]);
  const [loadingPrint, setLoadingPrint] = useState(false);
  const [lockedOrder, setLockedOrder] = useState(null);   // mảng id: thứ tự hàng đang bị đóng băng (null = sắp theo điểm)

  // Ref gương của state để các callback ổn định (poll, hàng đợi điểm) đọc được bản mới nhất. eventRef / logsRef
  // được ghi ĐỒNG BỘ cùng lúc với setState (commitEvent / trong loadMoreLogs) — không chờ effect — để hai phản hồi
  // về sát nhau vẫn so version đúng với bản vừa áp.
  const eventRef = useRef(initData);
  const tabRef = useRef("board");
  useEffect(() => { tabRef.current = tab; }, [tab]);
  const logsRef = useRef([]);
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => { onUpdatedRef.current = onUpdated; }, [onUpdated]);

  // Trang còn đang mở? Phản hồi về muộn sau khi bấm "Quay lại" KHÔNG được gọi onUpdated/setEvent (sẽ mở lại trang)
  const aliveRef = useRef(true);
  const lockRef = useRef(null);        // gương đồng bộ của lockedOrder (handler bấm liên tiếp đọc được ngay)
  const lockTimerRef = useRef(null);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(lockTimerRef.current);
    };
  }, []);

  // Điểm chờ xác nhận: pid → [{opId, delta}] — chỉ gồm lượt bấm mà server CHƯA trả lời; hàng đợi gửi tuần tự theo pid
  const pendingRef = useRef(new Map());
  const queueRef = useRef(new Map());
  const logsBusyRef = useRef(false);
  const logsRerunRef = useRef(false);   // có yêu cầu tải log đến lúc đang bận → chạy thêm một lượt sau khi xong
  const logsFullRef = useRef(false);    // lần tải log kế tiếp phải thay TOÀN BỘ (tải lại từ after_id=0)

  const commitEvent = useCallback((next) => {
    eventRef.current = next;
    setEvent(next);
  }, []);

  // ── Lịch sử: tải tăng dần theo after_id tới khi hết (giữ thứ tự id tăng dần, hiển thị đảo ngược).
  //    logsFullRef bật (người bị xoá cứng / đổi người ở máy khác) → thay hẳn danh sách bằng bản tải từ after_id=0. ──
  const loadMoreLogs = useCallback(async () => {
    if (logsBusyRef.current) { logsRerunRef.current = true; return; }
    logsBusyRef.current = true;
    setLogsLoading(true);
    try {
      do {
        logsRerunRef.current = false;
        const full = logsFullRef.current;
        logsFullRef.current = false;
        try {
          let acc = full ? [] : logsRef.current;
          let after = lastLogId(acc);
          for (;;) {
            const r = await pointEventsApi.logs(eventId, after, LOG_PAGE);
            if (!aliveRef.current) return;
            const chunk = r.data || [];
            if (chunk.length) {
              acc = appendLogs(acc, chunk);
              after = chunk[chunk.length - 1].id;
              if (!full) { logsRef.current = acc; setLogs(acc); }   // nạp thêm: hiện dần từng trang
            }
            if (chunk.length < LOG_PAGE) break;
          }
          if (full) { logsRef.current = acc; setLogs(acc); }        // nạp lại: thay một lần để không nhấp nháy
        } catch (err) {
          if (full) logsFullRef.current = true;                     // lỗi giữa chừng → lần sau vẫn nạp lại từ đầu
          if (aliveRef.current) message.error(err?.response?.data?.detail || "Không tải được lịch sử chấm điểm");
          break;
        }
      } while (logsRerunRef.current && aliveRef.current);
    } finally {
      logsBusyRef.current = false;
      logsRerunRef.current = false;
      if (aliveRef.current) setLogsLoading(false);
    }
  }, [eventId]);

  /**
   * Nhận PointEventOut từ server: điểm hiển thị = điểm server + delta của các lượt bấm CHƯA được xác nhận
   * (không giật khi bấm liên tiếp). Bản có version CŨ HƠN bản đang hiển thị thì bỏ qua (phản hồi về muộn);
   * version bằng nhau vẫn áp. `force` (nút Làm mới) bỏ qua phép so này để thoát khi server bị lùi version.
   */
  const applyServerEvent = useCallback((data, { force = false } = {}) => {
    if (!data || !aliveRef.current) return;
    if (!force && isStaleSnapshot(eventRef.current, data)) { setLoaded(true); return; }
    const next = withPending(data, pendingTotals(pendingRef.current));
    commitEvent(next);
    setLoaded(true);
    onUpdatedRef.current && onUpdatedRef.current(next);
    if (tabRef.current === "history") loadMoreLogs();
  }, [loadMoreLogs, commitEvent]);

  const reload = useCallback(async (force = false) => {
    let data;
    try {
      data = (await pointEventsApi.get(eventId)).data;
    } catch (err) {
      if (aliveRef.current) message.error(err?.response?.data?.detail || "Không tải được sự kiện");
      return;
    }
    if (!aliveRef.current) return;
    applyServerEvent(data, { force });
  }, [eventId, applyServerEvent]);

  // Danh sách chỉ trả bản nhẹ (không participants) → luôn tải bản đầy đủ khi mở trang
  useEffect(() => {
    let cancelled = false;
    pointEventsApi.get(eventId)
      .then((r) => { if (!cancelled) applyServerEvent(r.data); })
      .catch((err) => { if (!cancelled) message.error(err?.response?.data?.detail || "Không tải được sự kiện"); });
    return () => { cancelled = true; };
  }, [eventId, applyServerEvent]);

  // ── Poll /state 3s khi đang diễn ra: chỉ áp khi version mới hơn; người lạ / người vắng / đổi trạng thái →
  //    tải bản đầy đủ và nạp lại toàn bộ log ──
  const handleState = useCallback((state) => {
    if (!aliveRef.current) return;
    const cur = eventRef.current;
    const { event: next, needFull } = mergeState(cur, state, pendingTotals(pendingRef.current));
    if (needFull) { logsFullRef.current = true; reload(); return; }
    if (next === cur) return;
    commitEvent(next);
    onUpdatedRef.current && onUpdatedRef.current(next);
    if (tabRef.current === "history") loadMoreLogs();
  }, [reload, loadMoreLogs, commitEvent]);
  const loadState = useCallback(async () => {
    // Đang có thao tác chấm điểm chờ phản hồi → phản hồi đó đã mang bản đầy đủ, bỏ qua nhịp poll này
    if (pendingCount(pendingRef.current) > 0) return { ok: true };
    try {
      const r = await pointEventsApi.state(eventId);
      // Trong lúc chờ có lượt bấm mới: snapshot này có thể đã gồm lượt đó (sẽ bị cộng đôi với pending) → bỏ, nhịp sau đồng bộ
      if (pendingCount(pendingRef.current) > 0) return { ok: true };
      handleState(r.data);
      return { ok: true };
    } catch (err) {
      return { ok: false, status: err?.response?.status };
    }
  }, [eventId, handleState]);
  useFastPoll(event.status === "active", loadState, { intervalMs: STATE_POLL_MS, slowMs: STATE_POLL_SLOW_MS });

  // ── In: nạp toàn bộ log rồi mới mở hộp thoại in (sheet render qua portal ngoài #root) ──
  useEffect(() => {
    if (!printing) return undefined;
    const onAfterPrint = () => setPrinting(false);
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, [printing]);
  const handlePrintReady = useCallback(() => {
    // Đợi 1 tick để React commit xong nội dung trước khi mở hộp thoại in
    setTimeout(() => window.print(), 30);
  }, []);
  const handlePrint = async () => {
    setLoadingPrint(true);
    try {
      let all = [];
      let after = 0;
      for (;;) {
        const r = await pointEventsApi.logs(eventId, after, PRINT_LOG_PAGE);
        const chunk = r.data || [];
        all = appendLogs(all, chunk);
        if (chunk.length < PRINT_LOG_PAGE) break;
        after = chunk[chunk.length - 1].id;
      }
      if (!aliveRef.current) return;
      setPrintLogs(all);
      setPrinting(true);
    } catch (err) {
      if (aliveRef.current) message.error(err?.response?.data?.detail || "Không tải được lịch sử để in");
    } finally {
      if (aliveRef.current) setLoadingPrint(false);
    }
  };

  // ── Đóng băng thứ tự hàng sau mỗi lần bấm: hàng đổi chỗ ngay (điểm vừa đổi) làm lần chạm kế tiếp trúng người
  //    khác. Chụp thứ tự đang hiển thị ở lần bấm đầu, giữ nguyên ORDER_LOCK_MS kể từ lần bấm CUỐI rồi mới sắp lại. ──
  const armOrderLock = () => {
    if (!lockRef.current) {
      lockRef.current = rankParticipants(eventRef.current.participants).map((x) => x.id);
      setLockedOrder(lockRef.current);
    }
    clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(() => {
      lockRef.current = null;
      setLockedOrder(null);
    }, ORDER_LOCK_MS);
  };

  // ── Chấm điểm: lạc quan + hàng đợi tuần tự theo người + client_op_id (gửi lại 1 lần khi mất mạng) ──
  const handlePoint = (p, delta) => {
    if (!canEdit || eventRef.current.status !== "active") return;
    if (delta < 0 && (p.points ?? 0) + delta < 0) return;
    const pid = p.id;
    const opId = newOpId();
    armOrderLock();
    pendingAdd(pendingRef.current, pid, opId, delta);
    commitEvent(shiftPoints(eventRef.current, pid, delta));
    const send = async () => {
      let res = null;
      let failure = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          res = await pointEventsApi.addPoint(eventId, pid, delta, opId);
          break;
        } catch (err) {
          failure = err;
          // Không có phản hồi (mất mạng / quá thời gian) → thử lại 1 lần cùng client_op_id, backend bỏ qua nếu đã ghi
          if (!(isNetworkError(err) && attempt === 0)) break;
        }
      }
      // Phản hồi của CHÍNH lượt này đã về (hoặc đã bỏ cuộc) → không còn chờ: gỡ khỏi pending TRƯỚC khi áp bản server
      pendingRemove(pendingRef.current, pid, opId);
      if (res) {
        if (!aliveRef.current) return;
        if (isStaleSnapshot(eventRef.current, res.data)) {
          // Bản đang hiển thị đã dựng từ snapshot MỚI HƠN phản hồi này — snapshot đó đã gồm lượt bấm này, nhưng lúc áp
          // nó vẫn cộng lượt này như pending → đang bị đếm đôi. Trả lại phần cộng lạc quan, không ghi đè bằng bản cũ.
          commitEvent(shiftPoints(eventRef.current, pid, -delta));
        } else {
          applyServerEvent(res.data);
        }
        return;
      }
      // Ghi điểm thất bại: báo cả khi đã rời trang (điểm không được ghi — người chấm cần biết); không đụng state nếu đã unmount
      message.error(failure?.response?.data?.detail || "Không ghi được điểm — đã hoàn nguyên");
      if (!aliveRef.current) return;
      commitEvent(shiftPoints(eventRef.current, pid, -delta));
      reload();   // đồng bộ lại với server (trường hợp người đã rời / sự kiện đã kết thúc ở máy khác)
    };
    const prevChain = queueRef.current.get(pid) || Promise.resolve();
    const next = prevChain.then(send, send);
    queueRef.current.set(pid, next);
  };

  // ── Trạng thái: Bắt đầu / Kết thúc / Mở lại ──
  const handleStatus = async (newStatus) => {
    const reopening = newStatus === "active" && eventRef.current.status === "completed";
    const cfg = newStatus === "completed"
      ? { title: "Kết thúc sự kiện?", okText: "Kết thúc",
          content: "Bảng điểm được chốt; trang public hiện 'Đã kết thúc'. Có thể mở lại nếu cần chấm tiếp." }
      : reopening
        ? { title: "Mở lại sự kiện?", okText: "Mở lại", content: "Sự kiện sẽ mở lại để chấm tiếp, có ghi log." }
        : { title: "Bắt đầu sự kiện?", okText: "Bắt đầu",
            content: "Bắt đầu chấm điểm ngay sau khi xác nhận. Vẫn thêm được người đến muộn trong lúc diễn ra." };
    const ok = await confirm(cfg);
    if (!ok || !aliveRef.current) return;
    setBusy(true);
    try {
      const r = await pointEventsApi.update(eventId, { status: newStatus });
      if (!aliveRef.current) return;
      applyServerEvent(r.data);
      message.success(newStatus === "completed" ? "Đã kết thúc sự kiện" : reopening ? "Đã mở lại sự kiện" : "Đã bắt đầu — chấm điểm ngay");
    } catch (err) {
      if (aliveRef.current) message.error(err?.response?.data?.detail || "Không thể cập nhật trạng thái");
    } finally { if (aliveRef.current) setBusy(false); }
  };

  const handleRemove = async (p) => {
    const isActive = eventRef.current.status === "active";
    const hasPoints = (p.points ?? 0) > 0;
    const ok = await confirm({
      title: isActive ? `"${p.display_name}" rời sự kiện?` : `Xoá "${p.display_name}" khỏi sự kiện?`,
      content: isActive && hasPoints
        ? "Người này đã có điểm — sẽ được đánh dấu 'đã rời', điểm và lịch sử vẫn được giữ."
        : undefined,
      okButtonProps: { danger: true }, okText: isActive ? "Rời" : "Xoá",
    });
    if (!ok || !aliveRef.current) return;
    try {
      await pointEventsApi.removeParticipant(eventId, p.id);
      const r = await pointEventsApi.get(eventId);
      if (!aliveRef.current) return;
      const still = (r.data?.participants || []).some((x) => x.id === p.id);
      // Xoá cứng → log "Thêm" của người này biến mất khỏi server: nạp lại toàn bộ log thay vì append
      if (!still) logsFullRef.current = true;
      applyServerEvent(r.data);
      message.success(still ? "Đã rời, giữ lịch sử" : "Đã xoá khỏi sự kiện");
    } catch (err) {
      if (aliveRef.current) message.error(err?.response?.data?.detail || "Không thể xoá người tham gia");
    }
  };

  const openEdit = () => {
    editForm.setFieldsValue({ name: event.name, description: event.description });
    setEditModal(true);
  };
  const handleEditInfo = async () => {
    let vals;
    try { vals = await editForm.validateFields(); } catch { return; }
    try {
      const r = await pointEventsApi.update(eventId, { name: vals.name.trim(), description: vals.description || null });
      if (!aliveRef.current) return;
      applyServerEvent(r.data);
      setEditModal(false);
      message.success("Đã cập nhật thông tin sự kiện");
    } catch (err) {
      if (aliveRef.current) message.error(err?.response?.data?.detail || "Không thể cập nhật thông tin");
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Xác nhận xoá sự kiện?",
      content: <div>Sự kiện <b>{event.name}</b> và toàn bộ lịch sử điểm sẽ bị xoá vĩnh viễn.</div>,
      okButtonProps: { danger: true }, okText: "Xoá",
    });
    if (!ok || !aliveRef.current) return;
    setBusy(true);
    try {
      await pointEventsApi.delete(eventId);
      message.success("Đã xoá sự kiện");
      if (aliveRef.current) onBack && onBack();   // đã rời trang → không gọi onBack (sẽ đá người dùng khỏi trang khác)
    } catch (err) {
      if (!aliveRef.current) return;
      message.error(err?.response?.data?.detail || "Không thể xoá sự kiện");
      setBusy(false);
    }
  };

  // "Làm mới" / "Tải lại" là thao tác chủ động: bỏ qua phép so version và nạp lại toàn bộ log từ đầu
  const reloadLogsFull = () => {
    logsFullRef.current = true;
    loadMoreLogs();
  };
  const handleRefresh = () => {
    reload(true);
    if (tab === "history") reloadLogsFull();
  };
  const onTabChange = (k) => {
    setTab(k);
    if (k === "history") loadMoreLogs();
  };

  // ── Dữ liệu dẫn xuất ──
  const participants = useMemo(() => event.participants || [], [event.participants]);
  const ranked = useMemo(() => rankParticipants(participants), [participants]);
  const removed = useMemo(() => removedParticipants(participants), [participants]);
  const activeCount = ranked.length;
  const status = event.status;
  const isDraft = status === "draft";
  const isActive = status === "active";
  const isCompleted = status === "completed";
  const logCount = event.log_count ?? 0;   // cập nhật theo /state và mọi phản hồi của server (mergeState)
  // Màn chấm điểm: thứ tự hàng bị đóng băng ngay sau khi bấm; hạng hiển thị trong mỗi hàng vẫn là hạng thật theo điểm
  const scoreRows = useMemo(
    () => (canEdit && isActive ? applyOrderLock(ranked, lockedOrder) : ranked),
    [ranked, lockedOrder, canEdit, isActive],
  );

  // ── Nháp: bảng người tham gia ──
  const draftCols = [
    { title: "STT", width: 60, align: "center", render: (_, r, i) => i + 1 },
    { title: "Họ tên", dataIndex: "display_name" },
    { title: "Hạng", dataIndex: "rank_snapshot", width: 130, render: rankTag },
    ...(canEdit ? [{
      title: "", width: 60, align: "right",
      render: (_, r) => (
        <Tooltip title="Xoá khỏi sự kiện">
          <Button danger size="small" icon={<DeleteOutlined />} onClick={() => handleRemove(r)} />
        </Tooltip>
      ),
    }] : []),
  ];

  // ── Kết thúc: bảng xếp hạng (người đã rời mờ ở cuối) ──
  const rankingRows = useMemo(
    () => [...ranked, ...removed.map((r) => ({ ...r, rank: null }))],
    [ranked, removed],
  );
  const rankingCols = [
    { title: "Hạng", width: 70, align: "center",
      render: (_, r) => (r.rank
        ? <span style={{ fontWeight: 700, fontSize: 16, color: MEDAL_COLOR[r.rank] || undefined }}>{r.rank <= 3 && <TrophyOutlined style={{ marginRight: 4 }} />}{r.rank}</span>
        : <Text type="secondary">—</Text>) },
    { title: "Họ tên", dataIndex: "display_name",
      render: (v, r) => (r.status === "removed"
        ? <Text type="secondary">{v} <Tag style={{ marginLeft: 4 }}>đã rời</Tag></Text>
        : <span style={{ fontWeight: r.rank <= 3 ? 600 : 400 }}>{v}</span>) },
    { title: "Hạng CLB", dataIndex: "rank_snapshot", width: 130, render: rankTag },
    { title: "Điểm", dataIndex: "points", width: 90, align: "center",
      render: (v, r) => <span style={{ fontWeight: 700, fontSize: 16, color: r.status === "removed" ? token.colorTextDisabled : undefined }}>{v ?? 0}</span> },
  ];

  const historyTab = {
    key: "history",
    label: <span><HistoryOutlined /> Lịch sử{logCount ? ` (${logCount})` : ""}</span>,
    children: <LogList logs={logs} loading={logsLoading} onRefresh={reloadLogsFull} isMobileView={isMobileView} />,
  };

  const boardTab = isActive
    ? {
        key: "board",
        label: <span><StarOutlined /> Chấm điểm ({activeCount})</span>,
        children: (
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
              {canEdit
                ? `Bấm + / − để chấm; mọi máy tự cập nhật mỗi ${STATE_POLL_MS / 1000} giây. ${logCount} lượt chấm.`
                : `Bạn chỉ có quyền xem — bảng tự cập nhật mỗi ${STATE_POLL_MS / 1000} giây. ${logCount} lượt chấm.`}
            </Text>
            {ranked.length === 0 ? (
              <Empty description="Chưa có người tham gia — bấm Thêm người" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                {canEdit && <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAddOpen(true)}>Thêm người</Button>}
              </Empty>
            ) : scoreRows.map((p) => (
              <ScoreRow key={p.id} p={p} canEdit={canEdit} isMobileView={isMobileView}
                onPoint={handlePoint} onRemove={handleRemove} />
            ))}
            {removed.length > 0 && (
              <Collapse ghost size="small" style={{ marginTop: 8 }} items={[{
                key: "removed",
                label: <Text type="secondary">Đã rời ({removed.length})</Text>,
                children: removed.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: token.colorTextSecondary }}>
                    <span>{r.display_name}{r.rank_snapshot ? ` (${r.rank_snapshot})` : ""} <Tag style={{ marginLeft: 4 }}>đã rời</Tag></span>
                    <span style={{ fontWeight: 600 }}>{r.points ?? 0}</span>
                  </div>
                )),
              }]} />
            )}
          </div>
        ),
      }
    : {
        key: "board",
        label: <span><TrophyOutlined /> Xếp hạng ({activeCount})</span>,
        children: rankingRows.length === 0
          ? <Empty description="Không có người tham gia" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : (
            <ResponsiveTable
              columns={rankingCols} dataSource={rankingRows} rowKey="id" size="small" pagination={false}
              mobileTitle={(r) => (
                <span style={{ color: r.status === "removed" ? token.colorTextSecondary : undefined }}>
                  {r.rank ? <span style={{ color: MEDAL_COLOR[r.rank] || token.colorTextSecondary, marginRight: 8 }}>#{r.rank}</span> : null}
                  {r.display_name}
                  {r.status === "removed" && <Tag style={{ marginLeft: 6 }}>đã rời</Tag>}
                </span>
              )}
              mobileHideColumns={["Hạng", "Họ tên"]}
            />
          ),
      };

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Button onClick={onBack}>← Quay lại</Button>
          <Title level={4} style={{ margin: 0 }}>{event.name}</Title>
          <Badge status={STATUS_MAP[status]?.color} text={STATUS_MAP[status]?.label} />
          <Tag color="gold" icon={<StarOutlined />}>Thành tích cá nhân</Tag>
          {canEdit && <Button size="small" icon={<EditOutlined />} onClick={openEdit}>Sửa tên</Button>}
        </Space>
        <Space wrap>
          {canEdit && (isDraft || isActive) && (
            <Button icon={<UserAddOutlined />} onClick={() => setAddOpen(true)}>Thêm người</Button>
          )}
          {canEdit && isDraft && (
            <Tooltip title={activeCount === 0 ? "Cần ít nhất 1 người tham gia" : undefined}>
              <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} disabled={activeCount === 0}
                onClick={() => handleStatus("active")}>
                Bắt đầu
              </Button>
            </Tooltip>
          )}
          {canEdit && isActive && (
            <Button icon={<CheckCircleOutlined />} loading={busy} onClick={() => handleStatus("completed")}>Kết thúc</Button>
          )}
          {canEdit && isCompleted && (
            <Button icon={<UndoOutlined />} loading={busy} onClick={() => handleStatus("active")}>Mở lại</Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>Làm mới</Button>
          {!isDraft && (
            <Button icon={<PrinterOutlined />} loading={loadingPrint || printing} onClick={handlePrint}>In bảng điểm</Button>
          )}
          {canDelete && (
            <Button danger icon={<DeleteOutlined />} loading={busy} onClick={handleDelete}>Xoá</Button>
          )}
        </Space>
      </Row>

      <div style={{ marginBottom: 16 }}>
        {event.description && <div><Text>{event.description}</Text></div>}
        <Text type="secondary" style={{ fontSize: 12 }}>
          Tạo: {fmtDateTime(event.created_at)}
          {event.started_at && <> · Bắt đầu: {fmtDateTime(event.started_at)}</>}
          {event.completed_at && <> · Kết thúc: {fmtDateTime(event.completed_at)}</>}
          {event.created_by && <> · Người tạo: {event.created_by}</>}
        </Text>
      </div>

      {!loaded ? (
        <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
      ) : isDraft ? (
        <Card size="small" title={<span><UserAddOutlined /> Người tham gia ({activeCount})</span>}
          extra={canEdit && (
            <Button type="primary" size="small" icon={<UserAddOutlined />} onClick={() => setAddOpen(true)}>Thêm người</Button>
          )}>
          {participants.length === 0 ? (
            <Empty description="Chưa có người tham gia — bấm Thêm người" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              {canEdit && <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAddOpen(true)}>Thêm người</Button>}
            </Empty>
          ) : (
            <ResponsiveTable
              columns={draftCols} dataSource={participants} rowKey="id" size="small" pagination={false}
              mobileTitle={(r) => <span>{r.display_name}{r.rank_snapshot && <Tag color="purple" style={{ marginLeft: 6 }}>{r.rank_snapshot}</Tag>}</span>}
              mobileHideColumns={["Họ tên", "Hạng"]}
            />
          )}
          <Alert type="info" showIcon style={{ marginTop: 12 }}
            message="Bấm 'Bắt đầu' để mở màn chấm điểm. Trong lúc diễn ra vẫn thêm được người đến muộn." />
        </Card>
      ) : (
        <Tabs activeKey={tab} onChange={onTabChange} items={[boardTab, historyTab]} />
      )}

      {addOpen && (
        <AddParticipantsModal
          tournament={{ ...event, participants: participants.filter((p) => p.status !== "removed") }}
          title="Thêm người vào sự kiện"
          inLabel="Đã trong sự kiện"
          entityKey="event"
          submitFn={(memberIds, playerIds) => pointEventsApi.addParticipantsBulk(eventId, { member_ids: memberIds, player_ids: playerIds })}
          onAdded={(ev) => (ev ? applyServerEvent(ev) : reload())}
          onClose={() => setAddOpen(false)}
        />
      )}

      {printing && createPortal(
        <PointEventPrintSheet event={event} logs={printLogs} onReady={handlePrintReady} />,
        document.body
      )}

      <Modal title="Sửa thông tin sự kiện" open={editModal} onCancel={() => setEditModal(false)}
        onOk={handleEditInfo} okText="Lưu" cancelText="Hủy">
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Tên sự kiện" rules={[{ required: true, whitespace: true, message: "Nhập tên sự kiện" }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
