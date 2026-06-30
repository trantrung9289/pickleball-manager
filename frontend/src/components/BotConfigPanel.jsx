import React, { useEffect, useState } from "react";
import {
  Card, Form, Input, Switch, Button, message,
  Typography, Space, Alert, Select,
} from "antd";
import { SaveOutlined, ReloadOutlined } from "@ant-design/icons";
import { adminApi } from "../api";
import { useAuth } from "../context/AuthContext";

const { Text } = Typography;

const API_BASE = import.meta.env.VITE_API_URL || "";

const FEATURE_LABELS = {
  enable_members: "Quản lý thành viên",
  enable_thu: "Thu tiền",
  enable_chi: "Chi tiền",
  enable_report: "Báo cáo",
  enable_gdlist: "Danh sách giao dịch",
  enable_category: "Danh mục khoản",
};

const DEFAULT_CONFIG = {
  welcome_message: "👋 Xin chào! Bot quản lý CLB Pickleball.",
  ...Object.fromEntries(Object.keys(FEATURE_LABELS).map((k) => [k, "true"])),
};

export default function BotConfigPanel() {
  const { token } = useAuth();
  const [clubs, setClubs] = useState([]);
  const [selectedClub, setSelectedClub] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    adminApi.listClubs().then(({ data }) => {
      setClubs(data);
      if (data.length > 0) setSelectedClub(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (selectedClub) loadConfig(selectedClub);
  }, [selectedClub]);

  const loadConfig = async (clubId) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/bot-config`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Club-ID": String(clubId),
        },
      });
      const data = res.ok ? await res.json() : {};
      const merged = { ...DEFAULT_CONFIG, ...data };
      form.setFieldsValue({
        welcome_message: merged.welcome_message,
        ...Object.fromEntries(
          Object.keys(FEATURE_LABELS).map((k) => [k, merged[k] !== "false"])
        ),
      });
    } catch {
      message.error("Không tải được cấu hình");
    } finally {
      setLoading(false);
    }
  };

  const save = async (values) => {
    if (!selectedClub) return;
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Club-ID": String(selectedClub),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      message.success("Đã lưu cấu hình Bot");
    } catch {
      message.error("Lỗi lưu cấu hình");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 620 }}>
      <Alert
        type="info"
        showIcon
        message="Cấu hình Bot theo từng CLB. Bot Telegram vẫn dùng cùng 1 token — không cần tạo bot mới."
        style={{ marginBottom: 16 }}
      />

      <Card title="Chọn CLB cần cấu hình" size="small" style={{ marginBottom: 16 }}>
        <Select
          style={{ width: "100%" }}
          value={selectedClub}
          onChange={setSelectedClub}
          options={clubs.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Chọn câu lạc bộ..."
        />
      </Card>

      {selectedClub && (
        <Form form={form} layout="vertical" onFinish={save}>
          <Card title="Tin nhắn chào mừng" size="small" style={{ marginBottom: 16 }}>
            <Form.Item name="welcome_message" label="Hiện khi thành viên gõ /start">
              <Input.TextArea rows={3} maxLength={300} showCount />
            </Form.Item>
          </Card>

          <Card title="Bật / Tắt chức năng trong Bot" size="small" style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
              Tắt chức năng sẽ ẩn nút tương ứng khỏi menu Bot của CLB này.
            </Text>
            {Object.entries(FEATURE_LABELS).map(([key, label]) => (
              <Form.Item key={key} name={key} valuePropName="checked" style={{ marginBottom: 10 }}>
                <Switch checkedChildren="Bật" unCheckedChildren="Tắt" />
                <Text style={{ marginLeft: 10 }}>{label}</Text>
              </Form.Item>
            ))}
          </Card>

          <Space>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
              Lưu cấu hình
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => loadConfig(selectedClub)} loading={loading}>
              Tải lại
            </Button>
          </Space>
        </Form>
      )}

    </div>
  );
}
