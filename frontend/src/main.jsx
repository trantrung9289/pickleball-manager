import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./index.css";
import { ThemeProvider } from "./contexts/ThemeContext.jsx";
import ThemedApp from "./ThemedApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </StrictMode>
);

// Service worker chỉ phục vụ Web Push (public/sw.js), không cache; lỗi đăng ký thì bỏ qua (không ảnh hưởng app)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  });
}

