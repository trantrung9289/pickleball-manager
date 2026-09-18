import { ConfigProvider } from "antd";
import App from "./App.jsx";
import { useAppTheme } from "./contexts/ThemeContext.jsx";

export default function ThemedApp() {
  const { themeConfig } = useAppTheme();
  return (
    <ConfigProvider theme={themeConfig.antd}>
      <App />
    </ConfigProvider>
  );
}
