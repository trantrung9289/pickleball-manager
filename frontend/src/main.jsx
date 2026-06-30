import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import "antd/dist/reset.css";
import "./index.css";
import App from "./App.jsx";
import { ThemeProvider, useAppTheme } from "./contexts/ThemeContext.jsx";

function ThemedApp() {
  const { themeConfig } = useAppTheme();
  return (
    <ConfigProvider theme={themeConfig.antd}>
      <App />
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </StrictMode>
);
