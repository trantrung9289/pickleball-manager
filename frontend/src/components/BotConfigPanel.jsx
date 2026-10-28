import { useEffect, useState, useCallback } from "react";
import {
  Card, Input, Button, message, Space, Typography, Tree,
  Switch, Table, Tag, Tooltip, Alert,
} from "antd";
import { SaveOutlined, ReloadOutlined, TeamOutlined } from "@ant-design/icons";

const { Text } = Typography;
const API_BASE = import.meta.env.VITE_API_URL || "";
const getToken  = () => localStorage.getItem("token")  || "";
const getClubId = () => localStorage.getItem("selectedClubId") || "";

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
  {
    key: "gdlist",
    title: "📋 Giao dịch",
    children: [
      { key: "gdlist_edit",   title: "✏️ Sửa giao dịch" },
      { key: "gdlist_delete", title: "🗑 Xóa giao dịch" },
    ],
  },
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
// Key thêm ở version 2 của menu_config (Sửa/Xóa giao dịch) — phải khớp MENU_CFG_V2_KEYS trong bot/bot.py
const MENU_CFG_V2_KEYS = ["gdlist_edit", "gdlist_delete"];

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
  const [clubBotEnabled, setClubBotEnabled] = useState(true);   // cờ cấp CLB do quản trị hệ thống đặt


  // Khai báo TRƯỚC useEffect gọi chúng — const không hoisted như function declaration,
  // trước đây "chạy được" chỉ vì hiệu ứng phụ chạy sau khi component render xong (closure
  // over biến khai báo sau), nhưng dễ vỡ nếu code sau này gọi trực tiếp trong lúc render.
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/bot-config`, { headers: authHeaders() });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (data.welcome_message !== undefined) setWelcomeMsg(data.welcome_message);
      if (data.club_bot_enabled !== undefined) setClubBotEnabled(!!data.club_bot_enabled);
      if (data.menu_config) {
        const cfg = JSON.parse(data.menu_config);
        let keys = cfg.checkedKeys ?? ALL_KEYS;
        // Cấu hình lưu trước version 2 chưa có key Sửa/Xóa giao dịch → coi như đang bật
        // (khớp cách bot xử lý), để không tự khoá chức năng ở CLB đã cấu hình từ trước.
        if ((cfg.version ?? 1) < 2) keys = [...new Set([...keys, ...MENU_CFG_V2_KEYS])];
        setCheckedKeys(keys);
      } else {
        setCheckedKeys(ALL_KEYS);
      }
    } catch {
      message.error("Không tải được cấu hình");
    } finally {
      setLoading(false);
    }
  }, []);

  // Tài khoản trong CLB + quyền dùng bot (tài khoản do quản trị hệ thống cấp; ở đây chỉ bật/tắt bot)
  const [accounts, setAccounts]               = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [togglingAccount, setTogglingAccount] = useState(null);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/club/memberships`, { headers: authHeaders() });
      if (!res.ok) throw new Error(res.status);
      setAccounts(await res.json());
    } catch {
      message.error("Không tải được danh sách tài khoản");
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const toggleBotEnabled = async (acc, checked) => {
    setTogglingAccount(acc.id);
    try {
      const res = await fetch(`${API_BASE}/api/club/memberships/${acc.id}/bot-enabled`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ enabled: checked }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || res.status);
      }
      const updated = await res.json();
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      message.success(checked ? `Đã bật bot cho ${acc.username}` : `Đã tắt bot cho ${acc.username}`);
    } catch (e) {
      message.error(`Lỗi cập nhật: ${e.message}`);
    } finally {
      setTogglingAccount(null);
    }
  };

  useEffect(() => {
    // loadConfig/loadFeeTypes setState sau await bên trong nhưng được gọi trực tiếp
    // (không phải trong .then) nên lint coi là "đồng bộ"; cần giữ tách riêng để tái sử
    // dụng ở nút "Tải lại".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConfig();
    loadAccounts();
  }, [loadConfig, loadAccounts]);

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
          menu_config: JSON.stringify({ checkedKeys, version: 2 }),
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

  return (
    <div style={{ maxWidth: 580 }}>
      {!clubBotEnabled && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message="CLB chưa được cấp quyền dùng Bot Telegram"
          description="Quản trị hệ thống chưa bật Bot cho CLB này: không tài khoản nào đăng nhập được Bot và không ai nhận thông báo Telegram, dù bật ở bảng Tài khoản bên dưới. Liên hệ quản trị hệ thống để được cấp." />
      )}
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
        title={<><TeamOutlined style={{ marginRight: 6 }} />Tài khoản được dùng Bot</>}
        size="small"
        style={{ marginBottom: 16 }}
        extra={<Button size="small" icon={<ReloadOutlined />} loading={accountsLoading} onClick={loadAccounts}>Tải lại</Button>}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 12 }}>
          Tài khoản do quản trị hệ thống cấp cho CLB. Tắt để tài khoản đó không đăng nhập được Bot
          (và không nhận nhắc phí). Thay đổi có hiệu lực ngay ở thao tác kế tiếp trên Bot.
        </Text>
        <Table
          size="small"
          pagination={false}
          loading={accountsLoading}
          dataSource={accounts}
          rowKey="id"
          locale={{ emptyText: "CLB chưa có tài khoản nào" }}
          columns={[
            {
              title: "Tài khoản",
              key: "account",
              render: (_, a) => (
                <span>
                  <b>{a.username}</b>
                  {a.full_name && a.full_name !== a.username && <Text type="secondary"> — {a.full_name}</Text>}
                  {a.is_self && <Tag style={{ marginLeft: 6 }}>Bạn</Tag>}
                </span>
              ),
            },
            {
              title: "Telegram",
              dataIndex: "telegram_linked",
              width: 120,
              render: (v) => (v ? <Tag color="success">Đã liên kết</Tag> : <Tag>Chưa đăng nhập</Tag>),
            },
            {
              title: "Dùng Bot",
              key: "bot",
              width: 90,
              align: "center",
              render: (_, a) => (
                <Tooltip title={a.is_self ? "Không thể tự tắt quyền của chính mình" : undefined}>
                  <Switch
                    size="small"
                    checked={!!a.bot_enabled}
                    disabled={a.is_self}
                    loading={togglingAccount === a.id}
                    onChange={(checked) => toggleBotEnabled(a, checked)}
                  />
                </Tooltip>
              ),
            },
          ]}
        />
      </Card>

      <Space>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
          Lưu cấu hình
        </Button>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={loadConfig}>
          Tải lại
        </Button>
      </Space>

    </div>
  );
}
