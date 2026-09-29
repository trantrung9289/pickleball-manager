/**
 * PairBoard — bảng ĐỘI của phiên ghép đội đôi, điền dần theo các lượt đã quay.
 * Hiển thị theo phase của kế hoạch v2 (plan.phases: {index, ranks1, ranks2, team_max, team_cap, overlap} —
 * API luôn trả v2, kể cả phiên cũ, nên không còn fallback shape cũ): mỗi đội một hàng
 * "Đội t: [Người 1] + [Người 2]". team_max chỉ là DỰ KIẾN: hàng đã có người vẽ theo step thật; hàng chưa tới
 * vẽ mờ tới đủ team_max cho phase đang chạy và các phase sau; quy tắc ghép được NHIỀU hơn dự kiến → tạo thêm
 * hàng cho đội mà lượt kế tiếp (nextStep) trỏ tới; phase đã qua mà chưa đủ đội → ghi chú "dừng sớm".
 * Dùng chung admin (overlay tối) và public.
 *
 * Props: { plan (PartnerDrawOut.plan), pool ([{pid, name, rank}]), steps (đã reveal), nextStep
 *          ({phase_index, team_index, side} — ô đang chờ), spinning (vòng đang quay cho ô đó → "Đang quay…",
 *          ngược lại "Lượt kế tiếp…"), highlightStep (step_index vừa điền), dark,
 *          finished (đã hết lượt hợp lệ → không vẽ hàng chờ, người chưa được chọn = ghép tay),
 *          stuck (phiên kẹt — bên 2 không còn ai đủ điều kiện → Alert gợi ý huỷ phiên và mở lại) }
 */
import { useMemo } from "react";
import { Alert, theme } from "antd";
import { UNRANKED, ranksPhrase, phaseRanks, rankLabel } from "../../utils/drawMath";

export default function PairBoard({
  plan, pool = [], steps = [], nextStep = null, spinning = false, highlightStep = null, dark = false,
  finished = false, stuck = false,
}) {
  const { token } = theme.useToken();

  const poolById = useMemo(() => {
    const m = new Map();
    (pool || []).forEach((p) => m.set(Number(p.pid), p));
    return m;
  }, [pool]);

  // Tra step theo ô (team_index, side) — không phụ thuộc phase_index để chịu được mọi cách đánh số phase
  const stepBySlot = useMemo(() => {
    const m = new Map();
    (steps || []).forEach((s) => m.set(`${s.team_index}:${s.side}`, s));
    return m;
  }, [steps]);

  const phases = useMemo(() => plan?.phases || [], [plan?.phases]);

  // Người chưa có đội: theo kế hoạch (hạng không được quy tắc nào dùng) + người chưa được chọn khi đã
  // hết lượt hợp lệ (finished — trần total_steps_max là cận trên thật nên "chạm trần" cũng là finished)
  const unpaired = useMemo(() => {
    const ids = new Set((plan?.unpaired_pids || []).map(Number));
    if (finished) {
      const picked = new Set((steps || []).map((s) => Number(s.pid)));
      (pool || []).forEach((p) => { if (!picked.has(Number(p.pid))) ids.add(Number(p.pid)); });
    }
    return [...ids].map((pid) => poolById.get(pid) || { pid, name: `#${pid}` }).sort((a, b) => a.pid - b.pid);
  }, [plan?.unpaired_pids, steps, pool, poolById, finished]);

  // Hàng của từng phase: đội thật (theo step) + hàng chờ mờ tới đủ team_max (chỉ từ phase đang chạy trở đi);
  // lượt kế tiếp trỏ tới đội chưa có hàng (quy tắc ghép được nhiều hơn dự kiến) → thêm hàng cho đội đó
  const rows = useMemo(() => {
    const phaseKey = (ph, i) => (Number.isFinite(Number(ph.index)) ? Number(ph.index) : i);
    const teamsByPhase = new Map();   // phase_index → Set(team_index)
    (steps || []).forEach((s) => {
      const k = Number(s.phase_index) || 0;
      if (!teamsByPhase.has(k)) teamsByPhase.set(k, new Set());
      teamsByPhase.get(k).add(Number(s.team_index));
    });
    const last = (steps || []).length ? steps[steps.length - 1] : null;
    const nextPhase = nextStep ? Number(nextStep.phase_index) || 0 : null;
    const activeIdx = finished
      ? Infinity
      : (nextStep ? nextPhase : (last ? Number(last.phase_index) || 0 : 0));
    // Vòng for thường (không .map với biến đếm bên ngoài) để hợp quy tắc react-hooks/immutability
    const out = [];
    let counter = 0;   // số thứ tự đội kế tiếp (0-based toàn phiên) cho các hàng chờ
    for (let i = 0; i < phases.length; i++) {
      const ph = phases[i];
      const idx = phaseKey(ph, i);
      const tm = Number(ph.team_max) || 0;
      const actual = [...(teamsByPhase.get(idx) || [])].sort((a, b) => a - b);
      if (actual.length) counter = Math.max(counter, actual[actual.length - 1] + 1);
      // Đội mới mà lượt kế tiếp trỏ tới nhưng chưa có step nào → cần thêm 1 hàng dù đã đủ team_max
      const needsExtra = !finished && nextStep && nextPhase === idx && !actual.includes(Number(nextStep.team_index));
      const want = Math.max(tm, actual.length + (needsExtra ? 1 : 0));
      const placeholders = [];
      if (idx >= activeIdx) {
        for (let t = actual.length; t < want; t++) { placeholders.push(counter); counter += 1; }
      }
      const stoppedEarly = actual.length < tm && idx < activeIdx;
      out.push({ ph, idx, tm, actual, placeholders, stoppedEarly });
    }
    return out;
  }, [phases, steps, nextStep, finished]);

  // Bảng màu: overlay tối dùng màu cố định; inline theo token antd để hợp cả theme sáng/tối của app
  const c = dark
    ? {
      text: "#e2e8f0", muted: "#94a3b8", border: "rgba(255,255,255,.16)", bg: "rgba(255,255,255,.05)",
      filledBg: "rgba(34,197,94,.16)", filledBorder: "#22c55e", waitBorder: "#fbbf24", head: "#fbbf24",
    }
    : {
      text: token.colorText, muted: token.colorTextSecondary, border: token.colorBorder, bg: token.colorFillQuaternary,
      filledBg: token.colorSuccessBg, filledBorder: token.colorSuccessBorder, waitBorder: token.colorWarning, head: token.colorPrimary,
    };

  const rankText = (r) => (r ? rankLabel(r) : null);

  // Hàm render thuần (không phải component lồng trong render) để ô không bị remount mỗi lần
  // poll → animation .draw-slot-flash không chạy lại ngoài ý muốn
  const renderSlot = (teamIndex, side, wantRanks) => {
    const s = stepBySlot.get(`${teamIndex}:${side}`);
    const person = s ? poolById.get(Number(s.pid)) : null;
    const name = s ? (person?.name || `#${s.pid}`) : null;
    const filled = !!s;
    const waiting = !filled && nextStep && Number(nextStep.team_index) === teamIndex && Number(nextStep.side) === side;
    const flash = filled && highlightStep != null && s.step_index === highlightStep;
    const hint = `Người ${side}${wantRanks.length ? ` · ${ranksPhrase(wantRanks)}` : ""}`;
    // Ô nhận nhiều hạng / bất kỳ hạng → ghi hạng thật của người được chọn để khán giả đối chiếu
    const showRank = filled && person?.rank && person.rank !== UNRANKED && wantRanks.length !== 1;
    return (
      <div
        key={side}
        className={flash || waiting ? "draw-slot-flash" : undefined}
        style={{
          flex: "1 1 0", minWidth: 0,
          border: `1px ${waiting ? "dashed" : "solid"} ${filled ? c.filledBorder : (waiting ? c.waitBorder : c.border)}`,
          background: filled ? c.filledBg : c.bg,
          borderRadius: 8, padding: "6px 10px", minHeight: 44, color: c.text,
          display: "flex", flexDirection: "column", justifyContent: "center", gap: 2,
          transition: "background .3s, border-color .3s",
          // Ô đang chờ nhấp nháy liên tục (keyframes có sẵn); ô vừa điền chỉ nháy 2 lần như DrawBoard
          ...(waiting ? { animationIterationCount: "infinite" } : {}),
        }}
      >
        <span style={{ fontSize: 11, color: c.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hint}</span>
        <span style={{ fontWeight: filled ? 600 : 400, color: filled ? c.text : c.muted, overflowWrap: "anywhere" }}>
          {name || (waiting ? (spinning ? "Đang quay…" : "Lượt kế tiếp…") : "…")}
          {showRank && <span style={{ fontWeight: 400, color: c.muted }}> · {person.rank}</span>}
        </span>
      </div>
    );
  };

  const renderRow = (t, ranks1, ranks2, dim) => (
    <div key={t} style={{ display: "flex", alignItems: "stretch", gap: 6, opacity: dim ? 0.55 : 1, transition: "opacity .3s" }}>
      <div style={{
        flex: "0 0 auto", width: 52, display: "flex", alignItems: "center",
        fontSize: 12, fontWeight: 700, color: c.muted, whiteSpace: "nowrap",
      }}>
        Đội {t + 1}
      </div>
      {renderSlot(t, 1, ranks1)}
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", color: c.muted, fontWeight: 700 }}>+</div>
      {renderSlot(t, 2, ranks2)}
    </div>
  );

  const headStyle = { fontWeight: 700, color: c.head, marginBottom: 6, fontSize: 14 };

  const stuckAlert = stuck && (
    <Alert
      type="error" showIcon
      message="Phiên bị kẹt — bên 2 không còn ai đủ điều kiện"
      description="Không thể quay tiếp lẫn chốt (đội dở dang). Ban tổ chức huỷ phiên và mở lại."
    />
  );

  const hasAnyRow = rows.some((r) => r.actual.length || r.placeholders.length);
  if (!phases.length || (!hasAnyRow && !(steps || []).length)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {stuckAlert}
        <div style={{ color: c.muted }}>Kế hoạch ghép đội chưa có đội nào.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {stuckAlert}
      {rows.map(({ ph, idx, tm, actual, placeholders, stoppedEarly }, pi) => {
        const r1 = phaseRanks(ph, 1);
        const r2 = phaseRanks(ph, 2);
        // Số đội hiện trên tiêu đề = max(dự kiến, số đội thực tế đang vẽ) — quy tắc có thể ghép nhiều/ít hơn dự kiến
        const shown = Math.max(tm, actual.length + placeholders.length);
        const countText = ph.overlap || plan?.estimated ? `dự kiến ${shown} đội` : `${shown} đội`;
        const title = !r1.length && !r2.length
          ? `Ngẫu nhiên toàn bộ — ${countText}`
          : `Quy tắc ${idx + 1}: ${ranksPhrase(r1, true)} + ${ranksPhrase(r2, true)} — ${countText}`;
        if (!actual.length && !placeholders.length && !stoppedEarly) return null;   // quy tắc không ghép được đội nào
        return (
          <div key={`${pi}-${idx}`}>
            <div style={headStyle}>
              {title}
              {stoppedEarly && (
                <span style={{ fontWeight: 400, color: c.muted, fontSize: 12 }}>
                  {" "}· đã ghép {actual.length} (hết người đủ điều kiện)
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {actual.map((t) => renderRow(t, r1, r2, false))}
              {placeholders.map((t) => {
                const isNext = nextStep && Number(nextStep.team_index) === t;
                return renderRow(t, r1, r2, !isNext);
              })}
            </div>
          </div>
        );
      })}
      {unpaired.length > 0 && (
        <div style={{ border: `1px dashed ${c.border}`, borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ ...headStyle, fontSize: 12, color: c.muted, marginBottom: 4 }}>
            Chưa có đội (ghép tay sau): {unpaired.length} người
          </div>
          <div style={{ color: c.text, fontSize: 13, lineHeight: 1.6 }}>
            {unpaired.map((p, i) => (
              <span key={p.pid}>
                {i > 0 && <span style={{ color: c.muted }}>, </span>}
                {p.name}
                {rankText(p.rank) && <span style={{ color: c.muted }}> ({rankText(p.rank)})</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
