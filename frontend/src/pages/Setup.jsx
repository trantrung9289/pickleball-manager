import React, { useState } from "react";
import {
  Card, Form, Input, Button, Steps, Typography, Space,
  Row, Col, Divider, message, InputNumber,
} from "antd";
import {
  TrophyOutlined, UserOutlined, LockOutlined,
  TeamOutlined, EnvironmentOutlined,
} from "@ant-design/icons";
import { useAuth } from "../context/AuthContext";

const { Title, Text, Paragraph } = Typography;

export default function Setup() {
  const { setup } = useAuth();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [clubForm] = Form.useForm();
  const [adminForm] = Form.useForm();

  const handleFinish = async () => {
    try {
      await adminForm.validateFields();
    } catch {
      return;
    }
    const clubData = clubForm.getFieldsValue();
    const adminData = adminForm.getFieldsValue();
    const clean = (v) => (v === "" || v === undefined ? null : v);
    setLoading(true);
    try {
      await setup({
        club_name: clubData.club_name,
        sport: clubData.sport || "Pickleball",
        description: clean(clubData.description),
        founded_year: clean(clubData.founded_year),
        address: clean(clubData.address),
        phone: clean(clubData.phone),
        email: clean(clubData.email),
        admin_username: adminData.username,
        admin_password: adminData.password,
        admin_full_name: adminData.full_name,
      });
      message.success("Khởi tạo CLB thành công!");
    } catch (err) {
      message.error(err.response?.data?.detail || "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  };

  const nextStep = async () => {
    if (step === 0) {
      try { await clubForm.validateFields(["club_name"]); } catch { return; }
    }
    setStep(step + 1);
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
      <div style={{ width: "100%", maxWidth: 620 }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <TrophyOutlined style={{ fontSize: 52, color: "#faad14" }} />
          <Title level={2} style={{ color: "#fff", margin: "12px 0 4px" }}>
            Chào mừng!
          </Title>
          <Paragraph style={{ color: "rgba(255,255,255,0.65)", margin: 0 }}>
            Hãy thiết lập câu lạc bộ của bạn để bắt đầu
          </Paragraph>
        </div>

        <Card style={{ borderRadius: 12 }}>
          <Steps
            current={step}
            style={{ marginBottom: 28 }}
            items={[
              { title: "Thông tin CLB", icon: <TeamOutlined /> },
              { title: "Tài khoản Admin", icon: <UserOutlined /> },
            ]}
          />

          {/* Bước 1: Thông tin CLB */}
          {step === 0 && (
            <Form form={clubForm} layout="vertical">
              <Form.Item
                name="club_name"
                label="Tên câu lạc bộ"
                rules={[{ required: true, message: "Nhập tên câu lạc bộ" }]}
              >
                <Input size="large" placeholder="VD: CLB Pickleball Hà Nội" prefix={<TrophyOutlined />} />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="sport" label="Môn thể thao">
                    <Input placeholder="Pickleball" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="founded_year" label="Năm thành lập">
                    <InputNumber style={{ width: "100%" }} placeholder="2024" min={1900} max={2100} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="description" label="Mô tả">
                <Input.TextArea rows={2} placeholder="Giới thiệu ngắn về câu lạc bộ..." />
              </Form.Item>

              <Divider orientation="left" style={{ fontSize: 13 }}>Thông tin liên hệ (tùy chọn)</Divider>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="phone" label="Số điện thoại">
                    <Input placeholder="0912 345 678" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="email" label="Email">
                    <Input placeholder="clb@example.com" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="address" label="Địa chỉ sân">
                <Input prefix={<EnvironmentOutlined />} placeholder="Số nhà, đường, quận, thành phố..." />
              </Form.Item>
            </Form>
          )}

          {/* Bước 2: Tài khoản Admin */}
          {step === 1 && (
            <Form form={adminForm} layout="vertical">
              <div style={{
                background: "#fffbe6",
                border: "1px solid #ffe58f",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 20,
                fontSize: 13,
                color: "#7d5a00",
              }}>
                Tài khoản này sẽ là <b>Admin</b> với toàn quyền quản lý hệ thống.
              </div>

              <Form.Item
                name="full_name"
                label="Họ và tên"
                rules={[{ required: true, message: "Nhập họ tên" }]}
              >
                <Input size="large" prefix={<UserOutlined />} placeholder="Nguyễn Văn A" />
              </Form.Item>

              <Form.Item
                name="username"
                label="Tên đăng nhập"
                rules={[
                  { required: true, message: "Nhập tên đăng nhập" },
                  { min: 4, message: "Tối thiểu 4 ký tự" },
                  { pattern: /^[a-zA-Z0-9_]+$/, message: "Chỉ dùng chữ, số và dấu _" },
                ]}
              >
                <Input size="large" prefix="@" placeholder="admin" />
              </Form.Item>

              <Form.Item
                name="password"
                label="Mật khẩu"
                rules={[
                  { required: true, message: "Nhập mật khẩu" },
                  { min: 6, message: "Tối thiểu 6 ký tự" },
                ]}
              >
                <Input.Password size="large" prefix={<LockOutlined />} placeholder="Tối thiểu 6 ký tự" />
              </Form.Item>

              <Form.Item
                name="confirm"
                label="Xác nhận mật khẩu"
                rules={[
                  { required: true, message: "Xác nhận mật khẩu" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) return Promise.resolve();
                      return Promise.reject("Mật khẩu không khớp");
                    },
                  }),
                ]}
              >
                <Input.Password size="large" prefix={<LockOutlined />} placeholder="Nhập lại mật khẩu" />
              </Form.Item>
            </Form>
          )}

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            {step > 0 ? (
              <Button onClick={() => setStep(step - 1)}>← Quay lại</Button>
            ) : <span />}
            {step < 1 ? (
              <Button type="primary" size="large" onClick={nextStep}>
                Tiếp theo →
              </Button>
            ) : (
              <Button type="primary" size="large" loading={loading} onClick={handleFinish}>
                Hoàn tất & Bắt đầu
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
