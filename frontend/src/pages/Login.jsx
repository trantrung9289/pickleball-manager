import { useState, useEffect } from "react";
import { Card, Form, Input, Button, Typography, message, Alert, Checkbox, theme } from "antd";
import {
  UserOutlined, LockOutlined, TrophyOutlined,
  ArrowLeftOutlined, SettingOutlined,
} from "@ant-design/icons";
import { useAuth } from "../context/AuthContext";
import { useAppTheme } from "../contexts/ThemeContext";

const { Title, Text } = Typography;

const KEY_USER = "rememberedUsername";
// Không còn lưu mật khẩu trong localStorage (bản rõ, đọc được bởi bất kỳ XSS nào).
// Trình duyệt đã có password manager riêng cho việc này (autoComplete="current-password" bên dưới).

// adminMode=true  → trang này dùng cho Quản trị viên hệ thống
// adminMode=false → trang này dùng cho Thành viên CLB
export default function Login({ onBack, adminMode = false, onSwitchMode }) {
  const { login, club } = useAuth();
  const { themeConfig, themeName } = useAppTheme();
  const { token: antToken } = theme.useToken();

  const [loading, setLoading]       = useState(false);
  const [wrongMode, setWrongMode]   = useState(false);
  // Lazy init: đọc localStorage ngay lúc khởi tạo state thay vì set trong effect
  const [rememberUser, setRememberUser] = useState(() => !!localStorage.getItem(KEY_USER));
  const [form] = Form.useForm();

  // form.setFieldValue là API mệnh lệnh của antd (không phải React state) nên vẫn cần effect;
  // form từ Form.useForm() ổn định giữa các lần render.
  useEffect(() => {
    const savedUser = localStorage.getItem(KEY_USER);
    if (savedUser) form.setFieldValue("username", savedUser);
  }, [form]);

  const handleLogin = async (values) => {
    setLoading(true);
    setWrongMode(false);
    try {
      const loggedUser = await login(values.username, values.password);

      if (adminMode && !loggedUser.is_superuser) { setWrongMode("member"); return; }
      if (!adminMode && loggedUser.is_superuser)  { setWrongMode("admin");  return; }

      rememberUser
        ? localStorage.setItem(KEY_USER, values.username)
        : localStorage.removeItem(KEY_USER);

    } catch (err) {
      message.error(err.response?.data?.detail || "Sai tên đăng nhập hoặc mật khẩu");
      form.setFieldValue("password", "");
    } finally {
      setLoading(false);
    }
  };

  // Gradient nền theo theme
  const gradientMap = {
    "ai-minimalist": "linear-gradient(135deg, #1A4D3A 0%, #2BA56C 60%, #4DBFA0 100%)",
    "ai-inspired":   "linear-gradient(135deg, #0A0D12 0%, #14181F 50%, #0D1F2A 100%)",
  };
  const bgGradient = gradientMap[themeName] || gradientMap["ai-minimalist"];

  // Màu icon & accent trên nền gradient tối
  const accentColor = themeConfig.sidebarActive;

  return (
    <div style={{
      minHeight: "100vh",
      background: bgGradient,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        {/* Logo + tên CLB / hệ thống */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          {adminMode
            ? <SettingOutlined style={{ fontSize: 52, color: accentColor }} />
            : <TrophyOutlined  style={{ fontSize: 52, color: accentColor }} />
          }
          <Title level={2} style={{ color: "#fff", margin: "12px 0 4px" }}>
            {adminMode ? "Quản trị hệ thống" : (club?.name || "Quản lý CLB")}
          </Title>
          <Text style={{ color: "rgba(255,255,255,0.55)" }}>
            {adminMode ? "System Admin Portal" : (club?.sport || "Thể thao Pickleball")}
          </Text>
        </div>

        <Card style={{ borderRadius: 12, background: antToken.colorBgContainer }}>
          <Title level={4} style={{ textAlign: "center", marginBottom: 20, marginTop: 0, color: antToken.colorText }}>
            {adminMode ? "Đăng nhập Quản trị viên" : "Đăng nhập"}
          </Title>

          {/* Thông báo sai mode */}
          {wrongMode === "member" && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }}
              message="Tài khoản không có quyền quản trị hệ thống"
              description={
                <div>
                  Tài khoản này là <b>Thành viên CLB</b>, không phải Quản trị viên.
                  <br />
                  <Button type="link" size="small" style={{ padding: 0, marginTop: 4 }}
                    onClick={() => onSwitchMode?.("member")}>
                    → Chuyển sang đăng nhập Thành viên CLB
                  </Button>
                </div>
              }
            />
          )}
          {wrongMode === "admin" && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }}
              message="Tài khoản Quản trị viên hệ thống"
              description={
                <div>
                  Tài khoản này là <b>Quản trị viên hệ thống</b>, không phải Thành viên CLB.
                  <br />
                  <Button type="link" size="small" style={{ padding: 0, marginTop: 4 }}
                    onClick={() => onSwitchMode?.("admin")}>
                    → Chuyển sang đăng nhập Quản trị viên
                  </Button>
                </div>
              }
            />
          )}

          <Form form={form} layout="vertical" onFinish={handleLogin} autoComplete="on">
            <Form.Item name="username" rules={[{ required: true, message: "Nhập tên đăng nhập" }]}>
              <Input
                size="large"
                prefix={<UserOutlined style={{ color: antToken.colorTextQuaternary }} />}
                placeholder="Tên đăng nhập"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item name="password" rules={[{ required: true, message: "Nhập mật khẩu" }]}>
              <Input.Password
                size="large"
                prefix={<LockOutlined style={{ color: antToken.colorTextQuaternary }} />}
                placeholder="Mật khẩu"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 16 }}>
              <Checkbox checked={rememberUser} onChange={(e) => setRememberUser(e.target.checked)}>
                <Text style={{ fontSize: 13, color: antToken.colorText }}>Ghi nhớ tài khoản</Text>
              </Checkbox>
            </Form.Item>

            <Form.Item style={{ marginBottom: 8 }}>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                Đăng nhập
              </Button>
            </Form.Item>
          </Form>

          {onBack && (
            <Button block icon={<ArrowLeftOutlined />} onClick={onBack} type="text"
              style={{ color: antToken.colorTextSecondary }}>
              Quay lại trang chủ
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
