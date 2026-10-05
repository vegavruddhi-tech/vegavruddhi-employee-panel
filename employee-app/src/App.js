import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import MerchantForm from './pages/MerchantForm';
import MerchantDetail from './pages/MerchantDetail';
import Tasks from './pages/Tasks';
import MySalary from './pages/MySalary';
import InstallPWA from './components/InstallPWA';
import PullToRefresh from './components/PullToRefresh';

import { API_BASE, isValidToken } from './api';

function PrivateRoute({ children }) {
  const params = new URLSearchParams(window.location.search);
  const hashParams = window.location.hash ? new URLSearchParams(window.location.hash.substring(1)) : null;

  // Stored tokens (regular login or active impersonation session)
  const storedToken = sessionStorage.getItem('token') ||
                      sessionStorage.getItem('impersonationToken') ||
                      localStorage.getItem('token');

  // URL tokens (passed during legitimate admin impersonation)
  const urlToken = params.get('adminToken') || params.get('token') ||
                   (hashParams && (hashParams.get('adminToken') || hashParams.get('token')));

  // Strictly require a valid, non-expired JWT token
  const hasValidAuth = (storedToken && isValidToken(storedToken)) ||
                       (urlToken && isValidToken(urlToken));

  return hasValidAuth ? children : <Navigate to="/" replace />;
}

function AutoLogoutHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    let serverOffsetMs = 0;
    let isPerformingLogout = false;

    const fetchServerTime = async () => {
      try {
        const reqStart = Date.now();
        const res = await fetch(`${API_BASE}/api/auth/server-time`);
        if (!res.ok) return null;
        const data = await res.json();
        const reqEnd = Date.now();
        const latency = Math.round((reqEnd - reqStart) / 2);
        // Calibrate server time against client clock
        serverOffsetMs = (data.epochMs + latency) - reqEnd;
        return data;
      } catch (e) {
        return null;
      }
    };

    const handleAutoLogout = async (activeToken) => {
      if (isPerformingLogout) return;
      isPerformingLogout = true;

      const token = activeToken || sessionStorage.getItem('token') || localStorage.getItem('token');

      if (token) {
        try {
          await fetch(`${API_BASE}/api/auth/auto-logout`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
        } catch (error) {
          console.error('Auto logout error:', error);
        }
      }

      sessionStorage.removeItem('token');
      sessionStorage.removeItem('session_date');
      sessionStorage.clear();
      localStorage.removeItem('token');
      localStorage.removeItem('session_date');
      localStorage.clear();

      alert('Your session has ended at 11:59 PM. Please login again tomorrow.');

      navigate('/');
      window.location.reload();
    };

    const checkAutoLogout = async () => {
      const token = sessionStorage.getItem('token') || localStorage.getItem('token');
      if (!token || isPerformingLogout) return;

      const serverData = await fetchServerTime();

      let istHours, istMinutes, istDate, isAutoLogoutTime;

      if (serverData && serverData.istDate) {
        istHours = serverData.istHours;
        istMinutes = serverData.istMinutes;
        istDate = serverData.istDate;
        isAutoLogoutTime = serverData.isAutoLogoutTime;
      } else {
        // Fallback: apply calibrated server offset so local clock changes don't manipulate the time
        const currentServerMs = Date.now() + serverOffsetMs;
        const serverNow = new Date(currentServerMs);
        const istTime = new Date(serverNow.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        istHours = istTime.getHours();
        istMinutes = istTime.getMinutes();
        istDate = istTime.toISOString().split('T')[0];
        isAutoLogoutTime = (istHours === 23 && istMinutes === 59);
      }

      // Track the date on which this session was active
      const sessionDate = sessionStorage.getItem('session_date') || localStorage.getItem('session_date');
      if (!sessionDate) {
        sessionStorage.setItem('session_date', istDate);
        localStorage.setItem('session_date', istDate);
      }

      // Logout condition 1: Authoritative server time is 11:59 PM IST
      // Logout condition 2: Current server date is different from sessionDate (midnight passed or next day)
      const hasDateRolledOver = sessionDate && sessionDate !== istDate;

      if (isAutoLogoutTime || hasDateRolledOver) {
        console.log(`🕐 Server-authoritative Auto Logout triggered (server IST: ${istHours}:${istMinutes}, date: ${istDate})`);
        handleAutoLogout(token);
      }
    };

    // Check periodically (every 30 seconds)
    const interval = setInterval(checkAutoLogout, 30000);

    // Initial check
    checkAutoLogout();

    // Check on tab focus / wake from sleep
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAutoLogout();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', checkAutoLogout);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', checkAutoLogout);
    };
  }, [navigate]);

  return null;
}

function AutoUpdateChecker() {
  useEffect(() => {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;
    const CURRENT_SCRIPT_SRCS = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);

    const checkForUpdate = async () => {
      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            await reg.update();
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          }
        }
        const res = await fetch(window.location.origin + window.location.pathname + '?t=' + Date.now(), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (!res.ok) return;
        const htmlText = await res.text();
        const scriptMatches = htmlText.match(/src=["']([^"']+\.js[^"']*)["']/g);
        if (scriptMatches && CURRENT_SCRIPT_SRCS.length > 0) {
          const hasNewScript = scriptMatches.some(matchStr => {
            const src = matchStr.replace(/src=["']|["']/g, '');
            if (src.includes('http') && !src.includes(window.location.host)) return false;
            return !CURRENT_SCRIPT_SRCS.some(cur => cur.includes(src));
          });
          if (hasNewScript) {
            console.log('🚀 New deployment detected! Hard refreshing app...');
            if ('caches' in window) {
              const cacheNames = await caches.keys();
              await Promise.all(cacheNames.map(name => caches.delete(name)));
            }
            Object.keys(localStorage).forEach(key => {
              if (key.includes('cache') || key.includes('forms')) localStorage.removeItem(key);
            });
            window.location.reload(true);
          }
        }
      } catch (e) {}
    };

    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    window.addEventListener('focus', checkForUpdate);
    const interval = setInterval(checkForUpdate, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  return null;
}

export default function App() {
  return (
    <PullToRefresh onRefresh={() => window.location.reload(true)}>
      <BrowserRouter>
        <AutoUpdateChecker />
        <AutoLogoutHandler />
        <InstallPWA />
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
          <Route path="/tasks" element={<PrivateRoute><Tasks /></PrivateRoute>} />
          {/* <Route path="/my-salary" element={<PrivateRoute><MySalary /></PrivateRoute>} /> */}
          <Route path="/merchant-form" element={<PrivateRoute><MerchantForm /></PrivateRoute>} />
          <Route path="/merchant/:id" element={<PrivateRoute><MerchantDetail /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </PullToRefresh>
  );
}
