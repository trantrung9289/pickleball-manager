import React, { useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Typography, Spin, Tag, Divider } from "antd";
import {
  TeamOutlined, RiseOutlined, FallOutlined, WalletOutlined,
  TrophyOutlined, CalendarOutlined,
} from "@ant-design/icons";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import dayjs from "dayjs";
import { reportsApi, tournamentsApi } from "../api";

const { Title, Text } = Typography;

const fmt = (n) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);

const MONTHS = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"];

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [thisMonth, setThisMonth] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const year = dayjs().year();
  const month = dayjs().month() + 1;

  useEffect(() => {
    reportsApi.overview().then((r) => setOverview(r.data));
    reportsApi.summary(year).then((r) =>
      setMonthly(r.data.map((d) => ({ ...d, name: MONTHS[d.month - 1] })))
    );
    reportsApi.monthlyDetail(month, year).then((r) => setThisMonth(r.data));
    tournamentsApi.list().then((r) => setTournaments(r.data));
  }, []);

  if (!overview) return <Spin size="large" style={{ marginTop: 80, display: "block", textAlign: "center" }} />;

  const activeTournaments = tournaments.filter(t => t.status === "active").length;
  const totalTournaments = tournaments.length;

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>Tổng quan</Title>

      {/* KPIs all-time */}
      <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Tổng thành viên" value={overview.total_members}
              prefix={<TeamOutlined />} styles={{ content: { color: "#1677ff" } }} />
            <Text type="secondary">Đang hoạt động: <b style={{ color: "#52c41a" }}>{overview.active_members}</b></Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Tổng thu (tất cả)" value={overview.total_income}
              formatter={fmt} prefix={<RiseOutlined />} styles={{ content: { color: "#52c41a" } }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Tổng chi (tất cả)" value={overview.total_expense}
              formatter={fmt} prefix={<FallOutlined />} styles={{ content: { color: "#ff4d4f" } }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Số dư tích lũy" value={overview.balance}
              formatter={fmt} prefix={<WalletOutlined />}
              styles={{ content: { color: overview.balance >= 0 ? "#52c41a" : "#ff4d4f" } }} />
          </Card>
        </Col>
      </Row>

      {/* Tháng hiện tại + Giải đấu */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24, marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title={<span><CalendarOutlined style={{ marginRight: 8 }} />Tháng {month}/{year}</span>}
            size="small" style={{ borderTop: "3px solid #1677ff" }}>
            {thisMonth ? (
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic title="Thu tháng này" value={thisMonth.total_income}
                    formatter={fmt} styles={{ content: { color: "#52c41a", fontSize: 18 } }} />
                </Col>
                <Col span={8}>
                  <Statistic title="Chi tháng này" value={thisMonth.total_expense}
                    formatter={fmt} styles={{ content: { color: "#ff4d4f", fontSize: 18 } }} />
                </Col>
                <Col span={8}>
                  <Statistic title="Số dư tháng" value={thisMonth.balance}
                    formatter={fmt}
                    styles={{ content: { color: thisMonth.balance >= 0 ? "#1677ff" : "#ff4d4f", fontSize: 18 } }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{thisMonth.transaction_count} giao dịch</Text>
                </Col>
              </Row>
            ) : <Spin size="small" />}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span><TrophyOutlined style={{ marginRight: 8 }} />Giải đấu</span>}
            size="small" style={{ borderTop: "3px solid #faad14" }}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic title="Đang diễn ra" value={activeTournaments}
                  styles={{ content: { color: "#faad14", fontSize: 22 } }} />
              </Col>
              <Col span={12}>
                <Statistic title="Tổng số giải" value={totalTournaments}
                  styles={{ content: { fontSize: 22 } }} />
              </Col>
            </Row>
            <div style={{ marginTop: 8 }}>
              {tournaments.filter(t => t.status === "active").slice(0, 2).map(t => (
                <Tag key={t.id} color="processing" style={{ marginBottom: 4 }}>{t.name}</Tag>
              ))}
              {tournaments.filter(t => t.status === "active").length === 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>Không có giải nào đang diễn ra</Text>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Biểu đồ */}
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card title={`Biểu đồ thu chi năm ${year}`}>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(v) => `${(v/1e6).toFixed(0)}tr`} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Legend />
                <Bar dataKey="total_income" name="Thu" fill="#52c41a" radius={[3,3,0,0]} />
                <Bar dataKey="total_expense" name="Chi" fill="#ff4d4f" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
