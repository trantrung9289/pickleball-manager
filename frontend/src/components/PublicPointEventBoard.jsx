import { useEffect, useState, useCallback, useRef } from "react";
import { Card, Tag, Typography, Empty, Spin, Space, Badge, Alert, Button, theme } from "antd";
import { StarOutlined } from "@ant-design/icons";
import { useViewMode } from "../contexts/ViewModeContext";

const { Text, Title, Paragraph } = Typography;

const STATE_POLL_MS = 3000;        // sự kiện đang diễn ra: poll /state (endpoint nhẹ, bucket rate-limit 600/phút)
const STATE_POLL_SLOW_MS = 10000;  // giãn ra khi server trả 429, tới lần thành công kế tiếp
const IDLE_POLL_MS = 15000;        // đã kết thúc: poll thưa để bắt trường hợp BTC "Mở lại"
const LOG_PAGE = 200;              // khớp limit mặc định của endpoint logs
const MAX_LOG_PAGES = 25;          // trần an toàn 5000 log / lần tải
const LOG_PREVIEW = 100;           // số dòng lịch sử hiện mặc định, phần còn lại bấm "Xem thêm"
const LOGS_MIN_GAP_MS = 5000;      // /logs tối đa 1 lần / 5s dù /state đổi liên tục (chấm điểm dồn dập)
const INIT_RETRY_MS = 8000;        // lần nạp đầu lỗi mạng → thử lại thưa
const INIT_RETRY_SLOW_MS = 15000;  // ... và giãn hơn khi server trả 429

const STATUS_TAG = {
  active:    { label: "Đang diễn ra", color: "green" },
  completed: { label: "Đã kết thúc", color: "default" },
  draft:     { label: "Chuẩn bị", color: "orange" },
};

// Log trạng thái / thêm-rời người: note từ backend → câu tiếng Việt đọc xuôi
const STATUS_NOTE_LABEL = { "Bắt đầu": "Bắt đầu sự kiện", "Kết thúc": "Kết thúc sự kiện", "Mở lại": "Mở lại sự kiện" };
const PARTICIPANT_NOTE_LABEL = { "Thêm": "tham gia", "Rời": "rời sự kiện", "Thêm lại": "tham gia lại" };

const MEDAL_COLORS = { 1: "#faad14", 2: "#8c8c8c", 3: "#d46b08" };

const pad2 = (n) => String(n).padStart(2, "0");
// Backend trả datetime naive giờ VN (không có Z) → trình duyệt parse theo giờ máy, hợp với người xem trong nước
const parseTime = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmtHM = (s) => {
  const d = parseTime(s);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : "—";
};
const fmtDateTime = (s) => {
  const d = parseTime(s);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : "—";
};

/**
 * Xếp hạng người tham gia: chỉ người active được xếp hạng (điểm giảm dần, rồi thứ tự thêm), đồng điểm
 * cùng hạng (1, 1, 3); người đã rời (removed) nối ở cuối, không có hạng. Cùng quy tắc với
 * utils/pointEvents.rankParticipants của trang quản trị — viết lại cục bộ để board public tự đủ.
 */
function buildBoardRows(participants) {
  const byPoints = (a, b) => (b.points - a.points) || (a.seq - b.seq);
  const active = participants.filter((p) => p.status !== "removed").sort(byPoints);
  let rank = 0;
  const ranked = active.map((p, i) => {
    if (i === 0 || p.points !== active[i - 1].points) rank = i + 1;
    return { ...p, rank, removed: false };
  });
  const removed = participants.filter((p) => p.status === "removed").sort(byPoints)
    .map((p) => ({ ...p, rank: null, removed: true }));
  return [...ranked, ...removed];
}

/** Tải toàn bộ log có id > afterId, lặp theo trang tới khi trang cuối < limit. Ném lỗi để nơi gọi xử lý. */
async function fetchLogsAfter(api, eid, afterId) {
  const out = [];
  let after = afterId;
  for (let i = 0; i < MAX_LOG_PAGES; i++) {
    const r = await api.pointEvents.logs(eid, after, LOG_PAGE);
    const page = Array.isArray(r.data) ? r.data : [];
    out.push(...page);
    if (page.length < LOG_PAGE) break;
    after = page[page.length - 1].id;
  }
  return out;
}

/**
 * Poll nối tiếp bằng setTimeout (đổi nhịp được, không chồng request): tạm dừng khi tab ẩn (poll lại
 * ngay khi hiện), giãn `slowMs` khi 429. Bản sao cục bộ của hook cùng tên trong PublicTournamentTracker,
 * thêm tham số chu kỳ. `loadFn` là useCallback trả { ok, status }.
 */
function useFastPoll(enabled, loadFn, intervalMs, slowMs) {
  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let inflight = false;
    let timer = null;
    const tick = async () => {
      if (stopped || inflight) return;
      if (document.hidden) return;            // visibilitychange sẽ khởi động lại
      inflight = true;
      let res;
      try { res = await loadFn(); } catch (err) { res = { ok: false, status: err?.response?.status }; }
      inflight = false;
      if (stopped) return;
      timer = setTimeout(tick, res?.status === 429 ? slowMs : intervalMs);
    };
    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(tick, intervalMs);   // dữ liệu đầu đã có từ lần tải detail → chờ 1 nhịp rồi mới poll
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, loadFn, intervalMs, slowMs]);
}

// ── Một hàng bảng xếp hạng: hạng · tên (hạng CLB) · điểm — chữ to, không tràn ngang trên điện thoại ──
function BoardRow({ row, big, flashing, token }) {
  // Huy chương (vàng/bạc/đồng) chỉ cho người có điểm > 0: chưa ai ghi điểm thì không tô hạng 1 cho cả bảng
  const medalColor = !row.removed && row.points > 0 ? MEDAL_COLORS[row.rank] : undefined;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: big ? "10px 4px" : "8px 4px",
      borderBottom: `1px solid ${token.colorBorderSecondary}`,
      opacity: row.removed ? 0.45 : 1,
      background: flashing ? token.colorWarningBg : "transparent", transition: "background .6s ease",
    }}>
      <div style={{
        flex: "0 0 36px", textAlign: "center", fontWeight: 800, fontSize: big ? 18 : 16,
        color: medalColor || token.colorTextSecondary,
      }}>
        {row.removed ? "—" : row.rank}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: big ? 17 : 15, fontWeight: 600, wordBreak: "break-word", lineHeight: 1.3 }}>
          {row.display_name}
        </div>
        <div style={{ fontSize: 12, marginTop: 2 }}>
          {row.rank_snapshot
            ? <Tag style={{ marginRight: 4 }}>{row.rank_snapshot}</Tag>
            : <Text type="secondary">Chưa xếp hạng</Text>}
          {row.removed && <Text type="secondary" italic>đã rời</Text>}
        </div>
      </div>
      <div style={{
        fontSize: big ? 26 : 22, fontWeight: 800, minWidth: 44, textAlign: "right",
        fontVariantNumeric: "tabular-nums", color: row.removed ? token.colorTextSecondary : token.colorPrimary,
      }}>
        {row.points}
      </div>
    </div>
  );
}

// ── Một dòng lịch sử: "hh:mm · Tên · +1 → 5"; log trạng thái / thêm-rời người in dòng xám ──
function LogLine({ log, big, token }) {
  const time = fmtHM(log.created_at);
  const base = {
    display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", padding: big ? "6px 2px" : "4px 2px",
    borderBottom: `1px solid ${token.colorBorderSecondary}`, fontSize: big ? 15 : 13.5, lineHeight: 1.4,
  };
  if (log.kind !== "score") {
    const text = log.kind === "status"
      ? (STATUS_NOTE_LABEL[log.note] || log.note || "Đổi trạng thái")
      : `${log.display_name || "—"} · ${PARTICIPANT_NOTE_LABEL[log.note] || log.note || ""}`;
    return (
      <div style={base}>
        <Text type="secondary" style={{ fontVariantNumeric: "tabular-nums" }}>{time}</Text>
        <Text type="secondary" italic>· {text}</Text>
      </div>
    );
  }
  const up = log.delta > 0;
  return (
    <div style={base}>
      <Text type="secondary" style={{ fontVariantNumeric: "tabular-nums" }}>{time}</Text>
      <Text>· <b>{log.display_name || "—"}</b></Text>
      <Text style={{ color: up ? token.colorSuccess : token.colorError, fontWeight: 700 }}>
        · {up ? `+${log.delta}` : `−${Math.abs(log.delta)}`}
      </Text>
      <Text type="secondary">→ <b style={{ color: token.colorText }}>{log.points_after}</b></Text>
    </div>
  );
}

function LogList({ logs, big, token }) {
  const [showAll, setShowAll] = useState(false);
  if (logs.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lượt chấm nào" />;
  }
  // Mới nhất trước; logs đã tăng dần theo id nên chỉ cần đảo bản sao
  const newestFirst = [...logs].sort((a, b) => b.id - a.id);
  const shown = showAll ? newestFirst : newestFirst.slice(0, LOG_PREVIEW);
  const hidden = newestFirst.length - shown.length;
  return (
    <div>
      <div style={{ maxHeight: big ? 480 : 420, overflowY: "auto" }}>
        {shown.map((l) => <LogLine key={l.id} log={l} big={big} token={token} />)}
      </div>
      {hidden > 0 && (
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <Button size="small" onClick={() => setShowAll(true)}>Xem thêm {hidden} dòng cũ hơn</Button>
        </div>
      )}
    </div>
  );
}

/**
 * Bảng theo dõi public một sự kiện thành tích cá nhân (Mini game): bảng xếp hạng + lịch sử chấm điểm,
 * tự cập nhật khi đang diễn ra. Không hiển thị người bấm (public không có actor_name).
 *
 * Props: api (createPublicReportApi(slug)), eventId (số), refreshKey (đổi giá trị → tải lại toàn bộ).
 * Nơi gọi nên truyền key={eventId} để state được reset sạch khi đổi sự kiện.
 */
export default function PublicPointEventBoard({ api, eventId, refreshKey = 0 }) {
  const { isMobileView } = useViewMode();
  const { token } = theme.useToken();
  const [event, setEvent] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);           // 404 | "network" | null
  const [flashIds, setFlashIds] = useState(() => new Set());
  const eventRef = useRef(null);       // bản event mới nhất — loadState so version mà không đổi identity callback
  const lastLogIdRef = useRef(0);      // after_id cho lần tải log kế tiếp
  const logsDirtyRef = useRef(false);  // còn việc tải log chưa xong (lỗi/429/bị debounce) → tick sau thử lại dù version không đổi
  const logsFullRef = useRef(false);   // cần tải lại TOÀN BỘ log từ after_id=0 và thay thế (có người bị xoá cứng)
  const logsBusyRef = useRef(false);   // đang có 1 vòng tải log chạy — không chạy song song
  const logsRerunRef = useRef(false);  // có yêu cầu tải log đến lúc đang bận → chạy lại ngay khi xong
  const logsAttemptAtRef = useRef(0);  // mốc lần gọi /logs gần nhất (debounce LOGS_MIN_GAP_MS)
  const aliveRef = useRef(false);      // false sau unmount: request về muộn không setState nữa
  const flashTimerRef = useRef(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const commitEvent = useCallback((ev) => {
    eventRef.current = ev;
    setEvent(ev);
  }, []);

  const flash = useCallback((ids) => {
    if (ids.length === 0) return;
    setFlashIds(new Set(ids));
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashIds(new Set()), 1500);
  }, []);
  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  // Tải đầy đủ: detail + toàn bộ log (song song) — lúc mở board và mỗi lần bấm "Làm mới".
  // Lần nạp ĐẦU lỗi mạng/timeout/429 (chưa có event) → tự thử lại mỗi 8s (15s khi 429); dừng khi nạp được,
  // khi 404 (sự kiện không còn public) hoặc khi unmount / đổi sự kiện / bấm Làm mới (cleanup huỷ hẹn giờ).
  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    const load = async () => {
      try {
        const [detail, allLogs] = await Promise.all([
          api.pointEvents.detail(eventId).then((r) => r.data),
          fetchLogsAfter(api, eventId, 0),
        ]);
        if (cancelled) return;
        lastLogIdRef.current = allLogs.length ? allLogs[allLogs.length - 1].id : 0;
        logsDirtyRef.current = false;
        logsFullRef.current = false;
        setLogs(allLogs);
        commitEvent(detail);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 404) {
          setError(404);      // không còn public → dừng hẳn, không thử lại
        } else if (!eventRef.current) {
          // Chưa có dữ liệu → báo lỗi nhưng tự thử lại; đã có dữ liệu (đang "Làm mới") mà lỗi thoáng qua → giữ bảng cũ
          setError("network");
          retryTimer = setTimeout(load, status === 429 ? INIT_RETRY_SLOW_MS : INIT_RETRY_MS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; clearTimeout(retryTimer); };
  }, [api, eventId, refreshKey, commitEvent]);

  // Vòng tải log, TÁCH khỏi nhịp poll /state: lỗi/429 của /logs chỉ bật cờ dirty (tick sau thử lại) chứ
  // không làm vòng /state giãn nhịp. Không chạy song song: yêu cầu đến lúc đang bận → rerun, chạy lại
  // ngay khi xong (không mất dòng log cuối). Cờ full → tải từ after_id=0 và THAY toàn bộ (log "Thêm" của
  // người bị xoá cứng biến mất); ngược lại tải phần id > lastLogId và nối thêm (dedupe theo id).
  const syncLogs = useCallback(async () => {
    if (logsBusyRef.current) { logsRerunRef.current = true; return; }
    logsBusyRef.current = true;
    let full = false;
    try {
      do {
        logsRerunRef.current = false;
        logsDirtyRef.current = false;   // yêu cầu đến SAU thời điểm này sẽ bật lại cờ → không bị xoá nhầm
        logsAttemptAtRef.current = Date.now();
        full = logsFullRef.current;
        logsFullRef.current = false;
        const fetched = await fetchLogsAfter(api, eventId, full ? 0 : lastLogIdRef.current);
        if (!aliveRef.current) return;
        if (full) {
          lastLogIdRef.current = fetched.length ? fetched[fetched.length - 1].id : 0;
          setLogs(fetched);
        } else if (fetched.length > 0) {
          lastLogIdRef.current = Math.max(lastLogIdRef.current, fetched[fetched.length - 1].id);
          setLogs((prev) => {
            const seen = new Set(prev.map((l) => l.id));
            return [...prev, ...fetched.filter((l) => !seen.has(l.id))];
          });
        }
        full = false;
      } while (logsRerunRef.current);
    } catch (err) {
      if (!aliveRef.current) return;
      logsDirtyRef.current = true;                 // tick sau thử lại (429 cũng vậy)
      if (full) logsFullRef.current = true;
      logsRerunRef.current = false;
      if (err?.response?.status === 404) setError(404);
    } finally {
      logsBusyRef.current = false;
    }
  }, [api, eventId]);

  // Xin tải log: luôn bật dirty; trừ khi `force`, cách lần gọi trước < LOGS_MIN_GAP_MS thì hoãn (dirty giữ
  // nguyên → tick poll sau tải). Hoãn tối đa ~1 nhịp poll nên lịch sử trễ không quá ≈ 6s.
  const requestLogs = useCallback((force) => {
    logsDirtyRef.current = true;
    if (!force && Date.now() - logsAttemptAtRef.current < LOGS_MIN_GAP_MS) return;
    syncLogs();
  }, [syncLogs]);

  // Poll /state: version khác → cập nhật điểm/trạng thái tại chỗ; có người mới / người biến mất (xoá cứng)
  // / đổi trạng thái sự kiện → nạp lại detail (cần tên, hạng, mốc thời gian). Người biến mất còn kéo theo tải
  // lại toàn bộ log. Trả { ok, status } để vòng poll chỉ giãn nhịp khi CHÍNH /state (hoặc detail) trả 429.
  const loadState = useCallback(async () => {
    let st;
    try {
      st = (await api.pointEvents.state(eventId)).data || {};
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) setError(404);   // BTC xoá sự kiện → dừng poll; danh sách 12s của tracker sẽ chuyển mục khác
      return { ok: false, status };
    }
    const cur = eventRef.current;
    if (!cur || !Array.isArray(st.participants)) return { ok: true };
    const changed = st.version !== cur.version;
    const known = new Set(cur.participants.map((p) => p.id));
    const inState = new Set(st.participants.map((p) => p.id));
    const hasNew = st.participants.some((p) => !known.has(p.id));
    const gone = cur.participants.some((p) => !inState.has(p.id));   // bị xoá cứng: /state không còn trả người này
    let forceLogs = false;
    if (changed || hasNew || gone) {
      if (hasNew || gone || st.status !== cur.status) {
        try {
          const d = await api.pointEvents.detail(eventId);
          if (!aliveRef.current) return { ok: true };
          commitEvent(d.data);
        } catch (err) {
          const status = err?.response?.status;
          if (status === 404) setError(404);
          return { ok: false, status };
        }
        if (gone) { logsFullRef.current = true; forceLogs = true; }
      } else {
        const byId = new Map(st.participants.map((p) => [p.id, p]));
        const changedIds = [];
        const participants = cur.participants.map((p) => {
          const s = byId.get(p.id);
          if (!s || (s.points === p.points && s.status === p.status)) return p;
          if (s.points !== p.points) changedIds.push(p.id);
          return { ...p, points: s.points, status: s.status };
        });
        commitEvent({
          ...cur, version: st.version, status: st.status, participants,
          participant_count: participants.filter((p) => p.status === "active").length,
          log_count: st.log_count ?? cur.log_count,   // số lượt chấm lấy từ server, không tự cộng dồn
        });
        flash(changedIds);
      }
    }
    if (changed || gone || logsDirtyRef.current || logsFullRef.current) requestLogs(forceLogs);
    return { ok: true };
  }, [api, eventId, commitEvent, flash, requestLogs]);

  const isActive = event?.status === "active";
  useFastPoll(!!event && error !== 404, loadState, isActive ? STATE_POLL_MS : IDLE_POLL_MS, STATE_POLL_SLOW_MS);

  if (loading && !event) {
    return <div style={{ textAlign: "center", padding: 48 }}><Spin size="large" /></div>;
  }
  if (!event) {
    return (
      <Alert
        type="warning" showIcon
        message={error === 404 ? "Sự kiện không còn hiển thị công khai" : "Không tải được sự kiện — đang tự thử lại, hoặc bấm Làm mới"}
      />
    );
  }

  const rows = buildBoardRows(event.participants || []);
  const activeCount = rows.filter((r) => !r.removed).length;
  const st = STATUS_TAG[event.status] || { label: event.status, color: "default" };
  // Số lượt chấm: server là nguồn đúng (poll /state cập nhật log_count); chưa có thì đếm theo log đã tải
  const scoreLogs = logs.filter((l) => l.kind === "score").length;
  const logTotal = event.log_count ?? scoreLogs;
  const big = isMobileView;

  return (
    <div>
      {error === 404 && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="Sự kiện không còn hiển thị công khai — dữ liệu bên dưới là bản cuối đã tải" />
      )}
      <Space style={{ marginBottom: 12 }}>
        <Badge status={isActive ? "processing" : "default"} />
        <Text type="secondary">
          {isActive
            ? `Đang theo dõi chấm điểm trực tiếp (cập nhật ${STATE_POLL_MS / 1000}s)`
            : "Sự kiện đã kết thúc — bảng điểm đã chốt"}
        </Text>
      </Space>

      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <StarOutlined style={{ color: "#faad14", fontSize: 22, marginTop: 4 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Title level={big ? 4 : 3} style={{ margin: 0, wordBreak: "break-word" }}>{event.name}</Title>
            <Space size={[4, 4]} wrap style={{ marginTop: 6 }}>
              <Tag color="gold">Thành tích cá nhân</Tag>
              <Tag color={st.color}>{st.label}</Tag>
              <Text type="secondary">{activeCount} người · {logTotal} lượt chấm</Text>
            </Space>
            {event.description && (
              <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, whiteSpace: "pre-wrap" }}>
                {event.description}
              </Paragraph>
            )}
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
              Bắt đầu: {fmtDateTime(event.started_at)}
              {event.completed_at ? ` · Kết thúc: ${fmtDateTime(event.completed_at)}` : ""}
            </Text>
          </div>
        </div>
      </Card>

      <Card size="small" title="Bảng xếp hạng" style={{ marginBottom: 16 }}>
        {rows.length === 0
          ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có người tham gia" />
          : rows.map((r) => (
            <BoardRow key={r.id} row={r} big={big} flashing={flashIds.has(r.id)} token={token} />
          ))}
      </Card>

      <Card size="small" title={`Lịch sử chấm điểm (${logTotal})`}>
        <LogList logs={logs} big={big} token={token} />
      </Card>
    </div>
  );
}
