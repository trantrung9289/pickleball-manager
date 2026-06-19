import React, { useState } from "react";
import { Card, Form, Input, Button, Typography, message, Alert } from "antd";
import {
  UserOutlined, LockOutlined, TrophyOutlined,
  ArrowLeftOutlined, SettingOutlined,
} from "@ant-design/icons";
import { useAuth } from "../context/AuthContext";

const { Title, Text } = Typography;

// adminMode=true  → trang này dùng cho Quản trị viên hệ thống
// adminMode=false → trang này dùng cho Thành viên CLB
export default function Login({ onBack, adminMode = false, onSwitchMode }) {
  const { login, club } = useAuth();
  const [loading, setLoading] = useState(false);
  const [wrongMode, setWrongMode] = useState(false); // hiển thị thông báo sai mode
  const [form] = Form.useForm();

  const handleLogin = async (values) => {
    setLoading(true);
    setWrongMode(false);
    try {
      const loggedUser = await login(values.username, values.password);

      if (adminMode && !loggedUser.is_superuser) {
        // Đăng nhập ở mode Admin nhưng là tài khoản thành viên
        setWrongMode("member");
        return;
      }
      if (!adminMode && loggedUser.is_superuser) {
        // Đăng nhập ở mode Thành viên nhưng là tài khoản superuser
        setWrongMode("admin");
        return;
      }
      // OK — App.jsx sẽ tự điều hướng
    } catch (err) {
      message.error(err.response?.data?.detail || "Sai tên đăng nhập hoặc mật khẩu");
      form.setFieldValue("password", "");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #001529 0%, #003a70 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        {/* Logo + tên CLB / hệ thống */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          {adminMode
            ? <SettingOutlined style={{ fontSize: 52, color: "#faad14" }} />
            : <TrophyOutlined style={{ fontSize: 52, color: "#faad14" }} />
          }
          <Title level={2} style={{ color: "#fff", margin: "12px 0 4px" }}>
            {adminMode ? "Quản trị hệ thống" : (club?.name || "Quản lý CLB")}
          </Title>
          <Text style={{ color: "rgba(255,255,255,0.55)" }}>
            {adminMode ? "System Admin Portal" : (club?.sport || "Thể thao Pickleball")}
          </Text>
        </div>

        <Card style={{ borderRadius: 12 }}>
          <Title level={4} style={{ textAlign: "center", marginBottom: 20, marginTop: 0 }}>
            {adminMode ? "Đăng nhập Quản trị viên" : "Đăng nhập"}
          </Title>

          {/* Thông báo sai mode */}
          {wrongMode === "member" && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Tài khoản không có quyền quản trị hệ thống"
              description={
                <div>
                  Tài khoản này là <b>Thành viên CLB</b>, không phải Quản trị viên.
                  <br />
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, marginTop: 4 }}
                    onClick={() => onSwitchMode?.("member")}
                  >
                    → Chuyển sang đăng nhập Thành viên CLB
                  </Button>
                </div>
              }
            />
          )}
          {wrongMode === "admin" && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Tài khoản Quản trị viên hệ thống"
              description={
                <div>
                  Tài khoản này là <b>Quản trị viên hệ thống</b>, không phải Thành viên CLB.
                  <br />
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, marginTop: 4 }}
                    onClick={() => onSwitchMode?.("admin")}
                  >
                    → Chuyển sang đăng nhập Quản trị viên
                  </Button>
                </div>
              }
            />
          )}

          <Form form={form} layout="vertical" onFinish={handleLogin}>
            <Form.Item
              name="username"
              rules={[{ required: true, message: "Nhập tên đăng nhập" }]}
            >
              <Input
                size="large"
                prefix={<UserOutlined style={{ color: "#bbb" }} />}
                placeholder="Tên đăng nhập"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: "Nhập mật khẩu" }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined style={{ color: "#bbb" }} />}
                placeholder="Mật khẩu"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 8 }}>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                Đăng nhập
              </Button>
            </Form.Item>
          </Form>

          {onBack && (
            <Button
              block
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
              type="text"
              style={{ color: "#888" }}
            >
              Quay lại trang chủ
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
