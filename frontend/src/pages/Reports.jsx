import React, { useEffect, useState } from "react";
import {
  Table, Select, Typography, Row, Col, Card, Tabs, Statistic,
  Tag, Empty, Spin, Divider, Progress, Alert, Button, Space,
} from "antd";
import {
  RiseOutlined, FallOutlined, WalletOutlined, SwapOutlined,
  CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { reportsApi, feeTypesApi, transactionsApi } from "../api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, LabelList,
} from "recharts";

const { Title, Text } = Typography;

const fmt = (n) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n || 0);

const MONTHS = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"];

const INCOME_COLORS = ["#52c41a","#73d13d","#95de64","#b7eb8f","#d9f7be"];
const EXPENSE_COLORS = ["#ff4d4f","#ff7875","#ffa39e","#ffccc7","#fff1f0"];

// ── Tab 1: Tổng hợp năm ──────────────────────────────────────────────────────
function YearlySummary({ year }) {
  const [monthly, setMonthly] = useState([]);

  useEffect(() => {
    reportsApi.summary(year).then((r) =>
      setMonthly(r.data.map((d) => ({ ...d, name: MONTHS[d.month - 1] })))
    );
  }, [year]);

  const totalIncome = monthly.reduce((s, d) => s + d.total_income, 0);
  const totalExpense = monthly.reduce((s, d) => s + d.total_expense, 0);

  const monthCols = [
    { title: "Tháng", dataIndex: "name", width: 70 },
    {
      title: "Tổng thu",
      dataIndex: "total_income",
      render: (v) => <span style={{ color: "#52c41a" }}>{fmt(v)}</span>,
      align: "right",
    },
    {
      title: "Tổng chi",
      dataIndex: "total_expense",
      render: (v) => <span style={{ color: "#ff4d4f" }}>{fmt(v)}</span>,
      align: "right",
    },
    {
      title: "Số dư",
      dataIndex: "balance",
      render: (v) => (
        <b style={{ color: v >= 0 ? "#1677ff" : "#ff4d4f" }}>{fmt(v)}</b>
      ),
      align: "right",
    },
  ];

  return (
    <>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={`Tổng thu ${year}`}
              value={totalIncome}
              formatter={fmt}
              prefix={<RiseOutlined />}
              styles={{ content: { color: "#52c41a", fontSize: 20 } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={`Tổng chi ${year}`}
              value={totalExpense}
              formatter={fmt}
              prefix={<FallOutlined />}
              styles={{ content: { color: "#ff4d4f", fontSize: 20 } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title="Số dư còn lại"
              value={totalIncome - totalExpense}
              formatter={fmt}
              prefix={<WalletOutlined />}
              styles={{ content: { color: totalIncome >= totalExpense ? "#1677ff" : "#ff4d4f", fontSize: 20 } }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Biểu đồ thu chi theo tháng" style={{ marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(0)}tr`} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend />
            <Bar dataKey="total_income" name="Thu" fill="#52c41a" radius={[3,3,0,0]} />
            <Bar dataKey="total_expense" name="Chi" fill="#ff4d4f" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Đường số dư tích lũy theo tháng" style={{ marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(0)}tr`} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Line
              type="monotone" dataKey="balance" name="Số dư"
              stroke="#1677ff" strokeWidth={2}
              dot={{ r: 4 }} activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Table
        columns={monthCols}
        dataSource={monthly}
        rowKey="month"
        size="small"
        pagination={false}
        summary={(rows) => {
          const tIncome = rows.reduce((s, r) => s + r.total_income, 0);
          const tExpense = rows.reduce((s, r) => s + r.total_expense, 0);
          return (
            <Table.Summary.Row style={{ background: "#fafafa", fontWeight: 600 }}>
              <Table.Summary.Cell>Cộng</Table.Summary.Cell>
              <Table.Summary.Cell align="right"><span style={{ color: "#52c41a" }}>{fmt(tIncome)}</span></Table.Summary.Cell>
              <Table.Summary.Cell align="right"><span style={{ color: "#ff4d4f" }}>{fmt(tExpense)}</span></Table.Summary.Cell>
              <Table.Summary.Cell align="right"><b style={{ color: tIncome >= tExpense ? "#1677ff" : "#ff4d4f" }}>{fmt(tIncome - tExpense)}</b></Table.Summary.Cell>
            </Table.Summary.Row>
          );
        }}
      />
    </>
  );
}

// ── Tab 2: Thống kê theo tháng ───────────────────────────────────────────────
function MonthlyStats({ year }) {
  const [month, setMonth] = useState(dayjs().month() + 1);
  const [detail, setDetail] = useState(null);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      reportsApi.monthlyDetail(month, year),
      transactionsApi.list({ month, year }),
    ]).then(([dRes, txRes]) => {
      setDetail(dRes.data);
      setTxs(txRes.data);
    }).finally(() => setLoading(false));
  }, [month, year]);

  const txCols = [
    {
      title: "Ngày",
      dataIndex: "transaction_date",
      width: 100,
      render: (v) => dayjs(v).format("DD/MM/YYYY"),
      sorter: (a, b) => a.transaction_date.localeCompare(b.transaction_date),
    },
    {
      title: "Loại",
      dataIndex: "type",
      width: 70,
      render: (v) => <Tag color={v === "income" ? "green" : "red"}>{v === "income" ? "Thu" : "Chi"}</Tag>,
    },
    { title: "Khoản", render: (_, r) => r.fee_type?.name || "—" },
    { title: "Thành viên", render: (_, r) => r.member?.full_name || "—" },
    {
      title: "Số tiền",
      dataIndex: "amount",
      align: "right",
      render: (v, r) => (
        <b style={{ color: r.type === "income" ? "#52c41a" : "#ff4d4f" }}>{fmt(v)}</b>
      ),
    },
    { title: "Phương thức", dataIndex: "payment_method", width: 130 },
    { title: "Ghi chú", dataIndex: "description", ellipsis: true },
  ];

  const renderPie = (data, colors, label) => {
    if (!data?.length) return <Empty description={`Không có khoản ${label}`} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    return (
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="fee_type"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={({ fee_type, percent }) => `${fee_type} ${(percent * 100).toFixed(0)}%`}
            labelLine={false}
          >
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => fmt(v)} />
        </PieChart>
      </ResponsiveContainer>
    );
  };

  return (
    <>
      <Row align="middle" gutter={12} style={{ marginBottom: 16 }}>
        <Col>
          <Text strong>Chọn tháng:</Text>
        </Col>
        <Col>
          <Select value={month} onChange={setMonth} style={{ width: 120 }}>
            {Array.from({ length: 12 }, (_, i) => (
              <Select.Option key={i + 1} value={i + 1}>Tháng {i + 1}</Select.Option>
            ))}
          </Select>
        </Col>
        <Col>
          <Text type="secondary">Năm {year}</Text>
        </Col>
      </Row>

      <Spin spinning={loading}>
        {detail && (
          <>
            {/* KPI cards */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ borderTop: "3px solid #52c41a" }}>
                  <Statistic
                    title="Tổng thu"
                    value={detail.total_income}
                    formatter={fmt}
                    styles={{ content: { color: "#52c41a", fontSize: 18 } }}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ borderTop: "3px solid #ff4d4f" }}>
                  <Statistic
                    title="Tổng chi"
                    value={detail.total_expense}
                    formatter={fmt}
                    styles={{ content: { color: "#ff4d4f", fontSize: 18 } }}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ borderTop: "3px solid #1677ff" }}>
                  <Statistic
                    title="Số dư"
                    value={detail.balance}
                    formatter={fmt}
                    styles={{ content: { color: detail.balance >= 0 ? "#1677ff" : "#ff4d4f", fontSize: 18 } }}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ borderTop: "3px solid #faad14" }}>
                  <Statistic
                    title="Số giao dịch"
                    value={detail.transaction_count}
                    suffix="GD"
                    prefix={<SwapOutlined />}
                    styles={{ content: { fontSize: 18 } }}
                  />
                </Card>
              </Col>
            </Row>

            {/* Breakdown charts */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col xs={24} md={12}>
                <Card
                  size="small"
                  title={
                    <span>
                      Cơ cấu thu&nbsp;
                      <Tag color="green">{fmt(detail.total_income)}</Tag>
                    </span>
                  }
                >
                  {renderPie(detail.income_breakdown, INCOME_COLORS, "thu")}
                  {detail.income_breakdown?.length > 0 && (
                    <Table
                      dataSource={detail.income_breakdown}
                      rowKey="fee_type"
                      size="small"
                      pagination={false}
                      style={{ marginTop: 8 }}
                      columns={[
                        { title: "Khoản thu", dataIndex: "fee_type" },
                        { title: "Lần", dataIndex: "count", align: "center", width: 60 },
                        { title: "Số tiền", dataIndex: "amount", align: "right", render: (v) => <span style={{ color: "#52c41a" }}>{fmt(v)}</span> },
                      ]}
                    />
                  )}
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card
                  size="small"
                  title={
                    <span>
                      Cơ cấu chi&nbsp;
                      <Tag color="red">{fmt(detail.total_expense)}</Tag>
                    </span>
                  }
                >
                  {renderPie(detail.expense_breakdown, EXPENSE_COLORS, "chi")}
                  {detail.expense_breakdown?.length > 0 && (
                    <Table
                      dataSource={detail.expense_breakdown}
                      rowKey="fee_type"
                      size="small"
                      pagination={false}
                      style={{ marginTop: 8 }}
                      columns={[
                        { title: "Khoản chi", dataIndex: "fee_type" },
                        { title: "Lần", dataIndex: "count", align: "center", width: 60 },
                        { title: "Số tiền", dataIndex: "amount", align: "right", render: (v) => <span style={{ color: "#ff4d4f" }}>{fmt(v)}</span> },
                      ]}
                    />
                  )}
                </Card>
              </Col>
            </Row>

            {/* Transaction list */}
            <Card
              size="small"
              title={`Danh sách giao dịch tháng ${month}/${year} (${txs.length} giao dịch)`}
            >
              {txs.length === 0
                ? <Empty description="Chưa có giao dịch nào trong tháng này" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                : (
                  <Table
                    columns={txCols}
                    dataSource={txs}
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 15 }}
                    summary={(rows) => {
                      const tIn = rows.filter((r) => r.type === "income").reduce((s, r) => s + parseFloat(r.amount), 0);
                      const tEx = rows.filter((r) => r.type === "expense").reduce((s, r) => s + parseFloat(r.amount), 0);
                      return (
                        <Table.Summary.Row style={{ background: "#fafafa", fontWeight: 600 }}>
                          <Table.Summary.Cell colSpan={4} align="right">Tổng:</Table.Summary.Cell>
                          <Table.Summary.Cell align="right">
                            <div style={{ color: "#52c41a" }}>+{fmt(tIn)}</div>
                            <div style={{ color: "#ff4d4f" }}>-{fmt(tEx)}</div>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell colSpan={2} />
                        </Table.Summary.Row>
                      );
                    }}
                  />
                )
              }
            </Card>
          </>
        )}
      </Spin>
    </>
  );
}

// ── Tab 3: Đóng góp thành viên ───────────────────────────────────────────────
function MemberContributions({ year }) {
  const [contributions, setContributions] = useState([]);
  const [feeTypes, setFeeTypes] = useState([]);
  const [feeTypeFilter, setFeeTypeFilter] = useState(null);

  useEffect(() => {
    feeTypesApi.list({ type: "income" }).then((r) => setFeeTypes(r.data));
  }, []);

  useEffect(() => {
    reportsApi.memberContributions({ fee_type_id: feeTypeFilter || undefined, year }).then((r) =>
      setContributions(r.data)
    );
  }, [feeTypeFilter, year]);

  const contribCols = [
    { title: "Mã TV", dataIndex: "member_code", width: 90 },
    { title: "Họ và tên", dataIndex: "full_name" },
    { title: "Khoản đóng", dataIndex: "fee_type_name" },
    { title: "Số lần", dataIndex: "transaction_count", align: "center", width: 80 },
    {
      title: "Tổng tiền",
      dataIndex: "total_amount",
      render: (v) => <b style={{ color: "#52c41a" }}>{fmt(v)}</b>,
      align: "right",
    },
  ];

  const totalAmount = contributions.reduce((s, r) => s + r.total_amount, 0);

  return (
    <>
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col>
          <Select
            placeholder="Lọc theo khoản thu"
            allowClear
            style={{ width: 220 }}
            onChange={setFeeTypeFilter}
          >
            {feeTypes.map((ft) => (
              <Select.Option key={ft.id} value={ft.id}>{ft.name}</Select.Option>
            ))}
          </Select>
        </Col>
        <Col>
          <Tag color="green" style={{ lineHeight: "32px", padding: "0 12px" }}>
            Tổng đóng góp: {fmt(totalAmount)}
          </Tag>
        </Col>
      </Row>
      <Table
        columns={contribCols}
        dataSource={contributions}
        rowKey={(r) => `${r.member_id}-${r.fee_type_name}`}
        size="small"
        pagination={{ pageSize: 20 }}
        summary={(rows) => {
          const total = rows.reduce((s, r) => s + r.total_amount, 0);
          return (
            <Table.Summary.Row style={{ background: "#fafafa", fontWeight: 600 }}>
              <Table.Summary.Cell colSpan={4} align="right">Tổng cộng:</Table.Summary.Cell>
              <Table.Summary.Cell align="right">
                <b style={{ color: "#52c41a" }}>{fmt(total)}</b>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          );
        }}
      />
    </>
  );
}

// ── Tab 4: Theo dõi phí thành viên ──────────────────────────────────────────
function FeeStatusTracker({ year }) {
  const [month, setMonth] = useState(dayjs().month() + 1);
  const [feeTypes, setFeeTypes] = useState([]);
  const [selectedFeeType, setSelectedFeeType] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    feeTypesApi.list({ type: "income" }).then((r) => {
      setFeeTypes(r.data);
      if (r.data.length > 0 && !selectedFeeType) setSelectedFeeType(r.data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedFeeType) return;
    setLoading(true);
    reportsApi.feeStatus(month, year, selectedFeeType)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [month, year, selectedFeeType]);

  const exportCSV = () => {
    if (!data) return;
    const ftName = feeTypes.find(f => f.id === selectedFeeType)?.name || "phi";
    const headers = ["Mã TV,Họ và tên,SĐT,Hạng,Trạng thái"];
    const rows = data.members.map(m => [
      m.member_code,
      `"${m.full_name}"`,
      m.phone || "",
      m.rank || "",
      m.paid ? "Đã đóng" : "Chưa đóng",
    ].join(","));
    const blob = new Blob(["﻿" + [headers, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `theo-doi-phi-T${month}-${year}-${ftName}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const paidCols = [
    { title: "Mã TV", dataIndex: "member_code", width: 90 },
    { title: "Họ và tên", dataIndex: "full_name" },
    { title: "SĐT", dataIndex: "phone", width: 120 },
    { title: "Hạng", dataIndex: "rank", width: 90,
      render: (v) => v ? <Tag color="purple">{v}</Tag> : "—" },
    {
      title: "Trạng thái", dataIndex: "paid", width: 120,
      render: (v) => v
        ? <Tag icon={<CheckCircleOutlined />} color="success">Đã đóng</Tag>
        : <Tag icon={<CloseCircleOutlined />} color="error">Chưa đóng</Tag>,
      filters: [{ text: "Đã đóng", value: true }, { text: "Chưa đóng", value: false }],
      onFilter: (value, r) => r.paid === value,
    },
  ];

  return (
    <>
      <Row gutter={12} align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Select value={month} onChange={setMonth} style={{ width: 120 }}>
            {Array.from({ length: 12 }, (_, i) => (
              <Select.Option key={i + 1} value={i + 1}>Tháng {i + 1}</Select.Option>
            ))}
          </Select>
        </Col>
        <Col>
          <Select
            value={selectedFeeType}
            onChange={setSelectedFeeType}
            style={{ width: 220 }}
            placeholder="Chọn khoản phí"
          >
            {feeTypes.map((ft) => (
              <Select.Option key={ft.id} value={ft.id}>{ft.name}</Select.Option>
            ))}
          </Select>
        </Col>
        <Col>
          <Button icon={<DownloadOutlined />} onClick={exportCSV} disabled={!data}>
            Xuất CSV
          </Button>
        </Col>
      </Row>

      <Spin spinning={loading}>
        {data ? (
          <>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col xs={24} sm={8}>
                <Card size="small" style={{ borderTop: "3px solid #52c41a" }}>
                  <Statistic
                    title="Đã đóng phí"
                    value={data.paid}
                    suffix={`/ ${data.total} thành viên`}
                    styles={{ content: { color: "#52c41a" } }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card size="small" style={{ borderTop: "3px solid #ff4d4f" }}>
                  <Statistic
                    title="Chưa đóng phí"
                    value={data.unpaid}
                    suffix={`/ ${data.total} thành viên`}
                    styles={{ content: { color: data.unpaid > 0 ? "#ff4d4f" : "#52c41a" } }}
                    prefix={<CloseCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card size="small">
                  <div style={{ marginBottom: 8 }}>
                    <Text strong>Tỉ lệ đóng phí tháng {month}/{year}</Text>
                  </div>
                  <Progress
                    percent={data.total > 0 ? Math.round((data.paid / data.total) * 100) : 0}
                    strokeColor={data.paid === data.total ? "#52c41a" : "#1677ff"}
                    status={data.paid === data.total ? "success" : "active"}
                  />
                </Card>
              </Col>
            </Row>

            {data.unpaid > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={`Còn ${data.unpaid} thành viên chưa đóng phí`}
                description={
                  data.members.filter(m => !m.paid).map(m => m.full_name).join(", ")
                }
              />
            )}

            <Table
              columns={paidCols}
              dataSource={data.members}
              rowKey="member_id"
              size="small"
              pagination={{ pageSize: 20 }}
              rowClassName={(r) => r.paid ? "" : "ant-table-row-danger"}
            />
          </>
        ) : (
          !selectedFeeType
            ? <Empty description="Chọn khoản phí để xem trạng thái" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            : null
        )}
      </Spin>
    </>
  );
}

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
          {
            key: "monthly-detail",
            label: "Thống kê theo tháng",
            children: <MonthlyStats year={year} />,
          },
          {
            key: "yearly",
            label: "Tổng hợp cả năm",
            children: <YearlySummary year={year} />,
          },
          {
            key: "contributions",
            label: "Đóng góp thành viên",
            children: <MemberContributions year={year} />,
          },
          {
            key: "fee-status",
            label: "Theo dõi phí",
            children: <FeeStatusTracker year={year} />,
          },
        ]}
      />
    </div>
  );
}
