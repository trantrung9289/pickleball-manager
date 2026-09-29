/**
 * DrawBoard — bảng ô đích của phiên bốc thăm (bảng đấu / cặp nhánh / trận riêng lẻ),
 * điền dần theo các lượt đã quay. Dùng chung admin (overlay tối) và public (inline, theo theme antd).
 */
import { useMemo } from "react";
import { theme } from "antd";
import { displaySlots, GROUP_LETTERS } from "../../utils/drawMath";
import { teamLabel } from "../../utils/tournamentLabels";

export default function DrawBoard({
  format, numGroups = 2, n = 0, steps = [], participantsById = {},
  highlightStep = null, dark = false,
}) {
  const { token } = theme.useToken();
  const slots = useMemo(() => displaySlots(format, n, numGroups), [format, n, numGroups]);
  const stepByIndex = useMemo(() => {
    const m = new Map();
    (steps || []).forEach((s) => m.set(s.step_index, s));
    return m;
  }, [steps]);

  // Bảng màu: overlay tối dùng màu cố định; inline theo token antd để hợp cả theme sáng/tối của app
  const c = dark
    ? {
      text: "#e2e8f0", muted: "#94a3b8", border: "rgba(255,255,255,.16)", bg: "rgba(255,255,255,.05)",
      filledBg: "rgba(34,197,94,.16)", filledBorder: "#22c55e", byeBg: "rgba(148,163,184,.10)", head: "#fbbf24",
    }
    : {
      text: token.colorText, muted: token.colorTextSecondary, border: token.colorBorder, bg: token.colorFillQuaternary,
      filledBg: token.colorSuccessBg, filledBorder: token.colorSuccessBorder, byeBg: token.colorFillTertiary, head: token.colorPrimary,
    };

  const nameOf = (k) => {
    const s = stepByIndex.get(k);
    if (!s) return null;
    const p = participantsById[s.participant_id];
    const name = p ? teamLabel(p) : `#${s.participant_id}`;
    return p?.status === "withdrawn" ? `${name} (bỏ giải)` : name;
  };

  // Hàm render thuần (không phải component lồng trong render) để ô không bị remount mỗi lần
  // poll → animation .draw-slot-flash không chạy lại ngoài ý muốn
  const renderSlot = (key, k, hint, bye = false) => {
    const name = k == null ? null : nameOf(k);
    const filled = !!name;
    return (
      <div
        key={key}
        className={highlightStep != null && highlightStep === k ? "draw-slot-flash" : undefined}
        style={{
          border: `1px ${bye ? "dashed" : "solid"} ${filled ? c.filledBorder : c.border}`,
          background: bye ? c.byeBg : (filled ? c.filledBg : c.bg),
          borderRadius: 8, padding: "6px 10px", minHeight: 40, color: c.text,
          display: "flex", alignItems: "center", gap: 8, transition: "background .3s, border-color .3s",
        }}
      >
        {hint && <span style={{ fontSize: 11, color: c.muted, whiteSpace: "nowrap" }}>{hint}</span>}
        <span style={{ fontWeight: filled ? 600 : 400, color: filled ? c.text : c.muted, overflowWrap: "anywhere" }}>
          {bye ? "BYE — miễn vòng 1" : (name || "…")}
        </span>
      </div>
    );
  };

  const headStyle = { fontWeight: 700, color: c.head, marginBottom: 6, fontSize: 14 };

  if (format === "combined") {
    const g = Math.max(1, Number(numGroups) || 1);
    const letters = GROUP_LETTERS.slice(0, g).split("");
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {letters.map((L) => (
          <div key={L}>
            <div style={headStyle}>Bảng {L}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {slots.filter((s) => s.group === L).map((s) => (
                renderSlot(s.index, s.index, `#${s.pos}`)
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (format === "knockout") {
    let size = 1;
    while (size < n) size *= 2;
    const byPos = new Map(slots.map((s) => [s.display_pos, s]));
    const pairs = [];
    for (let p = 0; p < size; p += 2) pairs.push([byPos.get(p), byPos.get(p + 1)]);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {pairs.map(([a, b], i) => (
          <div key={i} style={{ border: `1px solid ${c.border}`, borderRadius: 10, padding: 8 }}>
            <div style={{ ...headStyle, fontSize: 12 }}>Cặp {i + 1}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[a, b].map((s, j) => (
                s ? renderSlot(j, s.index, `Vị trí ${s.index + 1}`) : renderSlot(j, null, null, true)
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (format === "individual") {
    const matches = new Map();
    let odd = null;
    slots.forEach((s) => {
      if (s.match == null) { odd = s; return; }
      if (!matches.has(s.match)) matches.set(s.match, []);
      matches.get(s.match).push(s);
    });
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {[...matches.entries()].map(([m, ss]) => (
          <div key={m} style={{ border: `1px solid ${c.border}`, borderRadius: 10, padding: 8 }}>
            <div style={{ ...headStyle, fontSize: 12 }}>Trận {m}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {renderSlot("a", ss[0]?.index, "Đội 1")}
              <div style={{ textAlign: "center", color: c.muted, fontSize: 11, lineHeight: 1 }}>vs</div>
              {renderSlot("b", ss[1]?.index, "Đội 2")}
            </div>
          </div>
        ))}
        {odd && (
          <div key="odd" style={{ border: `1px dashed ${c.border}`, borderRadius: 10, padding: 8 }}>
            <div style={{ ...headStyle, fontSize: 12, color: c.muted }}>Không có trận (số lẻ)</div>
            {renderSlot("odd", odd.index, null)}
          </div>
        )}
      </div>
    );
  }

  return <div style={{ color: c.muted }}>Thể thức này không hỗ trợ bốc thăm.</div>;
}
