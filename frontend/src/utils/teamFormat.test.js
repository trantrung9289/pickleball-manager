// Chạy: npm test (node --test). Ghim hàm thuần của giải đồng đội — gương backend/tournament_engine.py
// (test_batch19_team_format.py): nhãn tự đánh số, chuẩn hoá quy tắc, mốc PA2, giai đoạn, vượt số trận.
import test from "node:test";
import assert from "node:assert/strict";
import {
  autoLabelRubbers, placeholderLabels, normalizeTeamRules, defaultTeamRules, defaultTargetTotal, rubberTarget,
  stagesForFormat, overLimitIds, appearanceCounts, genderIssue, preferredGenders, teamGenderNeeds,
  teamRosterWarnings, tieScoreLabel, playerIndex, rubberStatusLabel, rubberSize, slotIssueText,
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
