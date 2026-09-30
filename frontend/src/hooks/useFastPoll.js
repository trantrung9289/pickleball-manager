import { useEffect } from "react";

/**
 * useFastPoll — poll nhanh một tài nguyên đang "sống" (phiên bốc thăm, bảng điểm sự kiện đang diễn ra…).
 * Tổng quát hoá từ hook cục bộ trong components/PublicTournamentTracker.jsx (poll 2s / giãn 5s):
 *  - tạm dừng khi tab ẩn (document.hidden), poll lại NGAY khi tab hiện trở lại (visibilitychange);
 *  - giãn nhịp sang `slowMs` khi server trả 429 (rate-limit), trở lại `intervalMs` sau lần thành công kế tiếp;
 *  - dùng setTimeout nối tiếp thay vì setInterval để đổi nhịp được và không chồng request (inflight guard);
 *  - mỗi lượt nạp bọc Promise.race với đồng hồ `timeoutMs` (mặc định 12s → coi như lỗi mạng `{status: 0}`) để một
 *    request treo không làm vòng poll dừng vĩnh viễn (inflight không bao giờ được nhả). Kết quả về muộn của request
 *    đã bị bỏ vẫn chạy nốt loadFn — loadFn phải an toàn với phản hồi cũ (so version trước khi áp).
 *
 * @param {boolean} enabled  false → không poll (effect dọn dẹp timer/listener).
 * @param {() => Promise<{ok?: boolean, status?: number}|void>} loadFn  useCallback ổn định; trả `{status: 429}`
 *        khi bị rate-limit để hook giãn nhịp. Nên tự bắt lỗi bên trong (hook vẫn phòng hờ try/catch).
 * @param {{intervalMs?: number, slowMs?: number, timeoutMs?: number}} [options]  nhịp thường / nhịp khi 429 /
 *        thời gian chờ tối đa một lượt nạp (ms).
 */
export function useFastPoll(enabled, loadFn, { intervalMs = 2000, slowMs = 5000, timeoutMs = 12000 } = {}) {
  useEffect(() => {
    if (!enabled || typeof loadFn !== "function") return undefined;
    let stopped = false;
    let inflight = false;
    let timer = null;
    const tick = async () => {
      if (stopped || inflight) return;
      if (document.hidden) return;            // visibilitychange sẽ khởi động lại
      inflight = true;
      let res;
      let limitTimer;
      const timeout = new Promise((resolve) => {
        limitTimer = setTimeout(() => resolve({ ok: false, status: 0 }), timeoutMs);
      });
      try {
        res = await Promise.race([loadFn(), timeout]);
      } catch (err) {
        res = { ok: false, status: err?.response?.status ?? 0 };
      } finally {
        clearTimeout(limitTimer);
      }
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
    tick();   // nạp ngay lần đầu, không chờ hết một nhịp
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, loadFn, intervalMs, slowMs, timeoutMs]);
}

export default useFastPoll;
