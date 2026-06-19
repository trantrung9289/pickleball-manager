import React, { useState, useEffect } from "react";
import {
  Layout, Menu, Typography, theme, Row, Col, Table, Button, Modal,
  Form, Input, Switch, Select, Space, Tag, Popconfirm, message,
  Avatar, Dropdown, Tooltip,
} from "antd";
import {
  TeamOutlined, TrophyOutlined, LinkOutlined, LogoutOutlined,
  PlusOutlined, EditOutlined, DeleteOutlined, SettingOutlined,
  UserOutlined, ArrowLeftOutlined, CrownOutlined,
} from "@ant-design/icons";
import { adminApi } from "../api";
import { useAuth } from "../context/AuthContext";

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;

export default function AdminPortal({ onBack }) {
  const { user, logout, refreshAll } = useAuth();
  const { token } = theme.useToken();
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

  // ── Assign user to club (luôn full CRUD + role=admin) ──
  const openAssignModal = (record = null) => {
    assignForm.resetFields();
    if (record) {
      assignForm.setFieldsValue({ user_id: record.user_id, club_id: record.club_id });
    }
    setAssignModal({ open: true, record });
  };

  const handleSaveAssign = async (values) => {
    try {
      const payload = {
        ...values,
        role: "admin",
        can_view: true,
        can_create: true,
        can_edit: true,
        can_delete: true,
      };
      if (assignModal.record) {
        await adminApi.updateMembership(assignModal.record.id, payload);
        message.success("Đã cập nhật");
      } else {
        await adminApi.createMembership(payload);
        message.success("Đã gán tài khoản quản trị CLB");
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
      render: v => v
        ? <Tag icon={<CrownOutlined />} color="gold">Superuser</Tag>
        : <Tag color="blue">Thành viên</Tag>,
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

  const assignColumns = [
    {
      title: "Tài khoản",
      render: (_, r) => {
        const u = users.find(x => x.id === r.user_id);
        return u
          ? <div><b>{u.full_name}</b><div style={{ color: "#888", fontSize: 12 }}>@{u.username}</div></div>
          : r.user_id;
      },
    },
    {
      title: "Câu lạc bộ",
      render: (_, r) => {
        const c = clubs.find(x => x.id === r.club_id);
        return c ? <div><b>{c.name}</b><div style={{ color: "#888", fontSize: 12 }}>{c.sport}</div></div> : r.club_id;
      },
    },
    {
      title: "Quyền",
      render: () => (
        <Space size={4}>
          <Tag color="green" style={{ fontSize: 11 }}>Xem</Tag>
          <Tag color="blue" style={{ fontSize: 11 }}>Tạo</Tag>
          <Tag color="orange" style={{ fontSize: 11 }}>Sửa</Tag>
          <Tag color="red" style={{ fontSize: 11 }}>Xóa</Tag>
        </Space>
      ),
    },
    {
      title: "Thao tác", width: 100,
      render: (_, r) => (
        <Popconfirm title="Gỡ quyền quản trị CLB này?" onConfirm={() => handleRemoveAssign(r.id)} okText="Gỡ" cancelText="Hủy">
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
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
  };

  // Danh sách user chưa phải superuser (superuser không cần assign CLB)
  const memberUsers = users.filter(u => !u.is_superuser);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={220} style={{ background: "#0a0a1a" }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <SettingOutlined style={{ fontSize: 20, color: "#faad14" }} />
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, marginTop: 8 }}>Quản trị hệ thống</div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>System Admin Portal</div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[section]}
          onClick={({ key }) => setSection(key)}
          style={{ background: "#0a0a1a", marginTop: 8 }}
          items={[
            { key: "users", icon: <TeamOutlined />, label: "Tài khoản" },
            { key: "clubs", icon: <TrophyOutlined />, label: "Câu lạc bộ" },
            { key: "memberships", icon: <LinkOutlined />, label: "Phân quyền" },
          ]}
        />
        <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, padding: "0 16px" }}>
          <Button block icon={<ArrowLeftOutlined />} onClick={onBack}
            style={{ color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.15)", background: "transparent" }}>
            Quay lại
          </Button>
        </div>
      </Sider>

      <Layout>
        <Header style={{ background: token.colorBgContainer, padding: "0 24px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Row justify="space-between" align="middle" style={{ height: "100%" }}>
            <Title level={4} style={{ margin: 0 }}>{sectionTitles[section]}</Title>
            <Dropdown menu={userMenu} placement="bottomRight">
              <Avatar style={{ background: "#faad14", cursor: "pointer" }} icon={<UserOutlined />} />
            </Dropdown>
          </Row>
        </Header>

        <Content style={{ margin: 24 }}>

          {/* ── USERS ── */}
          {section === "users" && (
            <div>
              <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                <Text type="secondary">{users.length} tài khoản</Text>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openUserModal()}>
                  Tạo tài khoản
                </Button>
              </Row>
              <Table dataSource={users} columns={userColumns} rowKey="id" loading={loading} size="middle" />
            </div>
          )}

          {/* ── CLUBS ── */}
          {section === "clubs" && (
            <div>
              <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                <Text type="secondary">{clubs.length} câu lạc bộ</Text>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openClubModal()}>
                  Tạo CLB
                </Button>
              </Row>
              <Table dataSource={clubs} columns={clubColumns} rowKey="id" loading={loading} size="middle" />
            </div>
          )}

          {/* ── MEMBERSHIPS ── */}
          {section === "memberships" && (
            <div>
              <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
                <Text type="secondary">{memberships.length} tài khoản được gán quyền</Text>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openAssignModal()}>
                  Gán tài khoản quản trị CLB
                </Button>
              </Row>
              <Table dataSource={memberships} columns={assignColumns} rowKey="id" loading={loading} size="middle" />
            </div>
          )}
        </Content>
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

      {/* ── Modal: Gán tài khoản quản trị CLB ── */}
      <Modal
        title="Gán tài khoản quản trị câu lạc bộ"
        open={assignModal.open}
        onCancel={() => setAssignModal({ open: false, record: null })}
        onOk={() => assignForm.submit()}
        okText="Gán quyền" cancelText="Hủy"
        destroyOnHidden
      >
        <Form form={assignForm} layout="vertical" onFinish={handleSaveAssign} style={{ marginTop: 16 }}>
          <Form.Item name="user_id" label="Tài khoản thành viên" rules={[{ required: true, message: "Chọn tài khoản" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={!!assignModal.record}
              placeholder="Chọn tài khoản thành viên"
              options={memberUsers.map(u => ({
                value: u.id,
                label: `${u.full_name || u.username} (@${u.username})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="club_id" label="Câu lạc bộ" rules={[{ required: true, message: "Chọn CLB" }]}>
            <Select
              disabled={!!assignModal.record}
              placeholder="Chọn câu lạc bộ"
              options={clubs.map(c => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
            Tài khoản được gán sẽ có đầy đủ quyền quản trị CLB: <b>Xem · Tạo · Sửa · Xóa</b>
          </div>
        </Form>
      </Modal>
    </Layout>
  );
}
