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
  const { isMobile } = useResponsive();

  useEffect(() => {
    localStorage.setItem('viewMode', mode);
  }, [mode]);

  // 'auto' | 'desktop' | 'mobile'
  const effectiveView =
    mode === 'desktop' ? 'desktop' :
    mode === 'mobile'  ? 'mobile'  :
    isMobile           ? 'mobile'  : 'desktop';

  const isMobileView = effectiveView === 'mobile';

  return (
    <ViewModeContext.Provider value={{ mode, setMode, effectiveView, isMobileView, isForced: mode !== 'auto' }}>
      {children}
    </ViewModeContext.Provider>
  );
};
