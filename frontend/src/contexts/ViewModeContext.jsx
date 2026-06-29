import React, { createContext, useState, useContext, useEffect } from 'react';
import { useResponsive } from '../hooks/useResponsive';

const ViewModeContext = createContext();

export const useViewMode = () => {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error('useViewMode must be used within ViewModeProvider');
  return ctx;
};

export const ViewModeProvider = ({ children }) => {
  const [mode, setMode] = useState(() => localStorage.getItem('viewMode') || 'auto');
  const { isMobile, deviceType } = useResponsive();

  useEffect(() => {
    localStorage.setItem('viewMode', mode);
  }, [mode]);

  // ── Chế độ 'auto' nhận dạng thiết bị đang truy cập ──
  // Là mobile nếu: thiết bị thật là điện thoại (User-Agent) HOẶC cửa sổ hẹp (< 768px).
  // → Điện thoại luôn ra giao diện mobile; desktop thu nhỏ cửa sổ cũng ra mobile.
  const autoIsMobile = deviceType === 'mobile' || isMobile;

  const effectiveView =
    mode === 'desktop' ? 'desktop' :
    mode === 'mobile'  ? 'mobile'  :
    autoIsMobile       ? 'mobile'  : 'desktop';

  const isMobileView = effectiveView === 'mobile';

  return (
    <ViewModeContext.Provider
      value={{
        mode,
        setMode,
        effectiveView,
        isMobileView,
        isForced: mode !== 'auto',
        deviceType,
      }}
    >
      {children}
    </ViewModeContext.Provider>
  );
};
