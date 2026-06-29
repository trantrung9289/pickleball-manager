import { useState, useEffect } from 'react';

const breakpoints = { xs: 480, sm: 576, md: 768, lg: 992, xl: 1200, xxl: 1600 };

// Nhận dạng thiết bị qua User-Agent (chỉ chạy 1 lần).
// Dùng cho chế độ "auto" để phân biệt điện thoại/tablet thật với desktop.
function detectDevice() {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const uaData = navigator.userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') {
    if (uaData.mobile) return 'mobile';
  }
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    return 'tablet';
  }
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|webOS/i.test(ua)) {
    return 'mobile';
  }
  // iPadOS 13+ giả lập desktop Safari → phát hiện qua touch + maxTouchPoints
  if (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)) return 'tablet';
  return 'desktop';
}

const deviceType = detectDevice();
const isTouchDevice =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);

export const useResponsive = () => {
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const handleResize = () =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const w = windowSize.width;
  return {
    isMobile: w < breakpoints.md,
    isTablet: w >= breakpoints.md && w < breakpoints.lg,
    isDesktop: w >= breakpoints.lg,
    width: w,
    height: windowSize.height,
    deviceType,      // 'mobile' | 'tablet' | 'desktop' (theo User-Agent)
    isTouchDevice,
    breakpoint:
      w < breakpoints.xs ? 'xs' :
      w < breakpoints.sm ? 'sm' :
      w < breakpoints.md ? 'md' :
      w < breakpoints.lg ? 'lg' :
      w < breakpoints.xl ? 'xl' : 'xxl',
  };
};
