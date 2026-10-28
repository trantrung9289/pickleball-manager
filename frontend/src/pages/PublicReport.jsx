import { useEffect, useMemo, useState } from "react";
import {
  Typography, Select, Tabs, Spin, Result, Card, Tag, Space, Row, Col, theme,
} from "antd";
import {
  LockOutlined, EyeOutlined, CalendarOutlined, TrophyOutlined,
  BarChartOutlined, TeamOutlined, DollarOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { createPublicReportApi, logoSrc } from "../api";
import { YearlySummary, MonthlyStats, MemberContributions, FeeStatusTracker } from "../components/ReportContent";
import PublicTournamentTracker from "../components/PublicTournamentTracker";
import { ViewModeProvider, useViewMode } from "../contexts/ViewModeContext";
import ViewModeSwitcher from "../components/ViewModeSwitcher";
import ThemeSwitcher from "../components/ThemeSwitcher";
import NotificationBell from "../components/NotificationBell";
import PushSettings from "../components/PushSettings";
import { InstallButton, InstallBanner, InstallGuide } from "../components/InstallApp";
import useInstallPrompt from "../hooks/useInstallPrompt";
import { shouldShowInstallBanner, bannerKey, nudgeKey, readLS, writeLS } from "../utils/install";
import { useAppTheme } from "../contexts/ThemeContext";
import MobileBottomNav from "../components/mobile/MobileBottomNav";

const { Title, Text } = Typography;

function PublicReportInner({ token }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [year, setYear] = useState(dayjs().year());
  const [activeSection, setActiveSection] = useState("monthly-detail");
  const { token: antToken } = theme.useToken();
  const { themeConfig, themeName } = useAppTheme();
  const { isMobileView } = useViewMode();
  const isDark = themeName === "ai-inspired";

  const api = useMemo(() => createPublicReportApi(token), [token]);
  const install = useInstallPrompt();
  const [guideOpen, setGuideOpen] = useState(false);
  const [bellSignal, setBellSignal] = useState(0);
  const showBanner = shouldShowInstallBanner({ platform: install.platform, dismissedAt: readLS(bannerKey(token)) });

  // Mở app (từ màn hình chính hoặc quay lại tab) → xoá số đếm trên icon và các thông báo còn treo của app này
  useEffect(() => {
    const clear = () => {
      if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
      navigator.serviceWorker?.ready?.then((reg) => reg.getNotifications().then((list) => list.forEach((n) => n.close()))).catch(() => {});
    };
    clear();
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);

  // Lần đầu mở từ màn hình chính (đã cài) → tự mở chuông với khối "Thông báo trên thiết bị", chỉ một lần theo slug
  useEffect(() => {
    if (!install.standalone || readLS(nudgeKey(token))) return;
    writeLS(nudgeKey(token), Date.now());
    const t = setTimeout(() => setBellSignal((n) => n + 1), 800);
    return () => clearTimeout(t);
  }, [install.standalone, token]);

  // PWA: manifest theo CLB (tên, logo, start_url = trang này) để "Thêm vào màn hình chính" mở đúng CLB và nhận Web Push
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    const prev = link?.getAttribute("href");
    if (link) link.setAttribute("href", api.manifestUrl);
    return () => { if (link && prev) link.setAttribute("href", prev); };
  }, [api]);
  // iPhone lấy icon từ apple-touch-icon: logo CLB ghép nền màu thương hiệu + ô trắng (backend); không có logo → icon chung
  useEffect(() => {
    const link = document.querySelector('link[rel="apple-touch-icon"]');
    if (!link || !meta?.club_apple_icon_src) return undefined;
    const prev = link.getAttribute("href");
    link.setAttribute("href", logoSrc(meta.club_apple_icon_src));
    return () => { if (prev) link.setAttribute("href", prev); };
  }, [meta?.club_apple_icon_src]);

  const SECTIONS = [
    { key: "monthly-detail", label: "Thống kê tháng", navLabel: "Tháng", icon: <BarChartOutlined />, children: <MonthlyStats year={year} api={api} /> },
    { key: "yearly", label: "Tổng hợp năm", navLabel: "Năm", icon: <CalendarOutlined />, children: <YearlySummary year={year} api={api} /> },
    { key: "contributions", label: "Đóng góp thành viên", navLabel: "Đóng góp", icon: <TeamOutlined />, children: <MemberContributions year={year} api={api} /> },
    { key: "fee-status", label: "Theo dõi phí", navLabel: "Phí", icon: <DollarOutlined />, children: <FeeStatusTracker year={year} api={api} showPhone={false} /> },
    { key: "tournaments", label: "Theo dõi giải đấu", navLabel: "Giải đấu", icon: <TrophyOutlined />, children: <PublicTournamentTracker api={api} /> },
  ];

  useEffect(() => {
    api.meta()
      .then((r) => {
        setMeta(r.data);
        document.title = `${r.data.club_name} | Báo cáo tài chính`;
      })
      .catch((err) => {
        const status = err.response?.status;
        if (status === 404) setError("Link không tồn tại hoặc đã bị vô hiệu hóa.");
        else if (status === 410) setError("Link này đã hết hạn.");
        else setError("Không thể tải báo cáo. Vui lòng thử lại sau.");
      })
      .finally(() => setLoading(false));
  }, [token, api]);

  const currentYear = dayjs().year();
  const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: antToken.colorBgLayout }}>
        <Spin size="large" tip="Đang tải báo cáo..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: antToken.colorBgLayout }}>
        <Result
          icon={<LockOutlined style={{ color: "#faad14" }} />}
          title="Không thể xem báo cáo"
          subTitle={error}
        />
      </div>
    );
  }

  // Màu label bar theo theme
  const labelBarStyle = isDark
    ? { background: "rgba(39,160,99,0.1)", borderBottom: "1px solid rgba(39,160,99,0.25)", padding: "8px 24px" }
    : { background: "rgba(39,160,99,0.08)", borderBottom: "1px solid rgba(39,160,99,0.2)", padding: "8px 24px" };
  const labelTextColor = isDark ? "#5dd49a" : "#1a7a4a";

  return (
    <div className="ui-glass-scope" style={{ minHeight: "100vh", background: antToken.colorBgLayout }}>{/* đồng bộ kiểu kính với Dashboard */}
      {/* Header */}
      <div style={{
        background: antToken.colorBgContainer,
        borderBottom: `1px solid ${antToken.colorBorderSecondary}`,
        padding: "12px 24px",
      }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space align="center">
              {meta.club_logo_src
                ? <img src={logoSrc(meta.club_logo_src)} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "contain" }} />
                : <TrophyOutlined style={{ fontSize: 22, color: themeConfig.sidebarActive }} />}
              <div>
                <Title level={4} style={{ margin: 0, lineHeight: 1.2, color: antToken.colorText }}>{meta.club_name}</Title>
                <Text style={{ fontSize: 12, color: antToken.colorTextSecondary }}>{meta.club_sport} · Báo cáo tài chính</Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Space wrap>
              {/* Chuông thông báo (đợt 2): cùng cụm với nút giao diện; trên mobile các tag lượt xem/hết hạn xuống dòng riêng */}
              <NotificationBell scope={`public:${token}`} fetchFeed={api.announcements} dark={isDark} topPanel={<PushSettings push={api.push} />} openSignal={bellSignal} />
              <InstallButton install={install} dark={isDark} onGuide={() => setGuideOpen(true)} />
              <ThemeSwitcher dark={isDark} />
              <ViewModeSwitcher />
              {!isMobileView && <>
                <Tag icon={<EyeOutlined />} color="green">{meta.view_count} lượt xem</Tag>
                {meta.expires_at && (
                  <Tag icon={<CalendarOutlined />} color="orange">
                    Hết hạn: {dayjs(meta.expires_at).format("DD/MM/YYYY")}
                  </Tag>
                )}
                {!meta.expires_at && <Tag color="green">Vĩnh viễn</Tag>}
              </>}
            </Space>
          </Col>
        </Row>
      </div>

      {/* Nhãn link */}
      <div style={labelBarStyle}>
        <Text style={{ color: labelTextColor, fontSize: 13 }}>
          <LockOutlined /> {meta.label} · Chỉ xem — không thể chỉnh sửa
        </Text>
      </div>
      {/* Thanh mời cài đặt lần đầu (ẩn khi đã cài / trong app khác / đã "Để sau" trong 14 ngày) */}
      {showBanner && <InstallBanner install={install} slug={token} onGuide={() => setGuideOpen(true)} />}
      <InstallGuide open={guideOpen} onClose={() => setGuideOpen(false)} platform={install.platform} isMobileView={isMobileView} />

      {/* Nội dung */}
      <div style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: isMobileView ? "16px 12px" : "24px 16px",
        paddingBottom: isMobileView ? "calc(64px + env(safe-area-inset-bottom, 0px))" : undefined,
      }}>
        <Card bordered={false} style={{ marginBottom: 16, borderRadius: 12 }}>
          <Row justify="space-between" align="middle">
            <Title level={5} style={{ margin: 0, color: antToken.colorText }}>Năm tài chính</Title>
            <Select value={year} onChange={setYear} style={{ width: 100 }}>
              {YEARS.map((y) => (
                <Select.Option key={y} value={y}>{y}</Select.Option>
              ))}
            </Select>
          </Row>
        </Card>

        {isMobileView ? (
          SECTIONS.find((s) => s.key === activeSection)?.children
        ) : (
          <Tabs
            activeKey={activeSection}
            onChange={setActiveSection}
            items={SECTIONS.map(({ key, label, children }) => ({ key, label, children }))}
          />
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "16px 0 32px", color: antToken.colorTextQuaternary, fontSize: 12 }}>
        Báo cáo này chỉ dành cho xem — mọi dữ liệu là READ-ONLY
      </div>

      {/* Bottom navigation — chỉ trên mobile */}
      {isMobileView && (
        <MobileBottomNav
          items={SECTIONS.map(({ key, navLabel, icon }) => ({ key, label: navLabel, icon }))}
          current={activeSection}
          onSelect={setActiveSection}
        />
      )}
    </div>
  );
}

export default function PublicReport({ token }) {
  return (
    <ViewModeProvider>
      <PublicReportInner token={token} />
    </ViewModeProvider>
  );
}
