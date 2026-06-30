import React, { useEffect, useState } from "react";
import {
  Typography, Select, Tabs, Spin, Result, Card, Tag, Space, Row, Col,
} from "antd";
import {
  LockOutlined, EyeOutlined, CalendarOutlined, TrophyOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { createPublicReportApi } from "../api";
import { YearlySummary, MonthlyStats, MemberContributions, FeeStatusTracker } from "../components/ReportContent";
import { ViewModeProvider } from "../contexts/ViewModeContext";
import ViewModeSwitcher from "../components/ViewModeSwitcher";

const { Title, Text } = Typography;

function PublicReportInner({ token }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [year, setYear] = useState(dayjs().year());

  const api = createPublicReportApi(token);

  useEffect(() => {
    api.meta()
      .then((r) => setMeta(r.data))
      .catch((err) => {
        const status = err.response?.status;
        if (status === 404) setError("Link không tồn tại hoặc đã bị vô hiệu hóa.");
        else if (status === 410) setError("Link này đã hết hạn.");
        else setError("Không thể tải báo cáo. Vui lòng thử lại sau.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  const currentYear = dayjs().year();
  const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spin size="large" tip="Đang tải báo cáo..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f5" }}>
        <Result
          icon={<LockOutlined style={{ color: "#faad14" }} />}
          title="Không thể xem báo cáo"
          subTitle={error}
        />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "12px 24px" }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space align="center">
              <TrophyOutlined style={{ fontSize: 22, color: "#1677ff" }} />
              <div>
                <Title level={4} style={{ margin: 0, lineHeight: 1.2 }}>{meta.club_name}</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>{meta.club_sport} · Báo cáo tài chính</Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Space wrap>
              <ViewModeSwitcher />
              <Tag icon={<EyeOutlined />} color="blue">{meta.view_count} lượt xem</Tag>
              {meta.expires_at && (
                <Tag icon={<CalendarOutlined />} color="orange">
                  Hết hạn: {dayjs(meta.expires_at).format("DD/MM/YYYY")}
                </Tag>
              )}
              {!meta.expires_at && <Tag color="green">Vĩnh viễn</Tag>}
            </Space>
          </Col>
        </Row>
      </div>

      {/* Nhãn link */}
      <div style={{ background: "#e6f4ff", padding: "8px 24px", borderBottom: "1px solid #bae0ff" }}>
        <Text style={{ color: "#0958d9", fontSize: 13 }}>
          <LockOutlined /> {meta.label} · Chỉ xem — không thể chỉnh sửa
        </Text>
      </div>

      {/* Nội dung */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
        <Card bordered={false} style={{ marginBottom: 16, borderRadius: 12 }}>
          <Row justify="space-between" align="middle">
            <Title level={5} style={{ margin: 0 }}>Năm tài chính</Title>
            <Select value={year} onChange={setYear} style={{ width: 100 }}>
              {YEARS.map((y) => (
                <Select.Option key={y} value={y}>{y}</Select.Option>
              ))}
            </Select>
          </Row>
        </Card>

        <Tabs
          defaultActiveKey="monthly-detail"
          items={[
            { key: "monthly-detail", label: "Thống kê tháng", children: <MonthlyStats year={year} api={api} /> },
            { key: "yearly", label: "Tổng hợp năm", children: <YearlySummary year={year} api={api} /> },
            { key: "contributions", label: "Đóng góp thành viên", children: <MemberContributions year={year} api={api} /> },
            { key: "fee-status", label: "Theo dõi phí", children: <FeeStatusTracker year={year} api={api} /> },
          ]}
        />
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "16px 0 32px", color: "#8c8c8c", fontSize: 12 }}>
        Báo cáo này chỉ dành cho xem — mọi dữ liệu là READ-ONLY
      </div>
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
