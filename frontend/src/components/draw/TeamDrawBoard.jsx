/**
 * TeamDrawBoard — bảng "đội × VĐV" của lễ PHÂN VĐV VÀO ĐỘI: mỗi đội một thẻ liệt kê VĐV đã bốc (theo lượt,
 * kèm hạng/giới tính), ô chờ của đội sắp nhận; phía dưới là tiến độ từng vòng và VĐV còn chờ.
 * Props: { draw (pool, teams, rules, plan), steps (đã reveal), nextStep, highlightStep, dark, finished }
 */
import { useMemo } from "react";
import { Tag, theme } from "antd";
import { GENDER_SHORT, normalizeTeamDrawRules, teamDrawRuleLabel } from "../../utils/teamDraw";
import { UNRANKED } from "../../utils/drawMath";

export default function TeamDrawBoard({ draw, steps = [], nextStep = null, highlightStep = null, dark = false, finished = false }) {
  const { token } = theme.useToken();
  const c = dark
    ? { text: "#e2e8f0", muted: "#94a3b8", panel: "rgba(255,255,255,.05)", border: "rgba(255,255,255,.12)", hi: "#fbbf24", pend: "rgba(59,130,246,.18)" }
    : { text: token.colorText, muted: token.colorTextSecondary, panel: token.colorFillQuaternary, border: token.colorBorderSecondary, hi: token.colorWarning, pend: token.colorPrimaryBg };

  const pool = useMemo(() => draw?.pool || [], [draw?.pool]);
  const teams = useMemo(() => draw?.teams || [], [draw?.teams]);
  const rules = useMemo(() => normalizeTeamDrawRules(draw?.rules || []), [draw?.rules]);
  const poolById = useMemo(() => new Map(pool.map((p) => [Number(p.tpid), p])), [pool]);
  const byTeam = useMemo(() => {
    const m = new Map(teams.map((t) => [Number(t.pid), []]));
    steps.forEach((s) => { if (m.has(Number(s.team_pid))) m.get(Number(s.team_pid)).push(s); });
    return m;
  }, [teams, steps]);
  const picked = useMemo(() => new Set(steps.map((s) => Number(s.tpid))), [steps]);
  const waiting = pool.filter((p) => !picked.has(Number(p.tpid)));
  const roundCounts = useMemo(() => {
    const cnt = rules.map(() => 0);
    steps.forEach((s) => { if (cnt[s.round_index] != null) cnt[s.round_index] += 1; });
    return cnt;
  }, [rules, steps]);
  const est = draw?.plan?.rounds || [];

  const personTags = (p) => (
    <>
      {p?.rank && p.rank !== UNRANKED && <Tag color="purple" style={{ margin: 0, fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>{p.rank}</Tag>}
      {p?.gender && GENDER_SHORT[p.gender] && (
        <Tag color={p.gender === "male" ? "blue" : "magenta"} style={{ margin: 0, fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>{GENDER_SHORT[p.gender]}</Tag>
      )}
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, color: c.text }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        {teams.map((t) => {
          const list = byTeam.get(Number(t.pid)) || [];
          const pending = nextStep && Number(nextStep.team_pid) === Number(t.pid);
          return (
            <div key={t.pid} style={{
              background: c.panel, border: `1px solid ${pending ? c.hi : c.border}`, borderRadius: 10, padding: 10,
              boxShadow: pending ? `0 0 0 2px ${c.hi}55` : "none",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <b style={{ fontSize: 14 }}>{t.name}</b>
                <span style={{ color: c.muted, fontSize: 12 }}>{list.length} VĐV</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {list.map((s) => {
                  const p = poolById.get(Number(s.tpid));
                  const hi = highlightStep === s.step_index;
                  return (
                    <div key={s.step_index} style={{
                      display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "2px 6px", borderRadius: 6,
                      background: hi ? `${c.hi}33` : "transparent", fontWeight: hi ? 700 : 400,
                    }}>
                      <span style={{ color: c.muted, fontSize: 11, minWidth: 18 }}>{s.step_index + 1}.</span>
                      <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{p?.name || `#${s.tpid}`}</span>
                      {personTags(p)}
                    </div>
                  );
                })}
                {pending && !finished && (
                  <div style={{ border: `1px dashed ${c.hi}`, borderRadius: 6, padding: "3px 6px", fontSize: 12, color: c.hi, background: c.pend }}>
                    Đang bốc… ({teamDrawRuleLabel(rules[nextStep.round_index] || {})})
                  </div>
                )}
                {!list.length && !pending && <span style={{ color: c.muted, fontSize: 12 }}>— chưa có —</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background: c.panel, border: `1px solid ${c.border}`, borderRadius: 10, padding: 10, fontSize: 13 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Các vòng phân bổ</div>
        {rules.map((r, i) => {
          const active = nextStep && nextStep.round_index === i;
          const done = roundCounts[i];
          const e = est[i]?.est_count;
          return (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", color: active ? c.hi : c.text, fontWeight: active ? 700 : 400 }}>
              <span>Vòng {i + 1}: {teamDrawRuleLabel(r)}</span>
              <span style={{ color: active ? c.hi : c.muted, whiteSpace: "nowrap" }}>{done}{e != null ? ` / ~${e}` : ""} lượt</span>
            </div>
          );
        })}
        <div style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>
          Đội nhận theo kiểu rắn: lượt đi xuôi thứ tự đội, lượt về đảo chiều; nhóm không chia hết thì đội cuối theo thứ tự nhận ít hơn.
        </div>
      </div>

      <div style={{ background: c.panel, border: `1px solid ${c.border}`, borderRadius: 10, padding: 10, fontSize: 13 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>VĐV chờ bốc ({waiting.length})</div>
        {waiting.length === 0 ? (
          <span style={{ color: c.muted }}>{finished ? "Tất cả đã có đội" : "—"}</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {waiting.map((p) => (
              <span key={p.tpid} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${c.border}`, borderRadius: 999, padding: "1px 8px" }}>
                {p.name}{personTags(p)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
