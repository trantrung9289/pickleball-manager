import { useEffect, useState, useCallback, useRef } from "react";
import {
  Select, Tabs, Empty, Spin, Card, Tag, Typography,
  Collapse, Divider, Space, Button, Badge, Modal, Form, Input, AutoComplete, message,
} from "antd";
import {
  ReloadOutlined, SyncOutlined, TrophyOutlined, EditOutlined, SafetyCertificateOutlined,
} from "@ant-design/icons";
import ResponsiveTable from "./ResponsiveTable";
import DrawCeremony from "./draw/DrawCeremony";
import { useViewMode } from "../contexts/ViewModeContext";
import { teamLabel, teamRank } from "../utils/tournamentLabels";
import { serverOffset, verifyDraw } from "../utils/drawMath";

const { Text } = Typography;

const POLL_MS = 12000;        // poll chi tiết giải + danh sách giải
const DRAW_POLL_MS = 2000;    // poll nhanh phiên bốc thăm đang mở (endpoint riêng, bucket rate-limit riêng)
const DRAW_POLL_SLOW_MS = 5000; // giãn ra khi server trả 429, tới lần thành công kế tiếp

const DRAW_STATUS_TAG = {
  committed:  { label: "Đã áp dụng", color: "success" },
  superseded: { label: "Đã thay bằng phiên mới", color: "default" },
  cancelled:  { label: "Đã huỷ", color: "error" },
  open:       { label: "Đang bốc thăm", color: "processing" },
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

export default function PublicTournamentTracker({ api }) {
  const [list, setList] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Phiên bốc thăm gắn với giải đang xem: lưu kèm tid để tự "reset" khi đổi giải mà không cần setState trong effect
  const [drawState, setDrawState] = useState(null);   // { tid, draw: DrawOut|null, offset: number }
  const pollRef = useRef(null);
  const lastDrawKeyRef = useRef(null);                // "id:status" lần poll trước — phát hiện open → committed/cancelled

  // Danh sách giải: tải lúc mount và mỗi tick 12s (bucket rate-limit riêng theo path) để giải vừa
  // "Bắt đầu" xuất hiện mà không cần F5; tự chọn giải đang diễn ra khi chưa chọn gì / giải cũ biến mất.
  const loadList = useCallback(() => (
    api.tournaments.list()
      .then(r => {
        const data = Array.isArray(r.data) ? r.data : [];
        setList(data);
        if (data.length > 0) {
          const active = data.find(t => t.status === "active") || data[0];
          setSelectedId(prev => (prev && data.some(t => t.id === prev)) ? prev : active.id);
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
  const summary = tournament?.draw || null;
  const latestDraw = (() => {
    if (draw && summary) {
      if (draw.id === summary.id) return draw;
      return (draw.seq ?? 0) >= (summary.seq ?? 0) ? draw : summary;
    }
    return draw || summary;
  })();
  const isLive = latestDraw?.status === "open";
  const showCeremony = draw?.status === "open";

  // Poll nhanh 2s khi phiên đang mở: tạm dừng khi tab ẩn (poll lại ngay khi hiện), giãn 5s khi 429.
  // Dùng setTimeout nối tiếp thay vì setInterval để đổi nhịp được và không chồng request.
  useEffect(() => {
    if (!isLive || !selectedId) return undefined;
    let stopped = false;
    let inflight = false;
    let timer = null;
    const tick = async () => {
      if (stopped || inflight) return;
      if (document.hidden) return;            // visibilitychange sẽ khởi động lại
      inflight = true;
      const res = await loadDraw();
      inflight = false;
      if (stopped) return;
      timer = setTimeout(tick, res.status === 429 ? DRAW_POLL_SLOW_MS : DRAW_POLL_MS);
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
  }, [isLive, selectedId, loadDraw]);

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
  // Giải đã "Bắt đầu" nhưng chưa có lịch và không đang bốc thăm → màn chờ thay vì Tabs rỗng
  const waiting = tournament && tournament.status === "active" && matches.length === 0 && !showCeremony;
  const showHistory = tournament && latestDraw && latestDraw.status !== "open";

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
              </span>
            ),
          }))}
        />
        <Button
          icon={refreshing ? <SyncOutlined spin /> : <ReloadOutlined />}
          onClick={() => { loadDetail(true); if (isLive) loadDraw(); }}
          loading={false}
        >
          Làm mới
        </Button>
      </Space>

      {tournament && (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Badge status={isLive || tournament.status === "active" ? "processing" : "default"} />
            <Text type="secondary">
              {isLive
                ? `Đang theo dõi bốc thăm trực tiếp (cập nhật ${DRAW_POLL_MS / 1000}s)`
                : `Tự động cập nhật mỗi ${POLL_MS / 1000}s`}
            </Text>
          </Space>

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

          {waiting
            ? <Empty description="Chưa có lịch thi đấu — ban tổ chức sẽ bốc thăm/sinh lịch trước giờ đấu" />
            : <TournamentContent tournament={tournament} api={api} onScored={() => loadDetail(true)} />}

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
