import { useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Typography, Skeleton, Tag } from "antd";
import { StatCard, StatCardSkeleton, StatusChip } from "../components/ui";
import {
  TeamOutlined, RiseOutlined, FallOutlined, WalletOutlined,
  TrophyOutlined, CalendarOutlined,
} from "@ant-design/icons";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import dayjs from "dayjs";
import { reportsApi, tournamentsApi, feeTypesApi } from "../api";

const { Title, Text } = Typography;

const fmt = (n) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);

const MONTHS = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"];

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [thisMonth, setThisMonth] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [unpaid, setUnpaid] = useState(null);   // [{fee_type_name, count}] khoản thu định kỳ (bật nhắc) còn người chưa đóng tháng này
  const year = dayjs().year();
  const month = dayjs().month() + 1;

  useEffect(() => {
    reportsApi.overview().then((r) => setOverview(r.data));
    reportsApi.summary(year).then((r) =>
      setMonthly(r.data.map((d) => ({ ...d, name: MONTHS[d.month - 1] })))
    );
    reportsApi.monthlyDetail(month, year).then((r) => setThisMonth(r.data));
    tournamentsApi.list().then((r) => setTournaments(r.data));
    // Việc cần làm: khoản thu định kỳ đang bật nhắc → đếm thành viên chưa đóng tháng này (lỗi → bỏ qua, không chặn trang)
    feeTypesApi.list().then(async (r) => {
      const types = (r.data || []).filter((ft) => ft.remind_enabled && ft.type === "income");
      const rows = await Promise.all(types.map(async (ft) => {
        try {
          const res = await reportsApi.feeStatus(month, year, ft.id);
          const list = Array.isArray(res.data) ? res.data : (res.data?.members || []);
          return { fee_type_name: ft.name, count: list.filter((m) => !m.paid).length };
        } catch { return null; }
      }));
      setUnpaid(rows.filter((x) => x && x.count > 0));
    }).catch(() => setUnpaid([]));
  }, [month, year]);

  if (!overview) return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
        {[0,1,2,3].map(i => (
          <Col key={i} xs={12} lg={6}>
            <StatCardSkeleton />
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]} style={{ marginBottom: 24, marginTop: 16 }}>
        <Col xs={24} lg={16}><Card><Skeleton active paragraph={{ rows: 2 }} /></Card></Col>
        <Col xs={24} lg={8}><Card><Skeleton active paragraph={{ rows: 2 }} /></Card></Col>
      </Row>
      <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>
    </div>
  );

  const activeTournaments = tournaments.filter(t => t.status === "active").length;
  const totalTournaments = tournaments.length;
  // Lớp 3 (bảng điều khiển việc còn tồn): bảng việc còn tồn — gom từ dữ liệu đã có, không thêm API
  const todos = [];
  tournaments.filter(t => t.status === "active").forEach(t => {
    const ms = t.matches || [];
    const pending = ms.filter(m => m.p1_id && m.p2_id && m.status !== "completed").length;
    if (ms.length === 0) todos.push({ key: `gen-${t.id}`, tone: "warn", text: `Giải "${t.name}" đã bắt đầu nhưng chưa sinh lịch` });
    else if (pending > 0) todos.push({ key: `pend-${t.id}`, tone: "info", text: `Giải "${t.name}": còn ${pending}/${ms.length} trận chưa có kết quả` });
    else todos.push({ key: `done-${t.id}`, tone: "ok", text: `Giải "${t.name}": đã đủ kết quả — có thể kết thúc giải` });
    if (t.team_type === "team" && (t.team_pool_count || 0) > 0) todos.push({ key: `pool-${t.id}`, tone: "warn", text: `Giải "${t.name}": ${t.team_pool_count} VĐV chưa phân đội` });
  });
  tournaments.filter(t => t.status === "draft").forEach(t => todos.push({ key: `draft-${t.id}`, tone: "neutral", text: `Giải "${t.name}" đang ở Nháp` }));
  (unpaid || []).forEach(u => todos.push({ key: `fee-${u.fee_type_name}`, tone: "danger", text: `${u.count} thành viên chưa đóng "${u.fee_type_name}" tháng ${month}` }));

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>Tổng quan</Title>

      {/* KPIs all-time */}
      <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
        <Col xs={12} lg={6}>
          <StatCard title="Tổng thành viên" value={overview.total_members} icon={<TeamOutlined />} tone="brand"
            note={<>Đang hoạt động: <b style={{ color: "var(--ok-strong)" }}>{overview.active_members}</b></>} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard title="Tổng thu (tất cả)" value={fmt(overview.total_income)} icon={<RiseOutlined />} tone="ok" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard title="Tổng chi (tất cả)" value={fmt(overview.total_expense)} icon={<FallOutlined />} tone="danger" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard title="Số dư tích lũy" value={fmt(overview.balance)} icon={<WalletOutlined />} tone={overview.balance >= 0 ? "ok" : "danger"} />
        </Col>
      </Row>

      {/* Việc cần làm (lớp 3) */}
      <Card size="small" style={{ marginTop: 16, borderLeft: "4px solid var(--brand)" }}
        title={<span>Việc cần làm <StatusChip tone={todos.length ? "brand" : "ok"}>{todos.length ? todos.length : "trống"}</StatusChip></span>}>
        {todos.length === 0 ? (
          <Text type="secondary">Không có việc tồn: mọi giải đã đủ kết quả{unpaid === null ? "" : ", các khoản thu định kỳ đã đóng đủ"}.</Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {todos.map(x => (
              <div key={x.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusChip tone={x.tone} dot>{x.tone === "danger" ? "Phí" : x.tone === "warn" ? "Cần làm" : x.tone === "ok" ? "Xong" : x.tone === "info" ? "Đang đấu" : "Nháp"}</StatusChip>
                <Text>{x.text}</Text>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Tháng hiện tại + Giải đấu */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24, marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title={<span><CalendarOutlined style={{ marginRight: 8 }} />Tháng {month}/{year}</span>}
            size="small" style={{ borderTop: "3px solid var(--brand)" }}>
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
                    styles={{ content: { color: thisMonth.balance >= 0 ? "var(--ok)" : "var(--danger)", fontSize: 18 } }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{thisMonth.transaction_count} giao dịch</Text>
                </Col>
              </Row>
            ) : <Skeleton active paragraph={{ rows: 1 }} />}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span><TrophyOutlined style={{ marginRight: 8 }} />Giải đấu</span>}
            size="small" style={{ borderTop: "3px solid var(--warn)" }}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic title="Đang diễn ra" value={activeTournaments}
                  styles={{ content: { color: "var(--warn)", fontSize: 22 } }} />
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
                <Bar dataKey="total_income" name="Thu" fill="var(--ok)" radius={[3,3,0,0]} />
                <Bar dataKey="total_expense" name="Chi" fill="var(--danger)" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
