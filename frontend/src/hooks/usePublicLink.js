/**
 * Link công khai đang bật của CLB hiện tại (2026-10-30) → URL tuyệt đối để chèn vào nội dung chia sẻ. null nếu chưa có.
 * Gọi /api/report-links một lần khi mount; lỗi (không có quyền, mạng) → null, không báo.
 */
import { useEffect, useState } from "react";
import { reportLinksApi } from "../api";

export default function usePublicLink(enabled = true) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    reportLinksApi.list().then((r) => {
      if (!alive) return;
      const link = (r.data || []).find((l) => l.is_active && (l.slug || l.token));
      setUrl(link ? `${window.location.origin}/public/report/${link.slug || link.token}` : null);
    }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [enabled]);
  return url;
}
