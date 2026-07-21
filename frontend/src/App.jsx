import React, { useState, lazy, Suspense } from "react";
import {
  Layout, Menu, Typography, theme, Row, Spin,
  Avatar, Dropdown, Space, Result, Button, Drawer,
} from "antd";
import {
  DashboardOutlined, TeamOutlined, DollarOutlined,
  SwapOutlined, BarChartOutlined, TrophyOutlined,
  UserOutlined, LogoutOutlined, LockOutlined, RobotOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ViewModeProvider, useViewMode } from "./contexts/ViewModeContext";
import { useAppTheme, THEMES } from "./contexts/ThemeContext";
import ViewModeSwitcher from "./components/ViewModeSwitcher";
import ThemeSwitcher from "./components/ThemeSwitcher";
import MobileBottomNav from "./components/mobile/MobileBottomNav";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Members = lazy(() => import("./pages/Members"));
const Guests = lazy(() => import("./pages/Guests"));
const FeeTypes = lazy(() => import("./pages/FeeTypes"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Reports = lazy(() => import("./pages/Reports"));
const Tournament = lazy(() => import("./pages/Tournament"));
const ShortcutHelp = lazy(() => import("./components/ShortcutHelp"));
const Login = lazy(() => import("./pages/Login"));
const Setup = lazy(() => import("./pages/Setup"));
const Landing = lazy(() => import("./pages/Landing"));
const AdminPortal = lazy(() => import("./pages/AdminPortal"));
const ClubSelect = lazy(() => import("./pages/ClubSelect"));
const PublicReport = lazy(() => import("./pages/PublicReport"));
const BotConfigPanel = lazy(() => import("./components/BotConfigPanel"));

function PageSpinner() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Spin size="large" />
    </div>
  );
}

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

const ALL_PAGES = {
  dashboard: { label: "Tổng quan", icon: <DashboardOutlined />, comp: Dashboard, requireView: false },
  members:   { label: "Thành viên", icon: <TeamOutlined />, comp: Members, requireView: true },
  guests:    { label: "Khách mời", icon: <UserAddOutlined />, comp: Guests, requireView: true },
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [botDrawerOpen, setBotDrawerOpen] = useState(false);
  const { token } = theme.useToken();
  const { isMobileView } = useViewMode();
  const { themeConfig, themeName, setThemeName } = useAppTheme();

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
  if (!initialized) return <Suspense fallback={<PageSpinner />}><Setup /></Suspense>;

  // Chưa chọn mode → Landing
  if (!mode) return <Suspense fallback={<PageSpinner />}><Landing onSelect={setMode} /></Suspense>;

  // ── Mode: Admin ──
  if (mode === "admin") {
    if (!user || !user.is_superuser) {
      return (
        <Suspense fallback={<PageSpinner />}>
          <Login
            onBack={() => { logout(); setMode(null); }}
            onSwitchMode={(m) => { logout(); setMode(m); }}
            adminMode
          />
        </Suspense>
      );
    }
    return <Suspense fallback={<PageSpinner />}><AdminPortal onBack={() => { logout(); setMode(null); }} /></Suspense>;
  }

  // ── Mode: Member ──
  if (!user) {
    return (
      <Suspense fallback={<PageSpinner />}>
        <Login
          onBack={() => setMode(null)}
          onSwitchMode={(m) => { logout(); setMode(m); }}
        />
      </Suspense>
    );
  }

  // Không có membership nào → no access
  if (memberships.length === 0) {
    return <NoMembership onLogout={() => { logout(); setMode(null); }} />;
  }

  // Nhiều CLB → chọn CLB
  if (!selectedMembership) {
    return <Suspense fallback={<PageSpinner />}><ClubSelect onBack={() => { logout(); setMode(null); }} /></Suspense>;
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
      { key: "bot_config", label: "Cài đặt Telegram Bot", icon: <RobotOutlined /> },
      ...(memberships.length > 1 ? [{ key: "switch_club", label: "Đổi câu lạc bộ", icon: <SwapOutlined /> }] : []),
      { key: "logout", label: "Đăng xuất", icon: <LogoutOutlined />, danger: true },
    ],
    onClick: ({ key }) => {
      if (key === "logout") { logout(); setMode(null); }
      if (key === "switch_club") { selectClub(null); }
      if (key === "bot_config") { setBotDrawerOpen(true); }
    },
  };

  const menuItems = visiblePages.map(([key, { label, icon }]) => ({ key, icon, label }));

  // ── Bottom navigation cho mobile ──
  // 4 tab chính (theo thứ tự ưu tiên), các trang còn lại nằm trong sheet "Thêm"
  const PRIMARY_KEYS = ["dashboard", "members", "transactions", "tournaments"];
  const primaryTabs = PRIMARY_KEYS
    .map((k) => visiblePages.find(([key]) => key === k))
    .filter(Boolean)
    .map(([key, { label, icon }]) => ({ key, label, icon }));
  const primaryKeySet = new Set(primaryTabs.map((t) => t.key));
  const overflowTabs = visiblePages
    .filter(([key]) => !primaryKeySet.has(key))
    .map(([key, { label, icon }]) => ({ key, label, icon }));
  const currentInOverflow = !primaryKeySet.has(safeKey);

  const sidebarContent = (
    <>
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${themeConfig.sidebarBorder}`, background: themeConfig.sidebar }}>
        <Title level={5} style={{ color: themeConfig.sidebarText, margin: 0, fontSize: 14 }}>
          🏸 {selectedClub?.name || "Quản lý CLB"}
        </Title>
        <div style={{ color: themeConfig.sidebarSubText, fontSize: 12 }}>
          {selectedClub?.sport || "Thể thao Pickleball"}
        </div>
      </div>
      <Menu
        theme={themeConfig.menuTheme || "dark"}
        mode="inline"
        selectedKeys={[safeKey]}
        onClick={({ key }) => setCurrent(key)}
        items={menuItems}
        style={{ background: themeConfig.sidebar }}
      />
    </>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* Desktop: sidebar cố định. Mobile: dùng bottom navigation thay thế. */}
      {!isMobileView && (
        <Sider style={{ background: themeConfig.sidebar }}>
          {sidebarContent}
        </Sider>
      )}

      <Layout>
        <Header style={{
          background: token.colorBgContainer,
          padding: isMobileView ? "0 12px" : "0 24px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <Row justify="space-between" align="middle" style={{ height: "100%" }}>
            <Space>
              <Title level={4} style={{ margin: 0, fontSize: isMobileView ? 15 : 20 }}>
                {ALL_PAGES[safeKey]?.label}
              </Title>
            </Space>
            <Space size={isMobileView ? "small" : "middle"}>
              <ViewModeSwitcher />
              {!isMobileView && <ThemeSwitcher />}
              {!isMobileView && <ShortcutHelp />}
              <Dropdown menu={userMenu} placement="bottomRight">
                <Avatar style={{ background: themeConfig.avatar, cursor: "pointer" }} icon={<UserOutlined />} />
              </Dropdown>
            </Space>
          </Row>
        </Header>
        <Content style={{
          margin: isMobileView ? "12px 8px" : "24px",
          minHeight: 280,
          paddingBottom: isMobileView ? "calc(64px + env(safe-area-inset-bottom, 0px))" : 0,
        }}>
          <Suspense fallback={<div style={{ textAlign: "center", padding: 48 }}><Spin size="large" /></div>}>
            <PageComp perms={perms} />
          </Suspense>
        </Content>
      </Layout>

      {/* Bottom navigation + sheet "Thêm" — chỉ trên mobile */}
      {isMobileView && (
        <>
          <MobileBottomNav
            items={primaryTabs}
            current={safeKey}
            onSelect={(key) => { setCurrent(key); setMoreOpen(false); }}
            onMore={() => setMoreOpen(true)}
            moreActive={moreOpen || currentInOverflow}
          />
          <Drawer
            placement="bottom"
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            title="Thêm"
            height="auto"
            styles={{ body: { padding: 0 } }}
          >
            <Menu
              mode="inline"
              selectedKeys={[safeKey]}
              onClick={({ key }) => {
                if (key === "switch_club") { selectClub(null); }
                else if (key === "logout") { logout(); setMode(null); }
                else { setCurrent(key); }
                setMoreOpen(false);
              }}
              items={[
                ...overflowTabs.map(({ key, label, icon }) => ({ key, label, icon })),
                { type: "divider" },
                ...(memberships.length > 1
                  ? [{ key: "switch_club", label: "Đổi câu lạc bộ", icon: <SwapOutlined /> }]
                  : []),
                { key: "logout", label: "Đăng xuất", icon: <LogoutOutlined />, danger: true },
              ]}
            />
            {/* Theme picker — chỉ hiện trong Drawer mobile */}
            <div style={{ padding: "10px 16px 16px", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Giao diện</div>
              <Space wrap>
                {Object.values(THEMES).map((t) => (
                  <Button
                    key={t.name}
                    size="small"
                    type={themeName === t.name ? "primary" : "default"}
                    onClick={() => setThemeName(t.name)}
                    style={{ borderRadius: 20 }}
                  >
                    {t.icon} {t.label}
                  </Button>
                ))}
              </Space>
            </div>
          </Drawer>
        </>
      )}

      {/* Drawer Cài đặt Telegram Bot */}
      <Drawer
        title={<><RobotOutlined style={{ marginRight: 8 }} />Cài đặt Telegram Bot</>}
        placement="right"
        width={isMobileView ? "100%" : 620}
        open={botDrawerOpen}
        onClose={() => setBotDrawerOpen(false)}
        styles={{ body: { padding: "16px" } }}
      >
        <Suspense fallback={<div style={{ textAlign: "center", padding: 48 }}><Spin /></div>}>
          <BotConfigPanel />
        </Suspense>
      </Drawer>
    </Layout>
  );
}

export default function App() {
  // Trang công khai — không cần đăng nhập
  const publicMatch = window.location.pathname.match(/^\/public\/report\/([^/]+)/);
  if (publicMatch) {
    return <Suspense fallback={<PageSpinner />}><PublicReport token={publicMatch[1]} /></Suspense>;
  }

  return (
    <AuthProvider>
      <ViewModeProvider>
        <Suspense fallback={<PageSpinner />}>
          <AppShell />
        </Suspense>
      </ViewModeProvider>
    </AuthProvider>
  );
}
