// Toán thuần cho vòng quay bốc thăm — không phụ thuộc React/DOM để dùng chung admin + public
// và đối chiếu được với backend (tournament_engine.py: draw_display_slots / draw_pick_index).
import { seedOrder } from "./bracketLayout";

export const DRAW_FORMATS = ["combined", "knockout", "individual"];
export const GROUP_LETTERS = "ABCDEFGHIJKLMNOP";

/** Danh sách id còn lại trong pool (giữ thứ tự pool), bỏ những id đã có trong steps. */
export function remainingPool(pool, steps) {
  const picked = new Set((steps || []).map((s) => s.participant_id));
  return (pool || []).filter((id) => !picked.has(id));
}

/**
 * Danh sách ô đích theo THỨ TỰ BỐC (lượt k điền ô k) — mirror backend draw_display_slots,
 * cùng nhãn và cùng thứ tự để UI hiển thị trước khi server trả slot_label.
 */
export function displaySlots(format, n, numGroups = 2) {
  const total = Math.max(0, Number(n) || 0);
  const slots = [];
  if (format === "combined") {
    const g = Math.max(1, Number(numGroups) || 1);
    for (let k = 0; k < total; k++) {
      const group = GROUP_LETTERS[k % g];
      const pos = Math.floor(k / g) + 1;
      slots.push({ index: k, group, pos, label: `Bảng ${group} – vị trí ${pos}` });
    }
    return slots;
  }
  if (format === "individual") {
    for (let k = 0; k < total; k++) {
      if (total % 2 === 1 && k === total - 1) {
        slots.push({ index: k, match: null, side: null, label: "Không có trận (số lẻ)" });
      } else {
        const match = Math.floor(k / 2) + 1;
        const side = (k % 2) + 1;
        slots.push({ index: k, match, side, label: `Trận ${match} – Đội ${side}` });
      }
    }
    return slots;
  }
  if (format === "knockout") {
    let size = 1;
    while (size < total) size *= 2;
    const order = seedOrder(size);
    const slotSeq = order.filter((s) => s <= total);
    for (let k = 0; k < total; k++) {
      const seed = slotSeq[k];
      const displayPos = order.indexOf(seed);
      const neighbor = order[displayPos ^ 1];
      const bye = neighbor !== undefined && neighbor > total;
      slots.push({
        index: k, seed, display_pos: displayPos, bye,
        label: `Vị trí ${k + 1}${bye ? " (miễn vòng 1)" : ""}`,
      });
    }
    return slots;
  }
  return slots;
}

// ── Hình học vòng quay ─────────────────────────────────────────
// Quy ước: góc 0° ở ĐỈNH (12h), tăng theo chiều kim đồng hồ; toạ độ SVG tâm (0,0), y hướng xuống.
const polar = (deg, r) => {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)];
};

/** Path `d` cho quạt thứ i trong n quạt, bán kính r, tâm (0,0). n = 1 → hình tròn đầy. */
export function sectorPath(i, n, r = 1) {
  if (n <= 1) {
    return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
  }
  const step = 360 / n;
  const [x0, y0] = polar(i * step, r);
  const [x1, y1] = polar((i + 1) * step, r);
  const largeArc = step > 180 ? 1 : 0;
  const f = (v) => Number(v.toFixed(5));
  return `M 0 0 L ${f(x0)} ${f(y0)} A ${r} ${r} 0 ${largeArc} 1 ${f(x1)} ${f(y1)} Z`;
}

/** Góc giữa quạt i (độ, 0 = đỉnh, chiều kim đồng hồ). */
export function sectorMidDeg(i, n) {
  if (n <= 0) return 0;
  return ((i + 0.5) * 360) / n;
}

/**
 * Góc kết thúc để quạt winnerIdx nằm dưới kim ở đỉnh: quay đủ extraTurns vòng, luôn ≥ currentDeg.
 * jitterDeg: lệch nhỏ khỏi tâm quạt (tất định, do caller tính) cho tự nhiên — mặc định 0.
 */
export function targetRotation(currentDeg, winnerIdx, n, extraTurns = 4, jitterDeg = 0) {
  const mid = sectorMidDeg(winnerIdx, n);
  const base = currentDeg + Math.max(0, extraTurns) * 360;
  // Rotor xoay deg theo chiều kim đồng hồ → tâm quạt đến góc (mid + deg); cần ≡ 0 (mod 360)
  const want = ((-mid - jitterDeg) % 360 + 360) % 360;
  const cur = ((base % 360) + 360) % 360;
  const delta = (want - cur + 360) % 360;
  return base + delta;
}

/** Số vòng quay thêm theo lượt — tất định để mọi máy (admin/public) quay giống nhau. */
export function extraTurnsFor(stepIndex) {
  return 4 + ((Number(stepIndex) || 0) % 3);
}

/** Lệch kim tất định trong ±frac bề rộng quạt (không dùng Math.random). */
export function deterministicJitterDeg(stepIndex, n, frac = 0.25) {
  if (n <= 1) return 0;
  const width = 360 / n;
  const k = Number(stepIndex) || 0;
  // băm nguyên đơn giản → [-1, 1]
  const h = ((k * 2654435761) >>> 0) % 1000;
  const unit = (h / 999) * 2 - 1;
  return unit * width * frac;
}

// ── Đồng bộ thời gian với server ──────────────────────────────
/** Mốc client (ms) mà kim phải dừng cho step này: spun_at_ms + reveal_ms, dịch theo lệch giờ server. */
export function revealAtClientMs(step, revealMs, serverOffsetMs = 0) {
  return (Number(step?.spun_at_ms) || 0) + (Number(revealMs) || 0) - (Number(serverOffsetMs) || 0);
}

/** Lệch giờ server so với client: serverNowMs - Date.now() (dương = server đi trước). */
export function serverOffset(serverNowMs) {
  return (Number(serverNowMs) || Date.now()) - Date.now();
}

// ── Kiểm chứng commit–reveal ──────────────────────────────────
/** SHA-256 hex (async, crypto.subtle). Trả null nếu trình duyệt không có subtle (HTTP không bảo mật). */
export async function sha256Hex(str) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === "undefined") return null;
  try {
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** idx = int(hex, 16) mod remainingCount — giống backend draw_pick_index (dùng BigInt để không tràn). */
export function pickIndexFromHash(hex, remainingCount) {
  if (!hex || !remainingCount) return 0;
  return Number(BigInt(`0x${hex}`) % BigInt(remainingCount));
}

/**
 * Kiểm chứng lại toàn bộ phiên đã lộ seed:
 *   - SHA256(seed_hex) == seed_commit
 *   - mỗi lượt k: remaining[SHA256(`${seed_hex}:${k}`) mod len(remaining)] == participant_id
 * Trả null nếu không tính được (thiếu seed_hex hoặc không có crypto.subtle).
 */
export async function verifyDraw(draw) {
  if (!draw?.seed_hex) return null;
  const commit = await sha256Hex(draw.seed_hex);
  if (commit === null) return null;
  const commitOk = commit === draw.seed_commit;
  const steps = [...(draw.steps || [])].sort((a, b) => a.step_index - b.step_index);
  const pool = draw.pool || [];
  const results = [];
  let allOk = commitOk;
  for (let k = 0; k < steps.length; k++) {
    const remaining = remainingPool(pool, steps.slice(0, k));
    const h = await sha256Hex(`${draw.seed_hex}:${steps[k].step_index}`);
    const idx = pickIndexFromHash(h, remaining.length);
    const expected = remaining[idx];
    const ok = expected === steps[k].participant_id;
    if (!ok) allOk = false;
    results.push({ step_index: steps[k].step_index, expected, actual: steps[k].participant_id, pick_index: idx, ok });
  }
  return { ok: allOk, commitOk, steps: results };
}

// ── Ghép ĐỘI ĐÔI bằng vòng quay (partner draw) v2 — mirror tournament_engine.py:
//    normalize_rank / normalize_partner_rules / _side_pool / partner_draw_plan / partner_step_context /
//    partner_draw_finished / partner_draw_stuck / draw_pick_index.
//    Quy tắc NHIỀU HẠNG mỗi bên: {ranks1: [...], ranks2: [...]} — bên rỗng = bất kỳ hạng.
//    Plan API luôn là v2 (server chuẩn hoá cả phiên cũ) nên KHÔNG còn fallback rank1/rank2/team_count/total_steps.
//    Danh sách hạng của CLB lấy từ hook useRankLevels (không còn mảng cứng ở đây).
export const UNRANKED = "Chưa xếp hạng";

/** Hạng đã chuẩn hoá: null/""/khoảng trắng → "Chưa xếp hạng", còn lại trim. */
export function normalizeRank(r) {
  const s = r == null ? "" : String(r).trim();
  return s === "" ? UNRANKED : s;
}

/**
 * Nhãn MỘT hạng để ghép câu: "hạng A" / "Chưa xếp hạng" (không thành "hạng Chưa xếp hạng").
 * cap=true → viết hoa chữ đầu ("Hạng A") cho tiêu đề.
 */
export function rankLabel(r, cap = false) {
  const v = normalizeRank(r);
  if (v === UNRANKED) return UNRANKED;
  return `${cap ? "Hạng" : "hạng"} ${v}`;
}

/**
 * Danh sách hạng một bên đã chuẩn hoá — mirror vòng lặp trong normalize_partner_rules:
 * phần tử null/""/khoảng trắng bị BỎ (để trống ≠ "Chưa xếp hạng"; muốn hạng đó thì chọn tường minh UNRANKED),
 * loại trùng, giữ thứ tự; không phải mảng → [].
 */
function normalizeRankList(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((r) => {
    if (r == null || !String(r).trim()) return;
    const v = normalizeRank(r);
    if (!out.includes(v)) out.push(v);
  });
  return out;
}

/**
 * Nhãn NHIỀU hạng của một bên quy tắc: ["A","B"] → "A/B"; [] → "bất kỳ hạng"; ["Chưa xếp hạng"] → "Chưa xếp hạng".
 * Dùng cho dòng quy tắc, biên bản, xem trước kế hoạch.
 */
export function ranksLabel(ranks) {
  const list = normalizeRankList(ranks);
  if (!list.length) return "bất kỳ hạng";
  return list.join("/");
}

/**
 * Cụm từ đầy đủ để ghép câu: "hạng A/B" / "bất kỳ hạng" / "Chưa xếp hạng" (có "Chưa xếp hạng" trong
 * nhiều hạng → "hạng A/Chưa xếp hạng"). cap=true → viết hoa chữ đầu ("Hạng A/B", "Bất kỳ hạng").
 */
export function ranksPhrase(ranks, cap = false) {
  const list = normalizeRankList(ranks);
  let s;
  if (!list.length) s = "bất kỳ hạng";
  else if (list.length === 1 && list[0] === UNRANKED) s = UNRANKED;
  else s = `hạng ${list.join("/")}`;
  return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Chuẩn hoá quy tắc về shape mới — mirror normalize_partner_rules:
 *   nhận [] / null / [{rank1, rank2}] (cũ) / [{ranks1: [...], ranks2: [...]}] (mới)
 *   → luôn trả [{ranks1: [...], ranks2: [...]}]; rank1 chuỗi được gộp vào ranks1 (nếu có cả hai);
 *   rank1/rank2 = null/""/khoảng trắng và phần tử rỗng trong ranks1/ranks2 bị BỎ; loại trùng, giữ thứ tự.
 *   Quy tắc CẢ 2 bên rỗng vẫn giữ (= "bất kỳ + bất kỳ", ghép ngẫu nhiên toàn bộ).
 */
export function normalizePartnerRules(rules) {
  if (!Array.isArray(rules)) return [];
  const side = (list, legacy) => normalizeRankList([...(Array.isArray(list) ? list : []), legacy]);
  return rules
    .filter((r) => r && typeof r === "object")
    .map((r) => ({ ranks1: side(r.ranks1, r.rank1), ranks2: side(r.ranks2, r.rank2) }));
}

/** Quy tắc để tính plan/replay — rỗng → 1 quy tắc "bất kỳ + bất kỳ" (như engine). */
const rulesOrDefault = (rules) => {
  const list = normalizePartnerRules(rules);
  return list.length ? list : [{ ranks1: [], ranks2: [] }];
};

const sortPeople = (people) =>
  [...(people || [])]
    .map((p) => ({ pid: Number(p.pid), rank: normalizeRank(p.rank) }))
    .sort((a, b) => a.pid - b.pid);

/** Người còn lại thoả một bên quy tắc — mirror _side_pool: ranks rỗng → tất cả; else rank ∈ ranks. */
function sidePool(remaining, ranks) {
  const list = Array.isArray(ranks) ? ranks : [];
  if (!list.length) return [...remaining];
  return remaining.filter((p) => list.includes(p.rank));
}

/**
 * (team, only1, only2, both) của một quy tắc trên `pool` — mirror _pair_capacity:
 *   S1/S2 theo sidePool; a=|S1\S2|, b=|S2\S1|, c=|S1∩S2|; team = min(a+c, b+c, (a+b+c)//2) (cỡ ghép cặp lớn nhất).
 */
function pairCapacity(pool, ranks1, ranks2) {
  const s1 = sidePool(pool, ranks1);
  const s2 = sidePool(pool, ranks2);
  const in1 = new Set(s1.map((p) => p.pid));
  const in2 = new Set(s2.map((p) => p.pid));
  const only1 = s1.filter((p) => !in2.has(p.pid));
  const only2 = s2.filter((p) => !in1.has(p.pid));
  const both = s1.filter((p) => in2.has(p.pid));
  const a = only1.length, b = only2.length, c = both.length;
  return { team: Math.min(a + c, b + c, Math.floor((a + b + c) / 2)), only1, only2, both };
}

/**
 * Kế hoạch (ƯỚC LƯỢNG) ghép đội v2 — công bố TRƯỚC lượt đầu — mirror partner_draw_plan.
 *   people: [{pid, rank}] ; rules: [] / [{rank1,rank2}] / [{ranks1,ranks2}] (tự normalize; rỗng → 1 quy tắc bất kỳ + bất kỳ).
 *   Mỗi phase:
 *     team_cap = cỡ ghép cặp lớn nhất của quy tắc trên TOÀN BỘ pool (không trừ tiêu thụ) — cận trên THẬT;
 *     team_max = cỡ ghép cặp lớn nhất trên phần "remaining" ước lượng (DỰ KIẾN, có thể nhiều/ít hơn khi bốc thật);
 *     overlap = hai bên có người chung (c > 0).
 *     Tiêu thụ ước lượng cho phase sau (lặp team_max lần): bên 1 lấy từ S1\S2 trước, hết thì từ giao;
 *     bên 2 lấy từ S2\S1 trước, hết thì từ giao.
 * Trả {phases: [{index, ranks1, ranks2, team_max, team_cap, overlap}] (MỌI quy tắc, kể cả team_max 0),
 *      total_steps_est: 2 × Σ team_max (con số "dự kiến"),
 *      total_steps_max: 2 × min(Σ team_cap, n // 2) (TRẦN THẬT — replay không bao giờ vượt; ≥ total_steps_est),
 *      unpaired_pids: người có hạng ∉ hợp của mọi ranks1 ∪ ranks2 (chỉ khi KHÔNG phase nào có bên rỗng),
 *      estimated: có phase overlap → số đội/lượt chỉ là ước lượng}.
 */
export function partnerPlan(people, rules) {
  const ppl = sortPeople(people);
  const list = rulesOrDefault(rules);
  let remaining = [...ppl];
  const phases = [];
  list.forEach((rule, i) => {
    const { team: teamCap } = pairCapacity(ppl, rule.ranks1, rule.ranks2);                       // trên toàn bộ pool
    const { team: teamMax, only1, only2, both } = pairCapacity(remaining, rule.ranks1, rule.ranks2); // trên phần còn lại
    phases.push({
      index: i, ranks1: [...rule.ranks1], ranks2: [...rule.ranks2],
      team_max: teamMax, team_cap: teamCap, overlap: both.length > 0,
    });
    // Tiêu thụ ước lượng: ưu tiên người CHỈ thuộc một bên, giữ người thuộc giao cho lượt/phase sau
    const used = new Set();
    const take = (primary, fallback) => {
      const src = primary.find((p) => !used.has(p.pid)) || fallback.find((p) => !used.has(p.pid));
      if (src) used.add(src.pid);
    };
    for (let t = 0; t < teamMax; t++) {
      take(only1, both);
      take(only2, both);
    }
    remaining = remaining.filter((p) => !used.has(p.pid));
  });
  const anyOpenSide = list.some((r) => !r.ranks1.length || !r.ranks2.length);
  const union = new Set();
  list.forEach((r) => { r.ranks1.forEach((x) => union.add(x)); r.ranks2.forEach((x) => union.add(x)); });
  return {
    phases,
    total_steps_max: 2 * Math.min(phases.reduce((s, ph) => s + ph.team_cap, 0), Math.floor(ppl.length / 2)),
    total_steps_est: 2 * phases.reduce((s, ph) => s + ph.team_max, 0),
    unpaired_pids: anyOpenSide ? [] : ppl.filter((p) => !union.has(p.rank)).map((p) => p.pid),
    estimated: phases.some((ph) => ph.overlap),
  };
}

/**
 * Ngữ cảnh lượt kế tiếp v2 — mirror partner_step_context: KHÔNG nhận k, k = số step đã có. Replay tất định:
 *   picked = {pid các step}; remaining = people − picked.
 *   Nếu step cuối là bên 1 → lượt bên 2 cùng phase/đội: eligible = sidePool(remaining, ranks2).
 *   Ngược lại → duyệt phase từ phase của step cuối (hoặc 0): S1, S2 theo sidePool;
 *     eligible1 = người trong S1 mà khi bỏ họ ra S2 vẫn còn ≥ 1 (tránh đội dở dang);
 *     eligible1 rỗng → phase kế tiếp; hết phase → null (đã hết lượt hợp lệ, người còn lại ghép tay).
 *     team_index = số step bên 2 đã có (đội mới, 0-based).
 * Trả {step_index, phase_index, team_index, side, eligible_pids (sắp theo pid)} hoặc null.
 */
export function partnerStepContext(people, rules, stepsSoFar) {
  const ppl = sortPeople(people);
  const list = rulesOrDefault(rules);
  const steps = [...(stepsSoFar || [])].sort((a, b) => a.step_index - b.step_index);
  const k = steps.length;
  const picked = new Set(steps.map((s) => Number(s.pid)));
  const remaining = ppl.filter((p) => !picked.has(p.pid));
  const last = steps.length ? steps[steps.length - 1] : null;
  // Kẹp chỉ số phase vào [0, số quy tắc − 1] như engine (dữ liệu lệch không làm replay văng)
  const clamp = (v) => Math.min(Math.max(Number(v) || 0, 0), list.length - 1);

  if (last && Number(last.side) === 1) {
    const pi = clamp(last.phase_index);
    return {
      step_index: k, phase_index: pi, team_index: Number(last.team_index) || 0, side: 2,
      eligible_pids: sidePool(remaining, list[pi].ranks2).map((p) => p.pid),
    };
  }
  const start = last ? clamp(last.phase_index) : 0;
  const teamIndex = steps.filter((s) => Number(s.side) === 2).length;
  for (let pi = start; pi < list.length; pi++) {
    const rule = list[pi];
    const s1 = sidePool(remaining, rule.ranks1);
    const s2 = sidePool(remaining, rule.ranks2);
    const eligible1 = s1.filter((x) => s2.some((y) => y.pid !== x.pid));
    if (eligible1.length) {
      return { step_index: k, phase_index: pi, team_index: teamIndex, side: 1, eligible_pids: eligible1.map((p) => p.pid) };
    }
  }
  return null;
}

/**
 * Phiên đã hết lượt — mirror partner_draw_finished: không còn cặp hợp lệ (replay → null).
 * KHÔNG so với trần total_steps: total_steps_max của plan v2 là cận trên thật nên replay không thể vượt.
 */
export function partnerDrawFinished(people, rules, steps) {
  return partnerStepContext(people, rules, steps) === null;
}

/**
 * Phiên KẸT — mirror partner_draw_stuck: lượt cuối là bên 1 mà bên 2 không còn ai đủ điều kiện (chỉ xảy ra với
 * dữ liệu hỏng / phiên mở bằng engine cũ). Không quay tiếp lẫn chốt được → huỷ phiên và mở lại.
 */
export function partnerDrawStuck(people, rules, steps) {
  const ctx = partnerStepContext(people, rules, steps);
  return ctx !== null && ctx.eligible_pids.length === 0;
}

/** Hạng yêu cầu (mảng) của một bên trong phase v2 — [] = bất kỳ hạng / không có phase. */
export function phaseRanks(ph, side) {
  const list = Number(side) === 1 ? ph?.ranks1 : ph?.ranks2;
  return Array.isArray(list) ? list : [];
}

/** Phase của một step/ctx trong plan: khớp theo ph.index (thứ tự quy tắc) — dự phòng theo vị trí mảng. */
function planPhaseFor(plan, phaseIndex) {
  const phases = plan?.phases || [];
  const idx = Number(phaseIndex);
  if (!Number.isFinite(idx)) return null;
  return phases.find((ph) => Number(ph.index) === idx) || phases[idx] || null;
}

/** Nhãn ô đích của một lượt: "Đội 3 – Người 1 (hạng A/B)" | "… (bất kỳ hạng)" | "… (Chưa xếp hạng)". */
export function partnerLabelForStep(ctx, plan) {
  if (!ctx) return "";
  const base = `Đội ${(Number(ctx.team_index) || 0) + 1} – Người ${ctx.side}`;
  return `${base} (${ranksPhrase(phaseRanks(planPhaseFor(plan, ctx.phase_index), ctx.side))})`;
}

/**
 * Kiểm chứng phiên ghép đội đã lộ seed (v2):
 *   - SHA256(seed_hex) == seed_commit
 *   - lượt k: ctx_k tái lập từ pool + rules + các lượt trước (replay); eligible_k[SHA256(`${seed}:${k}`) mod len] == pid,
 *     và ô ghi nhận (phase/đội/bên) khớp replay.
 * Trả null nếu không tính được (thiếu seed_hex hoặc không có crypto.subtle).
 */
export async function verifyPartnerDraw(draw) {
  if (!draw?.seed_hex) return null;
  const commit = await sha256Hex(draw.seed_hex);
  if (commit === null) return null;
  const commitOk = commit === draw.seed_commit;
  const people = sortPeople(draw.pool || []);
  const rules = normalizePartnerRules(draw.rules || []);
  const steps = [...(draw.steps || [])].sort((a, b) => a.step_index - b.step_index);
  const results = [];
  let allOk = commitOk;
  for (let k = 0; k < steps.length; k++) {
    const st = steps[k];
    const ctx = partnerStepContext(people, rules, steps.slice(0, k));
    const eligible = ctx?.eligible_pids || [];
    const h = await sha256Hex(`${draw.seed_hex}:${st.step_index}`);
    const idx = pickIndexFromHash(h, eligible.length);
    const expected = eligible.length ? eligible[idx] : null;
    const slotOk = !!ctx
      && (st.side == null || Number(st.side) === ctx.side)
      && (st.team_index == null || Number(st.team_index) === ctx.team_index);
    const ok = expected != null && expected === Number(st.pid) && slotOk;
    if (!ok) allOk = false;
    results.push({
      step_index: st.step_index, expected_pid: expected, actual_pid: st.pid, pick_index: idx, ok, slot_ok: slotOk,
    });
  }
  // Thông tin thêm (không gộp vào `ok` vì phiên huỷ giữa chừng vẫn kiểm chứng được các lượt đã quay):
  // finished = replay sau lượt cuối không còn cặp hợp lệ; stuck = bên 2 không còn ai (dữ liệu hỏng)
  const finished = partnerDrawFinished(people, rules, steps);
  const stuck = partnerDrawStuck(people, rules, steps);
  return { ok: allOk, commitOk, finished, stuck, steps: results };
}
