import React, { useEffect, useState, useCallback } from "react";
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select,
  message, Typography, Row, Col, Card, Steps,
  InputNumber, Tabs, Badge, Statistic, Empty,
  Divider, Alert, Transfer, Tooltip, Checkbox, Collapse,
} from "antd";
import {
  PlusOutlined, ThunderboltOutlined, TrophyOutlined,
  EditOutlined, DeleteOutlined, ReloadOutlined,
  CheckCircleOutlined, SaveOutlined, ArrowRightOutlined,
  UserOutlined, TeamOutlined, UserAddOutlined,
} from "@ant-design/icons";
import { tournamentsApi, membersApi, playersApi } from "../api";
import ResponsiveTable from "../components/ResponsiveTable";
import { useViewMode } from "../contexts/ViewModeContext";

const { Title, Text } = Typography;

const FORMAT_MAP = {
  round_robin:        { label: "Vòng tròn một lượt", color: "blue" },
  round_robin_double: { label: "Vòng tròn hai lượt", color: "cyan" },
  knockout:           { label: "Đấu loại trực tiếp", color: "red" },
  combined:           { label: "Vòng bảng + loại trực tiếp", color: "purple" },
  individual:         { label: "Thi đấu riêng lẻ", color: "default" },
};
const STATUS_MAP = {
  draft:     { label: "Nháp", color: "default" },
  active:    { label: "Đang diễn ra", color: "processing" },
  completed: { label: "Kết thúc", color: "success" },
};
const RANKS = ["A", "B", "C", "D", "Hạt giống 1", "Hạt giống 2", "Hạt giống 3"];

const confirm = (opts) =>
  new Promise((res) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => res(true), onCancel: () => res(false) })
  );

const teamLabel = (p) => p?.team_name || p?.member?.full_name || p?.player?.name || "—";

// ── Wizard tạo giải ──────────────────────────────────────
function CreateWizard({ onCreated, onClose }) {
  const [step, setStep] = useState(0);
  const [form] = Form.useForm();
  const [allMembers, setAllMembers] = useState([]);
  const [format, setFormat] = useState(null);

  // Bước 1: chọn người chơi (thành viên + khách mời)
  const [selectedIds, setSelectedIds] = useState([]);          // member IDs đã chọn
  const [guestPlayers, setGuestPlayers] = useState([]);        // [{id, name, phone, rank}] đã tạo qua API
  const [guestForm] = Form.useForm();
  const [addingGuest, setAddingGuest] = useState(false);

  // Bước 3: ghép đội
  const [teamType, setTeamType] = useState("singles");
  // doubles – method: "manual" | "by_rank"
  const [doubleMethod, setDoubleMethod] = useState("manual");
  // doubles – rank rules: [{rank1, rank2}] for auto-pairing
  const [rankRules, setRankRules] = useState([{ rank1: "", rank2: "" }]);
  // doubles – built teams (mở rộng: hỗ trợ player_id cho khách mời)
  const [teams, setTeams] = useState([]);
  const [pick1, setPick1] = useState(null);  // "m-{id}" hoặc "g-{id}"
  const [pick2, setPick2] = useState(null);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    membersApi.list().then((r) => setAllMembers(r.data));
  }, []);

  const selectedMembers = allMembers.filter(m => selectedIds.includes(m.id));
  const totalSelected = selectedIds.length + guestPlayers.length;

  // Pool chung cho ghép đội đôi (key: "m-{id}" hoặc "g-{id}")
  const allPool = [
    ...selectedMembers.map(m => ({ key: `m-${m.id}`, name: m.full_name, rank: m.rank, type: "member", member_id: m.id })),
    ...guestPlayers.map(g => ({ key: `g-${g.id}`, name: g.name, phone: g.phone, rank: g.rank, type: "guest", player_id: g.id })),
  ];
  const usedKeys = new Set(teams.flatMap(t => [t._key1, t._key2].filter(Boolean)));
  const availablePool = allPool.filter(p => !usedKeys.has(p.key));

  // Helper: parse key để lấy type+id cho payload
  const parseKey = (key) => {
    if (!key) return {};
    if (key.startsWith("m-")) return { member_id: parseInt(key.slice(2)) };
    if (key.startsWith("g-")) return { player_id: parseInt(key.slice(2)) };
    return {};
  };
  const keyToName = (key) => allPool.find(p => p.key === key)?.name || "?";

  // Thêm khách mời qua API rồi lưu vào guestPlayers
  const handleAddGuest = async () => {
    let vals;
    try { vals = await guestForm.validateFields(); } catch { return; }
    setAddingGuest(true);
    try {
      const res = await playersApi.create({ name: vals.name, phone: vals.phone || null, email: vals.email || null, rank: vals.rank || "Chưa xếp hạng" });
      setGuestPlayers(prev => [...prev, { id: res.data.id, name: res.data.name, phone: res.data.phone, rank: res.data.rank }]);
      guestForm.resetFields();
      message.success(`Đã thêm khách mời: ${res.data.name}`);
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể thêm khách mời");
    } finally { setAddingGuest(false); }
  };

  const removeGuest = (id) => setGuestPlayers(prev => prev.filter(g => g.id !== id));

  // Thêm 1 đội thủ công (hỗ trợ cả member và guest)
  const addTeamManual = () => {
    if (!pick1 || !pick2) { message.error("Chọn 2 người chơi để ghép đội"); return; }
    const n1 = keyToName(pick1);
    const n2 = keyToName(pick2);
    const p1 = parseKey(pick1);
    const p2 = parseKey(pick2);
    setTeams(t => [...t, {
      ...p1,
      partner_member_id: p2.member_id, partner_player_id: p2.player_id,
      team_name: `${n1} / ${n2}`,
      _key1: pick1, _key2: pick2,
    }]);
    setPick1(null); setPick2(null);
  };

  // Tự động ghép đội theo rank rules
  // Mỗi người chỉ được xuất hiện trong 1 đội (tracked bởi `used`)
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const autoTeamByRank = () => {
    const newTeams = [];
    const used = new Set();
    // Áp dụng ghép theo rank cho cả thành viên CLB và khách mời có rank
    const memberPool = allPool;  // allPool gồm cả member + guest, đều có rank

    for (const rule of rankRules) {
      if (!rule.rank1 || !rule.rank2) continue;

      if (rule.rank1 === rule.rank2) {
        const pool = shuffle(memberPool.filter(p => p.rank === rule.rank1 && !used.has(p.key)));
        for (let i = 0; i + 1 < pool.length; i += 2) {
          const a = pool[i], b = pool[i + 1];
          const pa = parseKey(a.key), pb = parseKey(b.key);
          newTeams.push({ ...pa, partner_member_id: pb.member_id, partner_player_id: pb.player_id, team_name: `${a.name} / ${b.name}`, _key1: a.key, _key2: b.key });
          used.add(a.key); used.add(b.key);
        }
      } else {
        const p1s = shuffle(memberPool.filter(p => p.rank === rule.rank1 && !used.has(p.key)));
        const p2s = shuffle(memberPool.filter(p => p.rank === rule.rank2 && !used.has(p.key)));
        for (const a of p1s) {
          const b = p2s.find(x => !used.has(x.key));
          if (!b) break;
          const pa = parseKey(a.key), pb = parseKey(b.key);
          newTeams.push({ ...pa, partner_member_id: pb.member_id, partner_player_id: pb.player_id, team_name: `${a.name} / ${b.name}`, _key1: a.key, _key2: b.key });
          used.add(a.key); used.add(b.key);
        }
      }
    }

    if (newTeams.length === 0) {
      message.warning("Không tìm được cặp nào phù hợp với quy tắc đã đặt"); return;
    }
    setTeams(newTeams);
    const unpairedCount = memberPool.filter(p => !used.has(p.key)).length;
    message.success(`Đã ghép ${newTeams.length} đội${unpairedCount > 0 ? ` · ${unpairedCount} người chưa có đội` : ""}`);
  };

  const removeTeam = (i) => setTeams(t => t.filter((_, j) => j !== i));

  const totalTeams = teamType === "singles" ? totalSelected : teams.length;

  const handleNext = async () => {
    if (step === 0) {
      try { await form.validateFields(); setFormat(form.getFieldValue("format")); }
      catch { return; }
    }
    if (step === 1 && totalSelected < 2) {
      message.error("Cần chọn ít nhất 2 người chơi"); return;
    }
    if (step === 2 && totalTeams < 2) {
      message.error("Cần có ít nhất 2 đội thi đấu"); return;
    }
    setStep(s => s + 1);
  };

  const handleCreate = async () => {
    const vals = form.getFieldsValue();
    if (!vals.name || !vals.format) { setStep(0); message.error("Thiếu thông tin giải"); return; }
    if (totalTeams < 2) { message.error("Cần ít nhất 2 đội"); return; }

    setSaving(true);
    try {
      const payload = {
        name: vals.name,
        format: vals.format,
        team_type: teamType,
        description: vals.description || null,
        num_groups: vals.num_groups || 2,
        pairing_mode: "random",
      };
      if (teamType === "doubles") {
        // Gửi teams không kèm _key1/_key2 (internal tracking only)
        payload.teams = teams.map(({ _key1, _key2, ...rest }) => rest);
      } else {
        payload.member_ids = selectedIds;
        payload.player_ids = guestPlayers.map(g => g.id);
      }
      const res = await tournamentsApi.create(payload);
      message.success("Đã tạo giải đấu!");
      onCreated(res.data);
    } finally { setSaving(false); }
  };

  const STATUS_MEMBER_MAP = {
    active: { label: "Hoạt động", color: "success" },
    inactive: { label: "Tạm nghỉ", color: "warning" },
    suspended: { label: "Đình chỉ", color: "error" },
  };

  const memberCols = [
    { title: "Họ và tên", dataIndex: "full_name" },
    { title: "Hạng", dataIndex: "rank", width: 90, render: v => v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">—</Text> },
    { title: "Trạng thái", dataIndex: "status", width: 110, render: v => { const s = STATUS_MEMBER_MAP[v] || { label: v, color: "default" }; return <Badge status={s.color} text={s.label} />; } },
    { title: "SĐT", dataIndex: "phone", width: 120 },
  ];

  const STEPS = [
    { title: "Thông tin giải" },
    { title: "Chọn người chơi" },
    { title: "Ghép đội" },
    { title: "Xác nhận" },
  ];

  return (
    <div style={{ padding: "0 8px" }}>
      <Steps current={step} style={{ marginBottom: 24 }} size="small" items={STEPS} />

      {/* ── Bước 0: Thông tin giải ── */}
      <div style={{ display: step === 0 ? "block" : "none" }}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Tên giải đấu" rules={[{ required: true, message: "Nhập tên giải đấu" }]}>
            <Input placeholder="VD: Giải Pickleball CLB Tháng 7/2026" autoFocus />
          </Form.Item>
          <Form.Item name="format" label="Thể thức thi đấu" rules={[{ required: true, message: "Chọn thể thức" }]}>
            <Select placeholder="Chọn thể thức" onChange={setFormat}>
              {Object.entries(FORMAT_MAP).map(([k, v]) => (
                <Select.Option key={k} value={k}><Tag color={v.color}>{v.label}</Tag></Select.Option>
              ))}
            </Select>
          </Form.Item>
          {format === "combined" && (
            <Form.Item name="num_groups" label="Số bảng" initialValue={2}>
              <InputNumber min={2} max={8} style={{ width: 120 }} />
            </Form.Item>
          )}
          <Form.Item name="description" label="Mô tả (không bắt buộc)">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </div>

      {/* ── Bước 1: Chọn người chơi ── */}
      {step === 1 && (
        <>
          <Alert
            message={totalSelected >= 2
              ? `Đã chọn ${totalSelected} người chơi (${selectedIds.length} thành viên, ${guestPlayers.length} khách mời)`
              : "Chọn ít nhất 2 người chơi tham gia giải"}
            type={totalSelected >= 2 ? "info" : "warning"}
            showIcon style={{ marginBottom: 12 }}
          />
          <Tabs
            defaultActiveKey="member"
            items={[
              {
                key: "member",
                label: <span><UserOutlined /> Thành viên CLB ({selectedIds.length})</span>,
                children: (
                  <>
                    <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Checkbox
                        checked={allMembers.length > 0 && selectedIds.length === allMembers.length}
                        indeterminate={selectedIds.length > 0 && selectedIds.length < allMembers.length}
                        onChange={e => setSelectedIds(e.target.checked ? allMembers.map(m => m.id) : [])}
                      >
                        Chọn tất cả thành viên CLB ({allMembers.length})
                      </Checkbox>
                      {selectedIds.length > 0 && (
                        <Button size="small" type="link" onClick={() => setSelectedIds([])}>
                          Bỏ chọn ({selectedIds.length})
                        </Button>
                      )}
                    </div>
                    <ResponsiveTable
                      rowSelection={{
                        selectedRowKeys: selectedIds,
                        onChange: keys => setSelectedIds(keys),
                      }}
                      columns={memberCols}
                      dataSource={allMembers}
                      rowKey="id"
                      size="small"
                      pagination={{ pageSize: 10 }}
                      mobileTitle={(r) => {
                        const s = STATUS_MEMBER_MAP[r.status] || { label: r.status, color: "default" };
                        return (
                          <span>
                            {r.full_name}
                            {r.rank && <Tag color="purple" style={{ marginLeft: 6 }}>{r.rank}</Tag>}
                            {r.status !== "active" && <Badge status={s.color} text={s.label} style={{ marginLeft: 8 }} />}
                          </span>
                        );
                      }}
                      mobileHideColumns={["Họ và tên", "Hạng", "Trạng thái"]}
                    />
                  </>
                ),
              },
              {
                key: "guest",
                label: <span><UserAddOutlined /> Khách mời ({guestPlayers.length})</span>,
                children: (
                  <>
                    <Card size="small" style={{ marginBottom: 12, background: "#fafafa" }}
                      title={<span style={{ fontSize: 13 }}>Thêm người chơi ngoài CLB</span>}
                    >
                      <Form form={guestForm} layout="inline" style={{ flexWrap: "wrap", gap: 8 }}>
                        <Form.Item name="name" rules={[{ required: true, message: "Nhập tên" }]} style={{ marginBottom: 8 }}>
                          <Input placeholder="Họ và tên *" style={{ width: 160 }} />
                        </Form.Item>
                        <Form.Item name="phone" style={{ marginBottom: 8 }}>
                          <Input placeholder="Số điện thoại" style={{ width: 130 }} />
                        </Form.Item>
                        <Form.Item name="rank" initialValue="Chưa xếp hạng" style={{ marginBottom: 8 }}>
                          <Select style={{ width: 140 }} placeholder="Chọn hạng">
                            {["A","B","C","D","Hạt giống 1","Hạt giống 2","Hạt giống 3","Chưa xếp hạng"].map(r => (
                              <Select.Option key={r} value={r}>{r}</Select.Option>
                            ))}
                          </Select>
                        </Form.Item>
                        <Form.Item style={{ marginBottom: 8 }}>
                          <Button
                            type="primary" icon={<PlusOutlined />}
                            loading={addingGuest} onClick={handleAddGuest}
                          >
                            Thêm
                          </Button>
                        </Form.Item>
                      </Form>
                    </Card>

                    {guestPlayers.length === 0 ? (
                      <Empty description="Chưa có khách mời nào" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <ResponsiveTable
                        size="small"
                        pagination={false}
                        dataSource={guestPlayers}
                        rowKey="id"
                        columns={[
                          { title: "#", render: (_, __, i) => i + 1, width: 40, align: "center" },
                          { title: "Họ và tên", dataIndex: "name",
                            render: v => <><Tag color="orange" style={{ marginRight: 6 }}>Khách</Tag>{v}</> },
                          { title: "SĐT", dataIndex: "phone", width: 120, render: v => v || "—" },
                          {
                            title: "Hạng", dataIndex: "rank", width: 120,
                            render: v => {
                              const colorMap = { A: "red", B: "gold", C: "blue", D: "green", "Hạt giống 1": "purple", "Hạt giống 2": "purple", "Hạt giống 3": "purple" };
                              return <Tag color={colorMap[v] || "default"}>{v || "Chưa xếp hạng"}</Tag>;
                            },
                          },
                          {
                            title: "Thao tác", width: 60, align: "center",
                            render: (_, r) => (
                              <Button danger size="small" onClick={() => removeGuest(r.id)}>Xóa</Button>
                            ),
                          },
                        ]}
                        mobileTitle={(r) => (
                          <span>
                            <Tag color="orange" style={{ marginRight: 6 }}>Khách</Tag>
                            {r.name}
                          </span>
                        )}
                        mobileHideColumns={["#", "Họ và tên"]}
                      />
                    )}
                  </>
                ),
              },
            ]}
          />
        </>
      )}

      {/* ── Bước 2: Ghép đội ── */}
      {step === 2 && (
        <div>
          {/* Chọn loại đội */}
          <Row gutter={12} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <Card
                size="small"
                hoverable
                onClick={() => setTeamType("singles")}
                style={{ borderColor: teamType === "singles" ? "#1677ff" : "#d9d9d9", cursor: "pointer" }}
              >
                <Space>
                  <UserOutlined style={{ fontSize: 20, color: teamType === "singles" ? "#1677ff" : "#999" }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Đấu đơn</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Mỗi người là 1 đội ({selectedIds.length} đội)</Text>
                  </div>
                </Space>
              </Card>
            </Col>
            <Col span={12}>
              <Card
                size="small"
                hoverable
                onClick={() => setTeamType("doubles")}
                style={{ borderColor: teamType === "doubles" ? "#1677ff" : "#d9d9d9", cursor: "pointer" }}
              >
                <Space>
                  <TeamOutlined style={{ fontSize: 20, color: teamType === "doubles" ? "#1677ff" : "#999" }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Đấu đôi</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>2 người ghép thành 1 đội</Text>
                  </div>
                </Space>
              </Card>
            </Col>
          </Row>

          {teamType === "singles" && (
            <Alert
              type="success" showIcon
              message={`${totalSelected} người chơi → ${totalSelected} đội thi đấu`}
              description="Mỗi người chơi được xem là 1 đội. Lịch thi đấu sẽ được ghép ngẫu nhiên khi bấm 'Sinh lịch'."
            />
          )}

          {teamType === "doubles" && (
            <>
              <Divider orientation="left" style={{ marginTop: 0 }}>Cách ghép đội đôi</Divider>
              <Row gutter={8} style={{ marginBottom: 16 }}>
                <Col span={12}>
                  <Card
                    size="small" hoverable
                    onClick={() => setDoubleMethod("manual")}
                    style={{ borderColor: doubleMethod === "manual" ? "#1677ff" : "#d9d9d9", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: doubleMethod === "manual" ? 600 : 400 }}>✋ Ghép tay</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Tự chọn từng cặp</Text>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card
                    size="small" hoverable
                    onClick={() => setDoubleMethod("by_rank")}
                    style={{ borderColor: doubleMethod === "by_rank" ? "#1677ff" : "#d9d9d9", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: doubleMethod === "by_rank" ? 600 : 400 }}>⚡ Ghép theo hạng</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Quy tắc hạng A + hạng B</Text>
                  </Card>
                </Col>
              </Row>

              {/* Ghép tay */}
              {doubleMethod === "manual" && (
                <Card size="small" style={{ marginBottom: 12 }}>
                  <Row gutter={8} align="middle">
                    <Col span={10}>
                      <Select value={pick1} onChange={setPick1} placeholder="Người 1"
                        style={{ width: "100%" }} allowClear showSearch
                        filterOption={(inp, opt) => opt.label?.toLowerCase().includes(inp.toLowerCase())}
                        options={availablePool.map(p => ({
                          value: p.key,
                          label: `${p.name}${p.rank ? ` (${p.rank})` : ""}${p.type === "guest" ? " [Khách]" : ""}`,
                        }))}
                      />
                    </Col>
                    <Col span={2} style={{ textAlign: "center" }}>
                      <Tag color="blue" style={{ margin: 0 }}>+</Tag>
                    </Col>
                    <Col span={10}>
                      <Select value={pick2} onChange={setPick2} placeholder="Người 2"
                        style={{ width: "100%" }} allowClear showSearch
                        filterOption={(inp, opt) => opt.label?.toLowerCase().includes(inp.toLowerCase())}
                        options={availablePool.filter(p => p.key !== pick1).map(p => ({
                          value: p.key,
                          label: `${p.name}${p.rank ? ` (${p.rank})` : ""}${p.type === "guest" ? " [Khách]" : ""}`,
                        }))}
                      />
                    </Col>
                    <Col span={2}>
                      <Button type="primary" onClick={addTeamManual} disabled={!pick1 || !pick2}>Ghép</Button>
                    </Col>
                  </Row>
                </Card>
              )}

              {/* Ghép theo rank */}
              {doubleMethod === "by_rank" && (
                <Card size="small" style={{ marginBottom: 12 }}
                  title="Quy tắc ghép đội theo hạng"
                  extra={
                    <Button type="primary" size="small" onClick={autoTeamByRank}>
                      ⚡ Tự động ghép đội
                    </Button>
                  }
                >
                  <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
                    Mỗi dòng = 1 quy tắc: Hạng A + Hạng B → ghép thành 1 đội đôi.
                  </Text>
                  {rankRules.map((rule, i) => (
                    <Row gutter={8} key={i} align="middle" style={{ marginBottom: 8 }}>
                      <Col span={10}>
                        <Select value={rule.rank1} placeholder="Hạng 1" style={{ width: "100%" }}
                          onChange={v => setRankRules(r => { const n=[...r]; n[i]={...n[i], rank1:v}; return n; })}>
                          {RANKS.map(r => <Select.Option key={r} value={r}>{r}</Select.Option>)}
                        </Select>
                      </Col>
                      <Col span={2} style={{ textAlign: "center" }}><Tag color="blue">+</Tag></Col>
                      <Col span={10}>
                        <Select value={rule.rank2} placeholder="Hạng 2" style={{ width: "100%" }}
                          onChange={v => setRankRules(r => { const n=[...r]; n[i]={...n[i], rank2:v}; return n; })}>
                          {RANKS.map(r => <Select.Option key={r} value={r}>{r}</Select.Option>)}
                        </Select>
                      </Col>
                      <Col span={2} style={{ textAlign: "center" }}>
                        <Button danger size="small" disabled={rankRules.length === 1}
                          onClick={() => setRankRules(r => r.filter((_, j) => j !== i))}>×</Button>
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" size="small"
                    onClick={() => setRankRules(r => [...r, { rank1: "", rank2: "" }])}>
                    + Thêm quy tắc
                  </Button>
                </Card>
              )}

              {/* Danh sách đội đã ghép */}
              {teams.length > 0 && (
                <>
                  <Divider orientation="left" style={{ marginTop: 8 }}>Danh sách đội ({teams.length})</Divider>
                  <ResponsiveTable
                    size="small" pagination={false}
                    dataSource={teams.map((t, i) => ({ ...t, key: i }))}
                    columns={[
                      { title: "#", render: (_, __, i) => i + 1, width: 40, align: "center" },
                      { title: "Tên đội", dataIndex: "team_name" },
                      { title: "", width: 60, align: "center",
                        render: (_, __, i) => <Button danger size="small" onClick={() => removeTeam(i)}>Xóa</Button> },
                    ]}
                  />
                </>
              )}

              {/* Trạng thái ghép đội của từng người */}
              <Divider orientation="left" style={{ marginTop: 12, fontSize: 12 }}>
                Trạng thái ({allPool.length} người)
              </Divider>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {allPool.map(p => {
                  const paired = usedKeys.has(p.key);
                  const partnerKey = paired
                    ? teams.find(t => t._key1 === p.key || t._key2 === p.key)
                    : null;
                  const partnerName = partnerKey
                    ? keyToName(partnerKey._key1 === p.key ? partnerKey._key2 : partnerKey._key1)
                    : null;
                  return (
                    <Tag
                      key={p.key}
                      color={paired ? "green" : p.type === "guest" ? "orange" : "gold"}
                      style={{ marginBottom: 4 }}
                    >
                      {paired ? "✓ " : ""}{p.name}
                      {p.rank && p.rank !== "Chưa xếp hạng" && ` (${p.rank})`}
                      {p.type === "guest" && <span style={{ opacity: 0.75 }}> [K]</span>}
                      {paired && partnerName && <Text style={{ color: "inherit", fontSize: 11 }}> + {partnerName}</Text>}
                    </Tag>
                  );
                })}
              </div>
              {availablePool.length > 0 && (
                <Alert
                  type="warning" showIcon style={{ marginTop: 8 }}
                  message={`${availablePool.length} người chưa có đội — mỗi người chỉ được ghép với 1 người khác`}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ── Bước 3: Xác nhận ── */}
      {step === 3 && (
        <div>
          {(() => {
            const vals = form.getFieldsValue();
            return (
              <Card style={{ marginBottom: 16 }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <div style={{ marginBottom: 8 }}><Text type="secondary">Tên giải đấu</Text></div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{vals.name}</div>
                  </Col>
                  <Col span={12}>
                    <div style={{ marginBottom: 8 }}><Text type="secondary">Thể thức</Text></div>
                    <Tag color={FORMAT_MAP[vals.format]?.color}>{FORMAT_MAP[vals.format]?.label}</Tag>
                  </Col>
                  <Col span={12} style={{ marginTop: 12 }}>
                    <div style={{ marginBottom: 8 }}><Text type="secondary">Loại đội</Text></div>
                    <Tag color={teamType === "doubles" ? "geekblue" : "default"}>
                      {teamType === "doubles" ? "Đấu đôi" : "Đấu đơn"}
                    </Tag>
                  </Col>
                  <Col span={12} style={{ marginTop: 12 }}>
                    <div style={{ marginBottom: 8 }}><Text type="secondary">Số đội tham gia</Text></div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: "#1677ff" }}>
                      {totalTeams} đội
                      {guestPlayers.length > 0 && <Tag color="orange" style={{ marginLeft: 8 }}>{guestPlayers.length} khách mời</Tag>}
                    </div>
                  </Col>
                  {vals.format === "combined" && (
                    <Col span={12} style={{ marginTop: 12 }}>
                      <div style={{ marginBottom: 8 }}><Text type="secondary">Số bảng</Text></div>
                      <div style={{ fontWeight: 600 }}>{vals.num_groups || 2} bảng</div>
                    </Col>
                  )}
                </Row>
              </Card>
            );
          })()}
          <Alert
            type="info" showIcon
            message="Lịch thi đấu sẽ được ghép ngẫu nhiên"
            description='Sau khi tạo giải, vào chi tiết giải và bấm "Sinh lịch" để tự động xếp lịch thi đấu ngẫu nhiên.'
          />
        </div>
      )}

      <Divider style={{ margin: "16px 0" }} />
      <Row justify="space-between" align="middle">
        <Button onClick={onClose}>Hủy</Button>
        <Space>
          {step > 0 && <Button onClick={() => setStep(s => s - 1)}>← Quay lại</Button>}
          {step < 3
            ? <Button type="primary" onClick={handleNext}>Tiếp theo →</Button>
            : <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleCreate}>
                Tạo giải đấu
              </Button>
          }
        </Space>
      </Row>
    </div>
  );
}

// ── Nhập tỉ số ───────────────────────────────────────────
function ScoreModal({ match, tournament, onSaved, onClose }) {
  const [s1, setS1] = useState(match?.score1 ?? 0);
  const [s2, setS2] = useState(match?.score2 ?? 0);
  const [saving, setSaving] = useState(false);

  const p1Name = teamLabel(match?.p1);
  const p2Name = teamLabel(match?.p2);

  const handleSave = async () => {
    const ok = await confirm({
      title: "Xác nhận nhập kết quả?",
      content: <div><b>{p1Name}</b> {s1} – {s2} <b>{p2Name}</b></div>,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await tournamentsApi.score(tournament.id, match.id, { score1: s1, score2: s2 });
      message.success("Đã lưu kết quả");
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`Nhập kết quả – ${match?.round_name}`} open onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="primary" loading={saving} icon={<SaveOutlined />} onClick={handleSave}>Lưu</Button>
        </Space>
      }>
      <Row justify="center" align="middle" gutter={16} style={{ margin: "24px 0" }}>
        <Col span={9} style={{ textAlign: "center" }}>
          <Text strong style={{ fontSize: 15 }}>{p1Name}</Text>
          {match?.p1?.member?.rank && <div><Tag color="purple">{match.p1.member.rank}</Tag></div>}
        </Col>
        <Col span={3} style={{ textAlign: "center" }}>
          <InputNumber min={0} value={s1} onChange={setS1} size="large"
            style={{ width: 60, textAlign: "center" }} />
        </Col>
        <Col span={2} style={{ textAlign: "center", fontSize: 20, color: "#999" }}>–</Col>
        <Col span={3} style={{ textAlign: "center" }}>
          <InputNumber min={0} value={s2} onChange={setS2} size="large"
            style={{ width: 60, textAlign: "center" }} />
        </Col>
        <Col span={7} style={{ textAlign: "center" }}>
          <Text strong style={{ fontSize: 15 }}>{p2Name}</Text>
          {match?.p2?.member?.rank && <div><Tag color="purple">{match.p2.member.rank}</Tag></div>}
        </Col>
      </Row>
    </Modal>
  );
}

// ── Bracket knockout ─────────────────────────────────────
function KnockoutBracket({ matches }) {
  const { isMobileView } = useViewMode();
  const rounds = [...new Set(matches.map(m => m.round_number))].sort((a, b) => a - b);

  // Mobile: Collapse theo từng vòng (dọc)
  if (isMobileView) {
    return (
      <Collapse
        defaultActiveKey={rounds.map(String)}
        items={rounds.map(r => {
          const rMatches = matches.filter(m => m.round_number === r);
          const rName = rMatches[0]?.round_name || `Vòng ${r}`;
          const done = rMatches.filter(m => m.status === "completed").length;
          return {
            key: String(r),
            label: <Text strong style={{ color: "#1677ff" }}>{rName} ({done}/{rMatches.length})</Text>,
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rMatches.map(m => <BracketCard key={m.id} match={m} />)}
              </div>
            ),
          };
        })}
      />
    );
  }

  // Desktop: bố cục ngang như cũ
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 24, minWidth: rounds.length * 220 }}>
        {rounds.map(r => {
          const rMatches = matches.filter(m => m.round_number === r);
          const rName = rMatches[0]?.round_name || `Vòng ${r}`;
          return (
            <div key={r} style={{ flex: "0 0 200px" }}>
              <Text strong style={{ display: "block", textAlign: "center", marginBottom: 8, color: "#1677ff" }}>
                {rName}
              </Text>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {rMatches.map(m => <BracketCard key={m.id} match={m} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BracketCard({ match }) {
  const p1 = teamLabel(match?.p1) || (match?.p1_id ? "?" : "BYE");
  const p2 = teamLabel(match?.p2) || (match?.p2_id ? "?" : "BYE");
  const done = match.status === "completed";
  const w = match.winner_id;

  return (
    <Card size="small" style={{ borderRadius: 8, borderColor: done ? "#52c41a" : "#d9d9d9" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <Text style={{ fontWeight: w === match.p1_id ? 700 : 400, color: w === match.p1_id ? "#52c41a" : "inherit", fontSize: 13 }}>
          {p1}
        </Text>
        <Text style={{ minWidth: 24, textAlign: "center", fontWeight: 700 }}>
          {done ? match.score1 : "–"}
        </Text>
      </div>
      <Divider style={{ margin: "4px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontWeight: w === match.p2_id ? 700 : 400, color: w === match.p2_id ? "#52c41a" : "inherit", fontSize: 13 }}>
          {p2}
        </Text>
        <Text style={{ minWidth: 24, textAlign: "center", fontWeight: 700 }}>
          {done ? match.score2 : "–"}
        </Text>
      </div>
    </Card>
  );
}

// ── Bảng xếp hạng (W=1, L=0) ────────────────────────────
function StandingsTable({ tournament, group }) {
  const [rows, setRows] = useState([]);
  const doneCount = tournament.matches?.filter(m => m.status === "completed").length ?? 0;

  useEffect(() => {
    tournamentsApi.standings(tournament.id, group).then(r => setRows(r.data));
  }, [tournament.id, group, doneCount]);

  const cols = [
    { title: "#", dataIndex: "rank", width: 40, align: "center",
      render: v => v <= 2 ? <b style={{ color: v === 1 ? "#faad14" : "#1677ff" }}>{v}</b> : v },
    { title: "Đội", dataIndex: "team_name", render: (v, r) => v || r.full_name },
    { title: "T.đấu", dataIndex: "played", width: 55, align: "center" },
    { title: "Thắng", dataIndex: "won", width: 55, align: "center",
      render: v => <Text style={{ color: "#52c41a", fontWeight: 600 }}>{v}</Text> },
    { title: "Thua", dataIndex: "lost", width: 55, align: "center",
      render: v => <Text style={{ color: "#ff4d4f" }}>{v}</Text> },
    { title: "BT", dataIndex: "goals_for", width: 45, align: "center" },
    { title: "BB", dataIndex: "goals_against", width: 45, align: "center" },
    { title: "Hiệu số", dataIndex: "goal_diff", width: 65, align: "center",
      render: v => <Text style={{ color: v > 0 ? "#52c41a" : v < 0 ? "#ff4d4f" : "inherit" }}>{v > 0 ? `+${v}` : v}</Text> },
    { title: "Điểm", dataIndex: "points", width: 55, align: "center",
      render: v => <b style={{ color: "#1677ff", fontSize: 15 }}>{v}</b> },
  ];

  const mobileTitle = (r) => {
    const name = r.team_name || r.full_name || "—";
    const rankIcon = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`;
    return <span>{rankIcon} {name}</span>;
  };

  return (
    <ResponsiveTable columns={cols} dataSource={rows} rowKey="participant_id" size="small"
      pagination={false}
      rowClassName={(_, i) => i < 2 ? "ant-table-row-selected" : ""}
      mobileTitle={(r) => {
        const icon = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`;
        return <span>{icon} <b>{r.team_name || r.full_name}</b></span>;
      }}
      mobileHideColumns={["#", "Đội"]}
    />
  );
}

// ── Thay người chơi (khi 1 người không thể tiếp tục thi đấu) ──
function ReplaceParticipantModal({ tournament, target, onSaved, onClose }) {
  const { participant, slot } = target;
  const [allMembers, setAllMembers] = useState([]);
  const [guestPlayers, setGuestPlayers] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [guestForm] = Form.useForm();
  const [addingGuest, setAddingGuest] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    membersApi.list().then(r => setAllMembers(r.data));
    playersApi.list("guest").then(r => setGuestPlayers(r.data));
  }, []);

  const outgoingName = slot === "main" ? teamLabel(participant) : (participant.partner?.full_name || participant.partner_player?.name || "—");

  // Người đã có mặt ở bất kỳ đội nào trong giải (trừ chính người sắp bị thay) không được chọn lại
  const usedMemberIds = new Set();
  const usedPlayerIds = new Set();
  tournament.participants.forEach(p => {
    if (p.member_id) usedMemberIds.add(p.member_id);
    if (p.partner_member_id) usedMemberIds.add(p.partner_member_id);
    if (p.player_id) usedPlayerIds.add(p.player_id);
    if (p.partner_player_id) usedPlayerIds.add(p.partner_player_id);
  });

  const availableMembers = allMembers.filter(m => !usedMemberIds.has(m.id));
  const availableGuests = guestPlayers.filter(g => !usedPlayerIds.has(g.id));

  const handleAddGuest = async () => {
    let vals;
    try { vals = await guestForm.validateFields(); } catch { return; }
    setAddingGuest(true);
    try {
      const res = await playersApi.create({ name: vals.name, phone: vals.phone || null, rank: vals.rank || "Chưa xếp hạng" });
      setGuestPlayers(prev => [...prev, res.data]);
      setSelectedKey(`g-${res.data.id}`);
      guestForm.resetFields();
      message.success(`Đã thêm khách mời: ${res.data.name}`);
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể thêm khách mời");
    } finally { setAddingGuest(false); }
  };

  const handleSave = async () => {
    if (!selectedKey) { message.error("Chọn người thay thế"); return; }
    const isMember = selectedKey.startsWith("m-");
    const id = parseInt(selectedKey.slice(2));
    const newName = isMember
      ? allMembers.find(m => m.id === id)?.full_name
      : guestPlayers.find(g => g.id === id)?.name;

    const ok = await confirm({
      title: "Xác nhận thay người?",
      content: <div>Thay <b>{outgoingName}</b> bằng <b>{newName}</b>. Kết quả các trận đã đấu của vị trí này vẫn được giữ nguyên.</div>,
    });
    if (!ok) return;

    setSaving(true);
    try {
      await tournamentsApi.replaceParticipant(tournament.id, participant.id, {
        slot,
        member_id: isMember ? id : null,
        player_id: isMember ? null : id,
      });
      message.success("Đã thay người chơi");
      onSaved();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể thay người chơi");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      title={`Thay người — đang thay thế "${outgoingName}"`}
      open onCancel={onClose} width={620}
      footer={
        <Space>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>Xác nhận thay người</Button>
        </Space>
      }
    >
      <Tabs
        defaultActiveKey="member"
        items={[
          {
            key: "member",
            label: <span><UserOutlined /> Thành viên CLB chưa tham gia ({availableMembers.length})</span>,
            children: availableMembers.length === 0 ? (
              <Empty description="Không còn thành viên nào chưa tham gia giải" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <ResponsiveTable
                rowSelection={{
                  type: "radio",
                  selectedRowKeys: selectedKey ? [selectedKey] : [],
                  onChange: (keys) => setSelectedKey(keys[0] ?? null),
                }}
                onRow={(r) => ({ onClick: () => setSelectedKey(`m-${r.id}`) })}
                columns={[
                  { title: "Họ và tên", dataIndex: "full_name" },
                  { title: "Hạng", dataIndex: "rank", width: 90, render: v => v ? <Tag color="purple">{v}</Tag> : "—" },
                ]}
                dataSource={availableMembers}
                rowKey={(r) => `m-${r.id}`} size="small" pagination={{ pageSize: 8 }}
                mobileTitle={(r) => <span>{r.full_name} {r.rank && <Tag color="purple">{r.rank}</Tag>}</span>}
                mobileHideColumns={["Họ và tên", "Hạng"]}
              />
            ),
          },
          {
            key: "guest",
            label: <span><UserAddOutlined /> Khách mời ({availableGuests.length})</span>,
            children: (
              <>
                <Card size="small" style={{ marginBottom: 12, background: "#fafafa" }}
                  title={<span style={{ fontSize: 13 }}>Tạo khách mời mới</span>}>
                  <Form form={guestForm} layout="inline" style={{ flexWrap: "wrap", gap: 8 }}>
                    <Form.Item name="name" rules={[{ required: true, message: "Nhập tên" }]} style={{ marginBottom: 8 }}>
                      <Input placeholder="Họ và tên *" style={{ width: 160 }} />
                    </Form.Item>
                    <Form.Item name="phone" style={{ marginBottom: 8 }}>
                      <Input placeholder="Số điện thoại" style={{ width: 130 }} />
                    </Form.Item>
                    <Form.Item name="rank" initialValue="Chưa xếp hạng" style={{ marginBottom: 8 }}>
                      <Select style={{ width: 140 }}>
                        {["A","B","C","D","Hạt giống 1","Hạt giống 2","Hạt giống 3","Chưa xếp hạng"].map(r => (
                          <Select.Option key={r} value={r}>{r}</Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 8 }}>
                      <Button type="primary" icon={<PlusOutlined />} loading={addingGuest} onClick={handleAddGuest}>Thêm</Button>
                    </Form.Item>
                  </Form>
                </Card>
                {availableGuests.length === 0 ? (
                  <Empty description="Chưa có khách mời nào khả dụng" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <ResponsiveTable
                    rowSelection={{
                      type: "radio",
                      selectedRowKeys: selectedKey ? [selectedKey] : [],
                      onChange: (keys) => setSelectedKey(keys[0] ?? null),
                    }}
                    onRow={(r) => ({ onClick: () => setSelectedKey(`g-${r.id}`) })}
                    columns={[
                      { title: "Họ và tên", dataIndex: "name" },
                      { title: "SĐT", dataIndex: "phone", width: 120, render: v => v || "—" },
                      { title: "Hạng", dataIndex: "rank", width: 120, render: v => v ? <Tag color="purple">{v}</Tag> : "—" },
                    ]}
                    dataSource={availableGuests}
                    rowKey={(r) => `g-${r.id}`} size="small" pagination={{ pageSize: 8 }}
                    mobileTitle={(r) => <span>{r.name} {r.rank && <Tag color="purple">{r.rank}</Tag>}</span>}
                    mobileHideColumns={["Họ và tên", "SĐT", "Hạng"]}
                  />
                )}
              </>
            ),
          },
        ]}
      />
    </Modal>
  );
}

// ── Sửa cài đặt giải (chỉ khi Nháp) ───────────────────────
function EditSetupModal({ tournament, onSaved, onClose }) {
  const [form] = Form.useForm();
  const [format, setFormat] = useState(tournament.format);
  const [allMembers, setAllMembers] = useState([]);
  const [guestPlayers, setGuestPlayers] = useState([]);
  const [pick1, setPick1] = useState(null);
  const [pick2, setPick2] = useState(null);
  const [guestForm] = Form.useForm();
  const [addingGuest, setAddingGuest] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    membersApi.list().then(r => setAllMembers(r.data));
    playersApi.list("guest").then(r => setGuestPlayers(r.data));
  }, []);

  const usedMemberIds = new Set();
  const usedPlayerIds = new Set();
  tournament.participants.forEach(p => {
    if (p.member_id) usedMemberIds.add(p.member_id);
    if (p.partner_member_id) usedMemberIds.add(p.partner_member_id);
    if (p.player_id) usedPlayerIds.add(p.player_id);
    if (p.partner_player_id) usedPlayerIds.add(p.partner_player_id);
  });

  const pool = [
    ...allMembers.filter(m => !usedMemberIds.has(m.id)).map(m => ({ key: `m-${m.id}`, name: m.full_name, rank: m.rank, member_id: m.id })),
    ...guestPlayers.filter(g => !usedPlayerIds.has(g.id)).map(g => ({ key: `g-${g.id}`, name: g.name, rank: g.rank, player_id: g.id })),
  ];
  const parseKey = (key) => {
    if (!key) return {};
    if (key.startsWith("m-")) return { member_id: parseInt(key.slice(2)) };
    if (key.startsWith("g-")) return { player_id: parseInt(key.slice(2)) };
    return {};
  };

  const handleAddGuest = async () => {
    let vals;
    try { vals = await guestForm.validateFields(); } catch { return; }
    setAddingGuest(true);
    try {
      const res = await playersApi.create({ name: vals.name, phone: vals.phone || null, rank: vals.rank || "Chưa xếp hạng" });
      setGuestPlayers(prev => [...prev, res.data]);
      guestForm.resetFields();
      message.success(`Đã thêm khách mời: ${res.data.name}`);
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể thêm khách mời");
    } finally { setAddingGuest(false); }
  };

  const handleAddParticipant = async () => {
    if (tournament.team_type === "doubles" && (!pick1 || !pick2)) {
      message.error("Chọn 2 người chơi để ghép đội"); return;
    }
    if (tournament.team_type !== "doubles" && !pick1) {
      message.error("Chọn người chơi"); return;
    }
    const p1 = parseKey(pick1);
    const p2 = parseKey(pick2);
    try {
      await tournamentsApi.addParticipant(tournament.id, {
        ...p1,
        partner_member_id: p2.member_id, partner_player_id: p2.player_id,
      });
      setPick1(null); setPick2(null);
      message.success("Đã thêm người chơi");
      onSaved();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể thêm người chơi");
    }
  };

  const handleRemoveParticipant = async (p) => {
    const ok = await confirm({ title: `Xóa "${teamLabel(p)}" khỏi giải?` });
    if (!ok) return;
    try {
      await tournamentsApi.removeParticipant(tournament.id, p.id);
      message.success("Đã xóa người chơi");
      onSaved();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể xóa");
    }
  };

  const handleSaveConfig = async () => {
    const vals = await form.validateFields();
    setSaving(true);
    try {
      await tournamentsApi.update(tournament.id, {
        format: vals.format,
        num_groups: vals.format === "combined" ? (vals.num_groups || 2) : undefined,
      });
      message.success("Đã lưu cấu hình");
      onSaved();
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể lưu cấu hình");
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Sửa cài đặt giải đấu" open onCancel={onClose} width={680} footer={<Button onClick={onClose}>Đóng</Button>}>
      <Divider orientation="left" style={{ marginTop: 0 }}>Thể thức</Divider>
      <Form form={form} layout="inline" initialValues={{ format: tournament.format, num_groups: tournament.num_groups }}>
        <Form.Item name="format" label="Thể thức">
          <Select style={{ width: 220 }} onChange={setFormat}>
            {Object.entries(FORMAT_MAP).map(([k, v]) => (
              <Select.Option key={k} value={k}><Tag color={v.color}>{v.label}</Tag></Select.Option>
            ))}
          </Select>
        </Form.Item>
        {format === "combined" && (
          <Form.Item name="num_groups" label="Số bảng">
            <InputNumber min={2} max={8} style={{ width: 100 }} />
          </Form.Item>
        )}
        <Form.Item>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveConfig}>Lưu</Button>
        </Form.Item>
      </Form>

      <Divider orientation="left">Người chơi ({tournament.participants.length})</Divider>
      <ResponsiveTable
        size="small" pagination={false}
        dataSource={tournament.participants}
        rowKey="id"
        columns={[
          { title: "Đội", render: (_, r) => teamLabel(r) },
          { title: "", width: 70, align: "right", render: (_, r) => (
            <Button danger size="small" icon={<DeleteOutlined />} onClick={() => handleRemoveParticipant(r)} />
          ) },
        ]}
        mobileTitle={(r) => teamLabel(r)}
        mobileHideColumns={["Đội"]}
      />

      <Divider orientation="left">Thêm người chơi</Divider>
      <Row gutter={8} align="middle" style={{ marginBottom: 12 }}>
        <Col span={tournament.team_type === "doubles" ? 10 : 20}>
          <Select value={pick1} onChange={setPick1} placeholder="Người chơi" style={{ width: "100%" }}
            allowClear showSearch filterOption={(inp, opt) => opt.label?.toLowerCase().includes(inp.toLowerCase())}
            options={pool.filter(p => p.key !== pick2).map(p => ({ value: p.key, label: `${p.name}${p.rank ? ` (${p.rank})` : ""}` }))}
          />
        </Col>
        {tournament.team_type === "doubles" && (
          <>
            <Col span={2} style={{ textAlign: "center" }}><Tag color="blue" style={{ margin: 0 }}>+</Tag></Col>
            <Col span={10}>
              <Select value={pick2} onChange={setPick2} placeholder="Đồng đội" style={{ width: "100%" }}
                allowClear showSearch filterOption={(inp, opt) => opt.label?.toLowerCase().includes(inp.toLowerCase())}
                options={pool.filter(p => p.key !== pick1).map(p => ({ value: p.key, label: `${p.name}${p.rank ? ` (${p.rank})` : ""}` }))}
              />
            </Col>
          </>
        )}
      </Row>
      <Button icon={<PlusOutlined />} onClick={handleAddParticipant} style={{ marginBottom: 16 }}>Thêm vào giải</Button>

      <Card size="small" style={{ background: "#fafafa" }} title={<span style={{ fontSize: 13 }}>Tạo khách mời mới</span>}>
        <Form form={guestForm} layout="inline" style={{ flexWrap: "wrap", gap: 8 }}>
          <Form.Item name="name" rules={[{ required: true, message: "Nhập tên" }]} style={{ marginBottom: 8 }}>
            <Input placeholder="Họ và tên *" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="phone" style={{ marginBottom: 8 }}>
            <Input placeholder="Số điện thoại" style={{ width: 130 }} />
          </Form.Item>
          <Form.Item name="rank" initialValue="Chưa xếp hạng" style={{ marginBottom: 8 }}>
            <Select style={{ width: 140 }}>
              {["A","B","C","D","Hạt giống 1","Hạt giống 2","Hạt giống 3","Chưa xếp hạng"].map(r => (
                <Select.Option key={r} value={r}>{r}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" icon={<PlusOutlined />} loading={addingGuest} onClick={handleAddGuest}>Thêm</Button>
          </Form.Item>
        </Form>
      </Card>
    </Modal>
  );
}

// ── Chi tiết giải đấu ─────────────────────────────────────
function TournamentDetail({ tournament: initData, onBack, onUpdated }) {
  const [tournament, setTournament] = useState(initData);
  const [scoreMatch, setScoreMatch] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [startingKO, setStartingKO] = useState(false);
  const [editNameModal, setEditNameModal] = useState(false);
  const [editForm] = Form.useForm();
  const [replaceTarget, setReplaceTarget] = useState(null); // { participant, slot: "main"|"partner" }
  const [editSetupModal, setEditSetupModal] = useState(false);

  const reload = useCallback(async () => {
    const r = await tournamentsApi.get(tournament.id);
    setTournament(r.data);
    onUpdated && onUpdated(r.data);
  }, [tournament.id]);

  const handleStatusChange = async (newStatus) => {
    const labels = { active: "Đang diễn ra", completed: "Kết thúc", draft: "Nháp" };
    const messages = {
      active: "Bắt đầu giải đấu? Sau khi bắt đầu sẽ không thể sửa thể thức hoặc thêm/xóa người chơi nữa.",
      completed: "Kết thúc giải đấu?",
    };
    const ok = await confirm({ title: `Chuyển sang "${labels[newStatus]}"?`, content: messages[newStatus] });
    if (!ok) return;
    try {
      await tournamentsApi.update(tournament.id, { status: newStatus });
      await reload();
      message.success("Đã cập nhật trạng thái");
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể cập nhật trạng thái");
    }
  };

  const handleGenerate = async (shuffle = true) => {
    const label = shuffle ? "xáo ngẫu nhiên" : "giữ thứ tự";
    const ok = await confirm({
      title: "Sinh lịch vòng bảng?",
      content: `Ghép cặp: ${label}. Lịch cũ (nếu có) sẽ bị thay thế.`,
    });
    if (!ok) return;
    setGenerating(true);
    try {
      await tournamentsApi.generate(tournament.id, shuffle);
      await reload();
      message.success("Đã tạo lịch thi đấu!");
    } finally { setGenerating(false); }
  };

  const handleStartKO = async () => {
    const ok = await confirm({
      title: "Lên vòng loại trực tiếp?",
      content: "Top 2 mỗi bảng sẽ được xếp vào bracket loại trực tiếp. Nhất bảng lẻ vs Nhì bảng chẵn và ngược lại.",
    });
    if (!ok) return;
    setStartingKO(true);
    try {
      await tournamentsApi.startKnockout(tournament.id);
      await reload();
      message.success("Đã sinh lịch vòng loại!");
    } catch (e) {
      message.error(e?.response?.data?.detail || "Lỗi khi tạo vòng loại");
    } finally { setStartingKO(false); }
  };

  const handleEditInfo = async () => {
    const vals = await editForm.validateFields();
    await tournamentsApi.update(tournament.id, vals);
    await reload();
    setEditNameModal(false);
    message.success("Đã cập nhật thông tin giải");
  };

  const fmt = tournament.format;
  const matches = tournament.matches || [];
  const groupMatches = matches.filter(m => m.phase === "group");
  const koMatches = matches.filter(m => m.phase === "knockout");
  const groups = [...new Set(tournament.participants.map(p => p.group_name).filter(Boolean))].sort();
  const doneCount = matches.filter(m => m.status === "completed").length;
  const groupDoneCount = groupMatches.filter(m => m.status === "completed").length;
  const allGroupDone = groupMatches.length > 0 && groupDoneCount === groupMatches.length;

  const matchTableCols = [
    { title: "Vòng", dataIndex: "round_name", width: 160 },
    {
      title: "Đội 1",
      render: (_, m) => {
        const name = teamLabel(m.p1);
        const rank = m.p1?.member?.rank;
        return name !== "—"
          ? <span>{name} {rank && <Tag color="purple" style={{ marginLeft: 4 }}>{rank}</Tag>}</span>
          : <Text type="secondary">Chờ kết quả</Text>;
      },
    },
    {
      title: "Tỉ số", align: "center", width: 90,
      render: (_, m) => m.status === "completed"
        ? <b style={{ fontSize: 16 }}>{m.score1} – {m.score2}</b>
        : <Tag>Chưa đấu</Tag>,
    },
    {
      title: "Đội 2",
      render: (_, m) => {
        const name = teamLabel(m.p2);
        const rank = m.p2?.member?.rank;
        return name !== "—"
          ? <span>{name} {rank && <Tag color="purple" style={{ marginLeft: 4 }}>{rank}</Tag>}</span>
          : <Text type="secondary">Chờ kết quả</Text>;
      },
    },
    {
      title: "Kết quả", width: 140,
      render: (_, m) => m.status === "completed"
        ? <Tag icon={<CheckCircleOutlined />} color="success">{teamLabel(m.winner) || "Hòa"}</Tag>
        : null,
    },
    {
      title: "", width: 80, align: "center",
      render: (_, m) => (
        <Button size="small" type={m.status === "completed" ? "default" : "primary"}
          icon={<EditOutlined />}
          disabled={!m.p1_id || !m.p2_id}
          onClick={() => setScoreMatch(m)}>
          {m.status === "completed" ? "Sửa" : "Nhập"}
        </Button>
      ),
    },
  ];

  // Mobile props dùng chung cho bảng lịch thi đấu
  const matchTableMobileProps = {
    mobileTitle: (m) => {
      const p1 = teamLabel(m.p1) || "BYE";
      const p2 = teamLabel(m.p2) || "BYE";
      const score = m.status === "completed"
        ? <b style={{ color: "#1677ff" }}> {m.score1}–{m.score2}</b>
        : <Tag style={{ marginLeft: 4 }}>Chưa đấu</Tag>;
      return <span>{p1} vs {p2}{score}</span>;
    },
    mobileHideColumns: ["Đội 1", "Tỉ số", "Đội 2", "Kết quả"],
  };

  const tabItems = [];

  tabItems.push({
    key: "participants",
    label: `Người chơi (${tournament.participants.length})`,
    children: (
      <ResponsiveTable
        columns={[
          { title: "Đội", dataIndex: "team_name", render: (v, r) => v || teamLabel(r) },
          { title: "Bảng", dataIndex: "group_name", width: 70, render: v => v ? <Tag>{v}</Tag> : "—" },
          {
            title: "", width: 130, align: "right",
            render: (_, r) => (
              <Button size="small" icon={<UserAddOutlined />} onClick={() => setReplaceTarget({ participant: r, slot: "main" })}>
                Thay {r.member?.full_name || r.player?.name || "người 1"}
              </Button>
            ),
          },
          ...(tournament.team_type === "doubles" ? [{
            title: "", width: 130, align: "right",
            render: (_, r) => (
              <Button size="small" icon={<UserAddOutlined />} onClick={() => setReplaceTarget({ participant: r, slot: "partner" })}>
                Thay {r.partner?.full_name || r.partner_player?.name || "người 2"}
              </Button>
            ),
          }] : []),
        ]}
        dataSource={tournament.participants}
        rowKey="id" size="small" pagination={false}
        mobileTitle={(r) => <span>{r.team_name || teamLabel(r)} {r.group_name && <Tag style={{ marginLeft: 6 }}>{r.group_name}</Tag>}</span>}
        mobileHideColumns={["Đội", "Bảng"]}
      />
    ),
  });

  if (fmt === "round_robin" || fmt === "round_robin_double" || fmt === "individual") {
    tabItems.push({
      key: "schedule",
      label: `Lịch thi đấu (${doneCount}/${matches.length})`,
      children: <ResponsiveTable columns={matchTableCols} dataSource={matches} rowKey="id" size="small" pagination={{ pageSize: 15 }} {...matchTableMobileProps} />,
    });
    if (fmt === "round_robin" || fmt === "round_robin_double") {
      tabItems.push({
        key: "standings",
        label: "Bảng xếp hạng",
        children: <StandingsTable tournament={tournament} />,
      });
    }
  }

  if (fmt === "knockout") {
    tabItems.push({
      key: "bracket",
      label: "Sơ đồ đấu",
      children: <KnockoutBracket matches={matches} />,
    });
    tabItems.push({
      key: "schedule",
      label: `Danh sách trận (${doneCount}/${matches.length})`,
      children: <ResponsiveTable columns={matchTableCols} dataSource={matches} rowKey="id" size="small" pagination={false} {...matchTableMobileProps} />,
    });
  }

  if (fmt === "combined") {
    tabItems.push({
      key: "groups",
      label: `Vòng bảng (${groupDoneCount}/${groupMatches.length})`,
      children: (
        <>
          {allGroupDone && koMatches.length === 0 && (
            <Alert
              type="success"
              showIcon
              message="Vòng bảng đã hoàn thành!"
              description="Nhấn nút bên dưới để tự động xếp lịch vòng loại trực tiếp."
              action={
                <Button type="primary" icon={<ArrowRightOutlined />} loading={startingKO} onClick={handleStartKO}>
                  Lên vòng loại →
                </Button>
              }
              style={{ marginBottom: 16 }}
            />
          )}
          <Tabs
            type="card"
            items={groups.map(g => ({
              key: g,
              label: `Bảng ${g}`,
              children: (
                <>
                  <ResponsiveTable
                    columns={matchTableCols}
                    dataSource={groupMatches.filter(m => m.group_name === g)}
                    rowKey="id" size="small" pagination={false}
                    style={{ marginBottom: 16 }}
                    {...matchTableMobileProps}
                  />
                  <StandingsTable tournament={tournament} group={g} />
                </>
              ),
            }))}
          />
        </>
      ),
    });
    if (koMatches.length > 0) {
      tabItems.push({
        key: "knockout",
        label: `Vòng loại (${koMatches.filter(m => m.status === "completed").length}/${koMatches.length})`,
        children: (
          <>
            <KnockoutBracket matches={koMatches} />
            <Divider />
            <ResponsiveTable columns={matchTableCols} dataSource={koMatches} rowKey="id" size="small" pagination={false} {...matchTableMobileProps} />
          </>
        ),
      });
    }
  }

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button onClick={onBack}>← Quay lại</Button>
          <Title level={4} style={{ margin: 0 }}>{tournament.name}</Title>
          <Badge status={STATUS_MAP[tournament.status]?.color} text={STATUS_MAP[tournament.status]?.label} />
          <Tag color={FORMAT_MAP[fmt]?.color}>{FORMAT_MAP[fmt]?.label}</Tag>
          <Tag color={tournament.team_type === "doubles" ? "geekblue" : "default"}>
            {tournament.team_type === "doubles" ? "Đấu đôi" : "Đấu đơn"}
          </Tag>
          <Button size="small" icon={<EditOutlined />} onClick={() => {
            editForm.setFieldsValue({ name: tournament.name, description: tournament.description });
            setEditNameModal(true);
          }}>Sửa tên</Button>
        </Space>
        <Space wrap>
          {tournament.status === "draft" && (
            <>
              <Button icon={<EditOutlined />} onClick={() => setEditSetupModal(true)}>Sửa cài đặt</Button>
              <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => handleStatusChange("active")}>
                Bắt đầu giải
              </Button>
            </>
          )}
          {tournament.status === "active" && (
            <Button icon={<CheckCircleOutlined />} onClick={() => handleStatusChange("completed")}>
              Kết thúc giải
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={reload}>Làm mới</Button>
          {tournament.status === "active" && (
            <>
              {fmt !== "combined" && (
                <Button icon={<ThunderboltOutlined />} loading={generating} onClick={() => handleGenerate(false)}>
                  Sinh lịch (giữ thứ tự)
                </Button>
              )}
              <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} onClick={() => handleGenerate(true)}>
                {fmt === "combined" ? "Sinh lịch vòng bảng" : "Random & Sinh lịch"}
              </Button>
            </>
          )}
        </Space>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={6}>
          <Card size="small">
            <Statistic title="Số đội" value={tournament.participants.length} prefix={<TrophyOutlined />} />
          </Card>
        </Col>
        <Col xs={6}>
          <Card size="small">
            <Statistic title="Tổng trận" value={matches.length} />
          </Card>
        </Col>
        <Col xs={6}>
          <Card size="small">
            <Statistic title="Đã thi đấu" value={doneCount} styles={{ content: { color: "#52c41a" } }} />
          </Card>
        </Col>
        <Col xs={6}>
          <Card size="small">
            <Statistic title="Còn lại" value={matches.length - doneCount}
              styles={{ content: { color: matches.length - doneCount > 0 ? "#faad14" : "#52c41a" } }} />
          </Card>
        </Col>
      </Row>

      {matches.length === 0 ? (
        <Card>
          <Empty
            description={
              tournament.status === "draft"
                ? "Giải đấu chưa bắt đầu. Chỉnh sửa cài đặt rồi bấm 'Bắt đầu giải'."
                : (fmt === "combined" ? "Nhấn 'Sinh lịch vòng bảng' để bắt đầu." : "Nhấn 'Random & Sinh lịch' để bắt đầu.")
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}>
            {tournament.status === "active" && (
              <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} onClick={() => handleGenerate(true)}>
                {fmt === "combined" ? "Sinh lịch vòng bảng" : "Random & Sinh lịch"}
              </Button>
            )}
          </Empty>
        </Card>
      ) : (
        <Tabs items={tabItems} />
      )}

      {scoreMatch && (
        <ScoreModal
          match={scoreMatch}
          tournament={tournament}
          onSaved={() => { setScoreMatch(null); reload(); }}
          onClose={() => setScoreMatch(null)}
        />
      )}

      {replaceTarget && (
        <ReplaceParticipantModal
          tournament={tournament}
          target={replaceTarget}
          onSaved={() => { setReplaceTarget(null); reload(); }}
          onClose={() => setReplaceTarget(null)}
        />
      )}

      {editSetupModal && (
        <EditSetupModal
          tournament={tournament}
          onSaved={reload}
          onClose={() => setEditSetupModal(false)}
        />
      )}

      <Modal title="Sửa thông tin giải đấu" open={editNameModal}
        onCancel={() => setEditNameModal(false)}
        onOk={handleEditInfo} okText="Lưu" cancelText="Hủy">
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Tên giải đấu" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ── Trang chính ───────────────────────────────────────────
export default function Tournament() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = async () => {
    setLoading(true);
    try { const r = await tournamentsApi.list(); setTournaments(r.data); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (t) => {
    const ok = await confirm({
      title: "Xác nhận xóa giải đấu?",
      content: <div>Giải <b>{t.name}</b> và toàn bộ kết quả sẽ bị xóa vĩnh viễn.</div>,
      okButtonProps: { danger: true }, okText: "Xóa",
    });
    if (!ok) return;
    await tournamentsApi.delete(t.id);
    message.success("Đã xóa giải đấu");
    load();
  };

  const columns = [
    { title: "Tên giải đấu", dataIndex: "name", render: (v, r) => <a onClick={() => setDetail(r)}>{v}</a> },
    { title: "Thể thức", dataIndex: "format", render: v => <Tag color={FORMAT_MAP[v]?.color}>{FORMAT_MAP[v]?.label}</Tag> },
    { title: "Loại đội", dataIndex: "team_type", width: 90,
      render: v => <Tag color={v === "doubles" ? "geekblue" : "default"}>{v === "doubles" ? "Đấu đôi" : "Đấu đơn"}</Tag> },
    { title: "Trạng thái", dataIndex: "status", render: v => <Badge status={STATUS_MAP[v]?.color} text={STATUS_MAP[v]?.label} /> },
    { title: "Đội", render: (_, r) => r.participants?.length || 0, align: "center", width: 60 },
    {
      title: "Tiến độ", render: (_, r) => {
        const total = r.matches?.length || 0;
        const done = r.matches?.filter(m => m.status === "completed").length || 0;
        return total ? <Text>{done}/{total} trận</Text> : <Text type="secondary">Chưa sinh lịch</Text>;
      },
    },
    {
      title: "Thao tác", width: 120,
      render: (_, r) => (
        <Space>
          <Button size="small" type="primary" onClick={() => setDetail(r)}>Mở</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} />
        </Space>
      ),
    },
  ];

  if (detail) {
    return (
      <TournamentDetail
        tournament={detail}
        onBack={() => { setDetail(null); load(); }}
        onUpdated={(t) => setDetail(t)}
      />
    );
  }

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Quản lý Giải đấu</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          Tạo giải đấu mới
        </Button>
      </Row>

      <ResponsiveTable
        columns={columns}
        dataSource={tournaments}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description="Chưa có giải đấu nào." image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        mobileTitle={(r) => <a onClick={() => setDetail(r)}>{r.name}</a>}
        mobileHideColumns={["Tên giải đấu"]}
      />

      <Modal
        title="Tạo giải đấu mới"
        open={creating}
        onCancel={() => setCreating(false)}
        footer={null}
        width={700}
        destroyOnHidden
      >
        <CreateWizard
          onCreated={(t) => { setCreating(false); setDetail(t); load(); }}
          onClose={() => setCreating(false)}
        />
      </Modal>
    </div>
  );
}
