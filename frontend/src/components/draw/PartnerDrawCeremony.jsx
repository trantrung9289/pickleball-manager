/**
 * PartnerDrawCeremony — "lễ GHÉP ĐỘI ĐÔI" bằng vòng quay, dùng chung admin (overlay) và public (inline).
 * Nhận dữ liệu thuần (tournament, draw = PartnerDrawOut) + callback; không tự gọi API.
 * Khác DrawCeremony (bốc cặp đấu): pool là NGƯỜI đơn lẻ (pid), mỗi lượt có danh sách đủ điều kiện
 * riêng (eligible_pids — theo hạng của quy tắc), 2 lượt liên tiếp tạo thành 1 đội; lượt chỉ còn 1 người
 * đủ điều kiện được điền tự động (không quay). Khung hiển thị do DrawStage đảm nhiệm.
 *
 * Props: { mode: 'admin'|'public', tournament, draw, serverOffsetMs, busy,
 *          onSpin, onCommit, onCancel, onClose, fullscreen }
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Space, Tag, theme } from "antd";
import {
  CheckCircleOutlined, CloseOutlined, StopOutlined, SyncOutlined, ThunderboltOutlined,
} from "@ant-design/icons";
import DrawWheel from "./DrawWheel";
import PairBoard from "./PairBoard";
import DrawStage, { useStageColors, useStageViewport } from "./DrawStage";
import {
  UNRANKED, rankLabel, revealAtClientMs, extraTurnsFor, partnerLabelForStep, verifyPartnerDraw,
} from "../../utils/drawMath";

const STATUS_TAG = {
  open:       { label: "Đang ghép đội", color: "processing" },
  committed:  { label: "Đã chốt", color: "success" },
  cancelled:  { label: "Đã huỷ", color: "error" },
  superseded: { label: "Đã thay bằng phiên mới", color: "default" },
};
const AUTO_FILL_MS = 600;   // ≤ 600ms → DrawWheel không quay, điền ngay

const sortSteps = (steps) => [...(steps || [])].sort((a, b) => a.step_index - b.step_index);

/** Số lượt đã tới mốc dừng kim lúc mount — người vào muộn không xem lại từ đầu. */
const countRevealedNow = (steps, revealMs, offsetMs) => {
  const now = Date.now();
  return steps.filter((s) => revealAtClientMs(s, revealMs, offsetMs) <= now).length;
};

const isAutoStep = (s) => !!s && (s.auto === true || (Array.isArray(s.eligible_pids) && s.eligible_pids.length === 1));

/** Dòng mô tả quy tắc theo thứ tự (hiện ở header). */
const rulesText = (rules) => {
  const list = Array.isArray(rules) ? rules.filter((r) => r && r.rank1 && r.rank2) : [];
  if (!list.length) return "Ngẫu nhiên toàn bộ (không lọc hạng).";
  return list.map((r, i) => `Quy tắc ${i + 1}: ${rankLabel(r.rank1, true)} + ${rankLabel(r.rank2, true)}`).join("; ") + ".";
};

// Bọc ngoài với key=draw.id để mọi state cục bộ (revealedCount, highlight...) reset khi sang phiên khác
export default function PartnerDrawCeremony(props) {
  return <PartnerDrawCeremonyInner key={props.draw?.id ?? "none"} {...props} />;
}

function PartnerDrawCeremonyInner({
  mode = "public", tournament, draw, serverOffsetMs = 0, busy = false,
  onSpin, onCommit, onCancel, onClose, fullscreen = true,
}) {
  const { token } = theme.useToken();
  const isAdmin = mode === "admin";

  const steps = useMemo(() => sortSteps(draw?.steps), [draw?.steps]);
  const pool = useMemo(() => draw?.pool || [], [draw?.pool]);
  const plan = draw?.plan;
  const total = draw?.total_steps ?? plan?.total_steps ?? 0;
  const revealMs = draw?.reveal_ms ?? 5000;

  const poolById = useMemo(() => {
    const m = {};
    pool.forEach((p) => { m[p.pid] = p; });
    return m;
  }, [pool]);
  const nameOf = (pid) => poolById[pid]?.name || `#${pid}`;

  const [revealedCount, setRevealedCount] = useState(() => countRevealedNow(steps, revealMs, serverOffsetMs));
  const [lastPicked, setLastPicked] = useState(null);      // step vừa quay xong (hiện thẻ "Vừa bốc")
  const [highlightStep, setHighlightStep] = useState(null);
  const [verifyState, setVerifyState] = useState({ loading: false, result: undefined }); // undefined = chưa bấm

  const revealed = Math.min(revealedCount, steps.length);
  // Lượt kế tiếp cần quay (suy ra từ props): có step server đã trả nhưng client chưa reveal
  const nextStep = steps.length > revealed ? steps[revealed] : null;
  const spinning = !!nextStep;
  const nextAuto = isAutoStep(nextStep);

  // Quạt trên vòng: đang quay → eligible của lượt đó (có người trúng); rảnh → GIỮ eligible của lượt vừa
  // quay (lastPicked) để kim vẫn chỉ đúng người vừa bốc cho tới khi bấm quay tiếp (như DrawCeremony) —
  // không được đổi sang pool lượt kế vì góc rotor giữ nguyên, kim sẽ chỉ nhầm người khác. Chỉ khi chưa
  // có lastPicked (người vào muộn / mount mới) mới dùng next_step server đã tính, rồi tới lượt cuối
  // (xem lại phiên đã chốt thấy vòng của lượt cuối thay vì vòng trống).
  const wheelItems = useMemo(() => {
    const src = nextStep
      ? nextStep.eligible_pids
      : (lastPicked?.eligible_pids ?? draw?.next_step?.eligible_pids ?? steps[steps.length - 1]?.eligible_pids ?? []);
    // Nhãn quạt: tên + " · hạng" khi đã có hạng
    return (src || []).map((pid) => {
      const p = poolById[pid];
      const label = !p ? `#${pid}` : (p.rank && p.rank !== UNRANKED ? `${p.name} · ${p.rank}` : p.name);
      return { id: pid, label };
    });
  }, [nextStep, draw?.next_step, lastPicked, steps, poolById]);

  // Mốc client (ms) kim phải dừng; lượt tự động → không đồng bộ mốc, điền ngay
  const revealAtMs = nextStep && !nextAuto ? revealAtClientMs(nextStep, revealMs, serverOffsetMs) : null;

  const handleSettled = useCallback(() => {
    if (!nextStep) return;
    setLastPicked(nextStep);
    setHighlightStep(nextStep.step_index);
    setRevealedCount((c) => c + 1);
  }, [nextStep]);

  // ── Admin: điều kiện nút ──
  const allRevealed = revealed === steps.length;
  const isOpen = draw?.status === "open";
  const remainingCount = total - steps.length;
  const canSpin = isAdmin && isOpen && !busy && !spinning && allRevealed && remainingCount > 0;
  const canCommit = isAdmin && isOpen && !busy && !spinning && allRevealed && steps.length === total && total > 0;
  const serverNextAuto = (draw?.next_step?.eligible_pids?.length ?? 0) === 1;

  // Phím Space = QUAY (bỏ qua khi focus đang ở button/input để không kích hoạt 2 lần)
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
    const r = await verifyPartnerDraw(draw);
    setVerifyState({ loading: false, result: r });
  };

  const st = STATUS_TAG[draw?.status] || { label: draw?.status || "—", color: "default" };
  const panelStyle = { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 };

  const tags = [
    <span key="turn" style={{ color: c.text, fontWeight: 600 }}>Lượt {revealed}/{total}</span>,
    <Tag key="status" color={st.color} style={{ marginInlineEnd: 0 }}>{st.label}</Tag>,
    draw?.seq != null && <span key="seq" style={{ color: c.muted, fontSize: 12 }}>Phiên #{draw.seq}</span>,
  ];
  const ruleText = `${rulesText(draw?.rules)} Người không khớp quy tắc sẽ được ghép tay sau.`;

  const lastCard = lastPicked && (
    <div style={{
      ...panelStyle, borderColor: "#fbbf24", background: fullscreen ? "rgba(251,191,36,.12)" : token.colorWarningBg,
      color: c.text, fontSize: 15,
    }}>
      <span style={{ color: c.muted, fontSize: 12 }}>
        Vừa bốc (lượt {lastPicked.step_index + 1}{isAutoStep(lastPicked) ? ", tự động" : ""}):{" "}
      </span>
      <b>{nameOf(lastPicked.pid)}</b>
      <span style={{ color: c.muted }}> → </span>
      <b style={{ color: "#f59e0b" }}>{partnerLabelForStep(lastPicked, plan)}</b>
    </div>
  );

  const controls = isAdmin ? (
    <Space wrap size={8} style={{ justifyContent: "center", width: "100%" }}>
      {isOpen && remainingCount > 0 && (
        <Button
          type="primary" size="large"
          icon={serverNextAuto ? <ThunderboltOutlined /> : <SyncOutlined spin={spinning} />}
          onClick={() => onSpin?.()} disabled={!canSpin} loading={busy}
          style={{ minWidth: 180, height: 52, fontSize: 18, fontWeight: 700 }}
        >
          {serverNextAuto ? "Điền tự động" : "QUAY"}
        </Button>
      )}
      {isOpen && steps.length === total && total > 0 && (
        <Button
          type="primary" size="large" icon={<CheckCircleOutlined />}
          onClick={() => onCommit?.()} disabled={!canCommit} loading={busy}
          style={{ height: 52, fontSize: 16, fontWeight: 700, background: canCommit ? "#16a34a" : undefined }}
        >
          Chốt & tạo đội
        </Button>
      )}
      {isOpen && (
        <Button danger icon={<StopOutlined />} onClick={() => onCancel?.()} disabled={busy}>Huỷ phiên</Button>
      )}
      {!fullscreen && onClose && <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>}
    </Space>
  ) : (
    <div style={{ textAlign: "center" }}>
      {isOpen ? (
        <Badge status="processing" text={<span style={{ color: c.text }}>Đang theo dõi trực tiếp</span>} />
      ) : draw?.status === "committed" ? (
        <Alert type="success" showIcon message="Đã chốt đội — danh sách đội bên dưới" />
      ) : null}
      {isOpen && !spinning && remainingCount > 0 && (
        <div style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>Chờ ban tổ chức quay lượt tiếp theo…</div>
      )}
    </div>
  );

  // Ô đang chờ trên bảng: lượt đang quay, hoặc (rảnh & còn mở) lượt kế tiếp server đã tính
  const pendingSlot = nextStep || (isOpen ? draw?.next_step : null);

  const board = (
    <PairBoard
      plan={plan} pool={pool}
      steps={steps.slice(0, revealed)}       /* chỉ điền ô đã reveal để khớp với vòng quay */
      nextStep={pendingSlot} spinning={spinning} highlightStep={highlightStep} dark={fullscreen}
    />
  );

  const wheel = (
    <DrawWheel
      items={wheelItems}
      winnerId={nextStep ? nextStep.pid : null}
      spinKey={nextStep ? nextStep.step_index : null}
      durationMs={nextAuto ? AUTO_FILL_MS : revealMs}
      revealAtMs={revealAtMs}
      extraTurns={nextStep ? extraTurnsFor(nextStep.step_index) : 4}
      size={wheelSize}
      onSettled={handleSettled}
    />
  );

  return (
    <DrawStage
      title={<>🎡 Ghép đội — {tournament?.name || "Giải đấu"}</>}
      tags={tags}
      ruleText={ruleText}
      wheel={wheel}
      underWheel={<>{lastCard}{controls}</>}
      board={board}
      transparency={{
        seedCommit: draw?.seed_commit,
        seedHex: draw?.seed_hex,
        formulaText: 'idx = SHA256("{seed}:{k}") mod (số người đủ điều kiện ở lượt k; đủ điều kiện = chưa được chọn và đúng hạng theo quy tắc)',
        onVerify: runVerify,
        verifyState,
      }}
      fullscreen={fullscreen}
      narrow={narrow}
      onClose={isAdmin && fullscreen ? onClose : undefined}   /* nút Đóng ở header chỉ cho admin overlay */
    />
  );
}
