/**
 * TeamDrawCeremony — "lễ PHÂN VĐV VÀO ĐỘI" bằng vòng quay (giải đồng đội), dùng chung admin (overlay) và
 * public (inline). Nhận dữ liệu thuần (tournament, draw = team draw dict) + callback; không tự gọi API.
 * Mỗi lượt: ô = (vòng, đội) do replay quyết định, quạt = VĐV còn chờ khớp tiêu chí vòng; chỉ còn 1 người → điền
 * tự động. Phiên kết thúc khi mọi VĐV đã có đội (draw.finished) → admin "Chốt & phân đội".
 *
 * Props: { mode: 'admin'|'public', tournament, draw, serverOffsetMs, busy, onSpin, onCommit, onCancel, onClose, fullscreen }
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Space, Tag, theme } from "antd";
import { CheckCircleOutlined, CloseOutlined, StopOutlined, SyncOutlined, ThunderboltOutlined } from "@ant-design/icons";
import DrawWheel from "./DrawWheel";
import TeamDrawBoard from "./TeamDrawBoard";
import DrawStage, { useStageColors, useStageViewport } from "./DrawStage";
import { UNRANKED, revealAtClientMs, extraTurnsFor } from "../../utils/drawMath";
import { GENDER_SHORT, normalizeTeamDrawRules, teamDrawFinished, teamDrawRuleLabel, verifyTeamDraw } from "../../utils/teamDraw";

const STATUS_TAG = {
  open:       { label: "Đang phân đội", color: "processing" },
  committed:  { label: "Đã chốt", color: "success" },
  cancelled:  { label: "Đã huỷ", color: "error" },
  superseded: { label: "Đã thay bằng phiên mới", color: "default" },
};
const AUTO_FILL_MS = 600;

const sortSteps = (steps) => [...(steps || [])].sort((a, b) => a.step_index - b.step_index);
const countRevealedNow = (steps, revealMs, offsetMs) => {
  const now = Date.now();
  return steps.filter((s) => revealAtClientMs(s, revealMs, offsetMs) <= now).length;
};
const isAutoStep = (s) => !!s && (s.auto === true || (Array.isArray(s.eligible_tpids) && s.eligible_tpids.length === 1));

export default function TeamDrawCeremony(props) {
  return <TeamDrawCeremonyInner key={props.draw?.id ?? "none"} {...props} />;
}

function TeamDrawCeremonyInner({
  mode = "public", tournament, draw, serverOffsetMs = 0, busy = false,
  onSpin, onCommit, onCancel, onClose, fullscreen = true,
}) {
  const { token } = theme.useToken();
  const isAdmin = mode === "admin";
  const steps = useMemo(() => sortSteps(draw?.steps), [draw?.steps]);
  const pool = useMemo(() => draw?.pool || [], [draw?.pool]);
  const teams = useMemo(() => draw?.teams || [], [draw?.teams]);
  const rules = useMemo(() => normalizeTeamDrawRules(draw?.rules || []), [draw?.rules]);
  const total = Number(draw?.total_steps) || pool.length;
  const revealMs = draw?.reveal_ms ?? 5000;
  const poolById = useMemo(() => new Map(pool.map((p) => [Number(p.tpid), p])), [pool]);
  const teamName = (pid) => teams.find((t) => Number(t.pid) === Number(pid))?.name || `Đội #${pid}`;
  const nameOf = (tpid) => poolById.get(Number(tpid))?.name || `#${tpid}`;

  const [revealedCount, setRevealedCount] = useState(() => countRevealedNow(steps, revealMs, serverOffsetMs));
  const [lastPicked, setLastPicked] = useState(null);
  const [highlightStep, setHighlightStep] = useState(null);
  const [verifyState, setVerifyState] = useState({ loading: false, result: undefined });

  const revealed = Math.min(revealedCount, steps.length);
  const nextStep = steps.length > revealed ? steps[revealed] : null;   // server đã quay, client chưa reveal
  const spinning = !!nextStep;
  const nextAuto = isAutoStep(nextStep);

  const wheelItems = useMemo(() => {
    const src = nextStep
      ? nextStep.eligible_tpids
      : (lastPicked?.eligible_tpids ?? draw?.next_step?.eligible_tpids ?? steps[steps.length - 1]?.eligible_tpids ?? []);
    return (src || []).map((tpid) => {
      const p = poolById.get(Number(tpid));
      const extra = [p?.rank && p.rank !== UNRANKED ? p.rank : null, GENDER_SHORT[p?.gender] || null].filter(Boolean).join(" · ");
      return { id: tpid, label: !p ? `#${tpid}` : extra ? `${p.name} · ${extra}` : p.name };
    });
  }, [nextStep, draw?.next_step, lastPicked, steps, poolById]);

  const revealAtMs = nextStep && !nextAuto ? revealAtClientMs(nextStep, revealMs, serverOffsetMs) : null;
  const handleSettled = useCallback(() => {
    if (!nextStep) return;
    setLastPicked(nextStep);
    setHighlightStep(nextStep.step_index);
    setRevealedCount((c) => c + 1);
  }, [nextStep]);

  const allRevealed = revealed === steps.length;
  const isOpen = draw?.status === "open";
  const finished = typeof draw?.finished === "boolean"
    ? draw.finished
    : teamDrawFinished(pool, teams.map((t) => t.pid), rules, steps);
  const canSpin = isAdmin && isOpen && !busy && !spinning && allRevealed && !finished;
  const canCommit = isAdmin && isOpen && !busy && !spinning && allRevealed && finished && steps.length > 0;
  const serverNextAuto = (draw?.next_step?.eligible_tpids?.length ?? 0) === 1;

  useEffect(() => {
    if (!isAdmin) return undefined;
    const onKey = (e) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const tag = e.target?.tagName;
      if (["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A"].includes(tag) || e.target?.isContentEditable) return;
      e.preventDefault();
      if (canSpin) onSpin?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAdmin, canSpin, onSpin]);

  const { narrow, wheelSize } = useStageViewport(fullscreen);
  const c = useStageColors(fullscreen);
  const runVerify = async () => {
    setVerifyState({ loading: true, result: undefined });
    setVerifyState({ loading: false, result: await verifyTeamDraw(draw) });
  };

  const st = STATUS_TAG[draw?.status] || { label: draw?.status || "—", color: "default" };
  const panelStyle = { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 };
  const tags = [
    <span key="turn" style={{ color: c.text, fontWeight: 600 }}>Lượt {revealed}/{total}</span>,
    <Tag key="status" color={st.color} style={{ marginInlineEnd: 0 }}>{st.label}</Tag>,
    draw?.seq != null && <span key="seq" style={{ color: c.muted, fontSize: 12 }}>Phiên #{draw.seq}</span>,
  ];
  const ruleText = rules.map((r, i) => `Vòng ${i + 1}: ${teamDrawRuleLabel(r)}`).join("; ")
    + ". Đội nhận theo kiểu rắn (lượt về đảo chiều); nhóm không chia hết → đội cuối theo thứ tự nhận ít hơn.";

  const lastCard = lastPicked && (
    <div style={{ ...panelStyle, borderColor: "#fbbf24", background: fullscreen ? "rgba(251,191,36,.12)" : token.colorWarningBg, color: c.text, fontSize: 15 }}>
      <span style={{ color: c.muted, fontSize: 12 }}>Vừa bốc (lượt {lastPicked.step_index + 1}{isAutoStep(lastPicked) ? ", tự động" : ""}): </span>
      <b>{nameOf(lastPicked.tpid)}</b>
      <span style={{ color: c.muted }}> → </span>
      <b style={{ color: "#f59e0b" }}>{teamName(lastPicked.team_pid)}</b>
      <span style={{ color: c.muted, fontSize: 12 }}> · vòng {Number(lastPicked.round_index) + 1}</span>
    </div>
  );
  const finishedNote = isOpen && finished && allRevealed && (
    <div style={{ ...panelStyle, color: c.text, fontSize: 14, textAlign: "center" }}>
      Đã phân xong {steps.length} VĐV vào {teams.length} đội{isAdmin ? " — bấm Chốt để ghi vào danh sách đội" : ""}
    </div>
  );

  const controls = isAdmin ? (
    <Space wrap size={8} style={{ justifyContent: "center", width: "100%" }}>
      {isOpen && !finished && (
        <Button type="primary" size="large" icon={serverNextAuto ? <ThunderboltOutlined /> : <SyncOutlined spin={spinning} />}
          onClick={() => onSpin?.()} disabled={!canSpin} loading={busy}
          style={{ minWidth: 180, height: 52, fontSize: 18, fontWeight: 700 }}>
          {serverNextAuto ? "Điền tự động" : "QUAY"}
        </Button>
      )}
      {isOpen && finished && steps.length > 0 && (
        <Button type="primary" size="large" icon={<CheckCircleOutlined />} onClick={() => onCommit?.()} disabled={!canCommit} loading={busy}
          style={{ height: 52, fontSize: 16, fontWeight: 700, background: canCommit ? "#16a34a" : undefined }}>
          Chốt & phân đội
        </Button>
      )}
      {isOpen && <Button danger icon={<StopOutlined />} onClick={() => onCancel?.()} disabled={busy}>Huỷ phiên</Button>}
      {!fullscreen && onClose && <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>}
    </Space>
  ) : (
    <div style={{ textAlign: "center" }}>
      {isOpen ? (
        <Badge status="processing" text={<span style={{ color: c.text }}>Đang theo dõi trực tiếp</span>} />
      ) : draw?.status === "committed" ? (
        <Alert type="success" showIcon message="Đã chốt — danh sách đội bên dưới" />
      ) : null}
      {isOpen && !spinning && !finished && <div style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>Chờ ban tổ chức quay lượt tiếp theo…</div>}
      {isOpen && !spinning && finished && <div style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>Chờ ban tổ chức chốt…</div>}
    </div>
  );

  const pendingSlot = nextStep || (isOpen && !finished ? draw?.next_step : null);
  const board = (
    <TeamDrawBoard draw={draw} steps={steps.slice(0, revealed)} nextStep={pendingSlot} highlightStep={highlightStep}
      dark={fullscreen} finished={finished && allRevealed} />
  );
  const wheel = (
    <DrawWheel items={wheelItems} winnerId={nextStep ? nextStep.tpid : null} spinKey={nextStep ? nextStep.step_index : null}
      durationMs={nextAuto ? AUTO_FILL_MS : revealMs} revealAtMs={revealAtMs}
      extraTurns={nextStep ? extraTurnsFor(nextStep.step_index) : 4} size={wheelSize} onSettled={handleSettled} />
  );

  return (
    <DrawStage
      title={<>🎡 Phân đội — {tournament?.name || "Giải đấu"}</>}
      tags={tags}
      ruleText={ruleText}
      wheel={wheel}
      underWheel={<>{lastCard}{finishedNote}{controls}</>}
      board={board}
      transparency={{
        seedCommit: draw?.seed_commit,
        seedHex: draw?.seed_hex,
        formulaText: 'idx = SHA256("{seed}:{k}") mod (số VĐV chờ khớp tiêu chí vòng ở lượt k); ô lượt k (vòng, đội) do thứ tự '
          + "rắn quyết định: mỗi lượt đi qua các đội, lượt kế đảo chiều; đội chạm trần của vòng bị bỏ qua",
        onVerify: runVerify,
        verifyState,
      }}
      fullscreen={fullscreen}
      narrow={narrow}
      onClose={isAdmin && fullscreen ? onClose : undefined}
    />
  );
}
