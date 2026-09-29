import { useEffect, useState, useCallback, useRef } from "react";
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
  UserOutlined, TeamOutlined, UserAddOutlined, PrinterOutlined, GiftOutlined,
} from "@ant-design/icons";
import { tournamentsApi, membersApi, playersApi } from "../api";
import ResponsiveTable from "../components/ResponsiveTable";
import TournamentPrintSheet from "../components/TournamentPrintSheet";
import DrawCeremony from "../components/draw/DrawCeremony";
import PartnerDrawCeremony from "../components/draw/PartnerDrawCeremony";
import { useViewMode } from "../contexts/ViewModeContext";
import { buildRealBracketNodes, computeBracketGeometry, findThirdPlaceMatch } from "../utils/bracketLayout";
import { teamLabel, teamRank } from "../utils/tournamentLabels";
import { DRAW_FORMATS, serverOffset, normalizeRank, UNRANKED, partnerPlan } from "../utils/drawMath";

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
// Hạng dùng cho quy tắc ghép đội đôi — có "Chưa xếp hạng" để ghép được khách mời/thành viên chưa có hạng
// (backend normalize rank NULL/"" → "Chưa xếp hạng", xem tournament_engine.normalize_rank)
const RANKS = ["A", "B", "C", "D", "Hạt giống 1", "Hạt giống 2", "Hạt giống 3", UNRANKED];

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
/** Quy tắc đủ 2 hạng (bỏ dòng để trống). */
const completeRules = (rules) => (rules || []).filter((r) => r && r.rank1 && r.rank2).map((r) => ({ rank1: r.rank1, rank2: r.rank2 }));
const DEFAULT_REVEAL_MS = 5000;

// Xáo ngẫu nhiên (Fisher–Yates) — ở module scope để không gọi Math.random trong thân component (react-hooks/purity)
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Editor quy tắc hạng [{rank1, rank2}] — dùng chung cho wizard (by_rank / wheel) và PartnerDrawSetupModal. */
function RankRulesEditor({ rules, onChange, allowEmpty = false }) {
  const setRule = (i, patch) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div>
      {rules.map((rule, i) => (
        <Row gutter={8} key={i} align="middle" style={{ marginBottom: 8 }}>
          <Col span={10}>
            <Select value={rule.rank1 || undefined} placeholder="Hạng 1" style={{ width: "100%" }} allowClear
              onChange={(v) => setRule(i, { rank1: v || "" })}>
              {RANKS.map((r) => <Select.Option key={r} value={r}>{r}</Select.Option>)}
            </Select>
          </Col>
          <Col span={2} style={{ textAlign: "center" }}><Tag color="blue">+</Tag></Col>
          <Col span={10}>
            <Select value={rule.rank2 || undefined} placeholder="Hạng 2" style={{ width: "100%" }} allowClear
              onChange={(v) => setRule(i, { rank2: v || "" })}>
              {RANKS.map((r) => <Select.Option key={r} value={r}>{r}</Select.Option>)}
            </Select>
          </Col>
          <Col span={2} style={{ textAlign: "center" }}>
            <Button danger size="small" disabled={!allowEmpty && rules.length === 1}
              onClick={() => onChange(rules.filter((_, j) => j !== i))}>×</Button>
          </Col>
        </Row>
      ))}
      <Button type="dashed" size="small" onClick={() => onChange([...rules, { rank1: "", rank2: "" }])}>
        + Thêm quy tắc
      </Button>
    </div>
  );
}

// ── Mở phiên ghép đội bằng vòng quay: chỉnh quy tắc + thời gian quay rồi "Mở phiên" ──
function PartnerDrawSetupModal({ tournament, busy, onOpen, onClose }) {
  const initialRules = completeRules(tournament.partner_rules);
  const [rules, setRules] = useState(initialRules.length ? initialRules : [{ rank1: "", rank2: "" }]);
  const [revealSec, setRevealSec] = useState(DEFAULT_REVEAL_MS / 1000);

  const singles = tournament.participants.filter(isSingleParticipant);
  // Thống kê hạng của người đơn lẻ để admin đặt quy tắc cho khớp
  const byRank = {};
  singles.forEach((p) => { const r = participantRank(p); byRank[r] = (byRank[r] || 0) + 1; });
  // Xem trước kế hoạch (cùng thuật toán với backend) — số đội / số người chắc chắn dư
  const rulesOk = completeRules(rules);
  const partial = rules.some((r) => (r.rank1 && !r.rank2) || (!r.rank1 && r.rank2));
  const plan = partnerPlan(singles.map((p) => ({ pid: p.id, rank: participantRank(p) })), rulesOk);
  const teamCount = plan.phases.reduce((s, ph) => s + ph.team_count, 0);

  const handleOpen = () => {
    if (partial) { message.error("Có quy tắc chưa chọn đủ 2 hạng — chọn đủ hoặc xoá dòng đó"); return; }
    if (teamCount === 0) { message.error("Không có quy tắc nào ghép được đội với danh sách hiện tại"); return; }
    onOpen(rulesOk, Math.round(revealSec * 1000));
  };

  return (
    <Modal title="🎡 Mở phiên ghép đội bằng vòng quay" open onCancel={onClose} width={640}
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
            Khác hạng: quay pool hạng 1 → người 1, rồi pool hạng 2 → người 2. Cùng hạng: 2 lượt liên tiếp cùng pool.
            Không có quy tắc: 2 lượt liên tiếp trên toàn bộ danh sách. Người không khớp quy tắc / dư sẽ ghép tay sau.
            Khán giả xem trực tiếp trên trang public ngay khi mở phiên.
          </div>
        } />

      <Divider orientation="left" style={{ marginTop: 0 }}>Quy tắc ghép theo hạng (theo thứ tự)</Divider>
      <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
        Để trống toàn bộ = ghép ngẫu nhiên không lọc hạng. Quy tắc trước tiêu thụ người trước.
      </Text>
      <RankRulesEditor rules={rules} onChange={setRules} allowEmpty />

      <Divider orientation="left">Thời gian quay mỗi lượt</Divider>
      <Space>
        <InputNumber min={1.5} max={15} step={0.5} value={revealSec} onChange={(v) => setRevealSec(v || DEFAULT_REVEAL_MS / 1000)} />
        <Text type="secondary">giây (mặc định 5s)</Text>
      </Space>

      <Divider orientation="left">Kế hoạch dự kiến</Divider>
      {teamCount > 0 ? (
        <Space direction="vertical" size={2}>
          {plan.phases.map((ph) => (
            <Text key={ph.index}>
              {ph.rank1 ? `Quy tắc ${ph.index + 1}: Hạng ${ph.rank1} + Hạng ${ph.rank2}` : "Ngẫu nhiên toàn bộ"} — <b>{ph.team_count} đội</b>
            </Text>
          ))}
          <Text type={plan.unpaired_pids.length ? "warning" : "secondary"}>
            {plan.unpaired_pids.length
              ? `${plan.unpaired_pids.length} người không khớp quy tắc nào — sẽ ghép tay sau`
              : "Mọi người đều thuộc hạng có trong quy tắc (người dư của một hạng chỉ biết sau khi quay)"}
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
          description={singles.length === 1 ? "Thêm người vào giải (Sửa cài đặt) hoặc xoá người này khỏi giải trước khi bắt đầu." : undefined} />
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

// ── Wizard tạo giải ──────────────────────────────────────
function CreateWizard({ onCreated, onClose }) {
  const [step, setStep] = useState(0);
  const [form] = Form.useForm();
  const [allMembers, setAllMembers] = useState([]);
  const [format, setFormat] = useState(null);

  // Bước 1: chọn người chơi (thành viên + khách mời)
  const [selectedIds, setSelectedIds] = useState([]);          // member IDs đã chọn
  const [allGuests, setAllGuests] = useState([]);               // toàn bộ khách mời đã có trong CLB
  const [selectedGuestIds, setSelectedGuestIds] = useState([]); // khách mời được chọn cho giải này
  const [guestForm] = Form.useForm();
  const [addingGuest, setAddingGuest] = useState(false);

  // Bước 3: ghép đội
  const [teamType, setTeamType] = useState("singles");
  const [thirdPlaceEnabled, setThirdPlaceEnabled] = useState(true);
  // doubles – method: "manual" | "by_rank" | "wheel" (wheel = tạo giải Nháp với danh sách người, quay ghép đội tại trang giải)
  const [doubleMethod, setDoubleMethod] = useState("manual");
  // doubles – rank rules: [{rank1, rank2}] for auto-pairing
  const [rankRules, setRankRules] = useState([{ rank1: "", rank2: "" }]);
  // doubles – built teams (mở rộng: hỗ trợ player_id cho khách mời)
  const [teams, setTeams] = useState([]);
  const [pick1, setPick1] = useState(null);  // "m-{id}" hoặc "g-{id}"
  const [pick2, setPick2] = useState(null);

  // Bước 3: PIN nhập điểm qua public
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinValue, setPinValue] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    membersApi.list().then((r) => setAllMembers(r.data));
    playersApi.list("guest").then((r) => setAllGuests(r.data));
  }, []);

  const selectedMembers = allMembers.filter(m => selectedIds.includes(m.id));
  const guestPlayers = allGuests.filter(g => selectedGuestIds.includes(g.id));
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

  // Thêm khách mời mới qua API, thêm vào danh sách chung và tự động chọn cho giải này
  const handleAddGuest = async () => {
    let vals;
    try { vals = await guestForm.validateFields(); } catch { return; }
    setAddingGuest(true);
    try {
      const res = await playersApi.create({ name: vals.name, phone: vals.phone || null, email: vals.email || null, rank: vals.rank || "Chưa xếp hạng" });
      setAllGuests(prev => [res.data, ...prev]);
      setSelectedGuestIds(prev => [...prev, res.data.id]);
      guestForm.resetFields();
      message.success(`Đã thêm khách mời: ${res.data.name}`);
    } catch (err) {
      message.error(err.response?.data?.detail || "Không thể thêm khách mời");
    } finally { setAddingGuest(false); }
  };

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
  const autoTeamByRank = () => {
    const newTeams = [];
    const used = new Set();
    // Áp dụng ghép theo rank cho cả thành viên CLB và khách mời có rank
    const memberPool = allPool;  // allPool gồm cả member + guest, đều có rank

    for (const rule of rankRules) {
      if (!rule.rank1 || !rule.rank2) continue;

      if (rule.rank1 === rule.rank2) {
        // normalizeRank: member.rank NULL/"" khớp quy tắc "Chưa xếp hạng" (như backend)
        const pool = shuffle(memberPool.filter(p => normalizeRank(p.rank) === rule.rank1 && !used.has(p.key)));
        for (let i = 0; i + 1 < pool.length; i += 2) {
          const a = pool[i], b = pool[i + 1];
          const pa = parseKey(a.key), pb = parseKey(b.key);
          newTeams.push({ ...pa, partner_member_id: pb.member_id, partner_player_id: pb.player_id, team_name: `${a.name} / ${b.name}`, _key1: a.key, _key2: b.key });
          used.add(a.key); used.add(b.key);
        }
      } else {
        const p1s = shuffle(memberPool.filter(p => normalizeRank(p.rank) === rule.rank1 && !used.has(p.key)));
        const p2s = shuffle(memberPool.filter(p => normalizeRank(p.rank) === rule.rank2 && !used.has(p.key)));
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

  // Đơn hoặc ghép đội bằng vòng quay tại giải: mỗi người là 1 participant → đếm người; còn lại đếm đội đã ghép
  const wheelMethod = teamType === "doubles" && doubleMethod === "wheel";
  const totalTeams = (teamType === "singles" || wheelMethod) ? totalSelected : teams.length;

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
      if (wheelMethod) {
        // Giải đôi tạo ở trạng thái Nháp với DANH SÁCH NGƯỜI (không gửi teams) — backend tạo participant đơn lẻ;
        // quy tắc hạng lưu vào partner_rules để gợi ý khi mở phiên ghép đội tại trang giải
        payload.member_ids = selectedIds;
        payload.player_ids = guestPlayers.map(g => g.id);
        payload.partner_rules = completeRules(rankRules);
      } else if (teamType === "doubles") {
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
          <Form.Item label="Loại đội">
            <Row gutter={12}>
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
                      <Text type="secondary" style={{ fontSize: 12 }}>Mỗi người chơi là 1 đội</Text>
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
          </Form.Item>
          {(format === "knockout" || format === "combined") && (
            <Form.Item label=" " colon={false}>
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

                    {allGuests.length === 0 ? (
                      <Empty description="Chưa có khách mời nào — thêm mới ở trên" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <>
                        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <Checkbox
                            checked={allGuests.length > 0 && selectedGuestIds.length === allGuests.length}
                            indeterminate={selectedGuestIds.length > 0 && selectedGuestIds.length < allGuests.length}
                            onChange={e => setSelectedGuestIds(e.target.checked ? allGuests.map(g => g.id) : [])}
                          >
                            Chọn tất cả khách mời ({allGuests.length})
                          </Checkbox>
                          {selectedGuestIds.length > 0 && (
                            <Button size="small" type="link" onClick={() => setSelectedGuestIds([])}>
                              Bỏ chọn ({selectedGuestIds.length})
                            </Button>
                          )}
                        </div>
                        <ResponsiveTable
                          rowSelection={{
                            selectedRowKeys: selectedGuestIds,
                            onChange: keys => setSelectedGuestIds(keys),
                          }}
                          size="small"
                          pagination={{ pageSize: 10 }}
                          dataSource={allGuests}
                          rowKey="id"
                          columns={[
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
                          ]}
                          mobileTitle={(r) => (
                            <span>
                              <Tag color="orange" style={{ marginRight: 6 }}>Khách</Tag>
                              {r.name}
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
        </>
      )}

      {/* ── Bước 2: Ghép đội ── */}
      {step === 2 && (
        <div>
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
                <Col xs={24} sm={8}>
                  <Card
                    size="small" hoverable
                    onClick={() => setDoubleMethod("manual")}
                    style={{ borderColor: doubleMethod === "manual" ? "#1677ff" : "#d9d9d9", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: doubleMethod === "manual" ? 600 : 400 }}>✋ Ghép tay</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Tự chọn từng cặp</Text>
                  </Card>
                </Col>
                <Col xs={24} sm={8}>
                  <Card
                    size="small" hoverable
                    onClick={() => setDoubleMethod("by_rank")}
                    style={{ borderColor: doubleMethod === "by_rank" ? "#1677ff" : "#d9d9d9", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: doubleMethod === "by_rank" ? 600 : 400 }}>⚡ Ghép theo hạng</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Quy tắc hạng A + hạng B</Text>
                  </Card>
                </Col>
                <Col xs={24} sm={8}>
                  <Card
                    size="small" hoverable
                    onClick={() => setDoubleMethod("wheel")}
                    style={{ borderColor: doubleMethod === "wheel" ? "#1677ff" : "#d9d9d9", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: doubleMethod === "wheel" ? 600 : 400 }}>🎡 Bốc thăm ghép đội tại giải</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Vòng quay công khai, khán giả xem trực tiếp</Text>
                  </Card>
                </Col>
              </Row>

              {/* Bốc thăm ghép đội tại giải: chỉ lưu danh sách người + quy tắc; quay ở trang chi tiết giải */}
              {doubleMethod === "wheel" && (
                <>
                  <Alert type="info" showIcon style={{ marginBottom: 12 }}
                    message="Giải sẽ được tạo ở trạng thái Nháp với danh sách người."
                    description="Vào trang giải bấm '🎡 Ghép đội' để quay; người không khớp quy tắc ghép tay sau. Quy tắc có thể sửa lại lúc mở phiên." />
                  <Card size="small" style={{ marginBottom: 12 }} title="Quy tắc ghép đội theo hạng (tuỳ chọn)">
                    <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
                      Mỗi dòng = 1 quy tắc theo thứ tự: Hạng 1 + Hạng 2. Để trống = ghép ngẫu nhiên toàn bộ danh sách.
                    </Text>
                    <RankRulesEditor rules={rankRules} onChange={setRankRules} allowEmpty />
                  </Card>
                  <Divider orientation="left" style={{ marginTop: 12, fontSize: 12 }}>
                    Danh sách người ({allPool.length})
                  </Divider>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {allPool.map(p => (
                      <Tag key={p.key} color={p.type === "guest" ? "orange" : "gold"} style={{ marginBottom: 4 }}>
                        {p.name}{normalizeRank(p.rank) !== UNRANKED && ` (${p.rank})`}
                        {p.type === "guest" && <span style={{ opacity: 0.75 }}> [K]</span>}
                      </Tag>
                    ))}
                  </div>
                </>
              )}

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
                  <RankRulesEditor rules={rankRules} onChange={setRankRules} />
                </Card>
              )}

              {/* Danh sách đội đã ghép (không áp dụng cho phương án vòng quay tại giải) */}
              {doubleMethod !== "wheel" && teams.length > 0 && (
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

              {/* Trạng thái ghép đội của từng người (ghép tay / theo hạng) */}
              {doubleMethod !== "wheel" && (<>
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
              </>)}
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
                    <div style={{ marginBottom: 8 }}><Text type="secondary">{wheelMethod ? "Ghép đội" : "Số đội tham gia"}</Text></div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: "#1677ff" }}>
                      {wheelMethod ? `🎡 Ghép đội bằng vòng quay sau khi tạo (${totalSelected} người)` : `${totalTeams} đội`}
                      {guestPlayers.length > 0 && <Tag color="orange" style={{ marginLeft: 8 }}>{guestPlayers.length} khách mời</Tag>}
                    </div>
                  </Col>
                  {vals.format === "combined" && (
                    <Col span={12} style={{ marginTop: 12 }}>
                      <div style={{ marginBottom: 8 }}><Text type="secondary">Số bảng</Text></div>
                      <div style={{ fontWeight: 600 }}>{vals.num_groups || 2} bảng</div>
                    </Col>
                  )}
                  {(vals.format === "knockout" || vals.format === "combined") && thirdPlaceEnabled && (
                    <Col span={12} style={{ marginTop: 12 }}>
                      <div style={{ marginBottom: 8 }}><Text type="secondary">Tranh giải 3</Text></div>
                      <Tag color="gold">Có</Tag>
                    </Col>
                  )}
                </Row>
              </Card>
            );
          })()}
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
    // Giải đôi: chỉ bắt buộc người 1 — để trống đồng đội = thêm 1 người đơn lẻ, ghép đội sau (vòng quay / ghép tay)
    if (!pick1) {
      message.error("Chọn người chơi"); return;
    }
    const p1 = parseKey(pick1);
    const p2 = parseKey(pick2);   // pick2 null → {} → partner_* undefined
    const single = tournament.team_type === "doubles" && !pick2;
    try {
      await tournamentsApi.addParticipant(tournament.id, {
        ...p1,
        partner_member_id: p2.member_id, partner_player_id: p2.player_id,
      });
      setPick1(null); setPick2(null);
      message.success(single ? "Đã thêm 1 người chưa có đội — sẽ ghép đội sau" : "Đã thêm người chơi");
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
        third_place_enabled: (vals.format === "knockout" || vals.format === "combined") ? !!vals.third_place_enabled : false,
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
      <Form form={form} layout="inline" initialValues={{ format: tournament.format, num_groups: tournament.num_groups, third_place_enabled: tournament.third_place_enabled }}>
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
        {(format === "knockout" || format === "combined") && (
          <Form.Item name="third_place_enabled" valuePropName="checked" style={{ marginBottom: 12 }}>
            <Checkbox>Có trận tranh giải 3</Checkbox>
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
          { title: "Đội", render: (_, r) => (
            <span>
              {teamLabel(r)}
              {tournament.team_type === "doubles" && isSingleParticipant(r) && (
                <Tag color="warning" style={{ marginLeft: 6 }}>Chưa có đội</Tag>
              )}
            </span>
          ) },
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
              <Select value={pick2} onChange={setPick2} placeholder="Đồng đội (có thể để trống)" style={{ width: "100%" }}
                allowClear showSearch filterOption={(inp, opt) => opt.label?.toLowerCase().includes(inp.toLowerCase())}
                options={pool.filter(p => p.key !== pick1).map(p => ({ value: p.key, label: `${p.name}${p.rank ? ` (${p.rank})` : ""}` }))}
              />
            </Col>
          </>
        )}
      </Row>
      {tournament.team_type === "doubles" && (
        <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
          Để trống "Đồng đội" → thêm 1 người đơn lẻ, sẽ ghép đội sau bằng vòng quay hoặc ghép tay.
        </Text>
      )}
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
function TournamentDetail({ tournament: initData, onBack, onUpdated }) {
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
  const startBlockedReason = unpaired > 0
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
          message={`Phiên ghép đội #${pendingPartnerDraw.seq} đang dở (${pendingPartnerDraw.done_steps}/${pendingPartnerDraw.total_steps})`}
          description="Đội chưa được tạo. Tiếp tục quay để chốt, hoặc huỷ phiên để ghép lại. Khán giả đang thấy phiên này trên trang public."
          action={
            <Space direction={isMobileView ? "vertical" : "horizontal"}>
              <Button type="primary" size="small" icon={<GiftOutlined />} loading={partnerBusy} onClick={handleResumePartnerDraw}>
                Tiếp tục
              </Button>
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

      {/* Giải đôi Nháp còn người chưa có đội → ghép bằng vòng quay (≥ 2 người) hoặc ghép tay */}
      {isDoublesDraft && unpaired > 0 && !pendingPartnerDraw && (
        <Alert type="info" showIcon style={{ marginBottom: 16 }}
          message={`Còn ${unpaired} người chưa có đội`}
          description={unpaired < 2
            ? "Chỉ còn 1 người — thêm người vào giải (Sửa cài đặt) hoặc xoá người này trước khi bắt đầu."
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
                ? (isDoublesDraft && unpaired > 0
                    ? "Giải đấu chưa bắt đầu. Ghép đội cho người chưa có đội rồi bấm 'Bắt đầu giải'."
                    : "Giải đấu chưa bắt đầu. Chỉnh sửa cài đặt rồi bấm 'Bắt đầu giải'.")
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
