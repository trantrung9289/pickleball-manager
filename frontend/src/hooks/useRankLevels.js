/**
 * useRankLevels — danh sách hạng của CLB (cấu hình ở cấp CLB, dùng chung Thành viên / Khách mời /
 * quy tắc ghép đội). Gọi GET /api/club/rank-levels một lần, cache ở module theo `selectedClubId`
 * (đổi CLB → tải lại); mọi component đang dùng hook cùng nhận bản mới sau `refresh()` (gọi sau khi PUT).
 * Chỉ dùng ở trang admin (cần auth) — public không gọi hook này.
 *
 * Trả { levels: string[], unranked: "Chưa xếp hạng", options: [...levels, unranked], inUse: {hạng: số người},
 *       loading, error (lỗi tải gần nhất — khi đó levels là bản cũ hoặc danh sách mặc định), refresh }.
 * Kết quả lỗi KHÔNG được cache: giữ bản thành công trước nếu có, không thì lần mount sau thử lại.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { authApi } from "../api";
import { UNRANKED } from "../utils/drawMath";

/** Dự phòng khi chưa tải được (mất mạng / backend cũ) — trùng DEFAULT_RANK_LEVELS của backend. */
export const DEFAULT_RANK_LEVELS = ["A", "B", "C", "D", "Hạt giống 1", "Hạt giống 2", "Hạt giống 3"];

const EMPTY_IN_USE = Object.freeze({});
const FALLBACK = Object.freeze({ levels: DEFAULT_RANK_LEVELS, unranked: UNRANKED, inUse: EMPTY_IN_USE });

const cache = new Map();      // clubKey → {levels, unranked, inUse} — CHỈ kết quả tải thành công
const lastError = new Map();  // clubKey → Error của lần tải gần nhất thất bại (xoá khi tải lại thành công)
const inflight = new Map();   // clubKey → Promise
const listeners = new Set();
let version = 0;              // tăng mỗi lần cache/inflight đổi → useSyncExternalStore re-render

const clubKey = () => {
  try { return localStorage.getItem("selectedClubId") || ""; } catch { return ""; }
};
const notify = () => { version += 1; listeners.forEach((fn) => fn()); };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getSnapshot = () => version;

const fromResponse = (data) => ({
  levels: Array.isArray(data?.rank_levels) ? data.rank_levels.map((x) => String(x)) : DEFAULT_RANK_LEVELS,
  unranked: data?.unranked_label || UNRANKED,
  inUse: data?.in_use && typeof data.in_use === "object" ? data.in_use : EMPTY_IN_USE,
});

/**
 * Tải (hoặc tải lại) danh sách hạng của CLB `key`. Lỗi KHÔNG được cache: giữ bản thành công trước đó nếu có,
 * không thì xoá key để lần mount hook kế tiếp thử lại; lỗi được ghi vào lastError để UI cảnh báo.
 */
function load(key, force = false) {
  if (!force && cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const p = authApi.rankLevels()
    .then((r) => {
      cache.set(key, fromResponse(r.data));
      lastError.delete(key);
      return cache.get(key);
    })
    .catch((err) => {
      lastError.set(key, err);
      // Không cache kết quả lỗi: cache chỉ giữ bản thành công trước đó (nếu có); không có → key vẫn trống
      // nên lần mount hook kế tiếp sẽ tải lại
      return cache.get(key) || FALLBACK;
    })
    .finally(() => { inflight.delete(key); notify(); });
  inflight.set(key, p);
  notify();
  return p;
}

export function useRankLevels() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const key = clubKey();
  const entry = cache.get(key);
  const error = lastError.get(key) || null;

  // Chỉ tải khi chưa có bản thành công và không có yêu cầu đang chạy; lần tải lỗi trước đó (không có cache)
  // sẽ được thử lại ở lần mount kế tiếp của bất kỳ component nào dùng hook
  useEffect(() => {
    if (!cache.has(key) && !inflight.has(key)) load(key);
  }, [key]);

  const refresh = useCallback(() => load(key, true), [key]);
  const data = entry || FALLBACK;
  const options = useMemo(() => [...data.levels, data.unranked], [data.levels, data.unranked]);

  return {
    levels: data.levels,
    unranked: data.unranked,
    options,
    inUse: data.inUse,
    // loading: đang gọi API, hoặc chưa có dữ liệu và cũng chưa có lỗi (lần mount đầu, effect sắp gọi load)
    loading: inflight.has(key) || (!entry && !error),
    error,                    // lỗi lần tải gần nhất — UI hiện cảnh báo nhỏ
    isFallback: !!error && !entry,   // lỗi và CHƯA từng tải thành công → đang dùng danh sách mặc định
    stale: !!error && !!entry,       // lỗi nhưng còn bản tải thành công trước đó → đang dùng bản cũ (đúng của CLB)
    refresh,
  };
}

export default useRankLevels;
