import React, { useState, useEffect } from "react";
import {
  Layout, Menu, Typography, theme, Row, Col, Table, Button, Modal,
  Form, Input, Switch, Select, Space, Tag, Popconfirm, message,
  Avatar, Dropdown, Tooltip, Checkbox, Divider, Alert,
} from "antd";
import {
  TeamOutlined, TrophyOutlined, LinkOutlined, LogoutOutlined,
  PlusOutlined, EditOutlined, DeleteOutlined, SettingOutlined,
  UserOutlined, ArrowLeftOutlined, CrownOutlined,
  MinusCircleOutlined, EyeOutlined, FormOutlined, EditFilled, ScissorOutlined,
} from "@ant-design/icons";
import { adminApi } from "../api";
import { useAuth } from "../context/AuthContext";
import { useAppTheme } from "../contexts/ThemeContext";
import ResponsiveTable from "../components/ResponsiveTable";
import ThemeSwitcher from "../components/ThemeSwitcher";
import { useViewMode } from "../contexts/ViewModeContext";

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;

export default function AdminPortal({ onBack }) {
  const { user, logout, refreshAll } = useAuth();
  const { token } = theme.useToken();
  const { themeConfig } = useAppTheme();
  const { isMobile } = useViewMode();
  const [section, setSection] = useState("users");

  const [users, setUsers] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(false);

  const [userModal, setUserModal] = useState({ open: false, record: null });
  const [clubModal, setClubModal] = useState({ open: false, record: null });
  const [assignModal, setAssignModal] = useState({ open: false, record: null });

  const [userForm] = Form.useForm();
  const [clubForm] = Form.useForm();
  const [assignForm] = Form.useForm();

  const loadUsers = async () => { const { data } = await adminApi.listUsers(); setUsers(data); };
  const loadClubs = async () => { const { data } = await adminApi.listClubs(); setClubs(data); };
  const loadMemberships = async () => { const { data } = await adminApi.listMemberships(); setMemberships(data); };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadUsers(), loadClubs(), loadMemberships()]).finally(() => setLoading(false));
  }, []);

  // ── User CRUD ──
  const openUserModal = (record = null) => {
    userForm.resetFields();
    if (record) userForm.setFieldsValue({ full_name: record.full_name, username: record.username, is_superuser: record.is_superuser, password: "" });
    setUserModal({ open: true, record });
  };

  const handleSaveUser = async (values) => {
    try {
      const payload = { ...values, role: "member" };
      if (!payload.password) delete payload.password;
      if (userModal.record) {
        await adminApi.updateUser(userModal.record.id, payload);
        message.success("Đã cập nhật tài khoản");
      } else {
        await adminApi.createUser(payload);
        message.success("Đã tạo tài khoản");
      }
      setUserModal({ open: false, record: null });
      loadUsers();
    } catch (err) {
      message.error(err.response?.data?.detail || "Có lỗi xảy ra");
    }
  };

  const handleDeleteUser = async (id) => {
    try {
      await adminApi.deleteUser(id);
      message.success("Đã xóa tài khoản");
      loadUsers();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể xóa");
    }
  };

  // ── Club CRUD ──
  const openClubModal = (record = null) => {
    clubForm.resetFields();
    if (record) clubForm.setFieldsValue(record);
    setClubModal({ open: true, record });
  };

  const handleSaveClub = async (values) => {
    try {
      if (clubModal.record) {
        await adminApi.updateClub(clubModal.record.id, values);
        message.success("Đã cập nhật CLB");
      } else {
        await adminApi.createClub(values);
        message.success("Đã tạo CLB");
      }
      setClubModal({ open: false, record: null });
      loadClubs();
      loadMemberships();
      refreshAll?.();
    } catch (err) {
      message.error(err.response?.data?.detail || "Có lỗi xảy ra");
    }
  };

  const handleDeleteClub = async (id) => {
    try {
      await adminApi.deleteClub(id);
      message.success("Đã xóa CLB");
      loadClubs();
      loadMemberships();
      refreshAll?.();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể xóa");
    }
  };

  // ── Assign user to club ──
  const openAssignModal = (record = null) => {
    assignForm.resetFields();
    if (record) {
      // Chế độ sửa: chỉ cập nhật quyền
      const perms = [];
      if (record.can_view)   perms.push("can_view");
      if (record.can_create) perms.push("can_create");
      if (record.can_edit)   perms.push("can_edit");
      if (record.can_delete) perms.push("can_delete");
      assignForm.setFieldsValue({ club_id: record.club_id, user_ids: [record.user_id], permissions: perms });
    } else {
      assignForm.setFieldsValue({ permissions: ["can_view", "can_create", "can_edit", "can_delete"] });
    }
    setAssignModal({ open: true, record });
  };

  const handleSaveAssign = async (values) => {
    const { club_id, user_ids, permissions } = values;
    const permPayload = {
      can_view:   permissions.includes("can_view"),
      can_create: permissions.includes("can_create"),
      can_edit:   permissions.includes("can_edit"),
      can_delete: permissions.includes("can_delete"),
    };
    try {
      if (assignModal.record) {
        // Sửa: chỉ cập nhật quyền cho 1 membership
        await adminApi.updateMembership(assignModal.record.id, { ...permPayload, role: "admin" });
        message.success("Đã cập nhật quyền");
      } else {
        // Tạo mới: tạo cho từng user đã chọn
        const existing = memberships.filter(m => m.club_id === club_id).map(m => m.user_id);
        const toCreate = user_ids.filter(uid => !existing.includes(uid));
        const skipped  = user_ids.length - toCreate.length;
        await Promise.all(toCreate.map(uid =>
          adminApi.createMembership({ user_id: uid, club_id, role: "admin", ...permPayload })
        ));
        if (toCreate.length > 0) message.success(`Đã gán quyền cho ${toCreate.length} tài khoản`);
        if (skipped > 0) message.warning(`${skipped} tài khoản đã có quyền CLB này, bỏ qua`);
      }
      setAssignModal({ open: false, record: null });
      loadMemberships();
      refreshAll?.();
    } catch (err) {
      message.error(err.response?.data?.detail || "Có lỗi xảy ra");
    }
  };

  const handleRemoveAssign = async (id) => {
    try {
      await adminApi.deleteMembership(id);
      message.success("Đã gỡ quyền quản trị CLB");
      loadMemberships();
      refreshAll?.();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể xóa");
    }
  };

  // Lookup admins of a club from memberships
  const getClubAdmins = (clubId) =>
    memberships
      .filter(m => m.club_id === clubId)
      .map(m => users.find(u => u.id === m.user_id))
      .filter(Boolean);

  // ── Table columns ──
  const userColumns = [
    { title: "ID", dataIndex: "id", width: 55 },
    {
      title: "Tài khoản",
      render: (_, r) => (
        <div>
          <b>{r.full_name || "—"}</b>
          <div style={{ color: "#888", fontSize: 12 }}>@{r.username}</div>
        </div>
      ),
    },
    {
      title: "Loại tài khoản",
      dataIndex: "is_superuser",
      width: 140,
      render: v => v
        ? <Tag icon={<CrownOutlined />} color="gold">Superuser</Tag>
        : <Tag color="blue">Thành viên</Tag>,
    },
    {
      title: "CLB đang quản lý",
      render: (_, r) => {
        const managed = memberships
          .filter(m => m.user_id === r.id)
          .map(m => clubs.find(c => c.id === m.club_id))
          .filter(Boolean);
        if (managed.length === 0)
          return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        return (
          <div>
            {managed.map((c, i) => (
              <div key={c.id} style={{ fontSize: 12, lineHeight: "22px" }}>
                <Tag color="cyan" style={{ fontSize: 11, marginRight: 4 }}>{c.id}</Tag>
                {c.name}
              </div>
            ))}
          </div>
        );
      },
    },
    {
      title: "Thao tác", width: 110,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openUserModal(r)} />
          <Popconfirm title="Xóa tài khoản này?" onConfirm={() => handleDeleteUser(r.id)} okText="Xóa" cancelText="Hủy">
            <Button size="small" danger icon={<DeleteOutlined />} disabled={r.id === user?.id} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const clubColumns = [
    { title: "ID", dataIndex: "id", width: 55 },
    {
      title: "Tên CLB",
      render: (_, r) => (
        <div>
          <b>{r.name}</b>
          {r.sport && <div style={{ color: "#888", fontSize: 12 }}>{r.sport}</div>}
        </div>
      ),
    },
    { title: "Địa chỉ", dataIndex: "address", render: v => v || "—" },
    { title: "Email", dataIndex: "email", render: v => v || "—" },
    {
      title: "Tài khoản quản trị",
      render: (_, r) => {
        const admins = getClubAdmins(r.id);
        if (admins.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>Chưa có</Text>;
        return (
          <Space size={4} wrap>
            {admins.map(u => (
              <Tooltip key={u.id} title={`@${u.username}`}>
                <Tag icon={<UserOutlined />} color="blue" style={{ fontSize: 12 }}>
                  {u.full_name || u.username}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        );
      },
    },
    {
      title: "Thao tác", width: 110,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openClubModal(r)} />
          <Popconfirm title="Xóa CLB này?" onConfirm={() => handleDeleteClub(r.id)} okText="Xóa" cancelText="Hủy">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const PERM_TAGS = [
    { key: "can_view",   label: "Xem",  color: "green" },
    { key: "can_create", label: "Tạo",  color: "blue" },
    { key: "can_edit",   label: "Sửa",  color: "orange" },
    { key: "can_delete", label: "Xóa",  color: "red" },
  ];

  // Group memberships theo club_id — mỗi CLB 1 dòng
  const groupedByClub = clubs
    .map(club => ({
      club_id: club.id,
      club,
      members: memberships.filter(m => m.club_id === club.id),
    }))
    .filter(g => g.members.length > 0);

  // Chiều cao mỗi hàng thành viên trong 1 ô — cố định để 3 cột (Tài khoản, Quyền, Thao tác) căn hàng nhau
  const ROW_H = 52;

  const assignColumns = [
    {
      title: "Câu lạc bộ",
      width: 220,
      render: (_, g) => (
        <div>
          <b>{g.club.name}</b>
          {g.club.sport && <div style={{ color: "#888", fontSize: 12 }}>{g.club.sport}</div>}
          <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>{g.members.length} tài khoản</div>
        </div>
      ),
    },
    {
      title: "Tài khoản",
      render: (_, g) => (
        <div>
          {g.members.map((m, i) => {
            const u = users.find(x => x.id === m.user_id);
            return (
              <div key={m.id} style={{
                height: ROW_H, display: "flex", alignItems: "center",
                borderTop: i > 0 ? "1px dashed rgba(0,0,0,0.06)" : "none",
              }}>
                {u
                  ? <div>
                      <b style={{ fontSize: 13 }}>{u.full_name || u.username}</b>
                      <div style={{ color: "#888", fontSize: 11 }}>@{u.username}</div>
                    </div>
                  : <span style={{ color: "#aaa" }}>#{m.user_id}</span>
                }
              </div>
            );
          })}
        </div>
      ),
    },
    {
      title: "Quyền được cấp",
      width: 200,
      render: (_, g) => (
        <div>
          {g.members.map((m, i) => (
            <div key={m.id} style={{
              height: ROW_H, display: "flex", alignItems: "center",
              borderTop: i > 0 ? "1px dashed rgba(0,0,0,0.06)" : "none",
            }}>
              <Space size={4} wrap>
                {PERM_TAGS.map(p => m[p.key]
                  ? <Tag key={p.key} color={p.color} style={{ fontSize: 11, margin: 0 }}>{p.label}</Tag>
                  : <Tag key={p.key} color="default" style={{ fontSize: 11, margin: 0, opacity: 0.35 }}>{p.label}</Tag>
                )}
              </Space>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "Thao tác",
      width: 110,
      render: (_, g) => (
        <div>
          {g.members.map((m, i) => (
            <div key={m.id} style={{
              height: ROW_H, display: "flex", alignItems: "center",
              borderTop: i > 0 ? "1px dashed rgba(0,0,0,0.06)" : "none",
            }}>
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openAssignModal(m)} />
                <Popconfirm
                  title="Gỡ quyền tài khoản này khỏi CLB?"
                  onConfirm={() => handleRemoveAssign(m.id)}
                  okText="Gỡ" cancelText="Hủy"
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            </div>
          ))}
        </div>
      ),
    },
  ];

  const userMenu = {
    items: [
      {
        key: "info", disabled: true,
        label: <div><div style={{ fontWeight: 600 }}>{user?.full_name}</div><div style={{ fontSize: 12, color: "#888" }}>Superuser</div></div>,
      },
      { type: "divider" },
      { key: "logout", label: "Đăng xuất", icon: <LogoutOutlined />, danger: true },
    ],
    onClick: ({ key }) => { if (key === "logout") { logout(); } },
  };

  const sectionTitles = {
    users: "Quản lý tài khoản",
    clubs: "Quản lý câu lạc bộ",
    memberships: "Phân quyền quản trị CLB",
    bot: "Cấu hình Telegram Bot",
  };

  // Danh sách user chưa phải superuser (superuser không cần assign CLB)
  const memberUsers = users.filter(u => !u.is_superuser);

  const NAV_ITEMS = [
    { key: "users",       icon: <TeamOutlined />,   label: "Tài khoản" },
    { key: "clubs",       icon: <TrophyOutlined />, label: "Câu lạc bộ" },
    { key: "memberships", icon: <LinkOutlined />,   label: "Phân quyền" },
  ];

  const contentArea = (
    <Content style={{ margin: isMobile ? 12 : 24 }}>

      {/* ── USERS ── */}
      {section === "users" && (
        <div>
          <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
            <Text type="secondary">{users.length} tài khoản</Text>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openUserModal()}>
              {isMobile ? "Tạo" : "Tạo tài khoản"}
            </Button>
          </Row>
          <ResponsiveTable
            dataSource={users} columns={userColumns} rowKey="id" loading={loading} size="middle"
            mobileTitle={(r) => <span><b>{r.full_name || "—"}</b> <span style={{ color: "#888", fontWeight: 400 }}>@{r.username}</span></span>}
            mobileHideColumns={["ID", "Tài khoản"]}
          />
        </div>
      )}

      {/* ── CLUBS ── */}
      {section === "clubs" && (
        <div>
          <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
            <Text type="secondary">{clubs.length} câu lạc bộ</Text>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openClubModal()}>
              {isMobile ? "Tạo" : "Tạo CLB"}
            </Button>
          </Row>
          <ResponsiveTable
            dataSource={clubs} columns={clubColumns} rowKey="id" loading={loading} size="middle"
            mobileTitle={(r) => <span><b>{r.name}</b>{r.sport && <span style={{ color: "#888", fontWeight: 400 }}> · {r.sport}</span>}</span>}
            mobileHideColumns={["ID", "Tên CLB"]}
          />
        </div>
      )}

      {/* ── MEMBERSHIPS ── */}
      {section === "memberships" && (
        <div>
          <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
            <Text type="secondary">
              {groupedByClub.length} CLB · {memberships.length} tài khoản
            </Text>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openAssignModal()}>
              {isMobile ? "Gán" : "Gán tài khoản quản trị CLB"}
            </Button>
          </Row>
          <ResponsiveTable
            dataSource={groupedByClub}
            columns={assignColumns}
            rowKey="club_id"
            loading={loading}
            size="middle"
            pagination={false}
            mobileTitle={(g) => (
              <span>
                <b>{g.club.name}</b>
                <span style={{ color: "#888", fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                  {g.members.length} tài khoản
                </span>
              </span>
            )}
            mobileHideColumns={["Câu lạc bộ"]}
          />
        </div>
      )}
    </Content>
  );

  /* ── MOBILE LAYOUT ── */
  if (isMobile) {
    return (
      <Layout style={{ minHeight: "100vh" }}>
        {/* Header mobile */}
        <Header style={{
          background: themeConfig.sidebar,
          padding: "0 12px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "sticky", top: 0, zIndex: 100,
        }}>
          <Space>
            <Button
              icon={<ArrowLeftOutlined />} onClick={onBack}
              style={{ color: themeConfig.sidebarText || "#fff", border: "none", background: "transparent" }}
            />
            <span style={{ color: themeConfig.sidebarText || "#fff", fontWeight: 700, fontSize: 15 }}>
              Quản trị hệ thống
            </span>
          </Space>
          <Space>
            <ThemeSwitcher dark={themeConfig.menuTheme === "dark"} />
            <Dropdown menu={userMenu} placement="bottomRight">
              <Avatar style={{ background: themeConfig.avatar, cursor: "pointer" }} icon={<UserOutlined />} />
            </Dropdown>
          </Space>
        </Header>

        {/* Nav tabs mobile */}
        <div style={{ background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}`, padding: "0 12px" }}>
          <div style={{ display: "flex", overflowX: "auto", gap: 0 }}>
            {NAV_ITEMS.map(item => (
              <button key={item.key} onClick={() => setSection(item.key)}
                style={{
                  flex: "0 0 auto", padding: "10px 14px",
                  border: "none", background: "transparent", cursor: "pointer",
                  borderBottom: section === item.key ? `2px solid ${token.colorPrimary}` : "2px solid transparent",
                  color: section === item.key ? token.colorPrimary : token.colorTextSecondary,
                  fontWeight: section === item.key ? 600 : 400,
                  fontSize: 13, display: "flex", alignItems: "center", gap: 6,
                  whiteSpace: "nowrap",
                }}
              >
                {item.icon} {item.label}
              </button>
            ))}
          </div>
        </div>

        {contentArea}
      </Layout>
    );
  }

  /* ── DESKTOP LAYOUT ── */
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={220} style={{ background: themeConfig.sidebar }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${themeConfig.sidebarBorder || "rgba(255,255,255,0.08)"}` }}>
          <SettingOutlined style={{ fontSize: 20, color: themeConfig.avatar }} />
          <div style={{ color: themeConfig.sidebarText || "#fff", fontWeight: 700, fontSize: 15, marginTop: 8 }}>Quản trị hệ thống</div>
          <div style={{ color: themeConfig.sidebarSubText || "rgba(255,255,255,0.4)", fontSize: 12 }}>System Admin Portal</div>
        </div>
        <Menu
          theme={themeConfig.menuTheme || "dark"}
          mode="inline"
          selectedKeys={[section]}
          onClick={({ key }) => setSection(key)}
          style={{ background: themeConfig.sidebar, marginTop: 8 }}
          items={NAV_ITEMS}
        />
        <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, padding: "0 16px" }}>
          <Button block icon={<ArrowLeftOutlined />} onClick={onBack}
            style={{
              color: themeConfig.sidebarSubText || "rgba(255,255,255,0.5)",
              borderColor: themeConfig.sidebarBorder || "rgba(255,255,255,0.15)",
              background: "transparent",
            }}>
            Quay lại
          </Button>
        </div>
      </Sider>

      <Layout>
        <Header style={{ background: token.colorBgContainer, padding: "0 24px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Row justify="space-between" align="middle" style={{ height: "100%" }}>
            <Title level={4} style={{ margin: 0 }}>{sectionTitles[section]}</Title>
            <Space>
              <ThemeSwitcher />
              <Dropdown menu={userMenu} placement="bottomRight">
                <Avatar style={{ background: themeConfig.avatar, cursor: "pointer" }} icon={<UserOutlined />} />
              </Dropdown>
            </Space>
          </Row>
        </Header>

        {contentArea}
      </Layout>

      {/* ── Modal: Tạo / Sửa tài khoản ── */}
      <Modal
        title={userModal.record ? "Sửa tài khoản" : "Tạo tài khoản"}
        open={userModal.open}
        onCancel={() => setUserModal({ open: false, record: null })}
        onOk={() => userForm.submit()}
        okText="Lưu" cancelText="Hủy"
        destroyOnHidden
      >
        <Form form={userForm} layout="vertical" onFinish={handleSaveUser} style={{ marginTop: 16 }}>
          <Form.Item name="full_name" label="Họ và tên" rules={[{ required: true, message: "Nhập họ tên" }]}>
            <Input placeholder="Nguyễn Văn A" />
          </Form.Item>
          <Form.Item
            name="username" label="Tên đăng nhập"
            rules={[
              { required: !userModal.record, message: "Nhập tên đăng nhập" },
              { min: 4, message: "Tối thiểu 4 ký tự" },
              { pattern: /^[a-zA-Z0-9_]+$/, message: "Chỉ dùng chữ, số, _" },
            ]}
          >
            <Input placeholder="nguyen_van_a" disabled={!!userModal.record} />
          </Form.Item>
          <Form.Item
            name="password"
            label={userModal.record ? "Mật khẩu mới (để trống nếu không đổi)" : "Mật khẩu"}
            rules={userModal.record ? [] : [{ required: true }, { min: 6, message: "Tối thiểu 6 ký tự" }]}
          >
            <Input.Password placeholder="Tối thiểu 6 ký tự" />
          </Form.Item>
          <Form.Item
            name="is_superuser" label="Loại tài khoản" valuePropName="checked" initialValue={false}
            help="Bật: Superuser hệ thống. Tắt: Tài khoản thành viên (có thể gán quản trị CLB)"
          >
            <Switch
              checkedChildren={<><CrownOutlined /> Superuser</>}
              unCheckedChildren="Thành viên"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Modal: Tạo / Sửa CLB ── */}
      <Modal
        title={clubModal.record ? "Sửa câu lạc bộ" : "Tạo câu lạc bộ"}
        open={clubModal.open}
        onCancel={() => setClubModal({ open: false, record: null })}
        onOk={() => clubForm.submit()}
        okText="Lưu" cancelText="Hủy"
        destroyOnHidden
      >
        <Form form={clubForm} layout="vertical" onFinish={handleSaveClub} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Tên CLB" rules={[{ required: true, message: "Nhập tên CLB" }]}>
            <Input placeholder="CLB Pickleball Hà Nội" />
          </Form.Item>
          <Form.Item name="sport" label="Môn thể thao">
            <Input placeholder="Pickleball" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="phone" label="Điện thoại">
                <Input placeholder="0912 345 678" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="Email">
                <Input placeholder="clb@example.com" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address" label="Địa chỉ">
            <Input placeholder="Số nhà, đường, quận..." />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Modal: Gán / Sửa quyền quản trị CLB ── */}
      <Modal
        title={assignModal.record ? "Sửa quyền quản trị CLB" : "Gán tài khoản quản trị CLB"}
        open={assignModal.open}
        onCancel={() => setAssignModal({ open: false, record: null })}
        onOk={() => assignForm.submit()}
        okText={assignModal.record ? "Cập nhật quyền" : "Gán quyền"}
        cancelText="Hủy"
        destroyOnHidden
        width={520}
      >
        <Form form={assignForm} layout="vertical" onFinish={handleSaveAssign} style={{ marginTop: 16 }}>

          {/* Bước 1: Chọn CLB */}
          <Form.Item
            name="club_id"
            label="1. Câu lạc bộ"
            rules={[{ required: true, message: "Chọn câu lạc bộ" }]}
          >
            <Select
              disabled={!!assignModal.record}
              placeholder="Chọn câu lạc bộ cần phân quyền"
              options={clubs.map(c => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>

          {/* Bước 2 & 3: Chọn tài khoản (tối đa 3) */}
          <Form.Item
            name="user_ids"
            label={
              <span>
                2. Tài khoản được phân quyền
                <span style={{ color: "#888", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                  (tối đa 3 tài khoản)
                </span>
              </span>
            }
            rules={[
              { required: true, message: "Chọn ít nhất 1 tài khoản" },
              { validator: (_, v) => v && v.length <= 3 ? Promise.resolve() : Promise.reject("Tối đa 3 tài khoản") },
            ]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              disabled={!!assignModal.record}
              placeholder="Chọn 1–3 tài khoản thành viên"
              maxCount={3}
              options={memberUsers.map(u => ({
                value: u.id,
                label: `${u.full_name || u.username} (@${u.username})`,
              }))}
            />
          </Form.Item>

          {/* Bước 4: Chọn quyền */}
          <Form.Item
            name="permissions"
            label="3. Quyền được cấp"
            rules={[{ required: true, message: "Chọn ít nhất 1 quyền" }]}
          >
            <Checkbox.Group style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Checkbox value="can_view">
                <Tag color="green" style={{ margin: 0 }}>Xem</Tag>
              </Checkbox>
              <Checkbox value="can_create">
                <Tag color="blue" style={{ margin: 0 }}>Tạo</Tag>
              </Checkbox>
              <Checkbox value="can_edit">
                <Tag color="orange" style={{ margin: 0 }}>Sửa</Tag>
              </Checkbox>
              <Checkbox value="can_delete">
                <Tag color="red" style={{ margin: 0 }}>Xóa</Tag>
              </Checkbox>
            </Checkbox.Group>
          </Form.Item>

          <Alert
            type="info" showIcon style={{ marginTop: 4 }}
            message='Quyền "Xem" là cơ bản — nên luôn bật để tài khoản truy cập được CLB.'
          />
        </Form>
      </Modal>
    </Layout>
  );
}
