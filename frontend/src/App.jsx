import React, { useState } from "react";
import {
  Layout, Menu, Typography, theme, Row, Spin,
  Avatar, Dropdown, Space, Result, Button, Drawer,
} from "antd";
import {
  DashboardOutlined, TeamOutlined, DollarOutlined,
  SwapOutlined, BarChartOutlined, TrophyOutlined,
  UserOutlined, LogoutOutlined, LockOutlined, MenuOutlined,
} from "@ant-design/icons";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ViewModeProvider, useViewMode } from "./contexts/ViewModeContext";
import ViewModeSwitcher from "./components/ViewModeSwitcher";
import { useResponsive } from "./hooks/useResponsive";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import FeeTypes from "./pages/FeeTypes";
import Transactions from "./pages/Transactions";
import Reports from "./pages/Reports";
import Tournament from "./pages/Tournament";
import ShortcutHelp from "./components/ShortcutHelp";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Landing from "./pages/Landing";
import AdminPortal from "./pages/AdminPortal";
import ClubSelect from "./pages/ClubSelect";

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

const ALL_PAGES = {
  dashboard: { label: "Tổng quan", icon: <DashboardOutlined />, comp: Dashboard, requireView: false },
  members:   { label: "Thành viên", icon: <TeamOutlined />, comp: Members, requireView: true },
  fee_types: { label: "Danh mục khoản", icon: <DollarOutlined />, comp: FeeTypes, requireView: true },
  transactions: { label: "Giao dịch", icon: <SwapOutlined />, comp: Transactions, requireView: true },
  reports:   { label: "Báo cáo", icon: <BarChartOutlined />, comp: Reports, requireView: true },
  tournaments: { label: "Giải đấu", icon: <TrophyOutlined />, comp: Tournament, requireView: true },
};

function NoMembership({ onLogout }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f5" }}>
      <Result
        icon={<LockOutlined style={{ color: "#faad14" }} />}
        title="Chưa được phân quyền"
        subTitle="Tài khoản của bạn chưa được gán quyền vào câu lạc bộ nào. Vui lòng liên hệ quản trị viên hệ thống."
        extra={
          <Button type="primary" danger onClick={onLogout}>
            Đăng xuất
          </Button>
        }
      />
    </div>
  );
}

function AppShell() {
  const { user, initialized, loading, memberships, selectedMembership, selectedClub, perms, logout, selectClub } = useAuth();
  const [current, setCurrent] = useState("dashboard");
  const [mode, setMode] = useState(null); // null | "admin" | "member"
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { token } = theme.useToken();
  const { isMobile } = useResponsive();
  const { isMobileView } = useViewMode();

  // Cập nhật Page Title theo mode
  React.useEffect(() => {
    if (!initialized) { document.title = "CLB Manager"; return; }
    if (mode === "admin") { document.title = "Hệ thống | Quản trị viên"; return; }
    if (mode === "member" && selectedClub) { document.title = `${selectedClub.name} | Quản lý CLB`; return; }
    document.title = "CLB Manager";
  }, [mode, selectedClub, initialized]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  // Lần đầu chạy chưa có CLB → Setup wizard
  if (!initialized) return <Setup />;

  // Chưa chọn mode → Landing
  if (!mode) return <Landing onSelect={setMode} />;

  // ── Mode: Admin ──
  if (mode === "admin") {
    if (!user || !user.is_superuser) {
      return (
        <Login
          onBack={() => { logout(); setMode(null); }}
          onSwitchMode={(m) => { logout(); setMode(m); }}
          adminMode
        />
      );
    }
    return <AdminPortal onBack={() => { logout(); setMode(null); }} />;
  }

  // ── Mode: Member ──
  if (!user) {
    return (
      <Login
        onBack={() => setMode(null)}
        onSwitchMode={(m) => { logout(); setMode(m); }}
      />
    );
  }

  // Không có membership nào → no access
  if (memberships.length === 0) {
    return <NoMembership onLogout={() => { logout(); setMode(null); }} />;
  }

  // Nhiều CLB → chọn CLB
  if (!selectedMembership) {
    return <ClubSelect onBack={() => { logout(); setMode(null); }} />;
  }

  // Lọc menu theo quyền can_view
  const visiblePages = Object.entries(ALL_PAGES).filter(
    ([, page]) => !page.requireView || perms.canView
  );

  // Đảm bảo current là page hợp lệ
  const safeKey = visiblePages.find(([k]) => k === current) ? current : visiblePages[0]?.[0] || "dashboard";
  const PageComp = ALL_PAGES[safeKey]?.comp || Dashboard;

  const userMenu = {
    items: [
      {
        key: "info",
        label: (
          <div style={{ padding: "4px 0" }}>
            <div style={{ fontWeight: 600 }}>{user.full_name || user.username}</div>
            <div style={{ fontSize: 12, color: "#888" }}>
              {selectedMembership.role === "admin" ? "Quản trị CLB" : selectedMembership.role === "treasurer" ? "Thủ quỹ" : "Thành viên"}
            </div>
          </div>
        ),
        disabled: true,
      },
      { type: "divider" },
      ...(memberships.length > 1 ? [{ key: "switch_club", label: "Đổi câu lạc bộ", icon: <SwapOutlined /> }] : []),
      { key: "logout", label: "Đăng xuất", icon: <LogoutOutlined />, danger: true },
    ],
    onClick: ({ key }) => {
      if (key === "logout") { logout(); setMode(null); }
      if (key === "switch_club") { selectClub(null); }
    },
  };

  const menuItems = visiblePages.map(([key, { label, icon }]) => ({ key, icon, label }));

  const sidebarContent = (
    <>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <Title level={5} style={{ color: "#fff", margin: 0, fontSize: 14 }}>
          🏸 {selectedClub?.name || "Quản lý CLB"}
        </Title>
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12 }}>
          {selectedClub?.sport || "Thể thao Pickleball"}
        </div>
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[safeKey]}
        onClick={({ key }) => { setCurrent(key); setDrawerOpen(false); }}
        items={menuItems}
      />
    </>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* Sidebar: Drawer trên màn hình nhỏ (<992px), Sider trên desktop */}
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          bodyStyle={{ padding: 0, background: "#001529" }}
          headerStyle={{ display: "none" }}
          width={240}
        >
          {sidebarContent}
        </Drawer>
      ) : (
        <Sider style={{ background: "#001529" }}>
          {sidebarContent}
        </Sider>
      )}

      <Layout>
        <Header style={{
          background: token.colorBgContainer,
          padding: isMobile ? "0 12px" : "0 24px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <Row justify="space-between" align="middle" style={{ height: "100%" }}>
            <Space>
              {isMobile && (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={() => setDrawerOpen(true)}
                  style={{ marginRight: 4 }}
                />
              )}
              <Title level={4} style={{ margin: 0, fontSize: isMobile ? 15 : 20 }}>
                {ALL_PAGES[safeKey]?.label}
              </Title>
            </Space>
            <Space size={isMobile ? "small" : "middle"}>
              <ViewModeSwitcher />
              {!isMobile && <ShortcutHelp />}
              <Dropdown menu={userMenu} placement="bottomRight">
                <Avatar style={{ background: "#1677ff", cursor: "pointer" }} icon={<UserOutlined />} />
              </Dropdown>
            </Space>
          </Row>
        </Header>
        <Content style={{ margin: isMobile ? "12px 8px" : "24px", minHeight: 280 }}>
          <PageComp perms={perms} />
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ViewModeProvider>
        <AppShell />
      </ViewModeProvider>
    </AuthProvider>
  );
}
