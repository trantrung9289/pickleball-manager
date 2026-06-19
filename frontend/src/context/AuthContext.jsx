import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { authApi } from "../api";

const AuthContext = createContext(null);

function computePerms(membership) {
  if (!membership) return { canView: false, canCreate: false, canEdit: false, canDelete: false, isClubAdmin: false };
  const isClubAdmin = membership.role === "admin";
  return {
    isClubAdmin,
    canView:   isClubAdmin || membership.can_view,
    canCreate: isClubAdmin || membership.can_create,
    canEdit:   isClubAdmin || membership.can_edit,
    canDelete: isClubAdmin || membership.can_delete,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("user")); } catch { return null; }
  });
  const [club, setClub] = useState(null);             // thông tin CLB đang xét (từ /api/club/status)
  const [initialized, setInitialized] = useState(null);
  const [loading, setLoading] = useState(true);

  // Multi-club state
  const [memberships, setMemberships] = useState([]);       // tất cả CLB user có quyền
  const [selectedMembership, setSelectedMembership] = useState(() => {
    try { return JSON.parse(localStorage.getItem("selectedMembership")); } catch { return null; }
  });

  const checkStatus = useCallback(async () => {
    try {
      const { data } = await authApi.status();
      setInitialized(data.initialized);
      if (data.club) setClub(data.club);
    } catch {
      setInitialized(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load memberships cho user (non-superuser)
  const loadMemberships = useCallback(async () => {
    try {
      const { data } = await authApi.myMemberships();
      setMemberships(data);
      // Nếu chỉ có 1 CLB → tự động chọn
      if (data.length === 1) {
        _selectMembership(data[0]);
      } else if (data.length > 1) {
        // Kiểm tra xem selectedMembership còn hợp lệ không
        const saved = JSON.parse(localStorage.getItem("selectedMembership") || "null");
        if (saved) {
          const still = data.find(m => m.id === saved.id);
          if (still) {
            _selectMembership(still);
          } else {
            _clearMembership();
          }
        }
      } else {
        _clearMembership();
      }
    } catch {
      setMemberships([]);
      _clearMembership();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function _selectMembership(m) {
    setSelectedMembership(m);
    localStorage.setItem("selectedMembership", JSON.stringify(m));
    localStorage.setItem("selectedClubId", String(m.club_id));
  }

  function _clearMembership() {
    setSelectedMembership(null);
    localStorage.removeItem("selectedMembership");
    localStorage.removeItem("selectedClubId");
  }

  // Refresh club status + memberships (gọi khi focus lại tab hoặc sau khi có thay đổi)
  const refreshAll = useCallback(async () => {
    await checkStatus();
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const { data: me } = await authApi.me();
      setUser(me);
      localStorage.setItem("user", JSON.stringify(me));
      if (!me.is_superuser) {
        await loadMemberships();
      }
    } catch {
      // token hết hạn → interceptor axios đã xử lý redirect
    }
  }, [checkStatus, loadMemberships]);

  useEffect(() => {
    // Khởi động lần đầu
    const token = localStorage.getItem("token");
    checkStatus();
    if (token) {
      authApi.me().then(({ data }) => {
        setUser(data);
        localStorage.setItem("user", JSON.stringify(data));
        if (!data.is_superuser) loadMemberships();
      }).catch(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUser(null);
        _clearMembership();
        setMemberships([]);
      });
    }

    // Tự động cập nhật khi người dùng quay lại tab / focus cửa sổ
    const onFocus = () => {
      if (localStorage.getItem("token")) refreshAll();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && localStorage.getItem("token")) refreshAll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkStatus, loadMemberships, refreshAll]);

  const login = async (username, password) => {
    const { data } = await authApi.login({ username, password });
    localStorage.setItem("token", data.access_token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
    try {
      const { data: clubData } = await authApi.getClub();
      setClub(clubData);
    } catch {}
    if (!data.user.is_superuser) {
      // load memberships — sẽ tự chọn nếu chỉ có 1
      try {
        const { data: ms } = await authApi.myMemberships();
        setMemberships(ms);
        if (ms.length === 1) _selectMembership(ms[0]);
        else _clearMembership(); // user sẽ phải chọn
      } catch {
        setMemberships([]);
        _clearMembership();
      }
    } else {
      setMemberships([]);
      _clearMembership();
    }
    return data.user;
  };

  const setup = async (formData) => {
    const { data } = await authApi.setup(formData);
    localStorage.setItem("token", data.access_token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
    setInitialized(true);
    await checkStatus();
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    setMemberships([]);
    _clearMembership();
  };

  const selectClub = (membership) => {
    if (membership) _selectMembership(membership);
    else _clearMembership();
  };

  const perms = useMemo(() => computePerms(selectedMembership), [selectedMembership]);

  // CLB đang được chọn (từ membership)
  const selectedClub = selectedMembership?.club || null;

  return (
    <AuthContext.Provider value={{
      user, club, initialized, loading,
      memberships, selectedMembership, selectedClub, perms,
      login, logout, setup, selectClub, checkStatus, refreshAll,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
