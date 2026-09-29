import { useEffect, useState, useCallback, useRef } from "react";
import {
  Select, Tabs, Empty, Spin, Card, Tag, Typography, Alert,
  Collapse, Divider, Space, Button, Badge, Modal, Form, Input, AutoComplete, message,
} from "antd";
import {
  ReloadOutlined, SyncOutlined, TrophyOutlined, EditOutlined, SafetyCertificateOutlined,
} from "@ant-design/icons";
import ResponsiveTable from "./ResponsiveTable";
import DrawCeremony from "./draw/DrawCeremony";
import PartnerDrawCeremony from "./draw/PartnerDrawCeremony";
import { useViewMode } from "../contexts/ViewModeContext";
import { teamLabel, teamRank } from "../utils/tournamentLabels";
import {
  serverOffset, verifyDraw, verifyPartnerDraw, partnerLabelForStep, partnerDrawFinished, partnerDrawStuck,
  normalizePartnerRules, ranksPhrase, UNRANKED,
} from "../utils/drawMath";

const { Text } = Typography;

const POLL_MS = 12000;        // poll chi tiết giải + danh sách giải
const DRAW_POLL_MS = 2000;    // poll nhanh phiên bốc thăm / ghép đội đang mở (endpoint riêng, bucket rate-limit riêng)
const DRAW_POLL_SLOW_MS = 5000; // giãn ra khi server trả 429, tới lần thành công kế tiếp

const DRAW_STATUS_TAG = {
  committed:  { label: "Đã áp dụng", color: "success" },
  superseded: { label: "Đã thay bằng phiên mới", color: "default" },
  cancelled:  { label: "Đã huỷ", color: "error" },
  open:       { label: "Đang bốc thăm", color: "processing" },
};

// Phiên GHÉP ĐỘI (partner draw) — khác phiên bốc cặp đấu: "committed" nghĩa là đã chốt danh sách đội
const PARTNER_STATUS_TAG = {
  committed:  { label: "Đã chốt", color: "success" },
  superseded: { label: "Đã thay bằng phiên mới", color: "default" },
  cancelled:  { label: "Đã huỷ", color: "error" },
  open:       { label: "Đang ghép đội", color: "processing" },
};

/** Người chơi đơn lẻ trong giải đôi (chưa có đồng đội) — theo đúng cách backend tính unpaired_count. */
const isSingleParticipant = (p) => p?.partner_member_id == null && p?.partner_player_id == null;

/**
 * Dòng mô tả quy tắc ghép đội theo thứ tự (dùng ở biên bản). Quy tắc v2 mỗi bên là danh sách hạng
 * (bên rỗng = bất kỳ hạng); quy tắc cũ rank1/rank2 được normalize về cùng shape.
 */
const partnerRulesText = (rules) => {
  const list = normalizePartnerRules(rules);
  // Không có quy tắc, hoặc chỉ 1 quy tắc "bất kỳ + bất kỳ" → ghép ngẫu nhiên toàn bộ
  const allAny = list.every(r => r.ranks1.length === 0 && r.ranks2.length === 0);
  if (list.length === 0 || (list.length === 1 && allAny)) return "Ngẫu nhiên toàn bộ (không lọc hạng)";
  return list
    .map((r, i) => `Quy tắc ${i + 1}: ${ranksPhrase(r.ranks1, true)} + ${ranksPhrase(r.ranks2, true)}`)
    .join("; ");
};

// Backend trả datetime naive giờ VN (không có Z) → trình duyệt parse theo giờ máy, hợp với người xem trong nước
const fmtTime = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString("vi-VN");
};

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

// ── Nhập tỉ số qua public (yêu cầu mã PIN của giải) ───────
function PublicScoreModal({ match, tid, api, onSaved, onClose }) {
  const [s1, setS1] = useState(match?.score1 ?? 0);
  const [s2, setS2] = useState(match?.score2 ?? 0);
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  const p1Name = teamLabel(match?.p1);
  const p2Name = teamLabel(match?.p2);

  const handleSave = async () => {
    if (!/^\d{4}$/.test(pin)) { message.error("Mã PIN phải gồm đúng 4 chữ số"); return; }
    setSaving(true);
    try {
      await api.tournaments.score(tid, match.id, { pin, score1: s1, score2: s2 });
      message.success("Đã lưu kết quả");
      onSaved();
    } catch (err) {
      message.error(err?.response?.data?.detail || "Không thể lưu kết quả — kiểm tra lại mã PIN");
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`Nhập kết quả – ${match?.round_name}`} open onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>Lưu</Button>
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
      <Form.Item label="Mã PIN của giải" style={{ marginBottom: 0 }}>
        <Input.Password
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="Nhập mã PIN 4 số" maxLength={4} style={{ width: 160 }}
        />
      </Form.Item>
    </Modal>
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

function KnockoutBracket({ matches }) {
  const { isMobileView } = useViewMode();
  const rounds = [...new Set(matches.map(m => m.round_number))].sort((a, b) => a - b);

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

function RoundedSchedule({ matches, columns, mobileProps }) {
  const rounds = [...new Set(matches.map(m => m.round_number))].sort((a, b) => a - b);
  const roundCols = columns.filter(c => c.dataIndex !== "round_name");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {rounds.map(r => {
        const rMatches = matches.filter(m => m.round_number === r);
        const rName = rMatches[0]?.round_name || `Vòng ${r}`;
        const done = rMatches.filter(m => m.status === "completed").length;
        return (
          <Card
            key={r}
            size="small"
            title={<Text strong style={{ color: "#1677ff" }}>{rName}</Text>}
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

function StandingsTable({ tournament, group, api }) {
  const [rows, setRows] = useState([]);
  const doneCount = tournament.matches?.filter(m => m.status === "completed").length ?? 0;

  useEffect(() => {
    api.tournaments.standings(tournament.id, group).then(r => setRows(r.data));
  }, [tournament.id, group, doneCount, api]);

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

function matchTableCols(onScore) {
  const cols = [
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
      render: (_, m) => m.status === "completed"
        ? <b style={{ fontSize: 16 }}>{m.score1} – {m.score2}</b>
        : <Tag>Chưa đấu</Tag>,
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
        ? <Tag color="success">{teamLabel(m.winner) || "Hòa"}</Tag>
        : null,
    },
  ];
  if (onScore) {
    cols.push({
      title: "", width: 80, align: "center",
      render: (_, m) => (
        <Button size="small" type={m.status === "completed" ? "default" : "primary"}
          icon={<EditOutlined />}
          disabled={!m.p1_id || !m.p2_id}
          onClick={() => onScore(m)}>
          {m.status === "completed" ? "Sửa" : "Nhập"}
        </Button>
      ),
    });
  }
  return cols;
}

function TournamentContent({ tournament, api, onScored }) {
  const fmt = tournament.format;
  const matches = tournament.matches || [];
  const groupMatches = matches.filter(m => m.phase === "group");
  const koMatches = matches.filter(m => m.phase === "knockout");
  const groups = [...new Set((tournament.participants || []).map(p => p.group_name).filter(Boolean))].sort();
  const doneCount = matches.filter(m => m.status === "completed").length;
  const groupDoneCount = groupMatches.filter(m => m.status === "completed").length;
  const [scoreMatch, setScoreMatch] = useState(null);

  const mobileProps = {
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

  const cols = matchTableCols(tournament.public_scoring_enabled ? setScoreMatch : null);
  const tabItems = [];

  if (fmt === "round_robin" || fmt === "individual") {
    tabItems.push({
      key: "schedule",
      label: `Lịch thi đấu (${doneCount}/${matches.length})`,
      children: <RoundedSchedule columns={cols} matches={matches} mobileProps={mobileProps} />,
    });
    if (fmt === "round_robin") {
      tabItems.push({
        key: "standings",
        label: "Bảng xếp hạng",
        children: <StandingsTable tournament={tournament} api={api} />,
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
      children: <RoundedSchedule columns={cols} matches={matches} mobileProps={mobileProps} />,
    });
  }

  if (fmt === "combined") {
    tabItems.push({
      key: "groups",
      label: `Vòng bảng (${groupDoneCount}/${groupMatches.length})`,
      children: (
        <Tabs
          type="card"
          items={groups.map(g => ({
            key: g,
            label: `Bảng ${g}`,
            children: (
              <>
                <ResponsiveTable
                  columns={cols}
                  dataSource={groupMatches.filter(m => m.group_name === g)}
                  rowKey="id" size="small" pagination={false}
                  style={{ marginBottom: 16 }}
                  {...mobileProps}
                />
                <StandingsTable tournament={tournament} group={g} api={api} />
              </>
            ),
          }))}
        />
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
            <RoundedSchedule columns={cols} matches={koMatches} mobileProps={mobileProps} />
          </>
        ),
      });
    }
  }

  return (
    <>
      <Tabs items={tabItems} />
      {scoreMatch && (
        <PublicScoreModal
          match={scoreMatch}
          tid={tournament.id}
          api={api}
          onSaved={() => { setScoreMatch(null); onScored && onScored(); }}
          onClose={() => setScoreMatch(null)}
        />
      )}
    </>
  );
}

// ── Một phiên bốc thăm trong lịch sử: seed + bảng lượt + nút Kiểm chứng ───────
function DrawHistoryItem({ draw, participantsById }) {
  const [verify, setVerify] = useState({ loading: false, result: undefined }); // undefined = chưa bấm

  const handleVerify = async () => {
    setVerify({ loading: true, result: undefined });
    const result = await verifyDraw(draw);   // null = thiếu seed_hex hoặc trình duyệt không có crypto.subtle
    setVerify({ loading: false, result });
  };

  const steps = [...(draw.steps || [])].sort((a, b) => a.step_index - b.step_index);
  const stepResult = (k) => verify.result?.steps?.find(s => s.step_index === k);
  const cols = [
    { title: "Lượt", dataIndex: "step_index", width: 60, align: "center", render: v => v + 1 },
    {
      title: "Đội", dataIndex: "participant_id",
      render: (pid) => {
        const p = participantsById[pid];
        return (
          <span>
            {p ? teamLabel(p) : `#${pid}`}
            {p?.status === "withdrawn" && <Tag style={{ marginLeft: 4 }}>bỏ giải</Tag>}
          </span>
        );
      },
    },
    { title: "Ô", dataIndex: "slot_label" },
    {
      title: "Kiểm chứng", width: 100, align: "center",
      render: (_, s) => {
        const r = stepResult(s.step_index);
        if (!r) return null;
        return r.ok ? <Tag color="success">✅ khớp</Tag> : <Tag color="error">❌ lệch</Tag>;
      },
    },
  ];
  const tag = DRAW_STATUS_TAG[draw.status] || { label: draw.status, color: "default" };
  const endedAt = draw.committed_at || draw.cancelled_at;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Space wrap>
        <Tag color={tag.color}>{tag.label}</Tag>
        <Text type="secondary">Mở: {fmtTime(draw.created_at)}</Text>
        {endedAt && <Text type="secondary">Kết thúc: {fmtTime(endedAt)}</Text>}
        {draw.cancel_reason && <Text type="secondary">Lý do: {draw.cancel_reason}</Text>}
      </Space>
      <div style={{ fontSize: 12, wordBreak: "break-all" }}>
        <div><Text type="secondary">Cam kết seed (SHA-256):</Text> <Text code>{draw.seed_commit}</Text></div>
        <div>
          <Text type="secondary">Seed công khai:</Text>{" "}
          {draw.seed_hex ? <Text code>{draw.seed_hex}</Text> : <Text type="secondary">chưa công bố</Text>}
        </div>
        <Text type="secondary">
          Công thức: lượt k chọn đội thứ idx = SHA256("{"{seed}:{k}"}") mod (số đội còn lại), danh sách còn lại theo id tăng dần.
        </Text>
      </div>
      <ResponsiveTable
        columns={cols} dataSource={steps} rowKey="step_index" size="small" pagination={false}
        mobileTitle={(s) => {
          const p = participantsById[s.participant_id];
          return <span>Lượt {s.step_index + 1}: <b>{p ? teamLabel(p) : `#${s.participant_id}`}</b> → {s.slot_label}</span>;
        }}
        mobileHideColumns={["Lượt", "Đội", "Ô"]}
      />
      <Space wrap>
        <Button
          icon={<SafetyCertificateOutlined />}
          loading={verify.loading}
          disabled={!draw.seed_hex}
          onClick={handleVerify}
        >
          Kiểm chứng
        </Button>
        {verify.result === null && (
          <Text type="secondary">Trình duyệt không hỗ trợ tính SHA-256 (cần HTTPS).</Text>
        )}
        {verify.result && (
          verify.result.ok
            ? <Tag color="success">✅ Khớp toàn bộ ({verify.result.steps.length} lượt, seed đúng cam kết)</Tag>
            : <Tag color="error">
                ❌ Không khớp{!verify.result.commitOk ? " — seed không khớp cam kết" : ""}
              </Tag>
        )}
      </Space>
    </div>
  );
}

// ── Lịch sử bốc thăm của giải (chỉ tải lại khi phiên mới nhất đổi id/trạng thái) ─────
function DrawHistory({ api, tid, historyKey, participantsById }) {
  const [draws, setDraws] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api.tournaments.drawHistory(tid)
      .then(r => { if (!cancelled) setDraws(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {});   // 429/mạng lỗi: giữ danh sách cũ
    return () => { cancelled = true; };
  }, [api, tid, historyKey]);

  if (draws.length === 0) return null;

  return (
    <Collapse
      style={{ marginTop: 16 }}
      items={[{
        key: "draws",
        label: <Text strong>🎲 Kết quả bốc thăm (có thể kiểm chứng)</Text>,
        children: (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {draws.map(d => (
              <Card key={d.id} size="small" title={`Phiên #${d.seq}`}>
                <DrawHistoryItem draw={d} participantsById={participantsById} />
              </Card>
            ))}
          </div>
        ),
      }]}
    />
  );
}

// ── Danh sách đội của giải Nháp (public thấy được nhờ đang/đã có phiên ghép đội) ─────
// Giải chưa có lịch thi đấu nên thay Tabs bằng bảng đội + người chưa có đội (sẽ ghép tay).
function DraftTeamsCard({ tournament }) {
  const doubles = tournament.team_type === "doubles";
  const participants = [...(tournament.participants || [])].sort((a, b) => {
    // Đội đã ghép lên trước, người đơn lẻ xuống dưới; trong cùng nhóm giữ thứ tự id
    const sa = doubles && isSingleParticipant(a) ? 1 : 0;
    const sb = doubles && isSingleParticipant(b) ? 1 : 0;
    return sa - sb || a.id - b.id;
  });
  const singles = doubles ? participants.filter(isSingleParticipant).length : 0;
  const teams = participants.length - singles;

  const cols = [
    { title: doubles ? "Đội / Người chơi" : "Người chơi", render: (_, p) => <b>{teamLabel(p)}</b> },
    {
      title: "Hạng", width: 120,
      render: (_, p) => { const r = teamRank(p); return r ? <Tag color="purple">{r}</Tag> : <Text type="secondary">—</Text>; },
    },
  ];
  if (doubles) {
    cols.push({
      title: "Trạng thái", width: 130,
      render: (_, p) => isSingleParticipant(p)
        ? <Tag color="warning">Chưa có đội</Tag>
        : <Tag color="success">Đã có đội</Tag>,
    });
  }

  return (
    <>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="Giải chưa bắt đầu — ban tổ chức sẽ bắt đầu và bốc thăm cặp đấu sau khi ghép đội xong"
      />
      <Card
        size="small"
        title="Danh sách đội"
        extra={
          <Space size={4} wrap>
            {doubles && <Tag color="blue">{teams} đội</Tag>}
            {singles > 0 && <Tag color="warning">{singles} người chưa có đội</Tag>}
          </Space>
        }
      >
        {participants.length === 0
          ? <Empty description="Chưa có người chơi" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : (
            <ResponsiveTable
              columns={cols} dataSource={participants} rowKey="id" size="small" pagination={false}
              mobileTitle={(p) => (
                <span>
                  <b>{teamLabel(p)}</b>
                  {doubles && isSingleParticipant(p) && <Tag color="warning" style={{ marginLeft: 6 }}>Chưa có đội</Tag>}
                </span>
              )}
              mobileHideColumns={[cols[0].title, "Trạng thái"]}
            />
          )}
      </Card>
    </>
  );
}

// ── Một phiên ghép đội trong biên bản: seed + quy tắc + bảng lượt + người chưa có đội + Kiểm chứng ─────
function PartnerDrawHistoryItem({ draw }) {
  const [verify, setVerify] = useState({ loading: false, result: undefined }); // undefined = chưa bấm

  const handleVerify = async () => {
    setVerify({ loading: true, result: undefined });
    const result = await verifyPartnerDraw(draw);   // null = thiếu seed_hex hoặc trình duyệt không có crypto.subtle
    setVerify({ loading: false, result });
  };

  const poolById = {};
  (draw.pool || []).forEach(p => { poolById[p.pid] = p; });
  const nameOf = (pid) => poolById[pid]?.name || `#${pid}`;
  const rankOf = (pid) => {
    const r = poolById[pid]?.rank;
    return r && r !== UNRANKED ? r : null;
  };

  const steps = [...(draw.steps || [])].sort((a, b) => a.step_index - b.step_index);
  const stepResult = (k) => verify.result?.steps?.find(s => s.step_index === k);

  // Kế hoạch v2 (API luôn trả v2): total_steps = TRẦN THẬT (plan.total_steps_max), plan.total_steps_est = DỰ KIẾN.
  // Hai bên quy tắc trùng hạng (plan.estimated) hoặc dự kiến < trần → số lượt thật có thể khác → "k lượt (tối đa N, dự kiến M)".
  const total = Number(draw.total_steps ?? draw.plan?.total_steps_max) || 0;
  const totalEst = Number(draw.plan?.total_steps_est ?? total) || 0;
  const estimated = !!draw.plan?.estimated || totalEst < total;
  // Hết lượt hợp lệ / kẹt: ưu tiên cờ server trả; thiếu cờ → replay theo drawMath v2 (không còn trần).
  // Phiên đã chốt luôn coi là đã hết lượt.
  const finished = draw.status === "committed"
    || (typeof draw.finished === "boolean"
      ? draw.finished
      : partnerDrawFinished(draw.pool || [], draw.rules || [], steps));
  const stuck = typeof draw.stuck === "boolean"
    ? draw.stuck
    : partnerDrawStuck(draw.pool || [], draw.rules || [], steps);
  // "Kết thúc sớm" so với DỰ KIẾN (total_steps_est), không so với trần total_steps_max — trần có thể cao hơn
  // dự kiến ngay cả khi không trùng hạng (team_cap tính trên toàn pool), khi đó không phải kết thúc sớm.
  const endedEarly = finished && totalEst > 0 && steps.length < totalEst;
  // Người chưa có đội: phiên đã hết lượt hợp lệ → mọi người trong pool không được bốc (gồm cả người dư
  // ngẫu nhiên của hạng bị tiêu thụ một phần, và người còn lại khi quy tắc kết thúc sớm);
  // chưa hết (huỷ giữa chừng) → chỉ người kế hoạch đã loại từ đầu.
  const pickedPids = new Set(steps.map(s => s.pid));
  const unpairedPids = (finished && steps.length > 0)
    ? (draw.pool || []).map(p => p.pid).filter(pid => !pickedPids.has(pid))
    : (draw.plan?.unpaired_pids || []);

  const cols = [
    { title: "Lượt", dataIndex: "step_index", width: 60, align: "center", render: v => v + 1 },
    { title: "Ô", render: (_, s) => partnerLabelForStep(s, draw.plan) },
    {
      title: "Người", dataIndex: "pid",
      render: (pid, s) => (
        <span>
          <b>{nameOf(pid)}</b>
          {s.auto && <Tag style={{ marginLeft: 4 }}>tự động</Tag>}
        </span>
      ),
    },
    {
      title: "Hạng", width: 90,
      render: (_, s) => { const r = rankOf(s.pid); return r ? <Tag color="purple">{r}</Tag> : <Text type="secondary">—</Text>; },
    },
    {
      title: "Kiểm chứng", width: 100, align: "center",
      render: (_, s) => {
        const r = stepResult(s.step_index);
        if (!r) return null;
        return r.ok ? <Tag color="success">✅ khớp</Tag> : <Tag color="error">❌ lệch</Tag>;
      },
    },
  ];
  const tag = PARTNER_STATUS_TAG[draw.status] || { label: draw.status, color: "default" };
  const endedAt = draw.committed_at || draw.cancelled_at;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Space wrap>
        <Tag color={tag.color}>{tag.label}</Tag>
        <Text type="secondary">
          {estimated
            ? `${steps.length} lượt (tối đa ${total}${totalEst < total ? `, dự kiến ${totalEst}` : ""})`
            : `${steps.length}/${total} lượt`}
        </Text>
        {stuck && <Tag color="error">Phiên bị kẹt — bên 2 không còn ai đủ điều kiện</Tag>}
        {endedEarly && !stuck && <Tag color="default">Kết thúc sớm — hết người đủ điều kiện</Tag>}
        <Text type="secondary">Mở: {fmtTime(draw.created_at)}</Text>
        {endedAt && <Text type="secondary">Kết thúc: {fmtTime(endedAt)}</Text>}
        {draw.cancel_reason && <Text type="secondary">Lý do: {draw.cancel_reason}</Text>}
      </Space>
      <div style={{ fontSize: 12, wordBreak: "break-all" }}>
        <div><Text type="secondary">Quy tắc:</Text> {partnerRulesText(draw.rules)}. Người không khớp quy tắc được ghép tay sau.</div>
        <div><Text type="secondary">Cam kết seed (SHA-256):</Text> <Text code>{draw.seed_commit}</Text></div>
        <div>
          <Text type="secondary">Seed công khai:</Text>{" "}
          {draw.seed_hex ? <Text code>{draw.seed_hex}</Text> : <Text type="secondary">chưa công bố</Text>}
        </div>
        <Text type="secondary">
          Công thức: lượt k chọn người thứ idx = SHA256("{"{seed}:{k}"}") mod (số người đủ điều kiện ở lượt k —
          chưa được chọn và có hạng thuộc danh sách hạng của bên đang bốc; bên để trống = bất kỳ hạng),
          danh sách theo id tăng dần. Lượt bên 1 loại những người mà nếu chọn thì bên 2 không còn ai;
          quy tắc dừng khi hết cặp hợp lệ{estimated ? " nên số lượt thật có thể ít hơn trần / khác dự kiến" : ""}.
        </Text>
      </div>
      {steps.length > 0 && (
        <ResponsiveTable
          columns={cols} dataSource={steps} rowKey="step_index" size="small" pagination={false}
          mobileTitle={(s) => (
            <span>Lượt {s.step_index + 1}: <b>{nameOf(s.pid)}</b> → {partnerLabelForStep(s, draw.plan)}</span>
          )}
          mobileHideColumns={["Lượt", "Ô", "Người"]}
        />
      )}
      {unpairedPids.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <Text type="secondary">Chưa có đội (ghép tay sau): </Text>
          {unpairedPids.map(pid => (
            <Tag key={pid} color="warning" style={{ marginBottom: 4 }}>
              {nameOf(pid)}{rankOf(pid) ? ` · ${rankOf(pid)}` : ""}
            </Tag>
          ))}
        </div>
      )}
      <Space wrap>
        <Button
          icon={<SafetyCertificateOutlined />}
          loading={verify.loading}
          disabled={!draw.seed_hex}
          onClick={handleVerify}
        >
          Kiểm chứng
        </Button>
        {verify.result === null && (
          <Text type="secondary">Trình duyệt không hỗ trợ tính SHA-256 (cần HTTPS).</Text>
        )}
        {verify.result && (
          verify.result.ok
            ? <Tag color="success">✅ Khớp toàn bộ ({verify.result.steps.length} lượt, seed đúng cam kết)</Tag>
            : <Tag color="error">
                ❌ Không khớp{!verify.result.commitOk ? " — seed không khớp cam kết" : ""}
              </Tag>
        )}
      </Space>
    </div>
  );
}

// ── Biên bản ghép đội của giải (chỉ tải lại khi phiên mới nhất đổi id/trạng thái) ─────
function PartnerDrawHistory({ api, tid, historyKey }) {
  const [draws, setDraws] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api.tournaments.partnerDrawHistory(tid)
      .then(r => { if (!cancelled) setDraws(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {});   // 429/mạng lỗi: giữ danh sách cũ
    return () => { cancelled = true; };
  }, [api, tid, historyKey]);

  if (draws.length === 0) return null;

  return (
    <Collapse
      style={{ marginTop: 16 }}
      items={[{
        key: "partner-draws",
        label: <Text strong>🎲 Biên bản ghép đội (có thể kiểm chứng)</Text>,
        children: (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {draws.map(d => (
              <Card key={d.id} size="small" title={`Phiên #${d.seq}`}>
                <PartnerDrawHistoryItem draw={d} />
              </Card>
            ))}
          </div>
        ),
      }]}
    />
  );
}

/**
 * Poll nhanh 2s một phiên đang mở (bốc cặp đấu hoặc ghép đội): tạm dừng khi tab ẩn (poll lại ngay
 * khi hiện), giãn 5s khi 429. Dùng setTimeout nối tiếp thay vì setInterval để đổi nhịp được và không
 * chồng request. `loadFn` là useCallback trả { ok, status } (đã gắn với giải đang xem).
 */
function useFastPoll(enabled, loadFn) {
  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let inflight = false;
    let timer = null;
    const tick = async () => {
      if (stopped || inflight) return;
      if (document.hidden) return;            // visibilitychange sẽ khởi động lại
      inflight = true;
      const res = await loadFn();
      inflight = false;
      if (stopped) return;
      timer = setTimeout(tick, res?.status === 429 ? DRAW_POLL_SLOW_MS : DRAW_POLL_MS);
    };
    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    tick();   // phát hiện open lần đầu (từ detail 12s) → nạp phiên ngay, không chờ nhịp poll
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, loadFn]);
}

/** Phiên "mới nhất" giữa bản local (poll 2s, tươi hơn nếu cùng id) và tóm tắt trong detail (12s). */
function pickLatest(local, summary) {
  if (local && summary) {
    if (local.id === summary.id) return local;
    return (local.seq ?? 0) >= (summary.seq ?? 0) ? local : summary;
  }
  return local || summary || null;
}

export default function PublicTournamentTracker({ api }) {
  const [list, setList] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Phiên bốc thăm / ghép đội gắn với giải đang xem: lưu kèm tid để tự "reset" khi đổi giải mà không cần setState trong effect
  const [drawState, setDrawState] = useState(null);           // { tid, draw: DrawOut|null, offset: number }
  const [partnerState, setPartnerState] = useState(null);     // { tid, draw: PartnerDrawOut|null, offset: number }
  const pollRef = useRef(null);
  const lastDrawKeyRef = useRef(null);        // "tid:id:status" lần poll trước — phát hiện open → committed/cancelled
  const lastPartnerKeyRef = useRef(null);     // như trên, cho phiên ghép đội

  // Danh sách giải: tải lúc mount và mỗi tick 12s (bucket rate-limit riêng theo path) để giải vừa
  // "Bắt đầu" xuất hiện mà không cần F5; tự chọn giải khi chưa chọn gì / giải cũ biến mất:
  // ưu tiên đang diễn ra → Nháp đang ghép đội trực tiếp → phần tử đầu.
  const loadList = useCallback(() => (
    api.tournaments.list()
      .then(r => {
        const data = Array.isArray(r.data) ? r.data : [];
        setList(data);
        if (data.length > 0) {
          const preferred = data.find(t => t.status === "active")
            || data.find(t => t.partner_draw_status === "open")
            || data[0];
          setSelectedId(prev => (prev && data.some(t => t.id === prev)) ? prev : preferred.id);
        }
      })
      .catch(() => {})   // lỗi mạng/429: giữ danh sách cũ
  ), [api]);

  useEffect(() => {
    loadList().finally(() => setLoading(false));
    const id = setInterval(loadList, POLL_MS);
    return () => clearInterval(id);
  }, [loadList]);

  const loadDetail = useCallback((silent) => {
    if (!selectedId) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    api.tournaments.detail(selectedId)
      .then(r => setTournament(r.data))
      .catch(() => {})   // 429/404 thoáng qua: giữ dữ liệu cũ, không làm trắng trang
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [selectedId, api]);

  useEffect(() => {
    if (!selectedId) return;
    // loadDetail(false) bật setLoading(true) đồng bộ — cờ loading cần bật lại mỗi khi
    // đổi giải đấu đang xem (selectedId đổi), không phải derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetail(false);
    pollRef.current = setInterval(() => loadDetail(true), POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [selectedId, loadDetail]);

  // Phiên bốc thăm chi tiết (chỉ hợp lệ với giải đang xem)
  const draw = drawState?.tid === selectedId ? drawState.draw : null;
  const drawOffset = drawState?.tid === selectedId ? drawState.offset : 0;

  // Tải phiên mới nhất từ endpoint public riêng. Trả { ok, status } để vòng poll quyết định giãn nhịp.
  const loadDraw = useCallback(async () => {
    if (!selectedId) return { ok: false };
    try {
      const r = await api.tournaments.draw(selectedId);
      const d = r.data?.draw || null;
      setDrawState({ tid: selectedId, draw: d, offset: serverOffset(r.data?.server_now_ms) });
      const key = d ? `${selectedId}:${d.id}:${d.status}` : null;
      const prev = lastDrawKeyRef.current;
      lastDrawKeyRef.current = key;
      // Vừa rời trạng thái open (chốt/huỷ, hoặc đã sang phiên khác) → nạp lại chi tiết ngay để lịch xuất hiện
      if (prev && prev.startsWith(`${selectedId}:`) && prev.endsWith(":open") && key !== prev) loadDetail(true);
      return { ok: true };
    } catch (err) {
      return { ok: false, status: err?.response?.status };
    }
  }, [selectedId, api, loadDetail]);

  // Nguồn quyết định "đang live": phiên local (poll 2s) tươi hơn tóm tắt trong detail (12s) nếu cùng id;
  // khác id thì lấy phiên có seq lớn hơn (detail có thể thấy phiên mới mở trước khi local kịp poll).
  const latestDraw = pickLatest(draw, tournament?.draw || null);
  const isLive = latestDraw?.status === "open";
  const showCeremony = draw?.status === "open";

  // Poll nhanh 2s khi phiên bốc cặp đấu đang mở (cơ chế dùng chung với phiên ghép đội bên dưới)
  useFastPoll(isLive && !!selectedId, loadDraw);

  // ── Phiên GHÉP ĐỘI (partner draw) — giải Nháp đôi, public thấy được nhờ có phiên open/committed ──
  const partnerDraw = partnerState?.tid === selectedId ? partnerState.draw : null;
  const partnerOffset = partnerState?.tid === selectedId ? partnerState.offset : 0;

  const loadPartnerDraw = useCallback(async () => {
    if (!selectedId) return { ok: false };
    try {
      const r = await api.tournaments.partnerDraw(selectedId);
      const d = r.data?.partner_draw || null;
      setPartnerState({ tid: selectedId, draw: d, offset: serverOffset(r.data?.server_now_ms) });
      const key = d ? `${selectedId}:${d.id}:${d.status}` : null;
      const prev = lastPartnerKeyRef.current;
      lastPartnerKeyRef.current = key;
      // Vừa rời trạng thái open (chốt/huỷ) → nạp lại chi tiết ngay để danh sách đội + biên bản xuất hiện.
      // (Huỷ → giải Nháp biến mất khỏi public: detail 404 giữ dữ liệu cũ, list 12s sẽ chuyển sang giải khác.)
      if (prev && prev.startsWith(`${selectedId}:`) && prev.endsWith(":open") && key !== prev) loadDetail(true);
      return { ok: true };
    } catch (err) {
      const status = err?.response?.status;
      // Phiên đang mở bị huỷ → giải Nháp không còn hiển thị public (404): bỏ phiên local và nạp lại danh
      // sách ngay để Select chuyển sang giải khác thay vì chờ tick 12s. Chỉ làm 1 lần cho mỗi lần chuyển
      // (xoá key) để không gọi list lặp mỗi 2s.
      const prev = lastPartnerKeyRef.current;
      if (status === 404 && prev && prev.startsWith(`${selectedId}:`) && prev.endsWith(":open")) {
        lastPartnerKeyRef.current = null;
        setPartnerState({ tid: selectedId, draw: null, offset: 0 });
        // Detail cũng 404 nên tóm tắt `tournament.partner_draw` vẫn là "open" → cập nhật local thành
        // cancelled để tắt poll 2s ngay (nếu list không còn giải nào khác, Select không đổi và poll sẽ
        // nhận 404 vô hạn).
        setTournament((t) => (t && t.id === selectedId
          ? { ...t, partner_draw: t.partner_draw ? { ...t.partner_draw, status: "cancelled" } : null }
          : t));
        loadList();
      }
      return { ok: false, status };
    }
  }, [selectedId, api, loadDetail, loadList]);

  const latestPartnerDraw = pickLatest(partnerDraw, tournament?.partner_draw || null);
  const isPartnerLive = latestPartnerDraw?.status === "open";
  const showPartnerCeremony = partnerDraw?.status === "open";

  useFastPoll(isPartnerLive && !!selectedId, loadPartnerDraw);

  const participantsById = (() => {
    const m = {};
    (tournament?.participants || []).forEach(p => { m[p.id] = p; });
    return m;
  })();

  if (loading && !tournament) {
    return <div style={{ textAlign: "center", padding: 48 }}><Spin size="large" /></div>;
  }

  if (!list || list.length === 0) {
    return <Empty description="CLB chưa có giải đấu nào để theo dõi" />;
  }

  const matches = tournament?.matches || [];
  // Giải Nháp chỉ lọt ra public khi đang/đã ghép đội → không có lịch, hiện danh sách đội thay Tabs
  const isDraft = tournament?.status === "draft";
  // Giải đã "Bắt đầu" nhưng chưa có lịch và không đang bốc thăm → màn chờ thay vì Tabs rỗng
  const waiting = tournament && tournament.status === "active" && matches.length === 0 && !showCeremony;
  const showHistory = tournament && latestDraw && latestDraw.status !== "open";
  const showPartnerHistory = tournament && latestPartnerDraw && latestPartnerDraw.status !== "open";
  const anyLive = isLive || isPartnerLive;

  return (
    <div>
      <Space wrap style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }}>
        <Select
          value={selectedId}
          onChange={setSelectedId}
          style={{ minWidth: 260 }}
          options={list.map(t => ({
            value: t.id,
            label: (
              <span>
                <TrophyOutlined style={{ color: "#faad14", marginRight: 6 }} />
                {t.name}
                {t.status === "active" && <Tag color="green" style={{ marginLeft: 6 }}>Đang diễn ra</Tag>}
                {t.status === "completed" && <Tag color="default" style={{ marginLeft: 6 }}>Đã kết thúc</Tag>}
                {t.status === "draft" && (
                  t.partner_draw_status === "open"
                    ? <Tag color="processing" style={{ marginLeft: 6 }}>Đang ghép đội</Tag>
                    : <Tag color="orange" style={{ marginLeft: 6 }}>Chuẩn bị</Tag>
                )}
              </span>
            ),
          }))}
        />
        <Button
          icon={refreshing ? <SyncOutlined spin /> : <ReloadOutlined />}
          onClick={() => { loadDetail(true); if (isLive) loadDraw(); if (isPartnerLive) loadPartnerDraw(); }}
          loading={false}
        >
          Làm mới
        </Button>
      </Space>

      {tournament && (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Badge status={anyLive || tournament.status === "active" ? "processing" : "default"} />
            <Text type="secondary">
              {isPartnerLive
                ? `Đang theo dõi ghép đội trực tiếp (cập nhật ${DRAW_POLL_MS / 1000}s)`
                : isLive
                  ? `Đang theo dõi bốc thăm trực tiếp (cập nhật ${DRAW_POLL_MS / 1000}s)`
                  : `Tự động cập nhật mỗi ${POLL_MS / 1000}s`}
            </Text>
          </Space>

          {showPartnerCeremony && (
            <Card size="small" title="🎡 Lễ ghép đội trực tiếp" style={{ marginBottom: 16 }}>
              <PartnerDrawCeremony
                mode="public"
                tournament={tournament}
                draw={partnerDraw}
                serverOffsetMs={partnerOffset}
                fullscreen={false}
              />
            </Card>
          )}

          {showCeremony && (
            <Card size="small" title="🎡 Lễ bốc thăm trực tiếp" style={{ marginBottom: 16 }}>
              <DrawCeremony
                mode="public"
                tournament={tournament}
                draw={draw}
                serverOffsetMs={drawOffset}
                fullscreen={false}
              />
            </Card>
          )}

          {isDraft
            ? <DraftTeamsCard tournament={tournament} />
            : waiting
              ? <Empty description="Chưa có lịch thi đấu — ban tổ chức sẽ bốc thăm/sinh lịch trước giờ đấu" />
              : <TournamentContent tournament={tournament} api={api} onScored={() => loadDetail(true)} />}

          {showPartnerHistory && (
            <PartnerDrawHistory
              api={api}
              tid={tournament.id}
              historyKey={`${latestPartnerDraw.id}:${latestPartnerDraw.status}`}
            />
          )}

          {showHistory && (
            <DrawHistory
              api={api}
              tid={tournament.id}
              historyKey={`${latestDraw.id}:${latestDraw.status}`}
              participantsById={participantsById}
            />
          )}
        </>
      )}
    </div>
  );
}
