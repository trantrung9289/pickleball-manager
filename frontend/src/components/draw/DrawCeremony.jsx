/**
 * DrawCeremony — "lễ bốc thăm" dùng chung admin (overlay toàn màn hình) và public (inline).
 * Nhận dữ liệu thuần (tournament, draw) + callback; không tự gọi API. Không có undo từng lượt:
 * admin chỉ có thể "Huỷ phiên" rồi mở phiên mới (quyết định sản phẩm).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Badge, Button, Space, Tag, theme } from "antd";
import {
  CheckCircleOutlined, CloseOutlined, SafetyCertificateOutlined, StopOutlined, SyncOutlined,
} from "@ant-design/icons";
import DrawWheel from "./DrawWheel";
import DrawBoard from "./DrawBoard";
import { useViewMode } from "../../contexts/ViewModeContext";
import { teamLabel } from "../../utils/tournamentLabels";
import {
  remainingPool, revealAtClientMs, extraTurnsFor, verifyDraw,
} from "../../utils/drawMath";

const STATUS_TAG = {
  open:       { label: "Đang bốc thăm", color: "processing" },
  committed:  { label: "Đã chốt", color: "success" },
  cancelled:  { label: "Đã huỷ", color: "error" },
  superseded: { label: "Đã thay bằng phiên mới", color: "default" },
};
const RULE_TEXT = {
  combined:   "Lượt 1 vào bảng A, lượt 2 vào bảng B..., lần lượt xoay vòng.",
  knockout:   "Bốc theo vị trí sơ đồ từ trên xuống; các vị trí có ghi 'miễn vòng 1' vào thẳng vòng 2.",
  individual: "Hai lượt liên tiếp tạo thành một trận.",
};
const DARK = { bg: "#0f172a", text: "#e2e8f0", muted: "#94a3b8", panel: "rgba(255,255,255,.05)", border: "rgba(255,255,255,.12)" };

const sortSteps = (steps) => [...(steps || [])].sort((a, b) => a.step_index - b.step_index);

/** Số lượt đã tới mốc dừng kim lúc mount — người vào muộn không xem lại từ đầu. */
const countRevealedNow = (steps, revealMs, offsetMs) => {
  const now = Date.now();
  return steps.filter((s) => revealAtClientMs(s, revealMs, offsetMs) <= now).length;
};

// Bọc ngoài với key=draw.id để mọi state cục bộ (revealedCount, highlight...) reset khi sang phiên khác
export default function DrawCeremony(props) {
  return <DrawCeremonyInner key={props.draw?.id ?? "none"} {...props} />;
}

function DrawCeremonyInner({
  mode = "public", tournament, draw, serverOffsetMs = 0, busy = false,
  onSpin, onCommit, onCancel, onClose, fullscreen = true,
}) {
  const { isMobileView } = useViewMode();
  const { token } = theme.useToken();
  const isAdmin = mode === "admin";

  const steps = useMemo(() => sortSteps(draw?.steps), [draw?.steps]);
  const pool = useMemo(() => draw?.pool || [], [draw?.pool]);
  const total = draw?.total_steps ?? pool.length;
  const revealMs = draw?.reveal_ms ?? 5000;
  const format = draw?.format || tournament?.format;
  const numGroups = draw?.num_groups ?? tournament?.num_groups ?? 2;

  const participantsById = useMemo(() => {
    const m = {};
    (tournament?.participants || []).forEach((p) => { m[p.id] = p; });
    return m;
  }, [tournament?.participants]);

  const [revealedCount, setRevealedCount] = useState(() => countRevealedNow(steps, revealMs, serverOffsetMs));
  const [lastPicked, setLastPicked] = useState(null);      // step vừa quay xong (hiện thẻ "Vừa bốc")
  const [highlightStep, setHighlightStep] = useState(null);
  const [verifyState, setVerifyState] = useState({ loading: false, result: undefined }); // undefined = chưa bấm

  const revealed = Math.min(revealedCount, steps.length);
  // Lượt kế tiếp cần quay (suy ra từ props, không cần effect): có step server đã trả nhưng client chưa reveal
  const nextStep = steps.length > revealed ? steps[revealed] : null;
  const spinning = !!nextStep;

  // Quạt trên vòng: đang quay → pool trước lượt đó (có đội thắng); rảnh → giữ nguyên lượt vừa rồi
  // để kim vẫn chỉ vào đội vừa bốc cho tới khi bấm quay tiếp
  const wheelItems = useMemo(() => {
    const upto = nextStep ? nextStep.step_index : (lastPicked ? lastPicked.step_index : revealed);
    return remainingPool(pool, steps.slice(0, upto)).map((id) => {
      const p = participantsById[id];
      return { id, label: p ? teamLabel(p) : `#${id}`, withdrawn: p?.status === "withdrawn" };
    });
  }, [pool, steps, nextStep, lastPicked, revealed, participantsById]);

  // Mốc client (ms) kim phải dừng — DrawWheel tự tính thời lượng còn lại lúc bắt đầu quay
  const revealAtMs = nextStep ? revealAtClientMs(nextStep, revealMs, serverOffsetMs) : null;

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

  // Khoá scroll body khi overlay mở
  useEffect(() => {
    if (!fullscreen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  // Kích thước vòng theo viewport (cập nhật khi resize/xoay máy)
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Xếp 1 cột khi là chế độ mobile HOẶC cửa sổ thật sự hẹp (< 768px): người dùng có thể ép chế độ
  // "desktop" trong app nhưng bảng ô đích 2 cột trên màn hình hẹp sẽ bị cắt mất bên phải.
  const narrow = isMobileView || vp.w < 768;
  const wheelSize = (() => {
    if (fullscreen) {
      if (narrow) return Math.max(200, Math.min(vp.w - 32, vp.h * 0.55));
      return Math.max(240, Math.min(vp.w * 0.55 - 96, vp.h - 250, 640));
    }
    return narrow ? Math.max(200, Math.min(vp.w - 80, vp.h * 0.55)) : 380;
  })();

  const runVerify = async () => {
    setVerifyState({ loading: true, result: undefined });
    const r = await verifyDraw(draw);
    setVerifyState({ loading: false, result: r });
  };

  // ── Màu theo ngữ cảnh: overlay tối cố định; inline theo token antd ──
  const c = fullscreen
    ? DARK
    : { bg: "transparent", text: token.colorText, muted: token.colorTextSecondary, panel: token.colorFillQuaternary, border: token.colorBorderSecondary };

  const st = STATUS_TAG[draw?.status] || { label: draw?.status || "—", color: "default" };
  const lastName = lastPicked ? teamLabel(participantsById[lastPicked.participant_id]) : null;
  const lastWithdrawn = lastPicked && participantsById[lastPicked.participant_id]?.status === "withdrawn";

  const panelStyle = { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 };
  const codeStyle = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, wordBreak: "break-all", color: c.text };

  const header = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: fullscreen ? 20 : 16, fontWeight: 700, color: c.text, lineHeight: 1.3 }}>
          🎡 {tournament?.name || "Bốc thăm"}
        </div>
        <Space size={8} wrap style={{ marginTop: 4 }}>
          <span style={{ color: c.text, fontWeight: 600 }}>Lượt {revealed}/{total}</span>
          <Tag color={st.color} style={{ marginInlineEnd: 0 }}>{st.label}</Tag>
          {draw?.seq != null && <span style={{ color: c.muted, fontSize: 12 }}>Phiên #{draw.seq}</span>}
        </Space>
        {RULE_TEXT[format] && (
          <div style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>{RULE_TEXT[format]}</div>
        )}
      </div>
      {isAdmin && fullscreen && (
        <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
      )}
    </div>
  );

  const lastCard = lastPicked && (
    <div style={{
      ...panelStyle, borderColor: "#fbbf24", background: fullscreen ? "rgba(251,191,36,.12)" : token.colorWarningBg,
      color: c.text, fontSize: 15,
    }}>
      <span style={{ color: c.muted, fontSize: 12 }}>Vừa bốc (lượt {lastPicked.step_index + 1}): </span>
      <b>{lastName}{lastWithdrawn ? " (bỏ giải)" : ""}</b>
      <span style={{ color: c.muted }}> → </span>
      <b style={{ color: "#f59e0b" }}>{lastPicked.slot_label}</b>
    </div>
  );

  const controls = isAdmin ? (
    <Space wrap size={8} style={{ justifyContent: "center", width: "100%" }}>
      {isOpen && remainingCount > 0 && (
        <Button
          type="primary" size="large" icon={<SyncOutlined spin={spinning} />}
          onClick={() => onSpin?.()} disabled={!canSpin} loading={busy}
          style={{ minWidth: 180, height: 52, fontSize: 18, fontWeight: 700 }}
        >
          {remainingCount === 1 ? "Xếp đội cuối" : "QUAY"}
        </Button>
      )}
      {isOpen && steps.length === total && total > 0 && (
        <Button
          type="primary" size="large" icon={<CheckCircleOutlined />}
          onClick={() => onCommit?.()} disabled={!canCommit} loading={busy}
          style={{ height: 52, fontSize: 16, fontWeight: 700, background: canCommit ? "#16a34a" : undefined }}
        >
          Chốt & sinh lịch
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
        <Alert type="success" showIcon message="Đã chốt kết quả — lịch thi đấu bên dưới" />
      ) : null}
      {isOpen && !spinning && remainingCount > 0 && (
        <div style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>Chờ ban tổ chức quay lượt tiếp theo…</div>
      )}
    </div>
  );

  const transparency = (
    <div style={{ ...panelStyle, fontSize: 13, color: c.text }}>
      <div style={{ fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <SafetyCertificateOutlined /> Minh bạch
      </div>
      <div style={{ color: c.muted }}>Cam kết seed (SHA-256):</div>
      <div style={codeStyle}>{draw?.seed_commit || "—"}</div>
      {draw?.seed_hex ? (
        <>
          <div style={{ color: c.muted, marginTop: 6 }}>Seed đã công bố:</div>
          <div style={codeStyle}>{draw.seed_hex}</div>
        </>
      ) : (
        <div style={{ color: c.muted, marginTop: 6 }}>Seed sẽ được công bố khi phiên kết thúc.</div>
      )}
      <div style={{ color: c.muted, marginTop: 6 }}>
        Công thức lượt k: <code style={codeStyle}>idx = SHA256("{"{seed}"}:{"{k}"}") mod (số đội còn lại)</code>
      </div>
      {draw?.seed_hex && (
        <Space wrap size={8} style={{ marginTop: 8 }}>
          <Button size="small" icon={<SafetyCertificateOutlined />} loading={verifyState.loading} onClick={runVerify}>
            Kiểm chứng
          </Button>
          {verifyState.result === null && (
            <span style={{ color: c.muted }}>Trình duyệt không hỗ trợ tính SHA-256 (cần HTTPS).</span>
          )}
          {verifyState.result && (
            verifyState.result.ok
              ? <Tag color="success">✅ Hợp lệ — seed khớp cam kết, {verifyState.result.steps.length} lượt đúng công thức</Tag>
              : <Tag color="error">❌ Không khớp{verifyState.result.commitOk ? "" : " (seed ≠ cam kết)"}</Tag>
          )}
        </Space>
      )}
    </div>
  );

  const board = (
    <DrawBoard
      format={format} numGroups={numGroups} n={total}
      steps={steps.slice(0, revealed)}       /* chỉ điền ô đã reveal để khớp với vòng quay */
      participantsById={participantsById} highlightStep={highlightStep} dark={fullscreen}
    />
  );

  const wheel = (
    <DrawWheel
      items={wheelItems}
      winnerId={nextStep ? nextStep.participant_id : null}
      spinKey={nextStep ? nextStep.step_index : null}
      durationMs={revealMs}
      revealAtMs={revealAtMs}
      extraTurns={nextStep ? extraTurnsFor(nextStep.step_index) : 4}
      size={wheelSize}
      onSettled={handleSettled}
    />
  );

  const twoCols = !narrow;
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {header}
      <div style={{
        display: "grid", gap: 16,
        gridTemplateColumns: twoCols ? (fullscreen ? "55fr 45fr" : "minmax(0, 420px) 1fr") : "1fr",
        alignItems: "start",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {wheel}
          {lastCard}
          {controls}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {board}
          {transparency}
        </div>
      </div>
    </div>
  );

  if (!fullscreen) return <div style={{ color: c.text }}>{body}</div>;

  // Overlay portal: z-index 900 (< 1000) để Modal.confirm / message của antd vẫn nổi lên trên
  return createPortal(
    <div className="draw-stage-root" style={{ background: DARK.bg, color: DARK.text }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: narrow ? "12px 16px 24px" : "20px 28px 32px" }}>
        {body}
      </div>
    </div>,
    document.body
  );
}
