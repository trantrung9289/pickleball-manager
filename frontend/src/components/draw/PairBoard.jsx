/**
 * PairBoard — bảng ĐỘI của phiên ghép đội đôi, điền dần theo các lượt đã quay.
 * Hiển thị theo phase của kế hoạch (plan.phases): mỗi đội một hàng "Đội t: [Người 1] + [Người 2]".
 * Dùng chung admin (overlay tối) và public (inline, theo theme antd).
 *
 * Props: { plan (PartnerDrawOut.plan), pool ([{pid, name, rank}]), steps (đã reveal), nextStep
 *          ({team_index, side} — ô đang chờ), spinning (vòng đang quay cho ô đó → "Đang quay…", ngược lại
 *          "Lượt kế tiếp…"), highlightStep (step_index vừa điền), dark }
 */
import { useMemo } from "react";
import { theme } from "antd";
import { UNRANKED, rankLabel } from "../../utils/drawMath";

export default function PairBoard({
  plan, pool = [], steps = [], nextStep = null, spinning = false, highlightStep = null, dark = false,
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

  const phases = plan?.phases || [];
  const totalSteps = plan?.total_steps ?? phases.reduce((s, ph) => s + 2 * (Number(ph.team_count) || 0), 0);

  // Người chưa có đội: theo kế hoạch (hạng không được quy tắc nào dùng) + người dư sau khi quay xong
  // (chỉ biết được khi đã điền hết lượt — VD 3 A ghép A+B với 2 B thì 1 A dư ngẫu nhiên)
  const unpaired = useMemo(() => {
    const ids = new Set((plan?.unpaired_pids || []).map(Number));
    if (totalSteps > 0 && (steps || []).length >= totalSteps) {
      const picked = new Set((steps || []).map((s) => Number(s.pid)));
      (pool || []).forEach((p) => { if (!picked.has(Number(p.pid))) ids.add(Number(p.pid)); });
    }
    return [...ids].map((pid) => poolById.get(pid) || { pid, name: `#${pid}` }).sort((a, b) => a.pid - b.pid);
  }, [plan?.unpaired_pids, steps, pool, poolById, totalSteps]);

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
  const renderSlot = (teamIndex, side, wantRank) => {
    const s = stepBySlot.get(`${teamIndex}:${side}`);
    const person = s ? poolById.get(Number(s.pid)) : null;
    const name = s ? (person?.name || `#${s.pid}`) : null;
    const filled = !!s;
    const waiting = !filled && nextStep && Number(nextStep.team_index) === teamIndex && Number(nextStep.side) === side;
    const flash = filled && highlightStep != null && s.step_index === highlightStep;
    const hint = `Người ${side}${wantRank ? ` · ${rankLabel(wantRank)}` : ""}`;
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
        <span style={{ fontSize: 11, color: c.muted, whiteSpace: "nowrap" }}>{hint}</span>
        <span style={{ fontWeight: filled ? 600 : 400, color: filled ? c.text : c.muted, overflowWrap: "anywhere" }}>
          {name || (waiting ? (spinning ? "Đang quay…" : "Lượt kế tiếp…") : "…")}
          {filled && person?.rank && person.rank !== UNRANKED && !wantRank && (
            <span style={{ fontWeight: 400, color: c.muted }}> · {person.rank}</span>
          )}
        </span>
      </div>
    );
  };

  const headStyle = { fontWeight: 700, color: c.head, marginBottom: 6, fontSize: 14 };

  if (!phases.length) {
    return <div style={{ color: c.muted }}>Kế hoạch ghép đội chưa có đội nào.</div>;
  }

  // Số thứ tự đội bắt đầu của từng phase (0-based toàn phiên) — tính trước, không cộng dồn trong render
  const phaseBases = phases.reduce((acc, ph, i) => {
    const prev = i > 0 ? acc[i - 1] : null;
    acc.push({ base: prev ? prev.base + prev.tc : 0, tc: Number(ph.team_count) || 0 });
    return acc;
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {phases.map((ph, pi) => {
        const { base, tc } = phaseBases[pi];
        const title = ph.rank1 == null && ph.rank2 == null
          ? `Ngẫu nhiên toàn bộ — ${tc} đội`
          : `Quy tắc ${(Number.isFinite(Number(ph.index)) ? Number(ph.index) : pi) + 1}: ${rankLabel(ph.rank1, true)} + ${rankLabel(ph.rank2, true)} — ${tc} đội`;
        return (
          <div key={`${pi}-${ph.index}`}>
            <div style={headStyle}>{title}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Array.from({ length: tc }, (_, i) => {
                const t = base + i;
                return (
                  <div key={t} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
                    <div style={{
                      flex: "0 0 auto", width: 52, display: "flex", alignItems: "center",
                      fontSize: 12, fontWeight: 700, color: c.muted, whiteSpace: "nowrap",
                    }}>
                      Đội {t + 1}
                    </div>
                    {renderSlot(t, 1, ph.rank1)}
                    <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", color: c.muted, fontWeight: 700 }}>+</div>
                    {renderSlot(t, 2, ph.rank2)}
                  </div>
                );
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
