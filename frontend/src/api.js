import axios from "axios";

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

// Tự logout nếu 401
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
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
};

export const feeTypesApi = {
  list: (params) => api.get("/api/fee-types", { params }),
  create: (data) => api.post("/api/fee-types", data),
  update: (id, data) => api.put(`/api/fee-types/${id}`, data),
  delete: (id) => api.delete(`/api/fee-types/${id}`),
};

export const transactionsApi = {
  list: (params) => api.get("/api/transactions", { params }),
  create: (data) => api.post("/api/transactions", data),
  update: (id, data) => api.put(`/api/transactions/${id}`, data),
  delete: (id) => api.delete(`/api/transactions/${id}`),
};

export const reportsApi = {
  overview: () => api.get("/api/reports/overview"),
  summary: (year) => api.get("/api/reports/summary", { params: { year } }),
  memberContributions: (params) => api.get("/api/reports/member-contributions", { params }),
  monthlyDetail: (month, year) => api.get("/api/reports/monthly-detail", { params: { month, year } }),
  feeStatus: (month, year, fee_type_id) => api.get("/api/reports/fee-status", { params: { month, year, fee_type_id } }),
};

export const tournamentsApi = {
  list: () => api.get("/api/tournaments"),
  get: (id) => api.get(`/api/tournaments/${id}`),
  create: (data) => api.post("/api/tournaments", data),
  update: (id, data) => api.put(`/api/tournaments/${id}`, data),
  delete: (id) => api.delete(`/api/tournaments/${id}`),
  generate: (id, shuffle = true) => api.post(`/api/tournaments/${id}/generate?shuffle=${shuffle}`),
  startKnockout: (id) => api.post(`/api/tournaments/${id}/start-knockout`),
  score: (tid, mid, data) => api.post(`/api/tournaments/${tid}/matches/${mid}/score`, data),
  standings: (tid, group) => api.get(`/api/tournaments/${tid}/standings`, { params: group ? { group } : {} }),
};

export default api;
