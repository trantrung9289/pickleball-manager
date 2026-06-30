import React, { useEffect, useState } from "react";
import {
  Card, Form, Input, Switch, Button, message,
  Divider, Typography, Space, Tag, Alert,
} from "antd";
import { RobotOutlined, SaveOutlined, ReloadOutlined } from "@ant-design/icons";
import { useAuth } from "../context/AuthContext";

const { Title, Text } = Typography;

const API_BASE = import.meta.env.VITE_API_URL || "";

const DEFAULT_CONFIG = {
  welcome_message: "👋 Xin chào! Bot quản lý CLB Pickleball.",
  enable_members: "true",
  enable_thu: "true",
  enable_chi: "true",
  enable_report: "true",
  enable_gdlist: "true",
  enable_category: "true",
};

const FEATURE_LABELS = {
  enable_members: "Quản lý thành viên",
  enable_thu: "Thu tiền",
  enable_chi: "Chi tiền",
  enable_report: "Báo cáo",
  enable_gdlist: "Danh sách giao dịch",
  enable_category: "Danh mục khoản",
};

export default function BotConfig() {
  const { token, clubId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [form] = Form.useForm();

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Club-ID": String(clubId),
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/bot-config`, { headers });
      if (!res.ok) throw new Error("Lỗi tải cấu hình");
      const data = await res.json();
      const merged = { ...DEFAULT_CONFIG, ...data };
      setConfig(merged);
      form.setFieldsValue({
        welcome_message: merged.welcome_message,
        ...Object.fromEntries(
          Object.keys(FEATURE_LABELS).map((k) => [k, merged[k] !== "false"])
        ),
      });
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clubId]);

  const save = async (values) => {
    setSaving(true);
    try {
      const payload = {
        welcome_message: values.welcome_message,
        ...Object.fromEntries(
          Object.keys(FEATURE_LABELS).map((k) => [k, values[k] ? "true" : "false"])
        ),
      };
      const res = await fetch(`${API_BASE}/api/bot-config`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Lỗi lưu cấu hình");
      message.success("Đã lưu cấu hình Bot");
      load();
    } catch (e) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 8px" }}>
      <Space align="center" style={{ marginBottom: 16 }}>
        <RobotOutlined style={{ fontSize: 24 }} />
        <Title level={4} style={{ margin: 0 }}>Cấu hình Telegram Bot</Title>
      </Space>

      <Alert
        type="info"
        showIcon
        message="Thay đổi cấu hình sẽ có hiệu lực ngay khi Bot reload. Không cần deploy lại."
        style={{ marginBottom: 16 }}
      />

      <Form form={form} layout="vertical" onFinish={save}>
        <Card title="Tin nhắn chào mừng" size="small" style={{ marginBottom: 16 }}>
          <Form.Item name="welcome_message" label="Tin nhắn hiện khi gõ /start">
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Card>

        <Card title="Bật / Tắt chức năng" size="small" style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
            Tắt một chức năng sẽ ẩn nút đó khỏi menu Bot.
          </Text>
          {Object.entries(FEATURE_LABELS).map(([key, label]) => (
            <Form.Item
              key={key}
              name={key}
              valuePropName="checked"
              style={{ marginBottom: 8 }}
            >
              <Switch checkedChildren="Bật" unCheckedChildren="Tắt" />
              <Text style={{ marginLeft: 10 }}>{label}</Text>
            </Form.Item>
          ))}
        </Card>

        <Divider />

        <Space>
          <Button
            type="primary"
            htmlType="submit"
            icon={<SaveOutlined />}
            loading={saving}
          >
            Lưu cấu hình
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            Tải lại
          </Button>
        </Space>
      </Form>

      <Divider />

      <Card title="Hướng dẫn kết nối Bot" size="small">
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Text strong>1. Tạo Bot trên Telegram:</Text>
            <br />
            <Text>Nhắn tin cho <Tag>@BotFather</Tag> → gõ <Tag>/newbot</Tag> → lấy token</Text>
          </div>
          <div>
            <Text strong>2. Thêm secret vào Fly.io:</Text>
            <br />
            <Text code>fly secrets set TELEGRAM_BOT_TOKEN="&lt;token&gt;"</Text>
          </div>
          <div>
            <Text strong>3. Deploy lại:</Text>
            <br />
            <Text code>fly deploy</Text>
          </div>
          <div>
            <Text strong>4. Dùng Bot:</Text>
            <br />
            <Text>Tìm Bot trên Telegram → gõ <Tag>/start</Tag> → đăng nhập bằng tài khoản CLB</Text>
          </div>
        </Space>
      </Card>
    </div>
  );
}
