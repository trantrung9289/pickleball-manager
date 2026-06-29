import { useState, useEffect } from 'react';

const breakpoints = { xs: 480, sm: 576, md: 768, lg: 992, xl: 1200, xxl: 1600 };

export const useResponsive = () => {
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
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
    breakpoint:
      w < breakpoints.xs ? 'xs' :
      w < breakpoints.sm ? 'sm' :
      w < breakpoints.md ? 'md' :
      w < breakpoints.lg ? 'lg' :
      w < breakpoints.xl ? 'xl' : 'xxl',
  };
};
