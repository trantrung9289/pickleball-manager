/* Service worker viết tay (2026-10-28) — CHỈ nhận Web Push và mở trang khi bấm thông báo. Không cache tài nguyên
   (tránh phục vụ bản build cũ sau deploy). Đăng ký ở src/main.jsx với scope "/". */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Thông báo", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "Thông báo CLB";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,          // cùng tag → thay thế, không chồng tin
    renotify: !!data.tag,
    data: { url: data.url || "/" },
  };
  // Số đếm trên icon màn hình chính (Badging API; iOS ≥16.4 với web app đã cài; trình duyệt không hỗ trợ thì bỏ qua)
  const badge = self.registration.getNotifications().then((list) => {
    const n = list.length + 1;
    return self.navigator.setAppBadge ? self.navigator.setAppBadge(n).catch(() => {}) : null;
  }).catch(() => {});
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badge]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const target = new URL(url, self.location.origin).href;
    for (const c of list) {
      if (c.url === target && "focus" in c) return c.focus();
    }
    for (const c of list) {
      if ("navigate" in c && "focus" in c) return c.navigate(target).then((w) => w && w.focus());
    }
    return self.clients.openWindow(target);
  }));
});
