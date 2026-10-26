// Chạy: npm test (node --test). Ghim hàm thuần của giải đồng đội — gương backend/tournament_engine.py
// (test_batch19_team_format.py): nhãn tự đánh số, chuẩn hoá quy tắc, mốc PA2, giai đoạn, vượt số trận.
import test from "node:test";
import assert from "node:assert/strict";
import {
  autoLabelRubbers, placeholderLabels, normalizeTeamRules, defaultTeamRules, defaultTargetTotal, rubberTarget,
  stagesForFormat, overLimitIds, appearanceCounts, genderIssue, preferredGenders, teamGenderNeeds,
  teamRosterWarnings, tieScoreLabel, playerIndex, rubberStatusLabel, rubberSize, slotIssueText,
  indexTeamPlayers, matchRubbersForDisplay, rubberScoreView, distributeEvenly, rubberTotals, rosterCountText, rulesForStage,
} from "./teamFormat.js";

test("autoLabelRubbers: nhãn trống tự đánh số theo thể thức, bộ đếm tăng cả khi có nhãn tự đặt, trùng nhãn thêm hậu tố", () => {
  const out = autoLabelRubbers([
    { code: "MD" }, { code: "md", label: "  " }, { code: "WD", label: "Nữ chủ lực" }, { code: "WD" },
    { code: "XD", label: "Đôi Nam 1" }, { code: "ZZ" },
  ]);
  assert.deepEqual(out, [
    { code: "MD", label: "Đôi Nam 1" },
    { code: "MD", label: "Đôi Nam 2" },
    { code: "WD", label: "Nữ chủ lực" },
    { code: "WD", label: "Đôi Nữ 2" },          // bộ đếm WD đã là 2 dù trận trước có nhãn riêng
    { code: "XD", label: "Đôi Nam 1 (2)" },     // trùng với nhãn tự sinh của MD
  ]);
  assert.deepEqual(placeholderLabels([{ code: "MS" }, { code: "MS", label: "x" }, { code: "WS" }]),
    ["Đơn Nam 1", "Đơn Nam 2", "Đơn Nữ 1"]);
});

test("normalizeTeamRules: mặc định PA1, 5 thể thức, 11 điểm, cách biệt 2, tối đa 2 trận/VĐV", () => {
  const r = normalizeTeamRules(null);
  assert.equal(r.scoring, "match_points");
  assert.deepEqual(r.rubbers.map((x) => x.code), ["MD", "WD", "XD", "MS", "WS"]);
  assert.deepEqual(r.rubbers.map((x) => x.label), ["Đôi Nam 1", "Đôi Nữ 1", "Đôi Nam Nữ 1", "Đơn Nam 1", "Đơn Nữ 1"]);
  assert.equal(r.points_per_rubber, 11);
  assert.equal(r.win_by_two, true);
  assert.equal(r.target_total, null);
  assert.equal(r.max_rubbers_per_player, 2);
  assert.equal(r.play_all, true);
  // editor khởi tạo chuẩn hoá ra cùng kết quả
  assert.deepEqual(normalizeTeamRules(defaultTeamRules()).rubbers, r.rubbers);
});

test("normalizeTeamRules: PA2 mốc tổng mặc định = điểm × số trận, không thấp hơn điểm/trận; giá trị lạ về mặc định", () => {
  const r = normalizeTeamRules({ scoring: "cumulative", points_per_rubber: "15", rubbers: [{ code: "MD" }, { code: "WD" }, { code: "XD" }] });
  assert.equal(r.target_total, 45);
  // mốc tổng bị kẹp ≤ điểm × số trận (lớn hơn thì trận đồng đội không bao giờ kết thúc) — như backend
  assert.equal(normalizeTeamRules({ scoring: "cumulative", points_per_rubber: 11, target_total: 60, rubbers: [{ code: "MS" }] }).target_total, 11);
  assert.equal(normalizeTeamRules({ scoring: "cumulative", points_per_rubber: 11, target_total: 99, rubbers: [{ code: "MS" }, { code: "MD" }, { code: "WD" }] }).target_total, 33);
  assert.equal(normalizeTeamRules({ scoring: "cumulative", points_per_rubber: 11, target_total: 25, rubbers: [{ code: "MS" }, { code: "MD" }, { code: "WD" }] }).target_total, 25);
  assert.equal(normalizeTeamRules({ scoring: "cumulative", points_per_rubber: 21, target_total: 5, rubbers: [{ code: "MS" }] }).target_total, 21);
  assert.equal(normalizeTeamRules({ scoring: "weird", points_per_rubber: "abc", max_rubbers_per_player: 0 }).points_per_rubber, 11);
  assert.equal(normalizeTeamRules({ max_rubbers_per_player: 0 }).max_rubbers_per_player, 2);
  assert.equal(normalizeTeamRules({ win_by_two: false, play_all: false }).win_by_two, false);
  assert.throws(() => normalizeTeamRules({ rubbers: [{ code: "ZZ" }] }), /ít nhất 1/);
  assert.equal(defaultTargetTotal({ points_per_rubber: 15, rubbers: [{ code: "MD" }, { code: "WD" }] }), 30);
});

test("rubberTarget: PA1 = điểm/trận; PA2 = k × điểm, chặn ở mốc tổng", () => {
  const pa1 = normalizeTeamRules({ points_per_rubber: 15 });
  assert.equal(rubberTarget(pa1, 1), 15);
  assert.equal(rubberTarget(pa1, 5), 15);
  const pa2 = normalizeTeamRules({ scoring: "cumulative", points_per_rubber: 11, target_total: 50 });
  assert.deepEqual([1, 2, 3, 4, 5].map((k) => rubberTarget(pa2, k)), [11, 22, 33, 44, 50]);
});

test("stagesForFormat: vòng tròn 1 lượt → leg1; 2 lượt → +leg2; combined → leg1+knockout; knockout → knockout", () => {
  assert.deepEqual(stagesForFormat("round_robin"), ["leg1"]);
  assert.deepEqual(stagesForFormat("round_robin_double"), ["leg1", "leg2"]);
  assert.deepEqual(stagesForFormat("combined"), ["leg1", "knockout"]);
  assert.deepEqual(stagesForFormat("knockout"), ["knockout"]);
  assert.deepEqual(stagesForFormat(undefined), ["leg1"]);
});

test("overLimitIds / appearanceCounts: đếm mỗi trận 1 lần, vượt giới hạn mới báo", () => {
  const rules = { max_rubbers_per_player: 2 };
  const sides = [[1, 2], [1, 3], [1, 1], [2, 3], [], null];
  assert.deepEqual(overLimitIds(rules, sides), [1]);
  assert.deepEqual(appearanceCounts(sides), { 1: 3, 2: 2, 3: 2 });
  assert.deepEqual(overLimitIds({ max_rubbers_per_player: 3 }, sides), []);
  assert.deepEqual(overLimitIds({}, [["5"], ["5"], ["5"]]), [5]);   // id dạng chuỗi vẫn gộp đúng
});

test("genderIssue / preferredGenders / rubberSize", () => {
  assert.equal(genderIssue("MD", ["male", "male"]), null);
  assert.equal(genderIssue("MD", ["male", "female"]), "mismatch");
  assert.equal(genderIssue("XD", ["female", "male"]), null);        // không phụ thuộc thứ tự
  assert.equal(genderIssue("XD", ["male", null]), "unknown");
  assert.equal(genderIssue("WS", ["other"]), "unknown");
  assert.equal(genderIssue("MS", ["male", "male"]), null);          // sai số người → không xét giới tính (backend báo lỗi riêng)
  assert.equal(genderIssue("ZZ", ["male"]), null);
  const byId = { 1: { gender: "male" }, 2: { gender: "female" }, 3: { gender: null } };
  assert.equal(slotIssueText("MD", [1, 2], byId), "Giới tính VĐV không khớp thể thức");
  assert.equal(slotIssueText("XD", [1, 3], byId), "Có VĐV chưa khai giới tính");
  assert.equal(slotIssueText("XD", [1, 2], byId), null);
  assert.equal(slotIssueText("MD", [1], byId), null);        // chưa đủ người → chưa xét
  assert.equal(slotIssueText("MD", [1, 99], undefined), "Có VĐV chưa khai giới tính");
  assert.deepEqual(preferredGenders("MD"), ["male"]);
  assert.deepEqual(preferredGenders("XD"), ["male", "female"]);
  assert.deepEqual(preferredGenders("WS"), ["female"]);
  assert.equal(rubberSize("MD"), 2);
  assert.equal(rubberSize("WS"), 1);
  assert.equal(rubberSize("??"), 0);
});

test("teamGenderNeeds / teamRosterWarnings: 5 thể thức mặc định cần tối thiểu 2 nam + 2 nữ khi mỗi người tối đa 2 trận", () => {
  const rules = normalizeTeamRules(null);   // MD(2 nam) WD(2 nữ) XD(1+1) MS(1 nam) WS(1 nữ) → 4 nam-suất, 4 nữ-suất
  assert.deepEqual(teamGenderNeeds(rules), { male: 2, female: 2 });
  assert.deepEqual(teamGenderNeeds({ ...rules, max_rubbers_per_player: 1 }), { male: 4, female: 4 });
  // Thêm 1 Đôi Nam nữa → 6 nam-suất → cần 3 nam
  assert.deepEqual(teamGenderNeeds({ ...rules, rubbers: [...rules.rubbers, { code: "MD", label: "Đôi Nam 2" }] }), { male: 3, female: 2 });
  const players = [{ gender: "male" }, { gender: "female" }, { gender: null }];
  assert.deepEqual(teamRosterWarnings(rules, players), [
    "Thiếu VĐV Nam: cần tối thiểu 2, hiện có 1",
    "Thiếu VĐV Nữ: cần tối thiểu 2, hiện có 1",
    "1 VĐV chưa khai giới tính",
  ]);
  assert.deepEqual(teamRosterWarnings(rules, [
    { gender: "male" }, { gender: "male" }, { gender: "female" }, { gender: "female" },
  ]), []);
});

test("tieScoreLabel: hoàn thành → tỉ số; đang đấu có điểm → live; chưa đấu → '–'", () => {
  assert.deepEqual(tieScoreLabel({ status: "completed", score1: 3, score2: 2 }), { text: "3 – 2", live: false });
  assert.deepEqual(tieScoreLabel({ status: "pending", score1: 1, score2: 0 }), { text: "1 – 0", live: true });
  assert.deepEqual(tieScoreLabel({ status: "pending", score1: null, score2: null }), { text: "–", live: false });
  assert.deepEqual(tieScoreLabel({ status: "pending", score1: 0, score2: 0 }), { text: "–", live: false });
  assert.deepEqual(tieScoreLabel(null), { text: "–", live: false });
});

test("playerIndex / rubberStatusLabel", () => {
  const idx = playerIndex({ players: [{ id: 1, display_name: "A" }] }, null, { players: [{ id: 2, display_name: "B" }] });
  assert.deepEqual(Object.keys(idx), ["1", "2"]);
  assert.equal(idx[2].display_name, "B");
  assert.equal(rubberStatusLabel({ status: "completed", is_walkover: false }, false), "Hoàn thành");
  assert.equal(rubberStatusLabel({ status: "completed", is_walkover: true }, true), "Xử thua");
  assert.equal(rubberStatusLabel({ status: "pending" }, false), "Chưa đấu");
  assert.equal(rubberStatusLabel({ status: "pending" }, true), "Không cần đấu");
});

test("indexTeamPlayers / matchRubbersForDisplay / rubberScoreView", () => {
  const idx = indexTeamPlayers([{ id: 3, display_name: "A" }, { id: 5, display_name: "B" }]);
  assert.equal(idx[5].display_name, "B");
  const rules = normalizeTeamRules({ rubbers: [{ code: "MD" }, { code: "WS" }] });
  const tpl = matchRubbersForDisplay({ rubbers: [] }, rules);
  assert.equal(tpl.template, true);
  assert.deepEqual(tpl.rubbers.map((r) => r.label), ["Đôi Nam 1", "Đơn Nữ 1"]);
  const real = matchRubbersForDisplay({ rubbers: [{ id: 9, order_index: 2, label: "x" }, { id: 8, order_index: 1, label: "y" }] }, rules);
  assert.equal(real.template, false);
  assert.deepEqual(real.rubbers.map((r) => r.id), [8, 9]);
  assert.deepEqual(rubberScoreView({ status: "pending" }, rules), { text: null, own: null, winner: null });
  assert.deepEqual(rubberScoreView({ status: "completed", score1: 11, score2: 7 }, rules), { text: "11 – 7", own: null, winner: 1 });
  const pa2 = normalizeTeamRules({ scoring: "cumulative", rubbers: [{ code: "MD" }, { code: "MD" }] });
  assert.deepEqual(rubberScoreView({ status: "completed", score1: 18, score2: 22, start1: 11, start2: 7 }, pa2),
    { text: "18 – 22", own: "7 / 15", winner: 2 });
});

test("distributeEvenly: gán cho đội ít người nhất, hoà thì đội đứng trước", () => {
  const teams = [
    { participant: { id: 1 }, players: [{}, {}] },
    { participant: { id: 2 }, players: [] },
    { participant: { id: 3 }, players: [{}] },
  ];
  assert.deepEqual(distributeEvenly([10, 11, 12, 13], teams), [
    { tpid: 10, participant_id: 2 },   // 2:0 → 1
    { tpid: 11, participant_id: 2 },   // đội 2 (1) vẫn ≤ đội 3 (1)? hoà → đội đứng trước trong danh sách là đội 2? không: 1:2, 2:1, 3:1 → đội 2 đứng trước đội 3
    { tpid: 12, participant_id: 3 },   // 1:2, 2:2, 3:1 → đội 3
    { tpid: 13, participant_id: 1 },   // 1:2, 2:2, 3:2 → hoà → đội 1
  ]);
  assert.deepEqual(distributeEvenly([1], []), []);
});

test("rubberTotals: trận chưa mở biên bản đếm theo thể thức, trận kết thúc chỉ đếm đã đấu, xử thua = 0", () => {
  const rules = { rubbers: [{ code: "MD" }, { code: "WD" }, { code: "XD" }] };
  const done = (s1, s2) => ({ status: "completed", score1: s1, score2: s2 });
  const matches = [
    { status: "pending", rubbers: [] },                                               // 3 theo thể thức
    { status: "in_progress", rubbers: [done(11, 5), { status: "pending" }, { status: "pending" }] },  // 3, đã 1
    { status: "completed", rubbers: [done(11, 5), done(11, 7)] },                      // PA2 kết thúc sớm: 2/2
    { status: "completed", is_walkover: true, rubbers: [] },                           // bỏ qua
  ];
  assert.deepEqual(rubberTotals(matches, rules), { total: 8, done: 3, remaining: 5, perTie: 3 });
  assert.deepEqual(rubberTotals([], rules), { total: 0, done: 0, remaining: 0, perTie: 3 });
});

test("sĩ số đội tối đa (mẫu FIS): chuẩn hoá null/số, cảnh báo vượt trần, chữ đếm n/N", () => {
  const r = normalizeTeamRules({ max_male: "8", max_female: 2, max_players: "", rubbers: [{ code: "MD" }] });
  assert.deepEqual([r.max_male, r.max_female, r.max_players], [8, 2, null]);
  assert.deepEqual([normalizeTeamRules(null).max_male, normalizeTeamRules({ max_male: 0 }).max_male, normalizeTeamRules({ max_male: "x" }).max_male], [null, null, null]);
  const rules = normalizeTeamRules({ max_male: 1, max_female: 1, max_players: 2, rubbers: [{ code: "XD" }] });
  const players = [{ gender: "male" }, { gender: "male" }, { gender: "female" }];
  const w = teamRosterWarnings(rules, players);
  assert.ok(w.some((x) => x.startsWith("Vượt sĩ số Nam: tối đa 1, hiện có 2")));
  assert.ok(w.some((x) => x.startsWith("Vượt sĩ số đội: tối đa 2, hiện có 3")));
  assert.equal(rosterCountText(rules, players), "3/2 VĐV · 2/1 Nam · 1/1 Nữ");
  assert.equal(rosterCountText(normalizeTeamRules(null), [{ gender: "male" }, {}]), "2 VĐV · 1 Nam · 0 Nữ · 1 chưa khai");
});

test("normalizeTeamRules: ranking mặc định tie_points, point_diff giữ nguyên, giá trị lạ về mặc định", () => {
  assert.equal(normalizeTeamRules(null).ranking, "tie_points");
  assert.equal(normalizeTeamRules({ ranking: "point_diff" }).ranking, "point_diff");
  assert.equal(normalizeTeamRules({ ranking: "x" }).ranking, "tie_points");
});

test("mẫu FIS đợt 4: Đôi tự do không ràng buộc giới; bộ thể thức vòng loại riêng + play_all theo giai đoạn", () => {
  assert.equal(genderIssue("FD", ["male", null]), "");
  const r = normalizeTeamRules({ scoring: "cumulative", points_per_rubber: 11, rubbers: [{ code: "MD" }, { code: "WD" }],
    knockout_rubbers: [{ code: "MD" }, { code: "WD" }, { code: "XD" }, { code: "FD" }], knockout_play_all: false });
  assert.equal(r.knockout_rubbers.length, 4);
  assert.deepEqual(r.knockout_rubbers.map((x) => x.label), ["Đôi Nam 1", "Đôi Nữ 1", "Đôi Nam Nữ 1", "Đôi tự do 1"]);
  assert.equal(r.knockout_play_all, false);
  assert.equal(rulesForStage(r, "leg1").rubbers.length, 2);
  const ko = rulesForStage(r, "knockout");
  assert.equal(ko.rubbers.length, 4); assert.equal(ko.target_total, 44); assert.equal(ko.play_all, false);
  assert.equal(normalizeTeamRules(null).knockout_rubbers, null);
  assert.equal(normalizeTeamRules(null).knockout_play_all, null);
  // mẫu trận thành phần của trận loại trực tiếp lấy theo bộ vòng loại
  assert.equal(matchRubbersForDisplay({ phase: "knockout", rubbers: [] }, r).rubbers.length, 4);
  assert.equal(matchRubbersForDisplay({ phase: "group", rubbers: [] }, r).rubbers.length, 2);
  assert.deepEqual(rubberTotals([{ phase: "group", status: "pending", rubbers: [] }, { phase: "knockout", status: "pending", rubbers: [] }], r).total, 6);
});
