import React, { useEffect, useState, useCallback } from "react";
import {
  Card, Input, Button, message, Select, Space, Typography, Tree,
} from "antd";
import { SaveOutlined, ReloadOutlined } from "@ant-design/icons";
import { adminApi } from "../api";

const { Text } = Typography;
const API_BASE = import.meta.env.VITE_API_URL || "";
const getToken = () => localStorage.getItem("token") || "";

// ── Cấu trúc menu cố định — không thay đổi thứ tự ────────────────────────────
const MENU_TREE = [
  {
    key: "members",
    title: "👥 Thành viên",
    children: [
      { key: "members_list",       title: "📋 Danh sách thành viên" },
      { key: "members_add",        title: "➕ Thêm thành viên" },
      { key: "members_upd_rank",   title: "🏆 Cập nhật hạng" },
      { key: "members_upd_status", title: "🔄 Cập nhật trạng thái" },
      { key: "members_delete",     title: "🗑 Xóa thành viên" },
    ],
  },
  { key: "thu", title: "💰 Thu tiền" },
  { key: "chi", title: "📤 Chi tiền" },
  {
    key: "report",
    title: "📊 Báo cáo",
    children: [
      { key: "report_overview",   title: "📈 Tổng quan" },
      { key: "report_monthly",    title: "📅 Theo tháng" },
      { key: "report_fee_status", title: "💳 Trạng thái phí" },
    ],
  },
  { key: "gdlist", title: "📋 Giao dịch" },
  {
    key: "category",
    title: "🗂 Danh mục khoản",
    children: [
      { key: "category_add",    title: "➕ Thêm khoản" },
      { key: "category_delete", title: "🗑 Xóa khoản" },
    ],
  },
  { key: "help", title: "❓ Hướng dẫn" },
];

function getAllKeys(nodes) {
  return nodes.flatMap((n) => [n.key, ...(n.children ? getAllKeys(n.children) : [])]);
}
const ALL_KEYS = getAllKeys(MENU_TREE);

export default function BotConfigPanel() {
  const [clubs, setClubs]               = useState([]);
  const [selectedClub, setSelectedClub] = useState(null);
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [welcomeMsg, setWelcomeMsg]     = useState("👋 Xin chào! Tôi là Bot quản lý CLB {club_name} của các bạn, chúc các bạn có một buổi thể thao vui vẻ!");
  const [checkedKeys, setCheckedKeys]   = useState(ALL_KEYS);

  useEffect(() => {
    adminApi.listClubs().then(({ data }) => {
      setClubs(data);
      if (data.length > 0) setSelectedClub(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (selectedClub) loadConfig(selectedClub);
  }, [selectedClub]); // eslint-disable-line

  const loadConfig = async (clubId) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/bot-config`, {
        headers: {
          Authorization: `Bearer ${getToken()}`,
          "X-Club-ID": String(clubId),
        },
      });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();

      if (data.welcome_message !== undefined) setWelcomeMsg(data.welcome_message);

      if (data.menu_config) {
        const cfg = JSON.parse(data.menu_config);
        setCheckedKeys(cfg.checkedKeys ?? ALL_KEYS);
      } else {
        setCheckedKeys(ALL_KEYS);
      }
    } catch {
      message.error("Không tải được cấu hình");
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = useCallback((checked) => {
    const keys = Array.isArray(checked) ? checked : checked.checked;
    setCheckedKeys(keys);
  }, []);

  const save = async () => {
    if (!selectedClub) return;
    setSaving(true);
    try {
      const payload = {
        welcome_message: welcomeMsg,
        menu_config: JSON.stringify({ checkedKeys }),
      };
      const res = await fetch(`${API_BASE}/api/bot-config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
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
    <div style={{ maxWidth: 600 }}>
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
        <>
          <Card title="Tin nhắn chào mừng" size="small" style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
              Hiển thị khi thành viên gõ /start lần đầu
            </Text>
            <Input.TextArea
              rows={3}
              maxLength={300}
              showCount
              value={welcomeMsg}
              onChange={(e) => setWelcomeMsg(e.target.value)}
            />
          </Card>

          <Card
            title="Bật / Tắt chức năng Bot"
            size="small"
            style={{ marginBottom: 16 }}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                Bỏ chọn để ẩn khỏi menu
              </Text>
            }
          >
            <Tree
              checkable
              defaultExpandAll
              checkedKeys={checkedKeys}
              treeData={MENU_TREE}
              onCheck={handleCheck}
              style={{ padding: "4px 0" }}
            />
          </Card>

          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={save}
            >
              Lưu cấu hình
            </Button>
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => loadConfig(selectedClub)}
            >
              Tải lại
            </Button>
          </Space>
        </>
      )}
    </div>
  );
}
