// Chạy: npm test (node --test). Ghim hàm thuần Tổng quan / Thống kê giải đồng đội (đợt 1 mẫu FIS).
import test from "node:test";
import assert from "node:assert/strict";
import {
  tieProgress, teamAllStageStats, finalPlacements, teamRoundsPlayed, teamRuleSummary, teamOverviewCounts, rubberPoints,
} from "./teamOverview.js";

const done = (s1, s2) => ({ status: "completed", score1: s1, score2: s2 });
const P = [
  { id: 1, team_name: "Đội 1", group_name: "A", status: "active" },
  { id: 2, team_name: "Đội 2", group_name: "A", status: "active" },
  { id: 3, team_name: "Đội 3", group_name: "A", status: "active" },
];
const M = [
  { id: 10, phase: "group", group_name: "A", round_number: 1, match_number: 1, p1_id: 1, p2_id: 2, status: "completed", winner_id: 1,
    rubbers: [done(11, 5), done(9, 11), done(11, 7)] },
  { id: 11, phase: "group", group_name: "A", round_number: 2, match_number: 2, p1_id: 2, p2_id: 3, status: "in_progress",
    rubbers: [done(11, 3), { status: "pending" }, { status: "pending" }] },
  { id: 12, phase: "group", group_name: "A", round_number: 3, match_number: 3, p1_id: 1, p2_id: 3, status: "completed", winner_id: 3, is_walkover: true, rubbers: [] },
  { id: 13, phase: "group", group_name: "A", round_number: 3, match_number: 4, p1_id: 2, p2_id: null, status: "pending", rubbers: [] },
];

test("tieProgress: chỉ tính trận đủ 2 đội, pending bỏ xử thua và sắp theo vòng", () => {
  const r = tieProgress(M);
  assert.equal(r.total, 3); assert.equal(r.done, 2);
  assert.deepEqual(r.pending.map((m) => m.id), [11]);
});

test("teamAllStageStats: gộp trận ĐĐ (kể cả xử thua) + trận TP + điểm nhỏ, sắp theo thắng rồi hiệu số", () => {
  const rows = teamAllStageStats(M, P, { scoring: "match_points" });
  const by = Object.fromEntries(rows.map((r) => [r.participant_id, r]));
  assert.deepEqual([by[1].ties_played, by[1].ties_won, by[1].rubbers_won, by[1].rubbers_lost, by[1].pts_for, by[1].pts_against, by[1].diff],
    [2, 1, 2, 1, 31, 23, 8]);
  assert.deepEqual([by[3].ties_played, by[3].ties_won, by[3].rubbers_won], [1, 1, 0]);   // thắng xử thua, không có trận TP
  assert.equal(by[2].ties_played, 1);                                                      // trận 11 chưa xong → không tính
  assert.equal(rows[0].participant_id, 1);
});

test("rubberPoints: PA2 trừ điểm xuất phát", () => {
  assert.deepEqual(rubberPoints({ score1: 22, score2: 15, start1: 11, start2: 9 }, { scoring: "cumulative" }), [11, 6]);
  assert.deepEqual(rubberPoints({ score1: 11, score2: 7 }, { scoring: "match_points" }), [11, 7]);
});

test("finalPlacements: chung kết + tranh giải 3 → 4 hạng; chưa đấu → null", () => {
  const ko = [
    { phase: "knockout", round_number: 1, round_name: "Bán kết", p1_id: 1, p2_id: 2, status: "completed", winner_id: 1 },
    { phase: "knockout", round_number: 1, round_name: "Bán kết", p1_id: 3, p2_id: 4, status: "completed", winner_id: 4 },
    { phase: "knockout", round_number: 2, round_name: "Chung kết", p1_id: 1, p2_id: 4, status: "completed", winner_id: 4 },
    { phase: "knockout", round_number: 2, round_name: "Tranh giải 3", p1_id: 2, p2_id: 3, status: "completed", winner_id: 2 },
  ];
  assert.deepEqual(finalPlacements(ko).map((x) => [x.rank, x.pid]), [[1, 4], [2, 1], [3, 2], [4, 3]]);
  assert.equal(finalPlacements(ko.map((m) => ({ ...m, status: "pending", winner_id: null }))), null);
  assert.equal(finalPlacements(M), null);
});

test("teamRoundsPlayed / teamOverviewCounts / teamRuleSummary", () => {
  assert.deepEqual(teamRoundsPlayed(M, 1), { played: 2, total: 2 });
  const t = { format: "round_robin", participants: P, matches: M,
    team_players: [{ id: 1, participant_id: 1 }, { id: 2, participant_id: null }] };
  const rules = { scoring: "match_points", rubbers: [{ label: "Đôi Nam 1" }, { label: "Đôi Nữ 1" }, { label: "Đôi Nam Nữ 1" }],
    points_per_rubber: 11, win_by_two: true, play_all: true, max_rubbers_per_player: 2 };
  const c = teamOverviewCounts(t, rules);
  assert.deepEqual([c.ties.total, c.ties.done, c.players.total, c.players.pool, c.teams], [3, 2, 2, 1, 3]);
  const lines = teamRuleSummary(t, rules);
  assert.match(lines[0], /^3 đội, thi đấu vòng tròn một lượt/);
  assert.match(lines[1], /3 trận thành phần: Đôi Nam 1, Đôi Nữ 1, Đôi Nam Nữ 1/);
  assert.ok(lines.some((l) => l.includes("đối đầu trực tiếp → hiệu số trận thành phần")));
});
