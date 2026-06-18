import React, { useState, useEffect, useRef } from 'react';

const PullToRefresh = ({ onRefresh, children }) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);

  const maxPull = 120;
  const triggerThreshold = 80;

  useEffect(() => {
    const handleTouchStart = (e) => {
      if (window.scrollY === 0) {
        startYRef.current = e.touches[0].clientY;
        isPullingRef.current = true;
      }
    };

    const handleTouchMove = (e) => {
      if (!isPullingRef.current || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const distance = currentY - startYRef.current;

      if (distance > 0 && window.scrollY === 0) {
        if (e.cancelable) {
          e.preventDefault();
        }
        setPullDistance(Math.min(distance * 0.5, maxPull));
      } else {
        isPullingRef.current = false;
        setPullDistance(0);
      }
    };

    const handleTouchEnd = () => {
      if (!isPullingRef.current) return;

      if (pullDistance > triggerThreshold && !isRefreshing) {
        setIsRefreshing(true);
        setPullDistance(60); 
        onRefresh();
      } else {
        setPullDistance(0);
      }
      isPullingRef.current = false;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, isRefreshing, onRefresh]);

  const indicatorStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: `${pullDistance}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#f0f4f1',
    zIndex: 9999,
    boxShadow: pullDistance > 0 ? '0 2px 8px rgba(26,71,49,0.08)' : 'none',
    transition: isPullingRef.current ? 'none' : 'height 0.3s ease',
    pointerEvents: 'none'
  };

  const textStyle = {
    fontSize: '13px',
    color: '#40916c',
    fontWeight: '700',
    opacity: pullDistance / maxPull,
    fontFamily: "'Plus Jakarta Sans', sans-serif"
  };

  return (
    <>
      <div style={indicatorStyle}>
        {isRefreshing ? (
          <span style={{ fontSize: '13px', color: '#1a4731', fontWeight: 'bold' }}>Refreshing...</span>
        ) : (
          <span style={textStyle}>
            {pullDistance > triggerThreshold ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        )}
      </div>
      <div style={{ transform: `translateY(${isPullingRef.current ? pullDistance : (isRefreshing ? 60 : 0)}px)`, transition: isPullingRef.current ? 'none' : 'transform 0.3s ease' }}>
        {children}
      </div>
    </>
  );
};

export default PullToRefresh;
