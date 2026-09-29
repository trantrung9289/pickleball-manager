import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Button, Space, Tag, Modal, Form, Input, Select,
  message, Typography, Row, Col, Card, Steps,
  InputNumber, Tabs, Badge, Statistic, Empty,
  Divider, Alert, Checkbox, Collapse, AutoComplete, Switch, Tooltip,
} from "antd";
import {
  PlusOutlined, ThunderboltOutlined, TrophyOutlined,
  EditOutlined, DeleteOutlined, ReloadOutlined,
  CheckCircleOutlined, SaveOutlined, ArrowRightOutlined,
  UserOutlined, TeamOutlined, UserAddOutlined, PrinterOutlined, GiftOutlined, WarningOutlined,
} from "@ant-design/icons";
import { tournamentsApi, membersApi, playersApi } from "../api";
import ResponsiveTable from "../components/ResponsiveTable";
import TournamentPrintSheet from "../components/TournamentPrintSheet";
import DrawCeremony from "../components/draw/DrawCeremony";
import PartnerDrawCeremony from "../components/draw/PartnerDrawCeremony";
import { useViewMode } from "../contexts/ViewModeContext";
import { useRankLevels } from "../hooks/useRankLevels";
import { buildRealBracketNodes, computeBracketGeometry, findThirdPlaceMatch } from "../utils/bracketLayout";
import { teamLabel, teamRank } from "../utils/tournamentLabels";
import {
  DRAW_FORMATS, serverOffset, normalizeRank, UNRANKED, partnerPlan, normalizePartnerRules, ranksLabel,
} from "../utils/drawMath";

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
// Danh sách hạng KHÔNG còn cứng ở đây — lấy từ cấu hình CLB qua hook useRankLevels (dùng chung Thành viên /
// Khách mời / quy tắc ghép đội). "Chưa xếp hạng" là hạng ngầm định (options của hook đã có sẵn).

const confirm = (opts) =>
  new Promise((res) =>
    Modal.confirm({ okText: "Xác nhận", cancelText: "Hủy", ...opts, onOk: () => res(true), onCancel: () => res(false) })
  );

// Luật bốc thăm theo thể thức — hiển thị trong hộp xác nhận mở phiên
const DRAW_RULE_TEXT = {
  combined:   "Lượt 1 vào bảng A, lượt 2 vào bảng B..., lần lượt xoay vòng cho đến hết.",
  knockout:   "Bốc theo vị trí sơ đồ từ trên xuống; các vị trí có ghi 'miễn vòng 1' vào thẳng vòng 2.",
  individual: "Hai lượt bốc liên tiếp tạo thành một trận.",
};

// ── Ghép đội đôi: helper dùng chung ──────────────────────
/** Participant đơn lẻ (giải đôi): chưa có đồng đội → cần ghép đội trước khi bắt đầu giải. */
const isSingleParticipant = (p) => !p?.partner_member_id && !p?.partner_player_id;
/** Hạng của người 1 trong participant (đã normalize như backend). */
const participantRank = (p) => normalizeRank(p?.member?.rank || p?.player?.rank);
/** Quy tắc rỗng (một dòng "bất kỳ + bất kỳ") để khởi tạo editor. */
const emptyRule = () => ({ ranks1: [], ranks2: [] });
/** Mọi quy tắc đều để trống cả 2 bên → coi như "không lọc hạng" (gửi [] cho gọn, backend hiểu như nhau). */
const allRulesBlank = (rules) => rules.every((r) => !r.ranks1.length && !r.ranks2.length);
const DEFAULT_REVEAL_MS = 5000;

/**
 * Editor quy tắc ghép đội theo hạng — shape v2 [{ranks1: [], ranks2: []}], mỗi bên chọn được NHIỀU hạng
 * (kể cả "Chưa xếp hạng"); để trống một bên = bất kỳ hạng. Options lấy từ cấu hình hạng CLB kèm số người
 * trong pool truyền vào ("A (3)"); hạng lạ có trong pool (dữ liệu cũ) vẫn được thêm vào để chọn được.
 * Props: { rules, onChange, allowEmpty (cho xoá tới 0 dòng), pool: [{pid, rank}] (đếm số người theo hạng) }
 */
function RankRulesEditor({ rules, onChange, allowEmpty = false, pool = [] }) {
  const { options: clubOptions, error: rankLevelsError, isFallback: rankLevelsFallback } = useRankLevels();
  const countByRank = useMemo(() => {
    const m = {};
    (pool || []).forEach((p) => { const r = normalizeRank(p.rank); m[r] = (m[r] || 0) + 1; });
    return m;
  }, [pool]);
  const options = useMemo(() => {
    const list = [...clubOptions];
    // Hạng đang có trong pool hoặc đã chọn trong quy tắc mà không còn trong cấu hình CLB → vẫn hiện để không mất
    Object.keys(countByRank).forEach((r) => { if (!list.includes(r)) list.push(r); });
    (rules || []).forEach((rule) => {
      [...(rule.ranks1 || []), ...(rule.ranks2 || [])].forEach((r) => { if (!list.includes(r)) list.push(r); });
    });
    return list.map((r) => ({ value: r, label: `${r} (${countByRank[r] || 0})` }));
  }, [clubOptions, countByRank, rules]);

  const setRule = (i, patch) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const sideSelect = (rule, i, key) => (
    <Select mode="multiple" value={rule[key] || []} placeholder="Bất kỳ hạng" style={{ width: "100%" }}
      allowClear showSearch optionFilterProp="label" maxTagCount="responsive" options={options}
      onChange={(v) => setRule(i, { [key]: v || [] })} />
  );
  return (
    <div>
      {rules.map((rule, i) => (
        <Row gutter={8} key={i} align="middle" style={{ marginBottom: 8 }}>
          <Col span={10}>{sideSelect(rule, i, "ranks1")}</Col>
          <Col span={2} style={{ textAlign: "center" }}><Tag color="blue">+</Tag></Col>
          <Col span={10}>{sideSelect(rule, i, "ranks2")}</Col>
          <Col span={2} style={{ textAlign: "center" }}>
            <Button danger size="small" disabled={!allowEmpty && rules.length === 1}
              onClick={() => onChange(rules.filter((_, j) => j !== i))}>×</Button>
          </Col>
        </Row>
      ))}
      <Button type="dashed" size="small" onClick={() => onChange([...rules, emptyRule()])}>
        + Thêm quy tắc
      </Button>
      <Text type="secondary" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
        Quy tắc áp dụng theo thứ tự từ trên xuống; quy tắc trước tiêu thụ người trước. Để trống một bên = bất kỳ hạng.
      </Text>
      {rankLevelsError && (
        <Text type="warning" style={{ display: "block", marginTop: 4, fontSize: 12 }}>
          <WarningOutlined /> {rankLevelsFallback
            ? "Không tải được danh sách hạng của CLB — đang dùng danh sách mặc định."
            : "Không tải lại được danh sách hạng của CLB — đang dùng danh sách đã tải trước đó."}
        </Text>
      )}
    </div>
  );
}

// ── Mở phiên ghép đội bằng vòng quay: chỉnh quy tắc + thời gian quay rồi "Mở phiên" ──
function PartnerDrawSetupModal({ tournament, busy, onOpen, onClose }) {
  // Quy tắc đã lưu của giải có thể còn shape cũ {rank1, rank2} → normalize khi nạp
  const [rules, setRules] = useState(() => {
    const saved = normalizePartnerRules(tournament.partner_rules);
    return saved.length ? saved : [emptyRule()];
  });
  const [revealSec, setRevealSec] = useState(DEFAULT_REVEAL_MS / 1000);

  const singles = useMemo(() => tournament.participants.filter(isSingleParticipant), [tournament.participants]);
  const people = useMemo(() => singles.map((p) => ({ pid: p.id, rank: participantRank(p) })), [singles]);
  // Thống kê hạng của người đơn lẻ để admin đặt quy tắc cho khớp
  const byRank = {};
  people.forEach((p) => { byRank[p.rank] = (byRank[p.rank] || 0) + 1; });
  // Xem trước kế hoạch v2 (cùng thuật toán với backend): mỗi quy tắc "dự kiến n đội" (team_max — có thể nhiều/ít
  // hơn khi bốc thật), tổng "tối đa N lượt" (total_steps_max — trần thật) + "dự kiến M lượt" (total_steps_est)
  const rulesToSend = allRulesBlank(rules) ? [] : normalizePartnerRules(rules);
  const plan = partnerPlan(people, rulesToSend);
  const teamEstTotal = plan.phases.reduce((s, ph) => s + (ph.team_max || 0), 0);

  const handleOpen = () => {
    if (plan.total_steps_max === 0) { message.error("Không có quy tắc nào ghép được đội với danh sách hiện tại"); return; }
    onOpen(rulesToSend, Math.round(revealSec * 1000));
  };

  return (
    <Modal title="🎡 Mở phiên ghép đội bằng vòng quay" open onCancel={onClose} width={680}
      footer={
        <Space>
          <Button onClick={onClose}>Đóng</Button>
          <Button type="primary" icon={<GiftOutlined />} loading={busy} onClick={handleOpen}>Mở phiên</Button>
        </Space>
      }>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={`${singles.length} người chưa có đội`}
        description={
          <div>
            <div style={{ marginBottom: 6 }}>
              {Object.entries(byRank).map(([r, n]) => <Tag key={r} color="purple">{r}: {n}</Tag>)}
            </div>
            Mỗi đội quay 2 lượt: bên 1 rồi bên 2 theo hạng của quy tắc. Lượt bên 1 loại những người mà nếu chọn
            thì bên 2 không còn ai; quy tắc dừng khi không còn cặp hợp lệ. Người không khớp quy tắc / dư sẽ ghép tay sau.
            Khán giả xem trực tiếp trên trang public ngay khi mở phiên.
          </div>
        } />

      <Divider orientation="left" style={{ marginTop: 0 }}>Quy tắc ghép theo hạng (tuỳ chọn, theo thứ tự)</Divider>
      <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
        Mỗi bên chọn được nhiều hạng (kể cả "Chưa xếp hạng"). Để trống toàn bộ = ghép ngẫu nhiên không lọc hạng.
      </Text>
      <RankRulesEditor rules={rules} onChange={setRules} allowEmpty pool={people} />

      <Divider orientation="left">Thời gian quay mỗi lượt</Divider>
      <Space>
        <InputNumber min={1.5} max={15} step={0.5} value={revealSec} onChange={(v) => setRevealSec(v || DEFAULT_REVEAL_MS / 1000)} />
        <Text type="secondary">giây (mặc định 5s)</Text>
      </Space>

      <Divider orientation="left">Kế hoạch dự kiến</Divider>
      {plan.total_steps_max > 0 ? (
        <Space direction="vertical" size={2}>
          {plan.phases.map((ph) => (
            <Text key={ph.index} type={ph.team_max ? undefined : "secondary"}>
              Quy tắc {ph.index + 1}: {ranksLabel(ph.ranks1)} + {ranksLabel(ph.ranks2)} — <b>dự kiến {ph.team_max} đội</b>
              {ph.overlap && <Text type="secondary"> (ước tính, hai bên có hạng trùng nhau)</Text>}
            </Text>
          ))}
          <Text>
            Tổng: <b>tối đa {plan.total_steps_max} lượt</b>
            {plan.total_steps_est < plan.total_steps_max
              ? <> — dự kiến {plan.total_steps_est} lượt ({teamEstTotal} đội)</>
              : <> ({teamEstTotal} đội)</>}
          </Text>
          <Text type="secondary">
            Số đội từng quy tắc là dự kiến (có thể nhiều/ít hơn tuỳ kết quả bốc); tổng không vượt {plan.total_steps_max} lượt;
            phiên tự kết thúc khi hết người đủ điều kiện.
          </Text>
          <Text type={plan.unpaired_pids.length ? "warning" : "secondary"}>
            {plan.unpaired_pids.length
              ? `${plan.unpaired_pids.length} người không khớp quy tắc nào — sẽ ghép tay sau`
              : "Mọi người đều thuộc hạng có trong quy tắc (người dư chỉ biết sau khi quay)"}
          </Text>
        </Space>
      ) : (
        <Text type="danger">Không ghép được đội nào với quy tắc hiện tại.</Text>
      )}
    </Modal>
  );
}

// ── Ghép tay 2 người đơn lẻ thành 1 đội (lặp tới khi hết) ──
function PairSinglesModal({ tournament, onSaved, onClose }) {
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);
  const [saving, setSaving] = useState(false);
  const singles = tournament.participants.filter(isSingleParticipant);
  const optionOf = (p) => ({ value: p.id, label: `${teamLabel(p)} (${participantRank(p)})` });

  const handlePair = async () => {
    if (!p1 || !p2 || p1 === p2) { message.error("Chọn 2 người khác nhau"); return; }
    setSaving(true);
    try {
      await tournamentsApi.pairParticipants(tournament.id, p1, p2);
      message.success("Đã ghép đội");
      setP1(null); setP2(null);
      await onSaved();   // reload → danh sách người đơn lẻ tự rút gọn, tiếp tục ghép cặp kế
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể ghép đội");
    } finally { setSaving(false); }
  };

  return (
    <Modal title="✋ Ghép tay người chưa có đội" open onCancel={onClose} width={620}
      footer={<Button onClick={onClose}>Đóng</Button>}>
      {singles.length < 2 ? (
        <Alert type={singles.length === 0 ? "success" : "warning"} showIcon
          message={singles.length === 0 ? "Mọi người đã có đội" : `Còn 1 người chưa có đội: ${teamLabel(singles[0])}`}
          description={singles.length === 1 ? "Thêm người vào giải (khung Người chơi → Thêm người chơi) hoặc xoá người này khỏi giải trước khi bắt đầu." : undefined} />
      ) : (
        <>
          <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
            Còn {singles.length} người chưa có đội. Chọn 2 người rồi bấm Ghép — lặp lại cho tới khi xong.
          </Text>
          <Row gutter={8} align="middle" style={{ marginBottom: 12 }}>
            <Col span={10}>
              <Select value={p1} onChange={setP1} placeholder="Người 1" style={{ width: "100%" }} allowClear showSearch
                filterOption={(inp, opt) => opt.label?.toLowerCase().includes(inp.toLowerCase())}
                options={singles.filter((p) => p.id !== p2).map(optionOf)} />
            </Col>
            <Col span={2} style={{ textAlign: "center" }}><Tag color="blue" style={{ margin: 0 }}>+</Tag></Col>
            <Col span={10}>
              <Select value={p2} onChange={setP2} placeholder="Người 2" style={{ width: "100%" }} allowClear showSearch
                filterOption={(inp, opt) => opt.label?.toLowerCase().includes(inp.toLowerCase())}
                options={singles.filter((p) => p.id !== p1).map(optionOf)} />
            </Col>
            <Col span={2}>
              <Button type="primary" loading={saving} disabled={!p1 || !p2} onClick={handlePair}>Ghép</Button>
            </Col>
          </Row>
        </>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {singles.map((p) => (
          <Tag key={p.id} color="gold">{teamLabel(p)}{participantRank(p) !== UNRANKED && ` (${participantRank(p)})`}</Tag>
        ))}
      </div>
    </Modal>
  );
}

// ── Wizard tạo giải (2 bước) ──────────────────────────────
// Bước 1: thông tin giải; bước 2: loại đội & tuỳ chọn. Giải tạo ra ở trạng thái Nháp KHÔNG kèm người chơi —
// chọn người (hàng loạt) và ghép đội (giải đôi) làm ngay trên trang chi tiết giải (ParticipantsPanel).
function CreateWizard({ onCreated, onClose }) {
  const [step, setStep] = useState(0);
  const [form] = Form.useForm();
  const [format, setFormat] = useState(null);
  const [teamType, setTeamType] = useState("singles");
  const [thirdPlaceEnabled, setThirdPlaceEnabled] = useState(true);
  // PIN nhập điểm qua public
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleNext = async () => {
    try { await form.validateFields(); setFormat(form.getFieldValue("format")); }
    catch { return; }
    setStep(1);
  };

  const handleCreate = async () => {
    const vals = form.getFieldsValue();
    if (!vals.name || !vals.format) { setStep(0); message.error("Thiếu thông tin giải"); return; }
    if (pinEnabled && !/^\d{4}$/.test(pinValue)) { message.error("Mã PIN phải gồm đúng 4 chữ số"); return; }

    setSaving(true);
    try {
      const payload = {
        name: vals.name,
        format: vals.format,
        team_type: teamType,
        description: vals.description || null,
        num_groups: vals.num_groups || 2,
        pairing_mode: "random",
        public_scoring_enabled: pinEnabled,
        score_pin: pinEnabled ? pinValue : null,
        third_place_enabled: (vals.format === "knockout" || vals.format === "combined") ? thirdPlaceEnabled : false,
      };
      const res = await tournamentsApi.create(payload);
      message.success("Đã tạo giải đấu — thêm người chơi ngay trên trang giải");
      onCreated(res.data);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể tạo giải đấu");
    } finally { setSaving(false); }
  };

  const STEPS = [
    { title: "Thông tin giải" },
    { title: "Loại đội & tuỳ chọn" },
  ];

  const teamTypeCard = (value, icon, title, desc) => (
    <Card size="small" hoverable onClick={() => setTeamType(value)}
      style={{ borderColor: teamType === value ? "#1677ff" : "#d9d9d9", cursor: "pointer" }}>
      <Space>
        {icon}
        <div>
          <div style={{ fontWeight: 600 }}>{title}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{desc}</Text>
        </div>
      </Space>
    </Card>
  );

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
          {(format === "knockout" || format === "combined") && (
            <Form.Item>
              <Checkbox checked={thirdPlaceEnabled} onChange={(e) => setThirdPlaceEnabled(e.target.checked)}>
                Có trận tranh giải 3 <Text type="secondary" style={{ fontSize: 12 }}>(2 người thua bán kết đấu với nhau — cần ít nhất 4 đội)</Text>
              </Checkbox>
            </Form.Item>
          )}
          <Form.Item name="description" label="Mô tả (không bắt buộc)">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </div>

      {/* ── Bước 1: Loại đội & tuỳ chọn ── */}
      {step === 1 && (
        <div>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Loại đội</div>
          <Row gutter={12} style={{ marginBottom: 16 }}>
            <Col span={12}>
              {teamTypeCard("singles",
                <UserOutlined style={{ fontSize: 20, color: teamType === "singles" ? "#1677ff" : "#999" }} />,
                "Đấu đơn", "Mỗi người chơi là 1 đội")}
            </Col>
            <Col span={12}>
              {teamTypeCard("doubles",
                <TeamOutlined style={{ fontSize: 20, color: teamType === "doubles" ? "#1677ff" : "#999" }} />,
                "Đấu đôi", "2 người ghép thành 1 đội")}
            </Col>
          </Row>

          <Card size="small" style={{ marginBottom: 16 }}>
            <Row justify="space-between" align="middle">
              <div>
                <div style={{ fontWeight: 600 }}>Cho phép nhập điểm qua trang public</div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Người xem trang public có thể nhập điểm nếu biết đúng mã PIN của giải này
                </Text>
              </div>
              <Switch checked={pinEnabled} onChange={setPinEnabled} />
            </Row>
            {pinEnabled && (
              <Form.Item
                label="Mã PIN (4 chữ số)" style={{ marginTop: 12, marginBottom: 0 }}
                validateStatus={pinValue && !/^\d{4}$/.test(pinValue) ? "error" : ""}
                help={pinValue && !/^\d{4}$/.test(pinValue) ? "Mã PIN phải gồm đúng 4 chữ số" : ""}
              >
                <Input
                  value={pinValue}
                  onChange={e => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="VD: 2026" maxLength={4} style={{ width: 160 }}
                />
              </Form.Item>
            )}
          </Card>

          <Alert
            type="info" showIcon
            message="Sau khi tạo, thêm người chơi và (giải đôi) ghép đội ngay trên trang giải."
            description="Giải ở trạng thái Nháp cho tới khi bấm 'Bắt đầu giải'. Lịch thi đấu được sinh ngẫu nhiên hoặc bốc thăm sau khi bắt đầu."
          />
        </div>
      )}

      <Divider style={{ margin: "16px 0" }} />
      <Row justify="space-between" align="middle">
        <Button onClick={onClose}>Hủy</Button>
        <Space>
          {step > 0 && <Button onClick={() => setStep(0)}>← Quay lại</Button>}
          {step === 0
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

const MEMBER_STATUS_MAP = {
  active: { label: "Hoạt động", color: "success" },
  inactive: { label: "Tạm nghỉ", color: "warning" },
  suspended: { label: "Đình chỉ", color: "error" },
};

/** Form nhỏ tạo khách mời nhanh (dùng trong AddParticipantsModal & ReplaceParticipantModal) — hạng từ cấu hình CLB. */
function QuickGuestForm({ form, loading, onAdd, title = "Tạo khách mời mới" }) {
  const { options: rankOptions, unranked } = useRankLevels();
  return (
    <Card size="small" style={{ marginBottom: 12, background: "#fafafa" }}
      title={<span style={{ fontSize: 13 }}>{title}</span>}>
      <Form form={form} layout="inline" style={{ flexWrap: "wrap", gap: 8 }}>
        <Form.Item name="name" rules={[{ required: true, message: "Nhập tên" }]} style={{ marginBottom: 8 }}>
          <Input placeholder="Họ và tên *" style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="phone" style={{ marginBottom: 8 }}>
          <Input placeholder="Số điện thoại" style={{ width: 130 }} />
        </Form.Item>
        <Form.Item name="rank" initialValue={unranked} style={{ marginBottom: 8 }}>
          <Select style={{ width: 150 }} placeholder="Chọn hạng" showSearch
            options={rankOptions.map((r) => ({ value: r, label: r }))} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 8 }}>
          <Button type="primary" icon={<PlusOutlined />} loading={loading} onClick={onAdd}>Thêm</Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

// ── Thêm người chơi hàng loạt vào giải Nháp (thành viên + khách mời) ──
// Chuyển từ bước "Chọn người chơi" của wizard cũ: tabs, checkbox list, tìm kiếm, chọn tất cả, tạo khách mời nhanh.
function AddParticipantsModal({ tournament, onAdded, onClose }) {
  const [allMembers, setAllMembers] = useState([]);
  const [allGuests, setAllGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);           // member IDs
  const [selectedGuestIds, setSelectedGuestIds] = useState([]); // player IDs (khách mời)
  const [memberSearch, setMemberSearch] = useState("");
  const [guestSearch, setGuestSearch] = useState("");
  const [guestForm] = Form.useForm();
  const [addingGuest, setAddingGuest] = useState(false);
  const [saving, setSaving] = useState(false);
  const { unranked } = useRankLevels();

  useEffect(() => {
    let cancelled = false;
    Promise.all([membersApi.list(), playersApi.list("guest")])
      .then(([m, g]) => { if (!cancelled) { setAllMembers(m.data); setAllGuests(g.data); } })
      .catch(() => { if (!cancelled) message.error("Không tải được danh sách người chơi"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Người đã có trong giải (ở bất kỳ vị trí, kể cả người 2 của một đội) → disabled + "Đã trong giải"
  const { usedMemberIds, usedPlayerIds } = useMemo(() => {
    const m = new Set(), p = new Set();
    (tournament.participants || []).forEach((x) => {
      if (x.member_id) m.add(x.member_id);
      if (x.partner_member_id) m.add(x.partner_member_id);
      if (x.player_id) p.add(x.player_id);
      if (x.partner_player_id) p.add(x.partner_player_id);
    });
    return { usedMemberIds: m, usedPlayerIds: p };
  }, [tournament.participants]);

  const norm = (s) => (s || "").toString().toLowerCase();
  const visibleMembers = allMembers.filter((m) => !memberSearch
    || norm(m.full_name).includes(norm(memberSearch)) || norm(m.phone).includes(norm(memberSearch)) || norm(m.member_code).includes(norm(memberSearch)));
  const visibleGuests = allGuests.filter((g) => !guestSearch
    || norm(g.name).includes(norm(guestSearch)) || norm(g.phone).includes(norm(guestSearch)));
  const selectableMembers = visibleMembers.filter((m) => !usedMemberIds.has(m.id));
  const selectableGuests = visibleGuests.filter((g) => !usedPlayerIds.has(g.id));
  const totalSelected = selectedIds.length + selectedGuestIds.length;

  // ResponsiveTable (mobile) không hỗ trợ getCheckboxProps → lọc bỏ người đã trong giải ngay tại onChange
  const onMemberKeys = (keys) => setSelectedIds(keys.filter((id) => !usedMemberIds.has(id)));
  const onGuestKeys = (keys) => setSelectedGuestIds(keys.filter((id) => !usedPlayerIds.has(id)));
  // "Chọn tất cả" áp dụng trên danh sách đang hiển thị (theo ô tìm kiếm), giữ các lựa chọn ngoài bộ lọc
  const toggleAll = (checked, selectable, selected, setSelected) => {
    const ids = selectable.map((x) => x.id);
    setSelected(checked ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id)));
  };
  const allChecked = (selectable, selected) => selectable.length > 0 && selectable.every((x) => selected.includes(x.id));
  const someChecked = (selectable, selected) => selectable.some((x) => selected.includes(x.id));

  const handleAddGuest = async () => {
    let vals;
    try { vals = await guestForm.validateFields(); } catch { return; }
    setAddingGuest(true);
    try {
      const res = await playersApi.create({ name: vals.name, phone: vals.phone || null, rank: vals.rank || unranked });
      setAllGuests((prev) => [res.data, ...prev]);
      setSelectedGuestIds((prev) => [...prev, res.data.id]);
      guestForm.resetFields();
      message.success(`Đã thêm khách mời: ${res.data.name}`);
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể thêm khách mời");
    } finally { setAddingGuest(false); }
  };

  const handleSubmit = async () => {
    if (totalSelected === 0) { message.error("Chọn ít nhất 1 người"); return; }
    setSaving(true);
    try {
      const res = await tournamentsApi.addParticipantsBulk(tournament.id, { member_ids: selectedIds, player_ids: selectedGuestIds });
      const { added = 0, skipped = [] } = res.data || {};
      message.success(`Đã thêm ${added} người${skipped.length ? ` (bỏ qua ${skipped.length} đã có)` : ""}`);
      await onAdded(res.data?.tournament);
      onClose();
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể thêm người chơi");
    } finally { setSaving(false); }
  };

  const inTournamentTag = <Tag color="default" style={{ marginLeft: 6 }}>Đã trong giải</Tag>;
  const rankTag = (v) => (v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">—</Text>);

  const memberCols = [
    { title: "Họ và tên", dataIndex: "full_name", render: (v, r) => <span>{v}{usedMemberIds.has(r.id) && inTournamentTag}</span> },
    { title: "Hạng", dataIndex: "rank", width: 110, render: rankTag },
    { title: "Trạng thái", dataIndex: "status", width: 110, render: (v) => { const s = MEMBER_STATUS_MAP[v] || { label: v, color: "default" }; return <Badge status={s.color} text={s.label} />; } },
    { title: "SĐT", dataIndex: "phone", width: 120, render: (v) => v || "—" },
  ];
  const guestCols = [
    { title: "Họ và tên", dataIndex: "name",
      render: (v, r) => <span><Tag color="orange" style={{ marginRight: 6 }}>Khách</Tag>{v}{usedPlayerIds.has(r.id) && inTournamentTag}</span> },
    { title: "SĐT", dataIndex: "phone", width: 120, render: (v) => v || "—" },
    { title: "Hạng", dataIndex: "rank", width: 110, render: (v) => rankTag(v || unranked) },
  ];

  const selectionBar = (selectable, selected, setSelected, label) => (
    <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Checkbox
        checked={allChecked(selectable, selected)}
        indeterminate={!allChecked(selectable, selected) && someChecked(selectable, selected)}
        disabled={selectable.length === 0}
        onChange={(e) => toggleAll(e.target.checked, selectable, selected, setSelected)}
      >
        Chọn tất cả {label} ({selectable.length})
      </Checkbox>
      {selected.length > 0 && (
        <Button size="small" type="link" onClick={() => setSelected([])}>Bỏ chọn ({selected.length})</Button>
      )}
    </div>
  );

  return (
    <Modal title="Thêm người chơi vào giải" open onCancel={onClose} width={720}
      footer={
        <Space>
          <Button onClick={onClose}>Đóng</Button>
          <Button type="primary" icon={<PlusOutlined />} loading={saving} disabled={totalSelected === 0} onClick={handleSubmit}>
            Thêm {totalSelected} người
          </Button>
        </Space>
      }>
      <Alert type={totalSelected > 0 ? "info" : "warning"} showIcon style={{ marginBottom: 12 }}
        message={totalSelected > 0
          ? `Đã chọn ${totalSelected} người (${selectedIds.length} thành viên, ${selectedGuestIds.length} khách mời)`
          : "Tích chọn người chơi ở hai tab rồi bấm Thêm"}
        description={tournament.team_type === "doubles"
          ? "Giải đôi: mỗi người được thêm ở trạng thái chưa có đội — ghép đội bằng vòng quay hoặc ghép tay sau."
          : undefined} />
      <Tabs
        defaultActiveKey="member"
        items={[
          {
            key: "member",
            label: <span><UserOutlined /> Thành viên CLB ({selectedIds.length})</span>,
            children: (
              <>
                <Input.Search allowClear placeholder="Tìm theo tên / SĐT / mã TV" value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)} style={{ marginBottom: 12 }} />
                {selectionBar(selectableMembers, selectedIds, setSelectedIds, "thành viên")}
                <ResponsiveTable
                  loading={loading}
                  rowSelection={{
                    selectedRowKeys: selectedIds,
                    onChange: onMemberKeys,
                    getCheckboxProps: (r) => ({ disabled: usedMemberIds.has(r.id) }),
                  }}
                  columns={memberCols}
                  dataSource={visibleMembers}
                  rowKey="id" size="small" pagination={{ pageSize: 10 }}
                  mobileTitle={(r) => {
                    const s = MEMBER_STATUS_MAP[r.status] || { label: r.status, color: "default" };
                    return (
                      <span>
                        {r.full_name}
                        {r.rank && <Tag color="purple" style={{ marginLeft: 6 }}>{r.rank}</Tag>}
                        {r.status !== "active" && <Badge status={s.color} text={s.label} style={{ marginLeft: 8 }} />}
                        {usedMemberIds.has(r.id) && inTournamentTag}
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
            label: <span><UserAddOutlined /> Khách mời ({selectedGuestIds.length})</span>,
            children: (
              <>
                <QuickGuestForm form={guestForm} loading={addingGuest} onAdd={handleAddGuest} title="Thêm người chơi ngoài CLB" />
                {allGuests.length === 0 && !loading ? (
                  <Empty description="Chưa có khách mời nào — thêm mới ở trên" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <>
                    <Input.Search allowClear placeholder="Tìm theo tên / SĐT" value={guestSearch}
                      onChange={(e) => setGuestSearch(e.target.value)} style={{ marginBottom: 12 }} />
                    {selectionBar(selectableGuests, selectedGuestIds, setSelectedGuestIds, "khách mời")}
                    <ResponsiveTable
                      loading={loading}
                      rowSelection={{
                        selectedRowKeys: selectedGuestIds,
                        onChange: onGuestKeys,
                        getCheckboxProps: (r) => ({ disabled: usedPlayerIds.has(r.id) }),
                      }}
                      columns={guestCols}
                      dataSource={visibleGuests}
                      rowKey="id" size="small" pagination={{ pageSize: 10 }}
                      mobileTitle={(r) => (
                        <span>
                          <Tag color="orange" style={{ marginRight: 6 }}>Khách</Tag>{r.name}
                          {usedPlayerIds.has(r.id) && inTournamentTag}
                        </span>
                      )}
                      mobileHideColumns={["Họ và tên"]}
                    />
                  </>
                )}
              </>
            ),
          },
        ]}
      />
    </Modal>
  );
}

// ── Bảng người chơi của giải Nháp: thêm hàng loạt / xoá; giải đôi đánh dấu "Chưa có đội" ──
// Props: { tournament, onChanged (reload sau khi thêm/xoá), autoOpenAdd (tự mở modal thêm — sau khi vừa tạo giải) }
function ParticipantsPanel({ tournament, onChanged, autoOpenAdd = false }) {
  const [addOpen, setAddOpen] = useState(() => !!autoOpenAdd);
  const participants = tournament.participants || [];
  const isDoubles = tournament.team_type === "doubles";
  const unpaired = isDoubles ? participants.filter(isSingleParticipant).length : 0;

  const handleRemove = async (p) => {
    const ok = await confirm({ title: `Xóa "${teamLabel(p)}" khỏi giải?` });
    if (!ok) return;
    try {
      await tournamentsApi.removeParticipant(tournament.id, p.id);
      message.success("Đã xóa người chơi");
      await onChanged();
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể xóa");
    }
  };

  const columns = [
    {
      title: isDoubles ? "Đội / Người chơi" : "Người chơi",
      render: (_, r) => (
        <span>
          {teamLabel(r)}
          {isDoubles && isSingleParticipant(r) && <Tag color="warning" style={{ marginLeft: 6 }}>Chưa có đội</Tag>}
        </span>
      ),
    },
    { title: "Hạng", width: 120, render: (_, r) => { const rk = teamRank(r); return rk ? <Tag color="purple">{rk}</Tag> : <Text type="secondary">—</Text>; } },
    {
      title: "", width: 60, align: "right",
      render: (_, r) => (
        <Tooltip title="Xóa khỏi giải">
          <Button danger size="small" icon={<DeleteOutlined />} onClick={() => handleRemove(r)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <Card
      size="small" style={{ marginBottom: 16 }}
      title={<span><TeamOutlined /> Người chơi ({participants.length})</span>}
      extra={
        <Space wrap>
          {isDoubles && participants.length > 0 && (
            <Tag color={unpaired > 0 ? "warning" : "success"} style={{ margin: 0 }}>
              {unpaired > 0 ? `${unpaired} chưa có đội` : "Đã ghép đội đủ"}
            </Tag>
          )}
          <Button type="primary" size="small" icon={<UserAddOutlined />} onClick={() => setAddOpen(true)}>Thêm người chơi</Button>
        </Space>
      }>
      {participants.length === 0 ? (
        <Empty description="Chưa có người chơi — bấm Thêm người chơi" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAddOpen(true)}>Thêm người chơi</Button>
        </Empty>
      ) : (
        <ResponsiveTable
          columns={columns} dataSource={participants} rowKey="id" size="small" pagination={false}
          mobileTitle={(r) => (
            <span>
              {teamLabel(r)}
              {isDoubles && isSingleParticipant(r) && <Tag color="warning" style={{ marginLeft: 6 }}>Chưa có đội</Tag>}
            </span>
          )}
          mobileHideColumns={["Đội / Người chơi", "Người chơi"]}
        />
      )}
      {addOpen && (
        <AddParticipantsModal
          tournament={tournament}
          onAdded={onChanged}
          onClose={() => setAddOpen(false)}
        />
      )}
    </Card>
  );
}

const SCORE_OPTIONS = Array.from({ length: 100 }, (_, i) => ({ value: String(i).padStart(2, "0") }));

function ScoreInput({ value, onChange }) {
  const [text, setText] = useState(String(value ?? 0));

  // Đồng bộ buffer text cục bộ khi prop `value` đổi từ bên ngoài (vd reset form) — đây là
  // 1 trong số ít trường hợp React khuyến nghị dùng effect ("Adjusting state when a prop
  // changes"), không phải derived-state anti-pattern; state vẫn cần editable độc lập với
  // prop trong lúc người dùng gõ nên không dùng key để remount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setText(String(value ?? 0)); }, [value]);

  const commit = (v) => {
    const n = Math.max(0, parseInt(v, 10) || 0);
    setText(String(n));
    onChange(n);
  };

  return (
    <AutoComplete
      value={text}
      options={SCORE_OPTIONS}
      onChange={setText}
      onFocus={() => setText("")}
      onSelect={commit}
      onBlur={() => (text === "" ? setText(String(value ?? 0)) : commit(text))}
      filterOption={(input, option) => !input || option.value.includes(input)}
      style={{ width: "100%", maxWidth: 120 }}
    >
      <Input size="large" inputMode="numeric" style={{ textAlign: "center", fontSize: 18 }} />
    </AutoComplete>
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, margin: "24px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, flex: "1 1 0", minWidth: 0 }}>
          <Text strong style={{ fontSize: 15, textAlign: "center" }}>{p1Name}</Text>
          {teamRank(match?.p1) && <Tag color="purple">{teamRank(match.p1)}</Tag>}
          <ScoreInput value={s1} onChange={setS1} />
        </div>
        <Text style={{ fontSize: 20, color: "#999" }}>–</Text>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, flex: "1 1 0", minWidth: 0 }}>
          <Text strong style={{ fontSize: 15, textAlign: "center" }}>{p2Name}</Text>
          {teamRank(match?.p2) && <Tag color="purple">{teamRank(match.p2)}</Tag>}
          <ScoreInput value={s2} onChange={setS2} />
        </div>
      </div>
    </Modal>
  );
}

// ── Bracket knockout ─────────────────────────────────────
function KnockoutBracket({ matches, onScoreClick }) {
  const { isMobileView } = useViewMode();
  // Trận "Tranh giải 3" đi theo đường thua (loser_next_match_id), không phải cây thắng chính —
  // tách riêng để không lẫn vào cùng cột với Chung kết (cả hai có cùng round_number).
  const thirdPlace = matches.find(m => m.round_name === "Tranh giải 3");
  const mainMatches = thirdPlace ? matches.filter(m => m.id !== thirdPlace.id) : matches;
  const rounds = [...new Set(mainMatches.map(m => m.round_number))].sort((a, b) => a - b);

  // Mobile: Collapse theo từng vòng (dọc) — cây nhánh có đường nối chỉ hợp lý ở màn hình
  // rộng, trên di động giữ danh sách thẻ theo vòng như cũ (đọc dọc tự nhiên hơn khi cuộn).
  if (isMobileView) {
    return (
      <>
        <Collapse
          defaultActiveKey={rounds.map(String)}
          items={rounds.map(r => {
            const rMatches = mainMatches.filter(m => m.round_number === r);
            const rName = rMatches[0]?.round_name || `Vòng ${r}`;
            const done = rMatches.filter(m => m.status === "completed").length;
            return {
              key: String(r),
              label: <Text strong style={{ color: "#1677ff" }}>{rName} ({done}/{rMatches.length})</Text>,
              children: (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {rMatches.map(m => <BracketCard key={m.id} match={m} onScoreClick={onScoreClick} />)}
                </div>
              ),
            };
          })}
        />
        {thirdPlace && (
          <Card size="small" style={{ marginTop: 12 }} title={<Text strong style={{ color: "#d48806" }}>Tranh giải 3</Text>}>
            <BracketCard match={thirdPlace} onScoreClick={onScoreClick} />
          </Card>
        )}
      </>
    );
  }

  // Desktop: sơ đồ nhánh thật với đường nối giữa các vòng
  return <BracketTreeDesktop matches={matches} onScoreClick={onScoreClick} />;
}

// ── Sơ đồ nhánh trên màn hình — cùng logic hình học với bảng in (bracketLayout.js),
// khác style: full tên đội (bọc 2 dòng thay vì cắt "..."), bấm vào ô để nhập điểm luôn.
const TREE_BOX_W = 232;
const TREE_COL_GAP = 56;
const TREE_BOX_H = 78;
const TREE_HEADER_H = 34;

function treeNodeLabels(node) {
  const m = node.match;
  const topLabel = m.p1_id ? teamLabel(m.p1) : (node.feeders[0] ? `Thắng #${node.feeders[0].match_number}` : null);
  const bottomLabel = m.p2_id ? teamLabel(m.p2) : (node.feeders[1] ? `Thắng #${node.feeders[1].match_number}` : null);
  // Bye cấu trúc (1 bên trống thật, không phải bỏ giải) chỉ xảy ra ở vòng đầu — phân biệt
  // với is_walkover (2 bên đều là người thật, 1 bên bỏ giải) để không ẩn mất tên đối thủ.
  const isStructuralBye = m.status === "completed" && (!m.p1_id || !m.p2_id);
  return {
    top: isStructuralBye ? teamLabel(m.p1 || m.p2) : topLabel,
    bottom: bottomLabel,
    isBye: isStructuralBye,
    scored: m.status === "completed" && m.score1 != null,
  };
}

function TreeSlot({ label, rank, score, scored, isWalkover, isWinner, isPending, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      padding: "6px 10px", minHeight: 36,
      borderBottom: last ? "none" : "1px solid #eef0f2",
      borderLeft: isWinner ? "3px solid #52c41a" : "3px solid transparent",
      background: isWinner ? "#f6ffed" : "transparent",
    }}>
      <span style={{
        fontSize: 13, lineHeight: 1.25, fontWeight: isWinner ? 700 : 400,
        color: isPending ? "#aaa" : (isWinner ? "#237804" : "#141413"),
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        overflow: "hidden", wordBreak: "break-word",
      }}>
        {label || "Chờ kết quả"}
        {rank && <Tag color="purple" style={{ marginLeft: 4, fontSize: 10, lineHeight: "14px", padding: "0 4px" }}>{rank}</Tag>}
      </span>
      <span style={{
        flex: "none", minWidth: 26, height: 22, borderRadius: 4, textAlign: "center", lineHeight: "22px",
        fontSize: isWalkover ? 10 : 13, fontWeight: 700,
        background: isWalkover ? "#fffbe6" : "#f5f5f5", color: isWalkover ? "#ad6800" : "#141413",
        border: isWalkover ? "1px solid #ffe58f" : "1px solid #eee",
      }}>
        {isWalkover ? "XT" : (scored ? score : "–")}
      </span>
    </div>
  );
}

function ThirdPlaceTreeBox({ info, onScoreClick }) {
  const { match: m, feeders } = info;
  const nameFor = (side) => {
    const pid = side === 1 ? m.p1_id : m.p2_id;
    if (pid) return teamLabel(side === 1 ? m.p1 : m.p2);
    const feeder = feeders.find((f) => f.loser_next_match_slot === side);
    return feeder ? `Thua #${feeder.match_number}` : null;
  };
  const scored = m.status === "completed" && m.score1 != null;
  const clickable = !!onScoreClick && !!m.p1_id && !!m.p2_id;
  return (
    <div
      onClick={clickable ? () => onScoreClick(m) : undefined}
      style={{ border: "1.5px solid #ffe58f", borderRadius: 8, background: "#fff", cursor: clickable ? "pointer" : "default" }}
    >
      <TreeSlot label={nameFor(1)} rank={teamRank(m.p1)} score={m.score1} scored={scored}
        isWalkover={m.is_walkover} isWinner={scored && m.winner_id === m.p1_id} isPending={!m.p1_id} />
      <TreeSlot label={nameFor(2)} rank={teamRank(m.p2)} score={m.score2} scored={scored}
        isWalkover={m.is_walkover} isWinner={scored && m.winner_id === m.p2_id} isPending={!m.p2_id} last />
    </div>
  );
}

function BracketTreeDesktop({ matches, onScoreClick }) {
  const roundsNodes = buildRealBracketNodes(matches);
  if (!roundsNodes.length) return null;
  const thirdPlaceInfo = findThirdPlaceMatch(matches);
  const { centers, totalHeight } = computeBracketGeometry(roundsNodes, { boxHeight: TREE_BOX_H, minGap: 30 });
  const treeWidth = roundsNodes.length * (TREE_BOX_W + TREE_COL_GAP) + 190; // +190 cho ô "Vô địch"

  const lines = [];
  roundsNodes.forEach((round, r) => {
    if (r === 0) return;
    const xEnd = r * (TREE_BOX_W + TREE_COL_GAP);
    const xStart = xEnd - TREE_COL_GAP;
    const xMid = xStart + TREE_COL_GAP / 2;
    round.forEach((node) => {
      const [a, b] = node.feederIds || [];
      if (a == null || b == null) return;
      const ya = centers[a], yb = centers[b], yMid = centers[node.id];
      lines.push(<path key={`${node.id}-l`} d={`M${xStart},${ya} H${xMid} V${yb} M${xStart},${yb} H${xMid} M${xMid},${yMid} H${xEnd}`} />);
    });
  });
  const finalRound = roundsNodes[roundsNodes.length - 1];
  const finalId = finalRound[0]?.id;
  const finalY = finalId != null ? centers[finalId] : totalHeight / 2;
  const champX = roundsNodes.length * (TREE_BOX_W + TREE_COL_GAP);
  if (finalId != null) lines.push(<path key="champ" d={`M${champX - TREE_COL_GAP},${finalY} H${champX}`} />);

  const finalMatch = finalRound?.[0]?.match;
  const championName = finalMatch?.status === "completed" && finalMatch.winner_id
    ? teamLabel(finalMatch.winner_id === finalMatch.p1_id ? finalMatch.p1 : finalMatch.p2)
    : null;
  const champBoxTop = finalY - 36 + TREE_HEADER_H;

  return (
    <div style={{ overflowX: "auto", paddingBottom: 8 }}>
      <div style={{ position: "relative", width: treeWidth, height: totalHeight + TREE_HEADER_H + 16 }}>
        {roundsNodes.map((round, i) => {
          const done = round.filter(n => n.match.status === "completed").length;
          return (
            <div key={i} style={{ position: "absolute", left: i * (TREE_BOX_W + TREE_COL_GAP), top: 0, width: TREE_BOX_W }}>
              <Text strong style={{ display: "block", color: "#1677ff", fontSize: 12.5, letterSpacing: ".03em", textTransform: "uppercase" }}>
                {round[0]?.match?.round_name || `Vòng ${i + 1}`}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>{done}/{round.length} đã đấu</Text>
            </div>
          );
        })}
        <div style={{ position: "absolute", left: champX, top: 0, width: 160 }}>
          <Text strong style={{ display: "block", color: "#d48806", fontSize: 12.5, letterSpacing: ".03em", textTransform: "uppercase" }}>
            <TrophyOutlined /> Vô địch
          </Text>
        </div>
        <svg width={treeWidth} height={totalHeight} style={{ position: "absolute", left: 0, top: TREE_HEADER_H }} stroke="#c1c7cd" strokeWidth="2" fill="none">
          {lines}
        </svg>
        {roundsNodes.map((round, r) =>
          round.map((node) => {
            const m = node.match;
            const c = treeNodeLabels(node);
            const y = centers[node.id] - TREE_BOX_H / 2 + TREE_HEADER_H;
            const x = r * (TREE_BOX_W + TREE_COL_GAP);
            if (c.isBye) {
              return (
                <div key={node.id} style={{
                  position: "absolute", left: x, top: y, width: TREE_BOX_W, minHeight: TREE_BOX_H,
                  border: "1.5px dashed #d9d9d9", borderRadius: 8, background: "#fafafa",
                  display: "flex", alignItems: "center", padding: "0 10px", gap: 6,
                }}>
                  <Text style={{ fontSize: 12.5, color: "#888" }}>{c.top}</Text>
                  <Text type="secondary" style={{ fontSize: 10.5 }}>(miễn — vào vòng sau)</Text>
                </div>
              );
            }
            const clickable = !!onScoreClick && !!m.p1_id && !!m.p2_id;
            return (
              <div
                key={node.id}
                onClick={clickable ? () => onScoreClick(m) : undefined}
                style={{
                  position: "absolute", left: x, top: y, width: TREE_BOX_W,
                  border: `1.5px solid ${m.status === "completed" ? "#b7eb8f" : "#d9d9d9"}`,
                  borderRadius: 8, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                  cursor: clickable ? "pointer" : "default",
                }}
              >
                <Text style={{ position: "absolute", right: 8, top: -18, fontSize: 10.5, color: "#aaa" }}>#{m.match_number}</Text>
                <TreeSlot label={c.top} rank={teamRank(m.p1)} score={m.score1} scored={c.scored}
                  isWalkover={m.is_walkover} isWinner={c.scored && m.winner_id === m.p1_id} isPending={!m.p1_id} />
                <TreeSlot label={c.bottom} rank={teamRank(m.p2)} score={m.score2} scored={c.scored}
                  isWalkover={m.is_walkover} isWinner={c.scored && m.winner_id === m.p2_id} isPending={!m.p2_id} last />
              </div>
            );
          })
        )}
        {thirdPlaceInfo && (
          <div style={{ position: "absolute", left: champX, top: champBoxTop + 78, width: 200 }}>
            <Text strong style={{ display: "block", color: "#d48806", fontSize: 11.5, letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 4 }}>
              Tranh giải 3
            </Text>
            <ThirdPlaceTreeBox info={thirdPlaceInfo} onScoreClick={onScoreClick} />
          </div>
        )}
        <div style={{
          position: "absolute", left: champX, top: champBoxTop, width: 160, minHeight: 66,
          border: "2px solid #d4b106", borderRadius: 8, background: "#fffbe6",
          display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 2, padding: "8px 10px",
        }}>
          <TrophyOutlined style={{ color: "#d4b106", fontSize: 18 }} />
          <Text strong style={{ fontSize: 12.5, textAlign: "center", color: "#874d00" }}>{championName || "Chưa xác định"}</Text>
        </div>
      </div>
    </div>
  );
}

// ── Lịch thi đấu tách theo vòng ───────────────────────────
function RoundedSchedule({ matches, columns, mobileProps }) {
  // Tách trận "Tranh giải 3" ra khỏi vòng cuối — nó dùng chung round_number với Chung kết
  // (do cùng là vòng cuối cùng của bracket) nên cần nhóm riêng để không bị gộp nhãn sai.
  const thirdPlace = matches.find(m => m.round_name === "Tranh giải 3");
  const mainMatches = thirdPlace ? matches.filter(m => m.id !== thirdPlace.id) : matches;
  const rounds = [...new Set(mainMatches.map(m => m.round_number))].sort((a, b) => a - b);
  const roundCols = columns.filter(c => c.dataIndex !== "round_name");
  const groups = rounds.map(r => ({
    key: String(r),
    rMatches: mainMatches.filter(m => m.round_number === r),
  }));
  if (thirdPlace) groups.push({ key: "third-place", rMatches: [thirdPlace] });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {groups.map(({ key, rMatches }) => {
        const rName = rMatches[0]?.round_name || `Vòng ${key}`;
        const done = rMatches.filter(m => m.status === "completed").length;
        return (
          <Card
            key={key}
            size="small"
            title={<Text strong style={{ color: key === "third-place" ? "#d48806" : "#1677ff" }}>{rName}</Text>}
            extra={<Tag color={done === rMatches.length ? "success" : "default"}>{done}/{rMatches.length}</Tag>}
          >
            <ResponsiveTable
              columns={roundCols}
              dataSource={rMatches}
              rowKey="id" size="small" pagination={false}
              {...mobileProps}
            />
          </Card>
        );
      })}
    </div>
  );
}

function BracketCard({ match, onScoreClick }) {
  const p1 = teamLabel(match?.p1) || (match?.p1_id ? "?" : "BYE");
  const p2 = teamLabel(match?.p2) || (match?.p2_id ? "?" : "BYE");
  const done = match.status === "completed";
  const w = match.winner_id;
  const clickable = !!onScoreClick && !!match?.p1_id && !!match?.p2_id;
  const cell = (score) => {
    if (!done) return "–";
    if (match.is_walkover) return <Text style={{ fontSize: 11, color: "#d48806" }}>XT</Text>;
    return score;
  };

  return (
    <Card
      size="small"
      hoverable={clickable}
      onClick={clickable ? () => onScoreClick(match) : undefined}
      style={{ borderRadius: 8, borderColor: done ? "#52c41a" : "#d9d9d9", cursor: clickable ? "pointer" : "default" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
        <Text style={{ fontWeight: w === match.p1_id ? 700 : 400, color: w === match.p1_id ? "#52c41a" : "inherit", fontSize: 13 }}>
          {p1}
        </Text>
        <Text style={{ minWidth: 24, textAlign: "center", fontWeight: 700, flex: "none" }}>
          {cell(match.score1)}
        </Text>
      </div>
      <Divider style={{ margin: "4px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={{ fontWeight: w === match.p2_id ? 700 : 400, color: w === match.p2_id ? "#52c41a" : "inherit", fontSize: 13 }}>
          {p2}
        </Text>
        <Text style={{ minWidth: 24, textAlign: "center", fontWeight: 700, flex: "none" }}>
          {cell(match.score2)}
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
  const { unranked } = useRankLevels();
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
      const res = await playersApi.create({ name: vals.name, phone: vals.phone || null, rank: vals.rank || unranked });
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
                <QuickGuestForm form={guestForm} loading={addingGuest} onAdd={handleAddGuest} />
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

// ── Sửa cài đặt giải (chỉ khi Nháp) — chỉ thể thức ───────────
function EditSetupModal({ tournament, onSaved, onClose }) {
  // Chỉ còn cài đặt thể thức — danh sách / thêm người chơi đã chuyển sang ParticipantsPanel trên trang giải
  const [form] = Form.useForm();
  const [format, setFormat] = useState(tournament.format);
  const [saving, setSaving] = useState(false);

  const handleSaveConfig = async () => {
    const vals = await form.validateFields();
    setSaving(true);
    try {
      await tournamentsApi.update(tournament.id, {
        format: vals.format,
        num_groups: vals.format === "combined" ? (vals.num_groups || 2) : undefined,
        third_place_enabled: (vals.format === "knockout" || vals.format === "combined") ? !!vals.third_place_enabled : false,
      });
      message.success("Đã lưu cấu hình");
      await onSaved();
      onClose();
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể lưu cấu hình");
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Sửa cài đặt thể thức" open onCancel={onClose} width={560}
      footer={
        <Space>
          <Button onClick={onClose}>Đóng</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveConfig}>Lưu</Button>
        </Space>
      }>
      <Form form={form} layout="vertical"
        initialValues={{ format: tournament.format, num_groups: tournament.num_groups, third_place_enabled: tournament.third_place_enabled }}>
        <Form.Item name="format" label="Thể thức thi đấu">
          <Select onChange={setFormat}>
            {Object.entries(FORMAT_MAP).map(([k, v]) => (
              <Select.Option key={k} value={k}><Tag color={v.color}>{v.label}</Tag></Select.Option>
            ))}
          </Select>
        </Form.Item>
        {format === "combined" && (
          <Form.Item name="num_groups" label="Số bảng">
            <InputNumber min={2} max={8} style={{ width: 120 }} />
          </Form.Item>
        )}
        {(format === "knockout" || format === "combined") && (
          <Form.Item name="third_place_enabled" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>Có trận tranh giải 3 <Text type="secondary" style={{ fontSize: 12 }}>(cần ít nhất 4 đội)</Text></Checkbox>
          </Form.Item>
        )}
      </Form>
      <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
        Thêm / xoá người chơi ở khung "Người chơi" trên trang giải.
      </Text>
    </Modal>
  );
}

// ── Đặt/Đổi mã PIN nhập điểm public ───────────────────────
function ScorePinModal({ tournament, onSaved, onClose }) {
  const [enabled, setEnabled] = useState(tournament.public_scoring_enabled);
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  const pinInvalid = pin.length > 0 && !/^\d{4}$/.test(pin);
  const needsNewPin = enabled && !tournament.has_score_pin && !pin;

  const handleSave = async () => {
    if (pinInvalid) { message.error("Mã PIN phải gồm đúng 4 chữ số"); return; }
    if (needsNewPin) { message.error("Chưa có mã PIN — vui lòng nhập mã PIN mới"); return; }
    setSaving(true);
    try {
      await tournamentsApi.updateScorePin(tournament.id, { enabled, pin: pin || null });
      message.success("Đã lưu cấu hình mã PIN");
      onSaved();
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể lưu cấu hình mã PIN");
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Đặt/Đổi mã PIN nhập điểm qua public" open onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>Lưu</Button>
        </Space>
      }>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Cho phép nhập điểm qua trang public</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Người xem trang public nhập đúng mã PIN sẽ được phép nhập/sửa điểm trận đấu
          </Text>
        </div>
        <Switch checked={enabled} onChange={setEnabled} />
      </Row>
      <Form.Item
        label={tournament.has_score_pin ? "Đổi mã PIN (bỏ trống để giữ mã hiện tại)" : "Mã PIN (4 chữ số)"}
        validateStatus={pinInvalid ? "error" : ""}
        help={pinInvalid ? "Mã PIN phải gồm đúng 4 chữ số" : ""}
      >
        <Input
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder={tournament.has_score_pin ? "••••" : "VD: 2026"}
          maxLength={4} style={{ width: 160 }}
        />
      </Form.Item>
    </Modal>
  );
}

// ── Chi tiết giải đấu ─────────────────────────────────────
function TournamentDetail({ tournament: initData, onBack, onUpdated, autoOpenAdd = false }) {
  const { isMobileView } = useViewMode();
  const [tournament, setTournament] = useState(initData);
  const [scoreMatch, setScoreMatch] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [startingKO, setStartingKO] = useState(false);
  const [editNameModal, setEditNameModal] = useState(false);
  const [editForm] = Form.useForm();
  const [replaceTarget, setReplaceTarget] = useState(null); // { participant, slot: "main"|"partner" }
  const [editSetupModal, setEditSetupModal] = useState(false);
  const [scorePinModal, setScorePinModal] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Bốc thăm bằng vòng quay: phiên hiện tại (DrawOut), overlay đang mở, đang gọi API, lệch giờ server
  const [draw, setDraw] = useState(null);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawBusy, setDrawBusy] = useState(false);
  const [drawOffset, setDrawOffset] = useState(0);

  // Nhận DrawOut từ API và đồng bộ lệch giờ server (mốc dừng kim tính theo giờ server)
  const applyDraw = useCallback((d) => {
    setDraw(d);
    if (d?.server_now_ms) setDrawOffset(serverOffset(d.server_now_ms));
  }, []);

  useEffect(() => {
    if (!printing) return;
    const onAfterPrint = () => setPrinting(false);
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, [printing]);
  const handlePrintReady = useCallback(() => {
    // Đợi 1 tick để React commit xong nội dung trước khi mở hộp thoại in
    setTimeout(() => window.print(), 30);
  }, []);

  const reload = useCallback(async () => {
    const r = await tournamentsApi.get(tournament.id);
    setTournament(r.data);
    onUpdated && onUpdated(r.data);
  }, [tournament.id, onUpdated]);

  // Khôi phục phiên bốc thăm đang dở sau F5: TournamentOut chỉ có tóm tắt, cần nạp DrawOut đầy đủ
  const openDrawSummary = tournament.draw?.status === "open" ? tournament.draw : null;
  const openDrawId = openDrawSummary?.id ?? null;
  const drawRef = useRef(null);
  // Đồng bộ ref trong effect (không gán trong render — rule react-hooks/refs); effect này chạy trước effect nạp bên dưới
  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => {
    // Đã có bản local cùng id (vừa mở phiên trong tab này) → không nạp lại để khỏi ghi đè lúc đang quay
    if (!openDrawId || drawRef.current?.id === openDrawId) return undefined;
    let cancelled = false;
    tournamentsApi.draw.get(tournament.id)
      .then((r) => { if (!cancelled && r.data?.status === "open") applyDraw(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [openDrawId, tournament.id, applyDraw]);

  // Phiên bị kết thúc ngoài luồng của tab này (tab khác chốt/huỷ, hoặc "Random & Sinh lịch" làm backend
  // tự huỷ phiên open) → sau reload() tóm tắt từ TournamentOut đổi trạng thái/id, bỏ bản local để banner
  // và overlay không còn trỏ vào phiên đã chết.
  const summaryDrawId = tournament.draw?.id ?? null;
  const summaryDrawStatus = tournament.draw?.status ?? null;
  useEffect(() => {
    const local = drawRef.current;
    if (!local) return;
    const ended = !summaryDrawId
      || (summaryDrawId === local.id && summaryDrawStatus !== "open")
      || summaryDrawId > local.id;
    if (ended) {
      setDraw(null);
      setDrawOpen(false);
    }
  }, [summaryDrawId, summaryDrawStatus]);

  // ── Phiên GHÉP ĐỘI ĐÔI bằng vòng quay (giải đôi, Nháp) — cùng cơ chế với phiên cặp đấu nhưng state riêng ──
  const [partnerDraw, setPartnerDraw] = useState(null);          // PartnerDrawOut
  const [partnerDrawOpen, setPartnerDrawOpen] = useState(false); // overlay đang mở
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerOffset, setPartnerOffset] = useState(0);
  const [partnerSetupModal, setPartnerSetupModal] = useState(false); // chỉnh quy tắc + thời gian quay trước khi mở phiên
  const [pairModal, setPairModal] = useState(false);                 // ghép tay người đơn lẻ

  const applyPartnerDraw = useCallback((d) => {
    setPartnerDraw(d);
    if (d?.server_now_ms) setPartnerOffset(serverOffset(d.server_now_ms));
  }, []);

  // Khôi phục phiên ghép đội đang dở sau F5 (TournamentOut chỉ có tóm tắt partner_draw)
  const openPartnerSummary = tournament.partner_draw?.status === "open" ? tournament.partner_draw : null;
  const openPartnerId = openPartnerSummary?.id ?? null;
  const partnerRef = useRef(null);
  useEffect(() => { partnerRef.current = partnerDraw; }, [partnerDraw]);
  useEffect(() => {
    if (!openPartnerId || partnerRef.current?.id === openPartnerId) return undefined;
    let cancelled = false;
    tournamentsApi.partnerDraw.get(tournament.id)
      .then((r) => { if (!cancelled && r.data?.status === "open") applyPartnerDraw(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [openPartnerId, tournament.id, applyPartnerDraw]);

  // Phiên ghép đội kết thúc ở tab khác (chốt/huỷ) → sau reload() bỏ bản local để banner/overlay không trỏ phiên đã chết
  const summaryPartnerId = tournament.partner_draw?.id ?? null;
  const summaryPartnerStatus = tournament.partner_draw?.status ?? null;
  useEffect(() => {
    const local = partnerRef.current;
    if (!local) return;
    const ended = !summaryPartnerId
      || (summaryPartnerId === local.id && summaryPartnerStatus !== "open")
      || summaryPartnerId > local.id;
    if (ended) {
      setPartnerDraw(null);
      setPartnerDrawOpen(false);
    }
  }, [summaryPartnerId, summaryPartnerStatus]);

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
    // Đã có trận có kết quả → backend yêu cầu force=true; cảnh báo rõ trước khi xoá kết quả
    const scored = (tournament.matches || []).filter((m) => m.score1 != null).length;
    const ok = await confirm({
      title: scored ? "Sinh lại lịch và XOÁ toàn bộ kết quả?" : "Sinh lịch vòng bảng?",
      content: scored
        ? `Đã có ${scored} trận có kết quả. Sinh lại (${label}) sẽ xoá hết kết quả đã nhập. Không thể hoàn tác.`
        : `Ghép cặp: ${label}. Lịch cũ (nếu có) sẽ bị thay thế.`,
    });
    if (!ok) return;
    setGenerating(true);
    try {
      await tournamentsApi.generate(tournament.id, shuffle, scored > 0);
      // Backend tự huỷ phiên bốc thăm đang mở khi sinh lịch thủ công → bỏ bản local
      setDraw(null); setDrawOpen(false);
      await reload();
      message.success("Đã tạo lịch thi đấu!");
    } finally { setGenerating(false); }
  };

  // ── Bốc thăm bằng vòng quay ──────────────────────────────
  const scoredCount = () => (tournament.matches || []).filter((m) => m.score1 != null).length;

  const handleOpenDraw = async () => {
    const scored = scoredCount();
    const ok = await confirm({
      title: "Mở phiên bốc thăm bằng vòng quay?",
      content: (
        <div>
          <p style={{ marginBottom: 6 }}>{DRAW_RULE_TEXT[tournament.format]}</p>
          <p style={{ marginBottom: 6 }}>
            Đội đã bỏ giải vẫn nằm trong vòng quay (đánh dấu "bỏ giải"). Kết quả từng lượt được công bố
            công khai kèm mã seed để khán giả kiểm chứng.
          </p>
          {scored > 0 && (
            <Alert type="warning" showIcon style={{ marginTop: 8 }}
              message={`Đã có ${scored} trận có kết quả. Khi chốt bốc thăm, toàn bộ kết quả sẽ bị xoá. Không thể hoàn tác.`} />
          )}
        </div>
      ),
      okButtonProps: scored > 0 ? { danger: true } : undefined,
    });
    if (!ok) return;
    setDrawBusy(true);
    try {
      const res = await tournamentsApi.draw.open(tournament.id, { force: scored > 0, reveal_ms: 5000 });
      applyDraw(res.data);
      setDrawOpen(true);
    } catch (e) {
      if (e?.response?.status === 409) {
        // Đã có phiên đang mở (tab khác / F5) → nạp phiên đó và tiếp tục
        try {
          const r = await tournamentsApi.draw.get(tournament.id);
          applyDraw(r.data);
          setDrawOpen(true);
          message.info("Đang có phiên bốc thăm chưa kết thúc — tiếp tục phiên đó.");
        } catch (e2) {
          message.error(e2?.response?.data?.detail || "Không thể tải phiên bốc thăm");
        }
      } else {
        message.error(e?.response?.data?.detail || "Không thể mở phiên bốc thăm");
      }
    } finally { setDrawBusy(false); }
  };

  const handleResumeDraw = async () => {
    // Banner "Tiếp tục": bản local có thể chưa nạp xong → lấy lại từ server rồi mở overlay
    setDrawBusy(true);
    try {
      const r = await tournamentsApi.draw.get(tournament.id);
      if (r.data?.status !== "open") {
        // Phiên đã được chốt/huỷ ở tab khác → đồng bộ lại trang thay vì mở overlay của phiên đã kết thúc
        setDraw(null); setDrawOpen(false);
        message.info("Phiên bốc thăm đã kết thúc ở nơi khác — đã tải lại giải đấu");
        await reload();
        return;
      }
      applyDraw(r.data);
      setDrawOpen(true);
    } catch (e) {
      message.error(e?.response?.data?.detail || "Không thể tải phiên bốc thăm");
    } finally { setDrawBusy(false); }
  };

  const handleDrawSpin = async () => {
    if (!draw) return;
    setDrawBusy(true);
    try {
      const res = await tournamentsApi.draw.spin(tournament.id, draw.done_steps);
      applyDraw(res.data);
    } catch (e) {
      if (e?.response?.status === 409) {
        // Lệch lượt (bấm trùng / tab khác đã quay) → đồng bộ lại theo server
        message.warning(e?.response?.data?.detail || "Lượt bốc không khớp — đã đồng bộ lại");
        try {
          const r = await tournamentsApi.draw.get(tournament.id);
          applyDraw(r.data);
        } catch { /* giữ bản local */ }
      } else {
        message.error(e?.response?.data?.detail || "Không thể quay lượt này");
      }
    } finally { setDrawBusy(false); }
  };

  const handleDrawCommit = async () => {
    const doCommit = async (force) => {
      const res = await tournamentsApi.draw.commit(tournament.id, force);
      setTournament(res.data);
      setDraw(null);
      setDrawOpen(false);
      message.success("Đã chốt bốc thăm và sinh lịch thi đấu!");
      onUpdated && onUpdated(res.data);
    };
    setDrawBusy(true);
    try {
      await doCommit(scoredCount() > 0);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 400 && typeof detail === "string" && detail.includes("force")) {
        // Có điểm mới nhập sau khi mở phiên → hỏi lại rồi gửi force=true
        const ok = await confirm({
          title: "Chốt bốc thăm và XOÁ kết quả đã nhập?",
          content: detail,
          okButtonProps: { danger: true }, okText: "Xoá kết quả & chốt",
        });
        if (ok) {
          try { await doCommit(true); }
          catch (e2) { message.error(e2?.response?.data?.detail || "Không thể chốt bốc thăm"); }
        }
      } else {
        message.error(detail || "Không thể chốt bốc thăm");
      }
    } finally { setDrawBusy(false); }
  };

  const handleDrawCancel = async () => {
    const ok = await confirm({
      title: "Huỷ phiên bốc thăm?",
      content: "Kết quả các lượt đã quay sẽ không được dùng. Phiên vẫn hiện trong lịch sử.",
      okButtonProps: { danger: true }, okText: "Huỷ phiên",
    });
    if (!ok) return;
    setDrawBusy(true);
    try {
      await tournamentsApi.draw.cancel(tournament.id);
      setDraw(null);
      setDrawOpen(false);
      await reload();
      message.success("Đã huỷ phiên bốc thăm");
    } catch (e) {
      message.error(e?.response?.data?.detail || "Không thể huỷ phiên bốc thăm");
    } finally { setDrawBusy(false); }
  };

  // ── Ghép đội đôi bằng vòng quay ──────────────────────────
  // Nạp phiên đang mở từ server (409 khi mở trùng / banner Tiếp tục); trả false nếu phiên không còn open
  const loadOpenPartnerDraw = async () => {
    const r = await tournamentsApi.partnerDraw.get(tournament.id);
    if (r.data?.status !== "open") return false;
    applyPartnerDraw(r.data);
    setPartnerDrawOpen(true);
    return true;
  };

  // Bước 1: mở modal chỉnh quy tắc/thời gian; bước 2 (handleSubmitPartnerDraw): gọi API mở phiên
  const handleOpenPartnerDraw = () => setPartnerSetupModal(true);

  const handleSubmitPartnerDraw = async (rules, revealMs) => {
    setPartnerBusy(true);
    try {
      const res = await tournamentsApi.partnerDraw.open(tournament.id, { rules, reveal_ms: revealMs });
      setPartnerSetupModal(false);
      applyPartnerDraw(res.data);
      setPartnerDrawOpen(true);
      // partner_rules của giải đã đổi theo phiên → đồng bộ nhẹ (không chặn overlay)
      reload().catch(() => {});
    } catch (e) {
      if (e?.response?.status === 409) {
        // Đã có phiên đang mở (tab khác / F5) → nạp phiên đó và tiếp tục
        try {
          setPartnerSetupModal(false);
          if (await loadOpenPartnerDraw()) message.info("Đang có phiên ghép đội chưa kết thúc — tiếp tục phiên đó.");
          else message.error(e?.response?.data?.detail || "Không thể mở phiên ghép đội");
        } catch (e2) {
          message.error(e2?.response?.data?.detail || "Không thể tải phiên ghép đội");
        }
      } else {
        message.error(e?.response?.data?.detail || "Không thể mở phiên ghép đội");
      }
    } finally { setPartnerBusy(false); }
  };

  const handleResumePartnerDraw = async () => {
    setPartnerBusy(true);
    try {
      if (!(await loadOpenPartnerDraw())) {
        setPartnerDraw(null); setPartnerDrawOpen(false);
        message.info("Phiên ghép đội đã kết thúc ở nơi khác — đã tải lại giải đấu");
        await reload();
      }
    } catch (e) {
      message.error(e?.response?.data?.detail || "Không thể tải phiên ghép đội");
    } finally { setPartnerBusy(false); }
  };

  const handlePartnerSpin = async () => {
    if (!partnerDraw) return;
    setPartnerBusy(true);
    try {
      const res = await tournamentsApi.partnerDraw.spin(tournament.id, partnerDraw.done_steps);
      applyPartnerDraw(res.data);
    } catch (e) {
      if (e?.response?.status === 409) {
        // Lệch lượt (bấm trùng / tab khác đã quay) → đồng bộ lại theo server
        message.warning(e?.response?.data?.detail || "Lượt bốc không khớp — đã đồng bộ lại");
        try {
          const r = await tournamentsApi.partnerDraw.get(tournament.id);
          applyPartnerDraw(r.data);
        } catch { /* giữ bản local */ }
      } else {
        message.error(e?.response?.data?.detail || "Không thể quay lượt này");
      }
    } finally { setPartnerBusy(false); }
  };

  const handlePartnerCommit = async () => {
    setPartnerBusy(true);
    try {
      const res = await tournamentsApi.partnerDraw.commit(tournament.id);
      setTournament(res.data);
      setPartnerDraw(null);
      setPartnerDrawOpen(false);
      message.success("Đã chốt ghép đội!");
      onUpdated && onUpdated(res.data);
    } catch (e) {
      message.error(e?.response?.data?.detail || "Không thể chốt ghép đội");
    } finally { setPartnerBusy(false); }
  };

  const handlePartnerCancel = async () => {
    const ok = await confirm({
      title: "Huỷ phiên ghép đội?",
      content: "Kết quả các lượt đã quay sẽ không được dùng. Phiên vẫn hiện trong biên bản công khai.",
      okButtonProps: { danger: true }, okText: "Huỷ phiên",
    });
    if (!ok) return;
    setPartnerBusy(true);
    try {
      await tournamentsApi.partnerDraw.cancel(tournament.id);
      setPartnerDraw(null);
      setPartnerDrawOpen(false);
      await reload();
      message.success("Đã huỷ phiên ghép đội");
    } catch (e) {
      message.error(e?.response?.data?.detail || "Không thể huỷ phiên ghép đội");
    } finally { setPartnerBusy(false); }
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

  const handleWithdraw = async (p) => {
    const ok = await confirm({
      title: "Xử bỏ giải?",
      content: (
        <div>
          <b>{p.team_name || teamLabel(p)}</b> sẽ bị đánh dấu bỏ giải — không thể hoàn tác.
          Các trận chưa đấu còn lại của đội này sẽ tự động xử thắng cho đối thủ
          (không tính vào hiệu số). Các trận đã đấu giữ nguyên kết quả.
        </div>
      ),
      okButtonProps: { danger: true }, okText: "Xử bỏ giải",
    });
    if (!ok) return;
    try {
      await tournamentsApi.withdraw(tournament.id, p.id);
      await reload();
      message.success("Đã xử bỏ giải");
    } catch (e) {
      message.error(e?.response?.data?.detail || "Không thể xử bỏ giải");
    }
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
  // Bốc thăm chỉ cho thể thức combined/knockout/individual khi giải đã bắt đầu (vòng tròn: server 400, UI ẩn nút)
  const canDraw = tournament.status === "active" && DRAW_FORMATS.includes(fmt)
    && !(tournament.pairing_mode === "cross_rank" && (tournament.rank_rules || []).length > 0);
  // Phiên đang mở: ưu tiên bản DrawOut local (đầy đủ), fallback tóm tắt từ TournamentOut (trước khi nạp xong)
  const pendingDraw = draw?.status === "open" ? draw : openDrawSummary;
  const pendingPartnerDraw = partnerDraw?.status === "open" ? partnerDraw : openPartnerSummary;
  // Giải đôi Nháp còn người chưa có đội → phải ghép (vòng quay / ghép tay) trước khi "Bắt đầu giải" (backend cũng chặn)
  const unpaired = tournament.unpaired_count || 0;
  const isDoublesDraft = tournament.status === "draft" && tournament.team_type === "doubles";
  // Chặn "Bắt đầu giải" (backend cũng chặn, cùng thứ tự): < 2 đội/người → còn người chưa có đội → phiên ghép đội đang mở
  const startBlockedReason = tournament.participants.length < 2
    ? "Cần ít nhất 2 đội/người chơi"
    : unpaired > 0
      ? `Còn ${unpaired} người chưa có đội`
      : (pendingPartnerDraw ? "Đang có phiên ghép đội chưa kết thúc" : null);
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
        const rank = teamRank(m.p1);
        return name !== "—"
          ? <span>{name} {rank && <Tag color="purple" style={{ marginLeft: 4 }}>{rank}</Tag>}</span>
          : <Text type="secondary">Chờ kết quả</Text>;
      },
    },
    {
      title: "Tỉ số", align: "center", width: 90,
      render: (_, m) => {
        if (m.is_walkover) return <Tag color="gold">Xử thắng</Tag>;
        return m.status === "completed"
          ? <b style={{ fontSize: 16 }}>{m.score1} – {m.score2}</b>
          : <Tag>Chưa đấu</Tag>;
      },
    },
    {
      title: "Đội 2",
      render: (_, m) => {
        const name = teamLabel(m.p2);
        const rank = teamRank(m.p2);
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
      let score;
      if (m.is_walkover) {
        score = <Tag color="gold" style={{ marginLeft: 4 }}>Xử thắng</Tag>;
      } else if (m.status === "completed") {
        score = <b style={{ color: "#1677ff" }}> {m.score1}–{m.score2}</b>;
      } else {
        score = <Tag style={{ marginLeft: 4 }}>Chưa đấu</Tag>;
      }
      return <span>{p1} vs {p2} {score}</span>;
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
          {
            title: "Đội", dataIndex: "team_name",
            render: (v, r) => (
              <span style={r.status === "withdrawn" ? { textDecoration: "line-through", color: "#999" } : undefined}>
                {v || teamLabel(r)}
              </span>
            ),
          },
          { title: "Bảng", dataIndex: "group_name", width: 70, render: v => v ? <Tag>{v}</Tag> : "—" },
          {
            title: "Trạng thái", dataIndex: "status", width: 110,
            render: (v, r) => {
              if (v === "withdrawn") return <Tag color="error">Đã bỏ giải</Tag>;
              // Giải đôi ở Nháp: người đơn lẻ chưa được ghép đội. Giải đã bắt đầu vẫn có thể có dữ liệu
              // cũ thiếu người 2 (tạo qua API) nhưng đã có lịch → không gắn "Chưa có đội" gây hiểu nhầm.
              if (tournament.status === "draft" && tournament.team_type === "doubles" && isSingleParticipant(r)) {
                return <Tag color="warning">Chưa có đội</Tag>;
              }
              return <Tag color="success">Đang thi đấu</Tag>;
            },
          },
          {
            title: "", width: 130, align: "right",
            render: (_, r) => (
              <Button size="small" icon={<UserAddOutlined />} disabled={r.status === "withdrawn"}
                onClick={() => setReplaceTarget({ participant: r, slot: "main" })}>
                Thay {r.member?.full_name || r.player?.name || "người 1"}
              </Button>
            ),
          },
          ...(tournament.team_type === "doubles" ? [{
            title: "", width: 130, align: "right",
            // Chưa có đồng đội → không có slot người 2 để thay
            render: (_, r) => !isSingleParticipant(r) && (
              <Button size="small" icon={<UserAddOutlined />} disabled={r.status === "withdrawn"}
                onClick={() => setReplaceTarget({ participant: r, slot: "partner" })}>
                Thay {r.partner?.full_name || r.partner_player?.name || "người 2"}
              </Button>
            ),
          }] : []),
          {
            title: "", width: 110, align: "right",
            render: (_, r) => (
              tournament.status === "active" && r.status !== "withdrawn" && (
                <Button size="small" danger onClick={() => handleWithdraw(r)}>Bỏ giải</Button>
              )
            ),
          },
        ]}
        dataSource={tournament.participants}
        rowKey="id" size="small" pagination={false}
        mobileTitle={(r) => (
          <span style={r.status === "withdrawn" ? { textDecoration: "line-through", color: "#999" } : undefined}>
            {r.team_name || teamLabel(r)} {r.group_name && <Tag style={{ marginLeft: 6 }}>{r.group_name}</Tag>}
            {r.status === "withdrawn" && <Tag color="error" style={{ marginLeft: 6 }}>Bỏ giải</Tag>}
            {tournament.status === "draft" && tournament.team_type === "doubles" && isSingleParticipant(r) && r.status !== "withdrawn" && (
              <Tag color="warning" style={{ marginLeft: 6 }}>Chưa có đội</Tag>
            )}
          </span>
        )}
        mobileHideColumns={["Đội", "Bảng", "Trạng thái"]}
      />
    ),
  });

  if (fmt === "round_robin" || fmt === "round_robin_double" || fmt === "individual") {
    tabItems.push({
      key: "schedule",
      label: `Lịch thi đấu (${doneCount}/${matches.length})`,
      children: <RoundedSchedule columns={matchTableCols} matches={matches} mobileProps={matchTableMobileProps} />,
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
      children: <KnockoutBracket matches={matches} onScoreClick={setScoreMatch} />,
    });
    tabItems.push({
      key: "schedule",
      label: `Danh sách trận (${doneCount}/${matches.length})`,
      children: <RoundedSchedule columns={matchTableCols} matches={matches} mobileProps={matchTableMobileProps} />,
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
            <KnockoutBracket matches={koMatches} onScoreClick={setScoreMatch} />
            <Divider />
            <RoundedSchedule columns={matchTableCols} matches={koMatches} mobileProps={matchTableMobileProps} />
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
          <Button size="small" icon={<EditOutlined />} onClick={() => setScorePinModal(true)}>
            Đặt/Đổi mã PIN
          </Button>
          {tournament.public_scoring_enabled
            ? <Tag color="success">Public: đang bật</Tag>
            : <Tag>Public: đang tắt</Tag>}
        </Space>
        <Space wrap>
          {tournament.status === "draft" && (
            <>
              <Button icon={<EditOutlined />} onClick={() => setEditSetupModal(true)}>Sửa cài đặt</Button>
              <Tooltip title={startBlockedReason}>
                <Button type="primary" icon={<ThunderboltOutlined />} disabled={!!startBlockedReason}
                  onClick={() => handleStatusChange("active")}>
                  Bắt đầu giải
                </Button>
              </Tooltip>
            </>
          )}
          {tournament.status === "active" && (
            <Button icon={<CheckCircleOutlined />} onClick={() => handleStatusChange("completed")}>
              Kết thúc giải
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={reload}>Làm mới</Button>
          {matches.length > 0 && (
            <Button icon={<PrinterOutlined />} loading={printing} onClick={() => setPrinting(true)}>
              In bảng thi đấu
            </Button>
          )}
          {tournament.status === "active" && (
            <>
              {canDraw && (
                <Button type="primary" icon={<GiftOutlined />} loading={drawBusy} onClick={handleOpenDraw}>
                  🎡 Bốc thăm
                </Button>
              )}
              {/* Khi có nút Bốc thăm, nút sinh lịch ngẫu nhiên lùi xuống type mặc định */}
              <Button type={canDraw ? "default" : "primary"} icon={<ThunderboltOutlined />} loading={generating}
                onClick={() => handleGenerate(true)}>
                {fmt === "combined" ? "Sinh lịch vòng bảng" : "Random & Sinh lịch"}
              </Button>
              {fmt !== "combined" && (
                <Button icon={<ThunderboltOutlined />} loading={generating} onClick={() => handleGenerate(false)}>
                  Sinh lịch (giữ thứ tự)
                </Button>
              )}
            </>
          )}
        </Space>
      </Row>

      {/* Phiên bốc thăm đang dở (sau F5 hoặc đã bấm Đóng overlay) — cho phép mở lại hoặc huỷ */}
      {pendingDraw && !drawOpen && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message={`Phiên bốc thăm #${pendingDraw.seq} đang dở (${pendingDraw.done_steps}/${pendingDraw.total_steps})`}
          description="Kết quả chưa được áp dụng vào lịch thi đấu. Tiếp tục quay để chốt, hoặc huỷ phiên để bốc lại."
          action={
            <Space direction={isMobileView ? "vertical" : "horizontal"}>
              <Button type="primary" size="small" icon={<GiftOutlined />} loading={drawBusy} onClick={handleResumeDraw}>
                Tiếp tục
              </Button>
              <Button danger size="small" loading={drawBusy} onClick={handleDrawCancel}>Huỷ phiên</Button>
            </Space>
          } />
      )}

      {/* Phiên ghép đội đang dở (sau F5 hoặc đã bấm Đóng overlay) */}
      {pendingPartnerDraw && !partnerDrawOpen && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message={`Phiên ghép đội #${pendingPartnerDraw.seq} đang dở (${pendingPartnerDraw.done_steps} / tối đa ${pendingPartnerDraw.total_steps} lượt)`}
          description={pendingPartnerDraw.stuck
            ? "Phiên bị kẹt — bên 2 không còn ai đủ điều kiện; không quay tiếp lẫn chốt được. Huỷ phiên và mở lại. Khán giả đang thấy phiên này trên trang public."
            : pendingPartnerDraw.finished
              ? "Đã hết lượt hợp lệ — mở lại để 'Chốt & tạo đội'; người còn lại sẽ ghép tay. Khán giả đang thấy phiên này trên trang public."
              : "Đội chưa được tạo. Tiếp tục quay để chốt, hoặc huỷ phiên để ghép lại. Khán giả đang thấy phiên này trên trang public."}
          action={
            <Space direction={isMobileView ? "vertical" : "horizontal"}>
              {!pendingPartnerDraw.stuck && (
                <Button type="primary" size="small" icon={<GiftOutlined />} loading={partnerBusy} onClick={handleResumePartnerDraw}>
                  Tiếp tục
                </Button>
              )}
              <Button danger size="small" loading={partnerBusy} onClick={handlePartnerCancel}>Huỷ phiên</Button>
            </Space>
          } />
      )}

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

      {/* Giải Nháp: chọn người chơi hàng loạt / xoá ngay trên trang giải (đơn lẫn đôi) */}
      {tournament.status === "draft" && (
        <ParticipantsPanel
          tournament={tournament}
          onChanged={reload}
          autoOpenAdd={autoOpenAdd && tournament.participants.length === 0}
        />
      )}

      {/* Giải đôi Nháp còn người chưa có đội → ghép bằng vòng quay (≥ 2 người) hoặc ghép tay */}
      {isDoublesDraft && unpaired > 0 && !pendingPartnerDraw && (
        <Alert type="info" showIcon style={{ marginBottom: 16 }}
          message={`Còn ${unpaired} người chưa có đội`}
          description={unpaired < 2
            ? "Chỉ còn 1 người — thêm người vào giải (Thêm người chơi) hoặc xoá người này trước khi bắt đầu."
            : "Ghép đội bằng vòng quay công khai (khán giả xem trực tiếp) hoặc ghép tay từng cặp. Người không khớp quy tắc / dư sẽ ghép tay."}
          action={
            <Space direction={isMobileView ? "vertical" : "horizontal"}>
              <Button type="primary" size="small" icon={<GiftOutlined />} disabled={unpaired < 2}
                loading={partnerBusy} onClick={handleOpenPartnerDraw}>
                🎡 Ghép đội (vòng quay)
              </Button>
              <Button size="small" icon={<TeamOutlined />} onClick={() => setPairModal(true)}>
                Ghép tay
              </Button>
            </Space>
          } />
      )}

      {matches.length === 0 ? (
        <Card>
          <Empty
            description={
              tournament.status === "draft"
                ? (tournament.participants.length < 2
                    ? "Giải đấu chưa bắt đầu. Thêm ít nhất 2 đội/người chơi rồi bấm 'Bắt đầu giải'."
                    : isDoublesDraft && unpaired > 0
                      ? "Giải đấu chưa bắt đầu. Ghép đội cho người chưa có đội rồi bấm 'Bắt đầu giải'."
                      : "Giải đấu chưa bắt đầu. Kiểm tra cài đặt thể thức rồi bấm 'Bắt đầu giải'.")
                : canDraw
                  ? "Nhấn 'Bốc thăm' để quay vòng quay trực tiếp, hoặc sinh lịch ngẫu nhiên."
                  : (fmt === "combined" ? "Nhấn 'Sinh lịch vòng bảng' để bắt đầu." : "Nhấn 'Random & Sinh lịch' để bắt đầu.")
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}>
            {tournament.status === "active" && (
              <Space wrap style={{ justifyContent: "center" }}>
                {canDraw && (
                  <Button type="primary" icon={<GiftOutlined />} loading={drawBusy} onClick={handleOpenDraw}>
                    🎡 Bốc thăm
                  </Button>
                )}
                <Button type={canDraw ? "default" : "primary"} icon={<ThunderboltOutlined />} loading={generating}
                  onClick={() => handleGenerate(true)}>
                  {fmt === "combined" ? "Sinh lịch vòng bảng" : "Random & Sinh lịch"}
                </Button>
              </Space>
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

      {scorePinModal && (
        <ScorePinModal
          tournament={tournament}
          onSaved={() => { setScorePinModal(false); reload(); }}
          onClose={() => setScorePinModal(false)}
        />
      )}

      {partnerSetupModal && (
        <PartnerDrawSetupModal
          tournament={tournament}
          busy={partnerBusy}
          onOpen={handleSubmitPartnerDraw}
          onClose={() => setPartnerSetupModal(false)}
        />
      )}

      {pairModal && (
        <PairSinglesModal
          tournament={tournament}
          onSaved={reload}
          onClose={() => setPairModal(false)}
        />
      )}

      {printing && createPortal(
        <TournamentPrintSheet tournament={tournament} onReady={handlePrintReady} />,
        document.body
      )}

      {/* Overlay bốc thăm toàn màn hình (tự portal vào body, z-index 900 < antd popup để Modal.confirm nổi lên trên) */}
      {drawOpen && draw && (
        <DrawCeremony
          mode="admin"
          tournament={tournament}
          draw={draw}
          serverOffsetMs={drawOffset}
          busy={drawBusy}
          onSpin={handleDrawSpin}
          onCommit={handleDrawCommit}
          onCancel={handleDrawCancel}
          onClose={() => setDrawOpen(false)}
          fullscreen
        />
      )}

      {/* Overlay ghép đội đôi bằng vòng quay (cùng khung DrawStage, portal z-index 900) */}
      {partnerDrawOpen && partnerDraw && (
        <PartnerDrawCeremony
          mode="admin"
          tournament={tournament}
          draw={partnerDraw}
          serverOffsetMs={partnerOffset}
          busy={partnerBusy}
          onSpin={handlePartnerSpin}
          onCommit={handlePartnerCommit}
          onCancel={handlePartnerCancel}
          onClose={() => setPartnerDrawOpen(false)}
          fullscreen
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
  const [loading, setLoading] = useState(true); // true ngay từ đầu vì effect mount tự fetch
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const [justCreated, setJustCreated] = useState(false); // vừa tạo giải → trang giải tự mở modal thêm người chơi

  const load = async () => {
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
    { title: "Tên giải đấu", dataIndex: "name", render: (v, r) => <a onClick={() => { setJustCreated(false); setDetail(r); }}>{v}</a> },
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
          <Button size="small" type="primary" onClick={() => { setJustCreated(false); setDetail(r); }}>Mở</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} />
        </Space>
      ),
    },
  ];

  if (detail) {
    return (
      <TournamentDetail
        tournament={detail}
        autoOpenAdd={justCreated}
        onBack={() => { setDetail(null); setJustCreated(false); load(); }}
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
        mobileTitle={(r) => <a onClick={() => { setJustCreated(false); setDetail(r); }}>{r.name}</a>}
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
          onCreated={(t) => { setCreating(false); setJustCreated(true); setDetail(t); load(); }}
          onClose={() => setCreating(false)}
        />
      </Modal>
    </div>
  );
}
