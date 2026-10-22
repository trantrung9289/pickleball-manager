import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
});

// Gắn token + X-Club-ID vào mọi request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const clubId = localStorage.getItem("selectedClubId");
  if (clubId) config.headers["X-Club-ID"] = clubId;
  return config;
});

// Tự logout nếu 401 — trừ chính request đăng nhập (sai mật khẩu không phải phiên hết hạn,
// reload ở đây sẽ nuốt luôn thông báo lỗi và làm mất "mode" đang chọn ở App.jsx)
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const isLoginRequest = err.config?.url?.includes("/api/auth/login");
    if (err.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("selectedMembership");
      localStorage.removeItem("selectedClubId");
      window.location.href = "/";
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  status: () => api.get("/api/club/status"),
  setup: (data) => api.post("/api/club/setup", data),
  login: (data) => api.post("/api/auth/login", data),
  me: () => api.get("/api/auth/me"),
  getClub: () => api.get("/api/club"),
  updateClub: (data) => api.put("/api/club", data),
  myMemberships: () => api.get("/api/my-memberships"),
  // Cấu hình danh sách hạng của CLB (dùng chung Thành viên / Khách mời / quy tắc ghép đội)
  rankLevels: () => api.get("/api/club/rank-levels"),
  updateRankLevels: (levels) => api.put("/api/club/rank-levels", { rank_levels: levels }),
};

export const adminApi = {
  // Users
  listUsers: () => api.get("/api/admin/users"),
  createUser: (data) => api.post("/api/admin/users", data),
  updateUser: (id, data) => api.put(`/api/admin/users/${id}`, data),
  deleteUser: (id) => api.delete(`/api/admin/users/${id}`),
  // Clubs
  listClubs: () => api.get("/api/admin/clubs"),
  createClub: (data) => api.post("/api/admin/clubs", data),
  updateClub: (id, data) => api.put(`/api/admin/clubs/${id}`, data),
  deleteClub: (id) => api.delete(`/api/admin/clubs/${id}`),
  // Memberships
  listMemberships: (clubId) => api.get("/api/admin/memberships", { params: clubId ? { club_id: clubId } : {} }),
  createMembership: (data) => api.post("/api/admin/memberships", data),
  updateMembership: (id, data) => api.put(`/api/admin/memberships/${id}`, data),
  deleteMembership: (id) => api.delete(`/api/admin/memberships/${id}`),
};

export const membersApi = {
  list: (params) => api.get("/api/members", { params }),
  get: (id) => api.get(`/api/members/${id}`),
  create: (data) => api.post("/api/members", data),
  update: (id, data) => api.put(`/api/members/${id}`, data),
  delete: (id) => api.delete(`/api/members/${id}`),
  exportExcel: () => api.get("/api/members/export", { responseType: "blob" }),
  downloadTemplate: () => api.get("/api/members/template", { responseType: "blob" }),
  importExcel: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/api/members/import", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};

export const feeTypesApi = {
  list: (params) => api.get("/api/fee-types", { params }),
  create: (data) => api.post("/api/fee-types", data),
  update: (id, data) => api.put(`/api/fee-types/${id}`, data),
  delete: (id) => api.delete(`/api/fee-types/${id}`),
  exportExcel: () => api.get("/api/fee-types/export", { responseType: "blob" }),
  downloadTemplate: () => api.get("/api/fee-types/template", { responseType: "blob" }),
  importExcel: (file) => { const f = new FormData(); f.append("file", file); return api.post("/api/fee-types/import", f, { headers: { "Content-Type": "multipart/form-data" } }); },
};

export const transactionsApi = {
  list: (params) => api.get("/api/transactions", { params }),
  create: (data) => api.post("/api/transactions", data),
  update: (id, data) => api.put(`/api/transactions/${id}`, data),
  delete: (id) => api.delete(`/api/transactions/${id}`),
  exportExcel: (params) => api.get("/api/transactions/export", { params, responseType: "blob" }),
  downloadTemplate: () => api.get("/api/transactions/template", { responseType: "blob" }),
  importExcel: (file) => { const f = new FormData(); f.append("file", file); return api.post("/api/transactions/import", f, { headers: { "Content-Type": "multipart/form-data" } }); },
};

export const reportsApi = {
  overview: () => api.get("/api/reports/overview"),
  summary: (year) => api.get("/api/reports/summary", { params: { year } }),
  memberContributions: (params) => api.get("/api/reports/member-contributions", { params }),
  monthlyDetail: (month, year) => api.get("/api/reports/monthly-detail", { params: { month, year } }),
  feeStatus: (month, year, fee_type_id) => api.get("/api/reports/fee-status", { params: { month, year, fee_type_id } }),
};

export const playersApi = {
  list: (type) => api.get("/api/players", { params: type ? { type } : {} }),
  create: (data) => api.post("/api/players", data),
  update: (id, data) => api.put(`/api/players/${id}`, data),
  delete: (id) => api.delete(`/api/players/${id}`),
  /** Tạo player từ member CLB (tự động lấy tên từ member) */
  createFromMember: (memberId, memberName) =>
    api.post("/api/players", { member_id: memberId, name: memberName }),
  tournaments: (id) => api.get(`/api/players/${id}/tournaments`),
  convertToMember: (id) => api.post(`/api/players/${id}/convert-to-member`),
};

export const tournamentsApi = {
  list: () => api.get("/api/tournaments"),
  get: (id) => api.get(`/api/tournaments/${id}`),
  create: (data) => api.post("/api/tournaments", data),
  update: (id, data) => api.put(`/api/tournaments/${id}`, data),
  delete: (id) => api.delete(`/api/tournaments/${id}`),
  generate: (id, shuffle = true, force = false) => api.post(`/api/tournaments/${id}/generate?shuffle=${shuffle}&force=${force}`),
  startKnockout: (id) => api.post(`/api/tournaments/${id}/start-knockout`),
  score: (tid, mid, data) => api.post(`/api/tournaments/${tid}/matches/${mid}/score`, data),
  updateScorePin: (tid, data) => api.patch(`/api/tournaments/${tid}/score-pin`, data),
  updateThirdPlace: (tid, enabled) => api.patch(`/api/tournaments/${tid}/third-place`, { enabled }),
  standings: (tid, group) => api.get(`/api/tournaments/${tid}/standings`, { params: group ? { group } : {} }),
  replaceParticipant: (tid, pid, data) => api.patch(`/api/tournaments/${tid}/participants/${pid}`, data),
  addParticipant: (tid, data) => api.post(`/api/tournaments/${tid}/participants`, data),
  removeParticipant: (tid, pid) => api.delete(`/api/tournaments/${tid}/participants/${pid}`),
  // Thêm nhiều người chơi vào giải Nháp một lần — {member_ids: [], player_ids: []} → {added, skipped, tournament}
  addParticipantsBulk: (tid, data) => api.post(`/api/tournaments/${tid}/participants/bulk`, data),
  withdraw: (tid, pid) => api.post(`/api/tournaments/${tid}/participants/${pid}/withdraw`),
  // Phiên bốc thăm bằng vòng quay (server random có seed, admin quay từng lượt rồi chốt)
  draw: {
    get: (tid) => api.get(`/api/tournaments/${tid}/draw`),
    history: (tid) => api.get(`/api/tournaments/${tid}/draws`),
    open: (tid, data) => api.post(`/api/tournaments/${tid}/draw`, data),            // {force, reveal_ms}
    spin: (tid, expectedStep) => api.post(`/api/tournaments/${tid}/draw/spin`, { expected_step: expectedStep }),
    commit: (tid, force = false) => api.post(`/api/tournaments/${tid}/draw/commit`, { force }),
    cancel: (tid, reason) => api.post(`/api/tournaments/${tid}/draw/cancel`, { reason }),
  },
  // Phiên GHÉP ĐỘI ĐÔI bằng vòng quay (giải đôi ở trạng thái Nháp, ghép người đơn lẻ thành đội)
  partnerDraw: {
    get: (tid) => api.get(`/api/tournaments/${tid}/partner-draw`),
    history: (tid) => api.get(`/api/tournaments/${tid}/partner-draws`),
    open: (tid, data) => api.post(`/api/tournaments/${tid}/partner-draw`, data),        // {rules?, reveal_ms}
    spin: (tid, expectedStep) => api.post(`/api/tournaments/${tid}/partner-draw/spin`, { expected_step: expectedStep }),
    commit: (tid) => api.post(`/api/tournaments/${tid}/partner-draw/commit`),
    cancel: (tid, reason) => api.post(`/api/tournaments/${tid}/partner-draw/cancel`, { reason }),
  },
  // Ghép tay 2 người đơn lẻ thành 1 đội (giải đôi, Nháp, không có phiên ghép đội đang mở)
  pairParticipants: (tid, p1Id, p2Id) => api.post(`/api/tournaments/${tid}/participants/pair`, { p1_id: p1Id, p2_id: p2Id }),

  // ── GIẢI ĐỒNG ĐỘI (team_type="team"): đội nhiều VĐV, trận đồng đội (tie) gồm nhiều trận thành phần (rubber) ──
  // Đội = participant có team_name; VĐV của đội = TournamentTeamPlayer (team_player_id). Mọi thao tác trên tie
  // trả về TieOut đầy đủ để client thay state ngay, không cần GET lại.
  teams: {
    list: (tid) => api.get(`/api/tournaments/${tid}/teams`),                                   // → TeamOut[] {participant, players}
    create: (tid, data) => api.post(`/api/tournaments/${tid}/teams`, data),                    // {team_name} (Nháp)
    update: (tid, pid, data) => api.put(`/api/tournaments/${tid}/teams/${pid}`, data),         // {team_name?}
    delete: (tid, pid) => api.delete(`/api/tournaments/${tid}/teams/${pid}`),                  // Nháp
    // {member_ids, player_ids} → {added, skipped, team}; một người chỉ ở một đội (người đã ở đội khác → skipped)
    addPlayers: (tid, pid, data) => api.post(`/api/tournaments/${tid}/teams/${pid}/players/bulk`, data),
    patchPlayer: (tid, pid, tpid, data) => api.patch(`/api/tournaments/${tid}/teams/${pid}/players/${tpid}`, data),   // {is_captain?, gender?, rank?}
    removePlayer: (tid, pid, tpid) => api.delete(`/api/tournaments/${tid}/teams/${pid}/players/${tpid}`),   // gỡ về danh sách VĐV tham dự (không rời giải)
    bulkCreate: (tid, data) => api.post(`/api/tournaments/${tid}/teams/bulk`, data),       // {count, prefix?} → TeamOut[] (Nháp)
  },
  // Vòng quay PHÂN VĐV VÀO ĐỘI (giải đồng đội, Nháp): luật theo vòng {ranks, genders, per_team}, seed commit–reveal
  teamDraw: {
    get: (tid) => api.get(`/api/tournaments/${tid}/team-draw`),
    history: (tid) => api.get(`/api/tournaments/${tid}/team-draws`),
    open: (tid, data) => api.post(`/api/tournaments/${tid}/team-draw`, data),          // {rules, reveal_ms}
    spin: (tid, expectedStep) => api.post(`/api/tournaments/${tid}/team-draw/spin`, { expected_step: expectedStep }),
    commit: (tid) => api.post(`/api/tournaments/${tid}/team-draw/commit`),             // → TournamentOut
    cancel: (tid, reason) => api.post(`/api/tournaments/${tid}/team-draw/cancel`, { reason }),
  },
  // VĐV tham dự cấp giải (giải đồng đội, 2026-10-22): participant_id null = chưa phân đội
  teamPlayers: {
    list: (tid) => api.get(`/api/tournaments/${tid}/team-players`),                          // → TeamPlayerOut[] (mọi VĐV)
    add: (tid, data) => api.post(`/api/tournaments/${tid}/team-players/bulk`, data),         // {member_ids, player_ids, participant_id?} → {added, skipped, team?, pool_count}
    patch: (tid, tpid, data) => api.patch(`/api/tournaments/${tid}/team-players/${tpid}`, data),   // {participant_id?: int|null, gender?, rank?, is_captain?}
    remove: (tid, tpid) => api.delete(`/api/tournaments/${tid}/team-players/${tpid}`),        // xoá hẳn khỏi giải
  },
  // Đội hình đăng ký theo giai đoạn (leg1 | leg2 | knockout) — khoá tự động khi giai đoạn có điểm đầu tiên
  lineups: {
    list: (tid, pid) => api.get(`/api/tournaments/${tid}/teams/${pid}/lineups`),                              // → LineupOut[]
    set: (tid, pid, stage, data) => api.put(`/api/tournaments/${tid}/teams/${pid}/lineups/${stage}`, data),   // {slots: {label: [tpid]}}
    unlock: (tid, pid, stage, data) => api.post(`/api/tournaments/${tid}/teams/${pid}/lineups/${stage}/unlock`, data),   // {note}
  },
  // Biên bản trận đồng đội
  tie: {
    get: (tid, mid) => api.get(`/api/tournaments/${tid}/matches/${mid}/tie`),
    drawOrder: (tid, mid) => api.post(`/api/tournaments/${tid}/matches/${mid}/tie/draw-order`),
    setPlayers: (tid, mid, rid, data) => api.put(`/api/tournaments/${tid}/matches/${mid}/tie/rubbers/${rid}`, data),   // {side1_players?, side2_players?}
    score: (tid, mid, rid, data) => api.post(`/api/tournaments/${tid}/matches/${mid}/tie/rubbers/${rid}/score`, data),  // {score1, score2}
    walkover: (tid, mid, rid, data) => api.post(`/api/tournaments/${tid}/matches/${mid}/tie/rubbers/${rid}/walkover`, data),   // {side: 1|2} bên THUA
    resetScore: (tid, mid, rid) => api.delete(`/api/tournaments/${tid}/matches/${mid}/tie/rubbers/${rid}/score`),
  },
  // Nhật ký thao tác giải đồng đội (mở khoá đội hình, đổi VĐV, điểm, xử thua, bốc thăm) — mới nhất trước
  teamLogs: (tid, limit = 200) => api.get(`/api/tournaments/${tid}/team-logs`, { params: { limit } }),
};

// Sự kiện thành tích cá nhân (Mini game): cộng/trừ điểm từng người bằng nút +/−, không có trận đấu.
// `state` là bản rút gọn {version, status, participants:[{id, points, status}]} để poll rẻ (3s);
// `logs` tải tăng dần theo after_id (nhật ký chỉ-ghi-thêm). `addPoint` gửi client_op_id để backend
// bỏ qua request trùng khi client retry (idempotent).
// Các request poll/chấm điểm có `timeout` riêng (không đổi instance axios toàn cục): request treo quá 10s bị huỷ
// với err.code === "ECONNABORTED" để vòng poll / hàng đợi chấm điểm không bị kẹt vĩnh viễn.
const POINT_EVENT_TIMEOUT_MS = 10000;
export const pointEventsApi = {
  list: () => api.get("/api/point-events", { timeout: POINT_EVENT_TIMEOUT_MS }),
  create: (data) => api.post("/api/point-events", data),
  get: (id) => api.get(`/api/point-events/${id}`, { timeout: POINT_EVENT_TIMEOUT_MS }),
  state: (id) => api.get(`/api/point-events/${id}/state`, { timeout: POINT_EVENT_TIMEOUT_MS }),
  logs: (id, afterId = 0, limit = 200) => api.get(`/api/point-events/${id}/logs`, { params: { after_id: afterId, limit }, timeout: POINT_EVENT_TIMEOUT_MS }),
  update: (id, data) => api.put(`/api/point-events/${id}`, data),
  addParticipantsBulk: (id, data) => api.post(`/api/point-events/${id}/participants/bulk`, data),
  removeParticipant: (id, pid) => api.delete(`/api/point-events/${id}/participants/${pid}`),
  addPoint: (id, pid, delta, clientOpId) => api.post(`/api/point-events/${id}/participants/${pid}/points`, { delta, client_op_id: clientOpId }, { timeout: POINT_EVENT_TIMEOUT_MS }),
  delete: (id) => api.delete(`/api/point-events/${id}`),
};

export const reportLinksApi = {
  list: () => api.get("/api/report-links"),
  create: (data) => api.post("/api/report-links", data),
  toggle: (id) => api.patch(`/api/report-links/${id}/toggle`),
  delete: (id) => api.delete(`/api/report-links/${id}`),
};

// Factory trả về api object cho một public slug/token (không cần auth)
export const createPublicReportApi = (slug) => {
  const base = `${BASE_URL}/api/public/report/${slug}`;
  const pub = axios.create({ baseURL: BASE_URL });
  return {
    meta: () => pub.get(`/api/public/report/${slug}`),
    reports: {
      summary: (year) => pub.get(`${base}/summary`, { params: { year } }),
      monthlyDetail: (month, year) => pub.get(`${base}/monthly-detail`, { params: { month, year } }),
      memberContributions: (params) => pub.get(`${base}/member-contributions`, { params }),
      feeStatus: (month, year, fee_type_id) => pub.get(`${base}/fee-status`, { params: { month, year, fee_type_id } }),
    },
    transactions: {
      list: (params) => pub.get(`${base}/transactions`, { params }),
    },
    feeTypes: {
      list: (params) => pub.get(`${base}/fee-types`, { params }),
    },
    tournaments: {
      list: () => pub.get(`${base}/tournaments`),
      detail: (tid) => pub.get(`${base}/tournaments/${tid}`),
      standings: (tid, group) => pub.get(`${base}/tournaments/${tid}/standings`, { params: { group } }),
      score: (tid, mid, data) => pub.post(`${base}/tournaments/${tid}/matches/${mid}/score`, data),
      // Bốc thăm: public poll nhanh (2s) trên endpoint riêng — bucket rate-limit riêng theo path
      draw: (tid) => pub.get(`${base}/tournaments/${tid}/draw`),
      drawHistory: (tid) => pub.get(`${base}/tournaments/${tid}/draws`),
      // Ghép đội đôi: public theo dõi trực tiếp (poll 2s) + biên bản các phiên đã kết thúc
      partnerDraw: (tid) => pub.get(`${base}/tournaments/${tid}/partner-draw`),
      partnerDrawHistory: (tid) => pub.get(`${base}/tournaments/${tid}/partner-draws`),
      // Giải đồng đội: danh sách đội + VĐV (không PII) và biên bản một trận đồng đội (poll như trận thường)
      teams: (tid) => pub.get(`${base}/tournaments/${tid}/teams`),
      tie: (tid, mid) => pub.get(`${base}/tournaments/${tid}/matches/${mid}/tie`),
      // Phân VĐV vào đội bằng vòng quay: public theo dõi trực tiếp (poll 2s) + lịch sử phiên
      teamDraw: (tid) => pub.get(`${base}/tournaments/${tid}/team-draw`),
      teamDrawHistory: (tid) => pub.get(`${base}/tournaments/${tid}/team-draws`),
    },
    // Sự kiện thành tích cá nhân: chỉ hiện khi status != draft; `state` poll 3s (bucket rate-limit riêng)
    // Mỗi request có timeout 10s để vòng poll public không kẹt khi mạng treo
    pointEvents: {
      list: () => pub.get(`${base}/point-events`, { timeout: POINT_EVENT_TIMEOUT_MS }),
      detail: (eid) => pub.get(`${base}/point-events/${eid}`, { timeout: POINT_EVENT_TIMEOUT_MS }),
      state: (eid) => pub.get(`${base}/point-events/${eid}/state`, { timeout: POINT_EVENT_TIMEOUT_MS }),
      logs: (eid, afterId = 0, limit = 200) => pub.get(`${base}/point-events/${eid}/logs`, { params: { after_id: afterId, limit }, timeout: POINT_EVENT_TIMEOUT_MS }),
    },
  };
};

export default api;
