import React, { useEffect, useState, useCallback } from "react";
import {
  Card, Input, Button, message, Space, Typography, Tree,
  Switch, Table, Modal, DatePicker, Spin, Tag, Divider,
} from "antd";
import { SaveOutlined, ReloadOutlined, BellOutlined, EyeOutlined, SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

const { Text } = Typography;
const API_BASE = import.meta.env.VITE_API_URL || "";
const getToken  = () => localStorage.getItem("token")  || "";
const getClubId = () => localStorage.getItem("clubId") || "";

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

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
    "X-Club-ID": getClubId(),
  };
}

export default function BotConfigPanel() {
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [welcomeMsg, setWelcomeMsg]     = useState("👋 Xin chào! Tôi là Bot quản lý CLB {club_name} của các bạn, chúc các bạn có một buổi thể thao vui vẻ!");
  const [checkedKeys, setCheckedKeys]   = useState(ALL_KEYS);

  const [feeTypes, setFeeTypes]             = useState([]);
  const [savingFeeType, setSavingFeeType]   = useState(null);
  const [reminderMonth, setReminderMonth]   = useState(dayjs());
  const [previewData, setPreviewData]       = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending]               = useState(false);
  const [showPreview, setShowPreview]       = useState(false);

  useEffect(() => {
    loadConfig();
    loadFeeTypes();
  }, []); // eslint-disable-line

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/bot-config`, { headers: authHeaders() });
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

  const loadFeeTypes = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/fee-types`, { headers: authHeaders() });
      if (!res.ok) return;
      setFeeTypes(await res.json());
    } catch { /* silent */ }
  };

  const handleCheck = useCallback((checked) => {
    setCheckedKeys(Array.isArray(checked) ? checked : checked.checked);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/bot-config`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          welcome_message: welcomeMsg,
          menu_config: JSON.stringify({ checkedKeys }),
        }),
      });
      if (!res.ok) throw new Error();
      message.success("Đã lưu cấu hình Bot");
    } catch {
      message.error("Lỗi lưu cấu hình");
    } finally {
      setSaving(false);
    }
  };

  const toggleRemindEnabled = async (feeType, checked) => {
    setSavingFeeType(feeType.id);
    try {
      const res = await fetch(`${API_BASE}/api/fee-types/${feeType.id}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ remind_enabled: checked }),
      });
      if (!res.ok) throw new Error();
      setFeeTypes((prev) => prev.map((ft) => ft.id === feeType.id ? { ...ft, remind_enabled: checked } : ft));
      message.success(checked ? "Đã bật nhắc đóng phí" : "Đã tắt nhắc đóng phí");
    } catch {
      message.error("Lỗi cập nhật");
    } finally {
      setSavingFeeType(null);
    }
  };

  const handlePreview = async () => {
    if (!reminderMonth) return;
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const m = reminderMonth.month() + 1;
      const y = reminderMonth.year();
      const res = await fetch(`${API_BASE}/api/fee-reminders/preview?month=${m}&year=${y}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(res.status);
      setPreviewData(await res.json());
      setShowPreview(true);
    } catch (e) {
      message.error("Lỗi tải dữ liệu preview: " + e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSendNow = async () => {
    if (!reminderMonth) return;
    setSending(true);
    try {
      const m = reminderMonth.month() + 1;
      const y = reminderMonth.year();
      const res = await fetch(`${API_BASE}/api/fee-reminders/send?month=${m}&year=${y}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      message.success(
        `Đã gửi ${data.sent} tin nhắn` +
        (data.skipped_already_sent_today ? `, bỏ qua ${data.skipped_already_sent_today} (đã gửi hôm nay)` : "")
      );
      if (data.errors?.length) message.warning(`${data.errors.length} lỗi gửi — kiểm tra log server`);
      setShowPreview(false);
    } catch (e) {
      message.error("Lỗi gửi: " + e.message);
    } finally {
      setSending(false);
    }
  };

  const incomeFeeTypes = feeTypes.filter((ft) => ft.type === "income");

  return (
    <div style={{ maxWidth: 580 }}>
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
        extra={<Text type="secondary" style={{ fontSize: 12 }}>Bỏ chọn để ẩn khỏi menu</Text>}
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

      <Card
        title={<><BellOutlined style={{ marginRight: 6 }} />Nhắc đóng phí qua Telegram</>}
        size="small"
        style={{ marginBottom: 16 }}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 12 }}>
          Bật nhắc cho các khoản thu — Bot gửi Telegram cho bạn vào 14h mỗi ngày (5 ngày cuối tháng M và 5 ngày đầu tháng M+1).
        </Text>

        {incomeFeeTypes.length === 0 ? (
          <Text type="secondary">Chưa có khoản thu nào.</Text>
        ) : (
          <Table
            size="small"
            pagination={false}
            dataSource={incomeFeeTypes}
            rowKey="id"
            columns={[
              { title: "Khoản thu", dataIndex: "name" },
              {
                title: "Nhắc Telegram",
                key: "remind",
                width: 120,
                align: "center",
                render: (_, ft) => (
                  <Switch
                    checked={!!ft.remind_enabled}
                    loading={savingFeeType === ft.id}
                    onChange={(checked) => toggleRemindEnabled(ft, checked)}
                    size="small"
                  />
                ),
              },
            ]}
          />
        )}

        <Divider style={{ margin: "16px 0 12px" }} />

        <Text strong style={{ display: "block", marginBottom: 8 }}>Gửi nhắc thủ công</Text>
        <Space wrap>
          <DatePicker
            picker="month"
            value={reminderMonth}
            onChange={setReminderMonth}
            format="MM/YYYY"
            allowClear={false}
          />
          <Button icon={<EyeOutlined />} loading={previewLoading} onClick={handlePreview}>
            Xem trước
          </Button>
          <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={handleSendNow}>
            Gửi ngay
          </Button>
        </Space>
      </Card>

      <Space>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
          Lưu cấu hình
        </Button>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={loadConfig}>
          Tải lại
        </Button>
      </Space>

      <Modal
        title={`Xem trước nhắc đóng phí — ${reminderMonth?.format("MM/YYYY")}`}
        open={showPreview}
        onCancel={() => setShowPreview(false)}
        footer={[
          <Button key="close" onClick={() => setShowPreview(false)}>Đóng</Button>,
          <Button key="send" type="primary" icon={<SendOutlined />} loading={sending} onClick={handleSendNow}>
            Gửi ngay
          </Button>,
        ]}
        width={520}
      >
        {previewLoading ? (
          <div style={{ textAlign: "center", padding: 32 }}><Spin /></div>
        ) : previewData ? (
          previewData.length === 0 ? (
            <Text type="secondary">Không có khoản phí nào bật nhắc hoặc tất cả đã đóng.</Text>
          ) : (
            previewData.map((item) => (
              <Card key={`${item.club_id}-${item.fee_type_id}`} size="small" style={{ marginBottom: 12 }}>
                <Text strong>{item.fee_type_name}</Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>{item.unpaid_count} người chưa đóng</Text>
                {item.admin_chat_ids?.length === 0 && (
                  <Tag color="warning" style={{ marginLeft: 8 }}>Bạn chưa đăng nhập Bot</Tag>
                )}
                <div style={{ marginTop: 8 }}>
                  {item.unpaid_members?.slice(0, 10).map((m) => (
                    <div key={m.id} style={{ fontSize: 13, padding: "2px 0" }}>
                      • {m.full_name}{m.phone ? ` (${m.phone})` : ""}
                    </div>
                  ))}
                  {item.unpaid_members?.length > 10 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      ... và {item.unpaid_members.length - 10} người khác
                    </Text>
                  )}
                </div>
              </Card>
            ))
          )
        ) : null}
      </Modal>
    </div>
  );
}
