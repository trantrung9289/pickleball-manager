// Hàm thuần cho sự kiện thành tích cá nhân (Mini game) — không phụ thuộc React/antd để chạy được
// bằng `node --test` (xem pointEvents.test.js). Dùng chung cho trang quản trị, trang public và bản in.

const ACTIVE = "active";

/**
 * Xếp hạng người tham gia: CHỈ gồm status "active", sắp theo điểm giảm dần rồi `seq` tăng dần (thứ tự
 * được thêm). Đồng điểm → cùng hạng, hạng kế tiếp nhảy theo số người đứng trên (1, 1, 3 — "competition ranking").
 * Trả mảng mới `{...p, rank}`; không đụng vào mảng đầu vào.
 */
export function rankParticipants(participants) {
  const active = (participants || []).filter((p) => (p?.status || ACTIVE) === ACTIVE);
  const sorted = [...active].sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (a.seq ?? 0) - (b.seq ?? 0));
  let lastPoints = null;
  let lastRank = 0;
  return sorted.map((p, i) => {
    const pts = p.points ?? 0;
    if (pts !== lastPoints) { lastRank = i + 1; lastPoints = pts; }
    return { ...p, rank: lastRank };
  });
}

/** Người đã rời sự kiện (status "removed"), sắp theo seq — hiện mờ ở cuối bảng / cuối trang in. */
export function removedParticipants(participants) {
  return (participants || [])
    .filter((p) => p?.status === "removed")
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/**
 * Áp bản rút gọn PointEventStateOut {version, status, log_count, participants:[{id, points, status}]} lên event
 * đang hiển thị. Trả `{ event, needFull }`:
 *  - needFull = true khi (a) state có participant lạ (người được thêm ở máy khác — state không mang tên),
 *    (b) một participant đang hiển thị VẮNG trong state (người bị xoá cứng ở máy khác; người rời có điểm vẫn có
 *    trong state với status "removed"), hoặc (c) trạng thái sự kiện đổi (cần started_at/completed_at…)
 *    → caller tải lại bản đầy đủ VÀ thay toàn bộ log bằng bản tải lại từ after_id=0 (log "Thêm" của người đã xoá
 *    biến mất khỏi server, append thêm không gỡ được).
 *  - ngược lại: event mới với points/status từng người, `log_count` và version cập nhật. `pendingByPid`
 *    {pid: tổng delta CHƯA được server xác nhận} được cộng vào điểm hiển thị để không "giật" về giá trị cũ khi
 *    người dùng đang bấm liên tiếp.
 * Không đổi gì khi state.version không MỚI HƠN event.version (poll trả bản cũ hơn phản hồi vừa nhận).
 */
export function mergeState(event, state, pendingByPid = {}) {
  if (!event || !state) return { event, needFull: false };
  if (!(Number(state.version) > Number(event.version ?? 0))) return { event, needFull: false };
  if (state.status && state.status !== event.status) return { event, needFull: true };
  const hasList = Array.isArray(state.participants);
  const byId = new Map((hasList ? state.participants : []).map((p) => [p.id, p]));
  const current = event.participants || [];
  const known = new Set(current.map((p) => p.id));
  for (const id of byId.keys()) if (!known.has(id)) return { event, needFull: true };
  if (hasList) for (const p of current) if (!byId.has(p.id)) return { event, needFull: true };
  const participants = current.map((p) => {
    const s = byId.get(p.id);
    if (!s) return p;
    const pending = pendingByPid[p.id] || 0;
    return { ...p, points: (s.points ?? 0) + pending, status: s.status || p.status };
  });
  const activeCount = participants.filter((p) => (p.status || ACTIVE) === ACTIVE).length;
  return {
    event: {
      ...event, version: state.version, log_count: state.log_count ?? event.log_count,
      participants, participant_count: activeCount,
    },
    needFull: false,
  };
}

/**
 * `data` (phản hồi/bản tải từ server) có CŨ HƠN bản đang hiển thị không? Chỉ so khi cùng sự kiện. Version BẰNG
 * nhau vẫn áp (đổi tên/mô tả không tăng version). Dùng để bỏ phản hồi về muộn, tránh ghi đè bản mới hơn.
 */
export function isStaleSnapshot(cur, data) {
  if (!cur || !data) return false;
  return data.id === cur.id && Number(data.version) < Number(cur.version ?? 0);
}

/** Cộng `delta` điểm cho participant `pid` (bản sao; trả lại chính event nếu không có pid). */
export function shiftPoints(event, pid, delta) {
  if (!event || !(event.participants || []).some((p) => p.id === pid)) return event;
  return {
    ...event,
    participants: event.participants.map((p) => (p.id === pid ? { ...p, points: (p.points ?? 0) + delta } : p)),
  };
}

/** Đặt bản server lên hiển thị: điểm = điểm server + tổng delta còn chờ ({pid: sum}) của từng người. */
export function withPending(data, pendingByPid = {}) {
  return {
    ...data,
    participants: (data.participants || []).map((p) => (
      pendingByPid[p.id] ? { ...p, points: (p.points ?? 0) + pendingByPid[p.id] } : p
    )),
  };
}

// ── Điểm chờ xác nhận: Map pid → [{opId, delta}]. Chỉ op CHƯA được server trả lời mới nằm trong map; op
//    được gỡ theo opId khi phản hồi của CHÍNH nó về (không gỡ theo giá trị delta vì 2 lượt +1 giống nhau). ──
export function pendingAdd(map, pid, opId, delta) {
  const arr = map.get(pid) || [];
  arr.push({ opId, delta });
  map.set(pid, arr);
}

/** Gỡ op theo opId; trả về delta đã gỡ hoặc null nếu không có. */
export function pendingRemove(map, pid, opId) {
  const arr = map.get(pid);
  if (!arr) return null;
  const i = arr.findIndex((o) => o.opId === opId);
  if (i < 0) return null;
  const [removed] = arr.splice(i, 1);
  if (!arr.length) map.delete(pid);
  return removed.delta;
}

/** {pid: tổng delta đang chờ}; bỏ pid có tổng 0. */
export function pendingTotals(map) {
  const out = {};
  map.forEach((arr, pid) => {
    const sum = arr.reduce((a, o) => a + o.delta, 0);
    if (sum) out[pid] = sum;
  });
  return out;
}

export function pendingCount(map) {
  let n = 0;
  map.forEach((arr) => { n += arr.length; });
  return n;
}

/**
 * Đóng băng thứ tự hàng: sắp `ranked` theo danh sách id `lockedIds` (chụp lúc bấm). Id mới chưa có trong khoá
 * nối cuối (giữ thứ tự xếp hạng), id đã mất thì bỏ. Hạng (`rank`) trong từng phần tử vẫn là hạng thật theo điểm.
 * lockedIds rỗng/null → trả lại nguyên `ranked`.
 */
export function applyOrderLock(ranked, lockedIds) {
  if (!lockedIds || !lockedIds.length) return ranked;
  const byId = new Map(ranked.map((p) => [p.id, p]));
  const used = new Set();
  const out = [];
  for (const id of lockedIds) {
    const p = byId.get(id);
    if (p && !used.has(id)) { out.push(p); used.add(id); }
  }
  for (const p of ranked) if (!used.has(p.id)) out.push(p);
  return out;
}

/**
 * Nối một trang log mới tải (tăng dần theo id) vào danh sách đã có, bỏ trùng id, giữ thứ tự id tăng dần.
 * Log là nhật ký chỉ-ghi-thêm nên chỉ cần lọc trùng, không cần sắp lại toàn bộ. Id không bị tái dùng (backend dùng
 * AUTOINCREMENT) nên dedupe theo id là đủ. Khi cần tải lại toàn bộ (needFull của mergeState) caller KHÔNG append
 * mà thay hẳn danh sách bằng log tải từ after_id=0 — append không gỡ được log của người đã bị xoá cứng.
 */
export function appendLogs(existing, chunk) {
  const prev = existing || [];
  if (!chunk || !chunk.length) return prev;
  const seen = new Set(prev.map((l) => l.id));
  const fresh = chunk.filter((l) => !seen.has(l.id));
  if (!fresh.length) return prev;
  const out = [...prev, ...fresh];
  // Phòng khi chunk tới không theo thứ tự (retry chồng nhau) — ổn định vì id duy nhất
  let ordered = true;
  for (let i = 1; i < out.length; i += 1) if (out[i].id < out[i - 1].id) { ordered = false; break; }
  return ordered ? out : out.sort((a, b) => a.id - b.id);
}

/** Id log lớn nhất đã có (0 khi rỗng) → truyền làm after_id cho lần tải kế tiếp. */
export function lastLogId(logs) {
  const arr = logs || [];
  return arr.length ? arr[arr.length - 1].id : 0;
}

/** Chuỗi hiển thị delta: "+1" / "−1" (dấu trừ Unicode để dễ đọc trên điện thoại). */
export function formatDelta(delta) {
  const d = Number(delta) || 0;
  if (d > 0) return `+${d}`;
  if (d < 0) return `−${Math.abs(d)}`;
  return "0";
}
