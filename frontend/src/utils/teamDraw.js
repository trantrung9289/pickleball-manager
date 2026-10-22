// Hàm thuần cho VÒNG QUAY PHÂN VĐV VÀO ĐỘI (giải đồng đội) — gương backend/tournament_engine.py
// (normalize_team_draw_rules, team_draw_person_matches, team_draw_step_context, team_draw_plan).
// Không import antd/React để chạy được bằng `node --test src/utils/`.
import { normalizeRank, sha256Hex, pickIndexFromHash, UNRANKED } from "./drawMath.js";

export const TEAM_DRAW_GENDERS = ["male", "female"];
export const GENDER_SHORT = { male: "Nam", female: "Nữ" };

/** Chuẩn hoá luật như backend: [{ranks, genders, per_team}] + luôn kết thúc bằng vòng "còn lại chia đều". */
export function normalizeTeamDrawRules(rules) {
  const out = [];
  (rules || []).forEach((rule) => {
    if (!rule) return;
    const ranks = [];
    (rule.ranks || []).forEach((r) => {
      if (r == null || !String(r).trim()) return;
      const nr = normalizeRank(r);
      if (!ranks.includes(nr)) ranks.push(nr);
    });
    let genders = [...new Set((rule.genders || []).filter((g) => TEAM_DRAW_GENDERS.includes(g)))];
    if (genders.length === TEAM_DRAW_GENDERS.length) genders = [];
    let perTeam = rule.per_team == null || rule.per_team === "" ? null : parseInt(rule.per_team, 10);
    if (!Number.isFinite(perTeam) || perTeam < 1) perTeam = null;
    out.push({ ranks, genders, per_team: perTeam });
  });
  const last = out[out.length - 1];
  if (!last || last.ranks.length || last.genders.length || last.per_team != null) {
    out.push({ ranks: [], genders: [], per_team: null });
  }
  return out;
}

export function teamDrawPersonMatches(rule, person) {
  if (rule.ranks?.length && !rule.ranks.includes(normalizeRank(person.rank))) return false;
  if (rule.genders?.length && !rule.genders.includes(person.gender)) return false;
  return true;
}

const sortPeople = (people) =>
  (people || []).map((p) => ({ tpid: Number(p.tpid), rank: normalizeRank(p.rank), gender: p.gender ?? null }))
    .sort((a, b) => a.tpid - b.tpid);

/** Bộ sinh ô dùng chung cho replay (picker null → trả ngữ cảnh ô kế tiếp) và ước lượng (picker → chạy tới hết). */
function walk(people, teamIds, rules, steps, picker) {
  const rs = normalizeTeamDrawRules(rules);
  const ppl = sortPeople(people);
  const teams = (teamIds || []).map(Number);
  const remaining = new Map(ppl.map((p) => [p.tpid, p]));
  const sts = steps || [];
  let k = 0;
  let passNo = 0;
  const counts = rs.map(() => 0);
  if (!teams.length) return picker ? { done: true, counts } : null;
  for (let ri = 0; ri < rs.length; ri++) {
    const rule = rs[ri];
    const given = new Map(teams.map((t) => [t, 0]));
    for (;;) {
      const order = passNo % 2 === 0 ? teams : [...teams].reverse();
      let pickedAny = false;
      let exhausted = false;
      for (let pos = 0; pos < order.length; pos++) {
        const t = order[pos];
        if (rule.per_team != null && given.get(t) >= rule.per_team) continue;
        const eligible = [...remaining.values()].filter((p) => teamDrawPersonMatches(rule, p)).map((p) => p.tpid).sort((a, b) => a - b);
        if (!eligible.length) { exhausted = true; break; }
        let chosen;
        if (k < sts.length) chosen = Number(sts[k].tpid);
        else if (!picker) {
          return { step_index: k, round_index: ri, pass_index: passNo, team_pid: t, team_pos: pos, eligible_tpids: eligible };
        } else chosen = picker(eligible);
        remaining.delete(chosen);
        given.set(t, given.get(t) + 1);
        counts[ri] += 1;
        k += 1;
        pickedAny = true;
      }
      if (pickedAny) passNo += 1;
      if (exhausted || !pickedAny) break;
    }
    if (!remaining.size) break;
  }
  return picker ? { done: true, counts } : null;
}

/** Ngữ cảnh ô kế tiếp bằng replay tất định; null = đã hết lượt. */
export const teamDrawStepContext = (people, teamIds, rules, steps) => walk(people, teamIds, rules, steps, null);
export const teamDrawFinished = (people, teamIds, rules, steps) => teamDrawStepContext(people, teamIds, rules, steps) === null;

/** Kế hoạch: số lượt từng vòng (ước lượng, chính xác khi vòng không có trần), tổng lượt = số người. */
export function teamDrawPlan(people, teamIds, rules) {
  const rs = normalizeTeamDrawRules(rules);
  const ppl = sortPeople(people);
  const { counts } = walk(ppl, teamIds, rs, [], (e) => e[0]);
  return {
    rounds: rs.map((r, i) => ({ index: i, ranks: r.ranks, genders: r.genders, per_team: r.per_team, est_count: counts[i] })),
    total_steps: (teamIds || []).length ? ppl.length : 0,
    team_ids: (teamIds || []).map(Number),
    estimated: rs.some((r) => r.per_team != null),
  };
}

/** Nhãn một vòng: "Hạng A, B · Nữ · tối đa 1/đội" — vòng không tiêu chí: "Còn lại — chia đều". */
export function teamDrawRuleLabel(rule) {
  const parts = [];
  if (rule?.ranks?.length) parts.push(`Hạng ${rule.ranks.map((r) => (r === UNRANKED ? "chưa xếp" : r)).join(", ")}`);
  if (rule?.genders?.length) parts.push(rule.genders.map((g) => GENDER_SHORT[g] || g).join("/"));
  if (!parts.length) parts.push(rule?.per_team != null ? "Mọi VĐV còn lại" : "Còn lại — chia đều");
  if (rule?.per_team != null) parts.push(`tối đa ${rule.per_team}/đội`);
  return parts.join(" · ");
}

/** Kiểm chứng công khai: seed khớp cam kết và từng lượt đúng công thức + đúng ô (đội) theo replay. */
export async function verifyTeamDraw(draw) {
  if (!draw?.seed_hex) return null;
  const commit = await sha256Hex(draw.seed_hex);
  if (commit === null) return null;
  const commitOk = commit === draw.seed_commit;
  const people = sortPeople(draw.pool || []);
  const teamIds = (draw.teams || []).map((t) => Number(t.pid));
  const rules = normalizeTeamDrawRules(draw.rules || []);
  const steps = [...(draw.steps || [])].sort((a, b) => a.step_index - b.step_index);
  const results = [];
  let allOk = commitOk;
  for (let k = 0; k < steps.length; k++) {
    const st = steps[k];
    const ctx = teamDrawStepContext(people, teamIds, rules, steps.slice(0, k));
    const eligible = ctx?.eligible_tpids || [];
    const h = await sha256Hex(`${draw.seed_hex}:${st.step_index}`);
    const idx = pickIndexFromHash(h, eligible.length);
    const expected = eligible.length ? eligible[idx] : null;
    const slotOk = !!ctx && Number(st.team_pid) === ctx.team_pid;
    const ok = expected != null && expected === Number(st.tpid) && slotOk;
    if (!ok) allOk = false;
    results.push({ step_index: st.step_index, expected_tpid: expected, actual_tpid: st.tpid, pick_index: idx, ok, slot_ok: slotOk });
  }
  return { ok: allOk, commitOk, finished: teamDrawFinished(people, teamIds, rules, steps), steps: results };
}
