/**
 * TeamDrawSetupModal — đặt luật phân bổ (các vòng theo hạng / giới tính / trần mỗi đội) + thời gian quay rồi
 * "Mở phiên" phân VĐV vào đội bằng vòng quay. Xem trước kế hoạch bằng teamDrawPlan (cùng thuật toán backend).
 * Props: { pool (TeamPlayerOut[] chưa phân đội), teams (TeamOut[] đang hoạt động), initialRules,
 *          busy, onOpen(rules, revealMs), onClose }
 */
import { useMemo, useState } from "react";
import { Alert, Button, Col, Divider, InputNumber, Modal, Row, Select, Space, Tag, Typography, message } from "antd";
import { DeleteOutlined, GiftOutlined, PlusOutlined } from "@ant-design/icons";
import { useRankLevels } from "../../hooks/useRankLevels";
import { UNRANKED, normalizeRank } from "../../utils/drawMath";
import { normalizeTeamDrawRules, teamDrawPlan, teamDrawRuleLabel } from "../../utils/teamDraw";

const { Text } = Typography;
const DEFAULT_REVEAL_MS = 5000;
const emptyRule = () => ({ ranks: [], genders: [], per_team: null });

export default function TeamDrawSetupModal({ pool = [], teams = [], initialRules, busy, onOpen, onClose }) {
  const { options: rankOptions } = useRankLevels();
  // Bỏ vòng "còn lại" tự thêm của phiên trước để người dùng không thấy dòng thừa
  const [rules, setRules] = useState(() => {
    const saved = (initialRules || []).filter((r) => r.ranks?.length || r.genders?.length || r.per_team != null);
    return saved.length ? saved.map((r) => ({ ranks: [...(r.ranks || [])], genders: [...(r.genders || [])], per_team: r.per_team ?? null })) : [emptyRule()];
  });
  const [revealSec, setRevealSec] = useState(DEFAULT_REVEAL_MS / 1000);

  const people = useMemo(() => pool.map((p) => ({ tpid: p.id, rank: normalizeRank(p.rank), gender: p.gender })), [pool]);
  const teamIds = useMemo(() => teams.map((t) => t.participant.id), [teams]);
  const byRank = {}; const byGender = { male: 0, female: 0, other: 0 };
  people.forEach((p) => {
    byRank[p.rank] = (byRank[p.rank] || 0) + 1;
    byGender[p.gender === "male" || p.gender === "female" ? p.gender : "other"] += 1;
  });
  const poolRanks = [...new Set([...(rankOptions || []), ...Object.keys(byRank)])];
  const normalized = normalizeTeamDrawRules(rules);
  const plan = teamDrawPlan(people, teamIds, normalized);
  const perTeamAvg = teamIds.length ? (people.length / teamIds.length).toFixed(1) : "0";

  const setRule = (i, patch) => setRules((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const removeRule = (i) => setRules((prev) => (prev.length > 1 ? prev.filter((_, k) => k !== i) : [emptyRule()]));

  const handleOpen = () => {
    if (!people.length) { message.error("Không còn VĐV nào chưa phân đội"); return; }
    if (teamIds.length < 2) { message.error("Cần ít nhất 2 đội"); return; }
    onOpen(normalized.filter((r) => r.ranks.length || r.genders.length || r.per_team != null), Math.round(revealSec * 1000));
  };

  return (
    <Modal title="🎡 Phân VĐV vào đội bằng vòng quay" open onCancel={onClose} width={720}
      footer={<Space><Button onClick={onClose}>Đóng</Button>
        <Button type="primary" icon={<GiftOutlined />} loading={busy} onClick={handleOpen} disabled={!people.length || teamIds.length < 2}>Mở phiên</Button></Space>}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={`${people.length} VĐV chưa phân đội → ${teamIds.length} đội (trung bình ${perTeamAvg} VĐV/đội)`}
        description={
          <div>
            <div style={{ marginBottom: 6 }}>
              <Tag color="blue">{byGender.male} Nam</Tag><Tag color="magenta">{byGender.female} Nữ</Tag>
              {byGender.other > 0 && <Tag color="warning">{byGender.other} chưa khai giới tính</Tag>}
              {Object.entries(byRank).map(([r, n]) => <Tag key={r} color="purple">{r}: {n}</Tag>)}
            </div>
            Mỗi vòng lọc VĐV theo hạng / giới tính và chia lần lượt cho các đội theo kiểu rắn (lượt về đảo chiều) cho tới hết
            người khớp tiêu chí (hoặc tới trần mỗi đội nếu đặt). Vòng cuối "Còn lại — chia đều" luôn được thêm tự động.
            Khán giả xem trực tiếp trên trang public ngay khi mở phiên; trong lúc phiên mở không sửa tay đội/VĐV được.
          </div>
        } />

      <Divider orientation="left" style={{ marginTop: 0 }}>Các vòng phân bổ (theo thứ tự)</Divider>
      {rules.map((r, i) => (
        <Row key={i} gutter={8} align="middle" style={{ marginBottom: 8 }}>
          <Col flex="24px"><Text type="secondary">{i + 1}.</Text></Col>
          <Col flex="1 1 200px">
            <Select mode="multiple" allowClear placeholder="Mọi hạng" value={r.ranks} style={{ width: "100%" }}
              options={poolRanks.map((x) => ({ value: x, label: x === UNRANKED ? "Chưa xếp hạng" : x }))}
              onChange={(v) => setRule(i, { ranks: v })} />
          </Col>
          <Col flex="0 0 120px">
            <Select value={r.genders?.length === 1 ? r.genders[0] : "any"} style={{ width: "100%" }}
              options={[{ value: "any", label: "Mọi giới" }, { value: "male", label: "Nam" }, { value: "female", label: "Nữ" }]}
              onChange={(v) => setRule(i, { genders: v === "any" ? [] : [v] })} />
          </Col>
          <Col flex="0 0 150px">
            <InputNumber min={1} max={50} value={r.per_team ?? null} placeholder="Chia đều hết" style={{ width: "100%" }}
              addonBefore="≤" addonAfter="/đội" onChange={(v) => setRule(i, { per_team: v ?? null })} />
          </Col>
          <Col flex="0 0 32px"><Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeRule(i)} /></Col>
        </Row>
      ))}
      <Button size="small" icon={<PlusOutlined />} onClick={() => setRules((p) => [...p, emptyRule()])}>Thêm vòng</Button>
      <Text type="secondary" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
        Ví dụ: vòng 1 hạng A (mỗi đội 1), vòng 2 hạng B (mỗi đội 1), vòng 3 Nữ (mỗi đội 2); người còn lại chia đều ở vòng cuối.
        Trần mỗi đội để trống = chia đều tới hết người của nhóm đó.
      </Text>

      <Divider orientation="left">Thời gian quay mỗi lượt</Divider>
      <Space>
        <InputNumber min={1.5} max={15} step={0.5} value={revealSec} onChange={(v) => setRevealSec(v || DEFAULT_REVEAL_MS / 1000)} />
        <Text type="secondary">giây (mặc định 5s)</Text>
      </Space>

      <Divider orientation="left">Kế hoạch dự kiến</Divider>
      <Space direction="vertical" size={2}>
        {plan.rounds.map((ph) => (
          <Text key={ph.index} type={ph.est_count ? undefined : "secondary"}>
            Vòng {ph.index + 1}: {teamDrawRuleLabel(ph)} — <b>{ph.est_count} lượt</b>
            {ph.per_team != null && ph.est_count > 0 && <Text type="secondary"> (ước tính)</Text>}
          </Text>
        ))}
        <Text>Tổng: <b>{plan.total_steps} lượt</b> — mỗi VĐV chờ đều được phân vào một đội.</Text>
        {byGender.other > 0 && normalized.some((r) => r.genders.length) && (
          <Text type="warning">{byGender.other} VĐV chưa khai giới tính sẽ không khớp các vòng lọc theo giới — chỉ vào ở vòng không lọc.</Text>
        )}
      </Space>
    </Modal>
  );
}
