// Chạy: node --test src/utils/ — gương test_batch21_team_draw.py (engine phân VĐV vào đội).
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTeamDrawRules, teamDrawStepContext, teamDrawPlan, teamDrawFinished, teamDrawRuleLabel } from "./teamDraw.js";
import { pickIndexFromHash, sha256Hex } from "./drawMath.js";

const ppl = (n, rank = () => "A", gender = () => "male") =>
  Array.from({ length: n }, (_, i) => ({ tpid: i + 1, rank: rank(i + 1), gender: gender(i + 1) }));

const run = (people, teams, rules, pick = (e) => e[0]) => {
  const steps = [];
  for (;;) {
    const ctx = teamDrawStepContext(people, teams, rules, steps);
    if (!ctx) return steps;
    steps.push({ tpid: pick(ctx.eligible_tpids), team_pid: ctx.team_pid, round_index: ctx.round_index, pass_index: ctx.pass_index });
  }
};

test("normalizeTeamDrawRules: dọn dữ liệu và thêm vòng còn lại", () => {
  assert.deepEqual(
    normalizeTeamDrawRules([{ ranks: ["A", "a ", null, "A"], genders: ["male", "x"], per_team: "2" }, { genders: ["male", "female"], per_team: 0 }]),
    [{ ranks: ["A", "a"], genders: ["male"], per_team: 2 }, { ranks: [], genders: [], per_team: null }],
  );
  assert.deepEqual(normalizeTeamDrawRules(null), [{ ranks: [], genders: [], per_team: null }]);
  assert.equal(normalizeTeamDrawRules([{ ranks: ["B"] }]).length, 2);
});

test("rắn + chia tới hết: 5 hạng A / 3 đội", () => {
  const steps = run(ppl(5), [10, 20, 30], [{ ranks: ["A"] }]);
  assert.deepEqual(steps.map((s) => s.team_pid), [10, 20, 30, 30, 20]);
  assert.deepEqual(steps.map((s) => s.pass_index), [0, 0, 0, 1, 1]);
  assert.equal(teamDrawFinished(ppl(5), [10, 20, 30], [{ ranks: ["A"] }], steps), true);
});

test("vòng theo hạng / giới tính / trần + vòng còn lại, kế hoạch", () => {
  const people = ppl(9, (i) => (i <= 3 ? "A" : i <= 6 ? "B" : "C"), (i) => ([4, 5, 6, 8].includes(i) ? "female" : "male"));
  const rules = [{ ranks: ["A"] }, { genders: ["female"], per_team: 1 }];
  const steps = run(people, [1, 2, 3], rules);
  assert.deepEqual(steps.slice(0, 3).map((s) => [s.tpid, s.team_pid]), [[1, 1], [2, 2], [3, 3]]);
  assert.deepEqual(steps.slice(3, 6).map((s) => [s.tpid, s.team_pid, s.round_index]), [[4, 3, 1], [5, 2, 1], [6, 1, 1]]);
  assert.deepEqual(steps.slice(6).map((s) => s.tpid).sort((a, b) => a - b), [7, 8, 9]);
  const plan = teamDrawPlan(people, [1, 2, 3], rules);
  assert.deepEqual(plan.rounds.map((r) => r.est_count), [3, 3, 3]);
  assert.equal(plan.total_steps, 9);
  assert.equal(plan.estimated, true);
  assert.equal(teamDrawStepContext(people, [], rules, []), null);
  assert.equal(teamDrawRuleLabel(plan.rounds[1]), "Nữ · tối đa 1/đội");
  assert.equal(teamDrawRuleLabel(plan.rounds[2]), "Còn lại — chia đều");
});

test("replay với seed: cùng công thức SHA256(seed:k) cho cùng kết quả", async () => {
  if (!globalThis.crypto?.subtle) return;   // node cũ không có WebCrypto
  const people = ppl(7, (i) => (i % 2 ? "A" : "B"));
  const seed = "ab".repeat(16);
  const go = async () => {
    const steps = [];
    for (;;) {
      const ctx = teamDrawStepContext(people, [5, 6], [{ ranks: ["A"], per_team: 1 }], steps);
      if (!ctx) return steps;
      const h = await sha256Hex(`${seed}:${steps.length}`);
      steps.push({ tpid: ctx.eligible_tpids[pickIndexFromHash(h, ctx.eligible_tpids.length)], team_pid: ctx.team_pid });
    }
  };
  const a = await go(), b = await go();
  assert.equal(a.length, 7);
  assert.deepEqual(a, b);
});
