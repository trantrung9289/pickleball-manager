import { useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";

/**
 * Bản in sự kiện thành tích cá nhân (Mini game) — render ẩn (display:none ngoài màn hình in, xem
 * .print-sheet-root trong index.css), chỉ hiện khi in. Thuần HTML/CSS inline như TournamentPrintSheet,
 * không dùng antd để bản in không phụ thuộc theme.
 *
 * Hợp đồng: <PointEventPrintSheet event={PointEventOut} logs={PointLogOut[]} onReady={fn} />
 *  - Trang 1: BẢNG ĐIỂM THÀNH TÍCH CÁ NHÂN — bảng xếp hạng (đồng điểm cùng hạng, người đã rời ở cuối).
 *  - Trang 2+: LỊCH SỬ CHẤM ĐIỂM theo thứ tự thời gian (log trạng thái in nghiêng), cột "Người chấm"
 *    lấy actor_name (chỉ có ở API admin; thiếu → "—").
 *  - onReady() được gọi ĐÚNG 1 lần khi đã có event (calledRef chặn gọi lại, kể cả StrictMode dev
 *    mount 2 lần) → nơi gọi window.print().
 *  - Mỗi trang in có sức chứa riêng (xem hằng số bên dưới) và được chia bằng hàm thuần paginate().
 */

const STATUS_LABEL = { draft: "Chuẩn bị", active: "Đang diễn ra", completed: "Đã kết thúc" };
const STATUS_NOTE_LABEL = { "Bắt đầu": "Bắt đầu sự kiện", "Kết thúc": "Kết thúc sự kiện", "Mở lại": "Mở lại sự kiện" };
const PARTICIPANT_NOTE_LABEL = { "Thêm": "tham gia", "Rời": "rời sự kiện", "Thêm lại": "tham gia lại" };

// Sức chứa (số hàng) mỗi trang A4 dọc. Vùng in được ≈ 269mm ≈ 1017px; hàng bảng xếp hạng ≈ 26px, hàng
// lịch sử ≈ 24px (lineHeight cố định 1.2 trong td/th). Tự chia trang thay vì để trình duyệt tràn: trang
// tràn tự động mất lề trên 14mm của .print-page.
//  - Trang xếp hạng đầu: đã trừ SheetHeader + tiêu đề mục + tiêu đề cột + ô "Hạng nhất" + chữ ký + footnote
//    (vì nếu chỉ có 1 trang thì tất cả nằm chung 1 trang). Đo thực (Chrome/macOS, 26 hàng) còn dư ≈ 225px
//    → mô tả/tên sự kiện dài tới ≈ 150px chưa phải bớt hàng (xem firstPageRowsLost).
//  - Trang xếp hạng tiếp: chỉ ContinuationHeader + tiêu đề cột; riêng trang tiếp CUỐI phải chừa
//    RANK_LAST_RESERVE hàng cho ô "Hạng nhất" + chữ ký + footnote.
//  - Trang lịch sử: tương tự, trang tiếp cuối chừa LOG_LAST_RESERVE hàng cho footnote.
export const RANK_FIRST_PAGE_ROWS = 26;
export const RANK_NEXT_PAGE_ROWS = 36;   // 38 × 26px vượt vùng in ≈ 17px (đo thực) → 36, dư ≈ 35px
export const RANK_LAST_RESERVE = 5;
export const LOG_FIRST_PAGE_ROWS = 32;
export const LOG_NEXT_PAGE_ROWS = 38;
export const LOG_LAST_RESERVE = 2;
const ROW_PX = 25;              // chiều cao 1 hàng bảng xếp hạng (để quy đổi khối mô tả ra số hàng)
const FIRST_PAGE_SLACK_PX = 150; // phần dư đã nằm sẵn trong RANK_FIRST_PAGE_ROWS (225px đo được, chừa ≈75px an toàn)

const pad2 = (n) => String(n).padStart(2, "0");
// Backend trả datetime naive giờ VN (không có Z) → trình duyệt parse theo giờ máy
const parseTime = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmtDate = (s) => {
  const d = parseTime(s);
  return d ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : "____ / ____ / ______";
};
const fmtHMDate = (s) => {
  const d = parseTime(s);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}` : "—";
};

/**
 * Chia mảng thành các trang với sức chứa khác nhau: trang đầu tối đa `first` hàng, các trang tiếp theo tối
 * đa `next` hàng. Nếu trang CUỐI là trang tiếp theo thì tối đa `next - reserveLast` hàng (chừa chỗ cho khối
 * nằm cuối tài liệu); phần dôi ra được tách đôi thành 2 trang. Mảng rỗng → 1 trang rỗng. Hàm thuần.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hàm thuần export để kiểm thử, không ảnh hưởng fast refresh của component
export function paginate(list, first, next, reserveLast = 0) {
  if (list.length <= first) return [list.slice()];   // gồm cả mảng rỗng → [[]] (1 trang rỗng)
  const pages = [list.slice(0, first)];
  for (let i = first; i < list.length; i += next) pages.push(list.slice(i, i + next));
  const lastCap = Math.max(1, next - reserveLast);
  const last = pages[pages.length - 1];
  if (last.length > lastCap) {
    const cut = Math.ceil(last.length / 2);
    pages.splice(pages.length - 1, 1, last.slice(0, cut), last.slice(cut));
  }
  return pages;
}

/**
 * Số hàng trang xếp hạng đầu phải nhường cho mô tả dài / tên sự kiện dài (ước lượng theo số ký tự: mô tả
 * 12px ≈ 95 ký tự/dòng × 16px, tên sự kiện ≈ 55 ký tự/dòng × 16px). Phần nằm trong FIRST_PAGE_SLACK_PX
 * đã được RANK_FIRST_PAGE_ROWS tính sẵn. Hàm thuần.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hàm thuần export để kiểm thử
export function firstPageRowsLost(event) {
  const lines = (text, perLine) => String(text || "").split("\n")
    .reduce((sum, ln) => sum + Math.max(1, Math.ceil(ln.length / perLine)), 0);
  const descPx = event?.description ? lines(event.description, 95) * 16 + 8 : 0;
  const namePx = Math.max(0, lines(event?.name, 55) - 1) * 16;
  return Math.max(0, Math.ceil((descPx + namePx - FIRST_PAGE_SLACK_PX) / ROW_PX));
}

/**
 * Xếp hạng: chỉ người active (điểm giảm dần rồi thứ tự thêm), đồng điểm cùng hạng (1, 1, 3); người đã
 * rời nối ở cuối, không hạng. Cùng quy tắc với bảng public và utils/pointEvents.rankParticipants.
 */
function buildRows(participants) {
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

// ── Khối tiêu đề dùng chung mọi trang in (mẫu SheetHeader của TournamentPrintSheet) ─────────────
function SheetHeader({ event, subtitle, activeCount, scoreCount }) {
  // Portal vào document.body vẫn giữ React context → đọc được CLB đang chọn (public không có → gạch trống).
  const clubName = useAuth()?.selectedClub?.name;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16,
      borderBottom: "3px solid #141413", paddingBottom: 10, marginBottom: 10,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#888" }}>
          {clubName || "CLB: ___________________"}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>{subtitle}</div>
        <div style={{ fontSize: 12.5, color: "#555", marginTop: 2, wordBreak: "break-word" }}>
          Sự kiện: <b style={{ color: "#141413" }}>{event.name}</b>
        </div>
      </div>
      <div style={{ textAlign: "right", fontSize: 12, color: "#555", lineHeight: 1.6, whiteSpace: "nowrap" }}>
        Ngày: <b>{fmtDate(event.created_at)}</b>
        &nbsp;·&nbsp; Số người: <b>{activeCount}</b>
        &nbsp;·&nbsp; {scoreCount} lượt chấm
        <br />Trạng thái: <b>{STATUS_LABEL[event.status] || event.status || "—"}</b>
      </div>
    </div>
  );
}

// Tiêu đề trang tiếp theo (gọn hơn SheetHeader) khi một bảng phải chia nhiều trang
function ContinuationHeader({ event, subtitle, pageIndex, pageCount }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      borderBottom: "2px solid #141413", paddingBottom: 6, marginBottom: 8,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800 }}>{subtitle} (tiếp)</div>
      <div style={{ fontSize: 11, color: "#555", whiteSpace: "nowrap" }}>
        {event.name} &nbsp;·&nbsp; trang {pageIndex + 1}/{pageCount}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "#555", textTransform: "uppercase",
      margin: "6px 0 4px", paddingBottom: 3, borderBottom: "2px solid #141413",
    }}>
      {children}
    </div>
  );
}

// lineHeight cố định (không để "normal" theo từng font hệ điều hành: Segoe UI/Noto cao hơn SF ≈ 14%) →
// chiều cao hàng ≈ như nhau trên mọi máy, sức chứa trang ở trên đo được và không tràn khi in từ Windows/Linux.
const thStyle = (align) => ({
  fontSize: 11, lineHeight: 1.2, textTransform: "uppercase", letterSpacing: ".04em", color: "#666", fontWeight: 700,
  borderBottom: "1.5px solid #141413", padding: "4px 6px", textAlign: align, whiteSpace: "nowrap",
});
const tdStyle = (align, extra) => ({
  fontSize: 12.5, lineHeight: 1.2, padding: "4px 6px", borderBottom: "1px solid #e5e5e5", textAlign: align, verticalAlign: "top",
  ...extra,
});

// ── Bảng xếp hạng: Hạng · Họ tên · Hạng CLB · Điểm ───────────────────────────────────────────
const RANK_COLS = [
  { label: "Hạng", width: 48, align: "center" },
  { label: "Họ tên", width: null, align: "left" },
  { label: "Hạng CLB", width: 90, align: "center" },
  { label: "Điểm", width: 64, align: "center" },
];

function RankingTable({ rows }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <colgroup>
        {RANK_COLS.map((c) => <col key={c.label} style={c.width ? { width: c.width } : undefined} />)}
      </colgroup>
      <thead>
        <tr>{RANK_COLS.map((c) => <th key={c.label} style={thStyle(c.align)}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr style={{ breakInside: "avoid" }}><td colSpan={RANK_COLS.length} style={tdStyle("center", { color: "#999", fontStyle: "italic" })}>Chưa có người tham gia</td></tr>
        )}
        {rows.map((r) => {
          const muted = r.removed ? { color: "#999", fontStyle: "italic" } : null;
          return (
            <tr key={r.id} style={{ breakInside: "avoid" }}>
              <td style={tdStyle("center", { fontWeight: 800, fontSize: 13.5, ...muted })}>{r.removed ? "—" : r.rank}</td>
              <td style={tdStyle("left", { wordBreak: "break-word", fontWeight: r.rank === 1 && r.points > 0 ? 700 : 400, ...muted })}>
                {r.display_name}
                {r.removed && <span style={{ fontSize: 11, marginLeft: 6 }}>(đã rời)</span>}
              </td>
              <td style={tdStyle("center", muted)}>{r.rank_snapshot || "—"}</td>
              <td style={tdStyle("center", { fontWeight: 800, fontSize: 14, ...muted })}>{r.points}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Lịch sử chấm điểm: Thời gian · Người · ± · Điểm sau · Người chấm ─────────────────────────
const LOG_COLS = [
  { label: "Thời gian", width: 96, align: "left" },
  { label: "Người", width: null, align: "left" },
  { label: "±", width: 40, align: "center" },
  { label: "Điểm sau", width: 66, align: "center" },
  { label: "Người chấm", width: 110, align: "left" },
];

function LogTable({ logs }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <colgroup>
        {LOG_COLS.map((c) => <col key={c.label} style={c.width ? { width: c.width } : undefined} />)}
      </colgroup>
      <thead>
        <tr>{LOG_COLS.map((c) => <th key={c.label} style={thStyle(c.align)}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {logs.map((l) => {
          if (l.kind !== "score") {
            // Log trạng thái sự kiện / thêm-rời người: 1 dòng nghiêng, xám, kéo dài các cột giữa
            const text = l.kind === "status"
              ? (STATUS_NOTE_LABEL[l.note] || l.note || "Đổi trạng thái")
              : `${l.display_name || "—"} · ${PARTICIPANT_NOTE_LABEL[l.note] || l.note || ""}`;
            return (
              <tr key={l.id} style={{ breakInside: "avoid" }}>
                <td style={tdStyle("left", { color: "#777", fontStyle: "italic", whiteSpace: "nowrap" })}>{fmtHMDate(l.created_at)}</td>
                <td colSpan={3} style={tdStyle("left", { color: "#777", fontStyle: "italic" })}>{text}</td>
                <td style={tdStyle("left", { color: "#777", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                  {l.actor_name || "—"}
                </td>
              </tr>
            );
          }
          const up = l.delta > 0;
          return (
            <tr key={l.id} style={{ breakInside: "avoid" }}>
              <td style={tdStyle("left", { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" })}>{fmtHMDate(l.created_at)}</td>
              <td style={tdStyle("left", { wordBreak: "break-word" })}>{l.display_name || "—"}</td>
              <td style={tdStyle("center", { fontWeight: 800, color: up ? "#237804" : "#a8071a" })}>
                {up ? `+${l.delta}` : `−${Math.abs(l.delta)}`}
              </td>
              <td style={tdStyle("center", { fontWeight: 700 })}>{l.points_after}</td>
              <td style={tdStyle("left", { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{l.actor_name || "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function PointEventPrintSheet({ event, logs, onReady }) {
  // Dữ liệu đã có sẵn từ props (nơi gọi tải xong logs rồi mới mount) → báo sẵn sàng 1 lần khi đã có event.
  // calledRef giữ qua lần mount giả của StrictMode (dev) nên window.print() không bị gọi 2 lần.
  const calledRef = useRef(false);
  const hasEvent = !!event;
  useEffect(() => {
    if (!hasEvent || calledRef.current) return;
    calledRef.current = true;
    onReady?.();
  }, [hasEvent, onReady]);

  if (!event) return null;

  const rows = buildRows(event.participants || []);
  const activeCount = rows.filter((r) => !r.removed).length;
  const sortedLogs = [...(logs || [])].sort((a, b) => a.id - b.id);   // in theo thứ tự thời gian
  const scoreCount = sortedLogs.filter((l) => l.kind === "score").length;
  const rankFirst = Math.max(8, RANK_FIRST_PAGE_ROWS - firstPageRowsLost(event));
  const rankPages = paginate(rows, rankFirst, RANK_NEXT_PAGE_ROWS, RANK_LAST_RESERVE);
  const logPages = sortedLogs.length > 0
    ? paginate(sortedLogs, LOG_FIRST_PAGE_ROWS, LOG_NEXT_PAGE_ROWS, LOG_LAST_RESERVE)
    : [];
  // Hạng nhất chỉ có nghĩa khi có người ghi điểm: chưa ai có điểm thì không vinh danh ai
  const winners = rows.filter((r) => r.rank === 1 && !r.removed && r.points > 0);

  return (
    <div className="print-sheet-root">
      {rankPages.map((pageRows, i) => (
        <div key={`rank-${i}`} className="print-page print-portrait">
          {i === 0
            ? <SheetHeader event={event} subtitle="BẢNG ĐIỂM THÀNH TÍCH CÁ NHÂN" activeCount={activeCount} scoreCount={scoreCount} />
            : <ContinuationHeader event={event} subtitle="BẢNG XẾP HẠNG" pageIndex={i} pageCount={rankPages.length} />}
          {i === 0 && event.description && (
            <div style={{ fontSize: 12, color: "#555", margin: "0 0 8px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {event.description}
            </div>
          )}
          {i === 0 && <SectionTitle>Bảng xếp hạng</SectionTitle>}
          <RankingTable rows={pageRows} />
          {i === rankPages.length - 1 && (
            <>
              {winners.length > 0 && event.status === "completed" && (
                <div style={{ marginTop: 14, padding: "8px 12px", border: "1.3px solid #141413", borderRadius: 6, fontSize: 13, breakInside: "avoid" }}>
                  <b>Hạng nhất:</b> {winners.map((w) => w.display_name).join(", ")} — <b>{winners[0].points}</b> điểm
                </div>
              )}
              <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", breakInside: "avoid" }}>
                <span>Bắt đầu: {fmtHMDate(event.started_at)} &nbsp;·&nbsp; Kết thúc: {fmtHMDate(event.completed_at)}</span>
                <span>Người lập bảng: _______________</span>
              </div>
              <div className="print-footnote">
                Điểm cộng/trừ từng lượt bằng nút +/− trên ứng dụng; đồng điểm xếp cùng hạng.
                {logPages.length > 0 && " Chi tiết từng lượt chấm ở các trang sau."}
              </div>
            </>
          )}
        </div>
      ))}

      {logPages.map((pageLogs, i) => (
        <div key={`log-${i}`} className="print-page print-portrait">
          {i === 0
            ? <SheetHeader event={event} subtitle="LỊCH SỬ CHẤM ĐIỂM" activeCount={activeCount} scoreCount={scoreCount} />
            : <ContinuationHeader event={event} subtitle="LỊCH SỬ CHẤM ĐIỂM" pageIndex={i} pageCount={logPages.length} />}
          <LogTable logs={pageLogs} />
          {i === logPages.length - 1 && (
            <div className="print-footnote">
              {scoreCount} lượt chấm · {sortedLogs.length - scoreCount} dòng trạng thái/thêm-rời người · theo thứ tự thời gian
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
