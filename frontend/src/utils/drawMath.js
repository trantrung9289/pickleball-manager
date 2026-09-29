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

// ── Ghép ĐỘI ĐÔI bằng vòng quay (partner draw) — mirror tournament_engine.py:
//    normalize_rank / partner_draw_plan / partner_step_context / draw_pick_index ─────────────
export const UNRANKED = "Chưa xếp hạng";
export const PARTNER_RANK_OPTIONS = ["A", "B", "C", "D", "Hạt giống 1", "Hạt giống 2", "Hạt giống 3", UNRANKED];

/** Hạng đã chuẩn hoá: null/""/khoảng trắng → "Chưa xếp hạng", còn lại trim. */
/**
 * Nhãn hạng để ghép câu: "hạng A" / "Chưa xếp hạng" (không thành "hạng Chưa xếp hạng").
 * cap=true → viết hoa chữ đầu ("Hạng A") cho tiêu đề.
 */
export function rankLabel(r, cap = false) {
  const v = normalizeRank(r);
  if (v === UNRANKED) return UNRANKED;
  return `${cap ? "Hạng" : "hạng"} ${v}`;
}

export function normalizeRank(r) {
  const s = r == null ? "" : String(r).trim();
  return s === "" ? UNRANKED : s;
}

const sortPeople = (people) =>
  [...(people || [])]
    .map((p) => ({ pid: Number(p.pid), rank: normalizeRank(p.rank) }))
    .sort((a, b) => a.pid - b.pid);

/**
 * Kế hoạch ghép đội — công bố TRƯỚC lượt đầu để kiểm chứng được.
 *   people: [{pid, rank}] ; rules: [{rank1, rank2}] hoặc [] (rỗng = ngẫu nhiên toàn bộ).
 * Mô phỏng các quy tắc THEO THỨ TỰ với bộ đếm còn lại theo hạng (quy tắc trước tiêu thụ người trước):
 *   cùng hạng → team_count = còn // 2 ; khác hạng → min(còn1, còn2).
 * Trả {phases: [{index (vị trí quy tắc gốc), rank1|null, rank2|null, team_count}] (chỉ phase có đội),
 *      total_steps: 2 × Σ team_count,
 *      unpaired_pids: người KHÔNG THỂ vào đội nào theo kế hoạch (hạng không được quy tắc nào dùng tới,
 *                     kể cả "Chưa xếp hạng"). Người dư của một hạng CÓ được dùng (VD 3 A ghép A+B với 2 B)
 *                     chỉ biết sau khi quay xong, không nằm trong danh sách này.}
 */
export function partnerPlan(people, rules) {
  const ppl = sortPeople(people);
  const n = ppl.length;
  const list = Array.isArray(rules) ? rules : [];
  if (list.length === 0) {
    const tc = Math.floor(n / 2);
    return {
      phases: tc > 0 ? [{ index: 0, rank1: null, rank2: null, team_count: tc }] : [],
      total_steps: 2 * tc,
      unpaired_pids: [],
    };
  }
  const remain = {};
  ppl.forEach((p) => { remain[p.rank] = (remain[p.rank] || 0) + 1; });
  const usedRanks = new Set();
  const phases = [];
  list.forEach((rule, i) => {
    const r1 = normalizeRank(rule?.rank1);
    const r2 = normalizeRank(rule?.rank2);
    let tc;
    if (r1 === r2) {
      tc = Math.floor((remain[r1] || 0) / 2);
      remain[r1] = (remain[r1] || 0) - 2 * tc;
    } else {
      tc = Math.min(remain[r1] || 0, remain[r2] || 0);
      remain[r1] = (remain[r1] || 0) - tc;
      remain[r2] = (remain[r2] || 0) - tc;
    }
    if (tc > 0) {
      phases.push({ index: i, rank1: r1, rank2: r2, team_count: tc });
      usedRanks.add(r1); usedRanks.add(r2);
    }
  });
  const totalTeams = phases.reduce((s, ph) => s + ph.team_count, 0);
  return {
    phases,
    total_steps: 2 * totalTeams,
    unpaired_pids: ppl.filter((p) => !usedRanks.has(p.rank)).map((p) => p.pid),
  };
}

/** Phase + số thứ tự đội (0-based toàn phiên) + bên (1|2) của lượt k, chạy tuần tự qua các phase. */
function locateStep(plan, k) {
  let offset = 0;
  let teamBase = 0;
  const phases = plan?.phases || [];
  for (let pi = 0; pi < phases.length; pi++) {
    const ph = phases[pi];
    const tc = Number(ph.team_count) || 0;
    const span = 2 * tc;
    if (k < offset + span) {
      const local = k - offset;
      // phase_index = "index" của phase (thứ tự quy tắc gốc) — giống engine; vị trí mảng chỉ để dự phòng
      const phaseIndex = Number.isFinite(Number(ph.index)) ? Number(ph.index) : pi;
      return { phase: ph, phase_index: phaseIndex, team_index: teamBase + Math.floor(local / 2), side: (local % 2) + 1 };
    }
    offset += span;
    teamBase += tc;
  }
  return null;
}

/**
 * Ngữ cảnh lượt k: phase / đội / bên và danh sách người đủ điều kiện (chưa được chọn, đúng hạng theo
 * quy tắc — null = mọi người), sắp theo pid tăng dần. `rules` nhận [{rank1,rank2}] hoặc sẵn một plan
 * ({phases}) để khỏi tính lại. k vượt quá kế hoạch → eligible_pids rỗng, phase/team/side null (như engine).
 */
export function partnerStepContext(people, rules, stepsSoFar, k) {
  const ppl = sortPeople(people);
  const plan = rules && !Array.isArray(rules) && Array.isArray(rules.phases) ? rules : partnerPlan(ppl, rules);
  const loc = locateStep(plan, Number(k) || 0);
  if (!loc) return { step_index: Number(k) || 0, phase_index: null, team_index: null, side: null, eligible_pids: [] };
  const picked = new Set((stepsSoFar || []).map((s) => Number(s.pid)));
  const want = loc.side === 1 ? loc.phase.rank1 : loc.phase.rank2;
  const eligible = ppl
    .filter((p) => !picked.has(p.pid) && (want == null || p.rank === want))
    .map((p) => p.pid);
  return {
    step_index: Number(k) || 0,
    phase_index: loc.phase_index,
    team_index: loc.team_index,
    side: loc.side,
    eligible_pids: eligible,
  };
}

/** Hạng yêu cầu ở ô (team_index, side) theo kế hoạch — null nếu không lọc hạng / không tìm thấy. */
export function partnerSlotRank(plan, teamIndex, side) {
  let base = 0;
  for (const ph of plan?.phases || []) {
    const tc = Number(ph.team_count) || 0;
    if (teamIndex < base + tc) return (side === 1 ? ph.rank1 : ph.rank2) ?? null;
    base += tc;
  }
  return null;
}

/** Nhãn ô đích của một lượt: "Đội 3 – Người 1" + " (hạng A)" khi quy tắc có lọc hạng. */
export function partnerLabelForStep(ctx, plan) {
  if (!ctx) return "";
  const base = `Đội ${(Number(ctx.team_index) || 0) + 1} – Người ${ctx.side}`;
  const rank = partnerSlotRank(plan, Number(ctx.team_index) || 0, ctx.side);
  return rank ? `${base} (${rankLabel(rank)})` : base;
}

/**
 * Kiểm chứng phiên ghép đội đã lộ seed:
 *   - SHA256(seed_hex) == seed_commit
 *   - lượt k: eligible_k tái lập từ pool + rules + các lượt trước; eligible_k[SHA256(`${seed}:${k}`) mod len] == pid
 * Trả null nếu không tính được (thiếu seed_hex hoặc không có crypto.subtle).
 */
export async function verifyPartnerDraw(draw) {
  if (!draw?.seed_hex) return null;
  const commit = await sha256Hex(draw.seed_hex);
  if (commit === null) return null;
  const commitOk = commit === draw.seed_commit;
  const people = sortPeople(draw.pool || []);
  const plan = partnerPlan(people, draw.rules || []);
  const steps = [...(draw.steps || [])].sort((a, b) => a.step_index - b.step_index);
  const results = [];
  let allOk = commitOk;
  for (let k = 0; k < steps.length; k++) {
    const ctx = partnerStepContext(people, plan, steps.slice(0, k), steps[k].step_index);
    const eligible = ctx?.eligible_pids || [];
    const h = await sha256Hex(`${draw.seed_hex}:${steps[k].step_index}`);
    const idx = pickIndexFromHash(h, eligible.length);
    const expected = eligible.length ? eligible[idx] : null;
    const ok = expected != null && expected === Number(steps[k].pid);
    if (!ok) allOk = false;
    results.push({
      step_index: steps[k].step_index, expected_pid: expected, actual_pid: steps[k].pid, pick_index: idx, ok,
    });
  }
  return { ok: allOk, commitOk, steps: results };
}
