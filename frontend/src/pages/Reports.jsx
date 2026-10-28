import { useState } from "react";
import { Typography, Row, Select, Tabs } from "antd";
import dayjs from "dayjs";
import { reportsApi, transactionsApi, feeTypesApi } from "../api";
import { YearlySummary, MonthlyStats, MemberContributions, FeeStatusTracker } from "../components/ReportContent";

const { Title } = Typography;

// API object truyền xuống các sub-component
const DEFAULT_API = {
  reports: reportsApi,
  transactions: transactionsApi,
  feeTypes: feeTypesApi,
};

// (Link công khai chuyển sang Cài đặt CLB → components/PublicLinksTab.jsx, 2026-10-28)

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Reports() {
  const [year, setYear] = useState(dayjs().year());
  const currentYear = dayjs().year();
  const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Báo cáo & Thống kê</Title>
        <Select value={year} onChange={setYear} style={{ width: 100 }}>
          {YEARS.map((y) => (
            <Select.Option key={y} value={y}>{y}</Select.Option>
          ))}
        </Select>
      </Row>

      <Tabs
        defaultActiveKey="monthly-detail"
        items={[
          { key: "monthly-detail", label: "Thống kê theo tháng", children: <MonthlyStats year={year} api={DEFAULT_API} /> },
          { key: "yearly", label: "Tổng hợp cả năm", children: <YearlySummary year={year} api={DEFAULT_API} /> },
          { key: "contributions", label: "Đóng góp thành viên", children: <MemberContributions year={year} api={DEFAULT_API} /> },
          { key: "fee-status", label: "Theo dõi phí", children: <FeeStatusTracker year={year} api={DEFAULT_API} /> },
        ]}
      />
    </div>
  );
}
