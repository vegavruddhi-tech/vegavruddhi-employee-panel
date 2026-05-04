import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { API_BASE } from '../api';
import { useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import ImpersonationBanner from '../components/ImpersonationBanner';

const POINTS_MAP = { 
  'Tide': 2, 
  // 'MSME': 0.3, 
  'Tide MSME': 0.3,
  'Tide Insurance': 1, 
  'Tide Credit Card': 1,
  'Tide BT': 1,
};


const STATUS_COLOR = {
  'Ready for Onboarding':          { color: '#2e7d32', bg: '#e6f4ea' },
  'Not Interested':                { color: '#c62828', bg: '#fdecea' },
  'Try but not done due to error': { color: '#e65100', bg: '#fff3e0' },
  'Need to visit again':           { color: '#1565c0', bg: '#e3f2fd' },
};

const BADGE_MAP = {
  'Fully Verified': { bg: '#e6f4ea', color: '#2e7d32', icon: '✓' },
  'Partially Done': { bg: '#fff8e1', color: '#f57f17', icon: '◑' },
  'Not Verified':   { bg: '#fdecea', color: '#c62828', icon: '✗' },
  'Not Found':      { bg: '#f5f5f5', color: '#888',    icon: '–' },
};

export default function Dashboard() {
  const navigate = useNavigate();
  
  // ✅ Check for impersonation parameters first
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonationToken, setImpersonationToken] = useState(null);
  const [viewAsEmail, setViewAsEmail] = useState(null);
  const [authChecked, setAuthChecked] = useState(false); // Track if auth check is complete
  
  const token = isImpersonating ? impersonationToken : localStorage.getItem('token');

  const [emp,          setEmp]          = useState(null);
  const [allForms,     setAllForms]     = useState([]);
  const [verifiedMap,  setVerifiedMap]  = useState({});
  const [activeKPI,    setActiveKPI]    = useState('all');
  const [dateFilter,   setDateFilter]   = useState('all');
  const [fromDate,     setFromDate]     = useState('');
  const [toDate,       setToDate]       = useState('');
  const [selYear,      setSelYear]      = useState('');
  const [selMonth,     setSelMonth]     = useState('');
  const [selProduct,   setSelProduct]   = useState('');
  const [adjustment,   setAdjustment]   = useState(0);
  const [taskCounts,   setTaskCounts]   = useState({ pending: 0, completed: 0, total: 0 });

  // ✅ Check for impersonation on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewAs = params.get('viewAs');
    const adminToken = params.get('adminToken');
    
    if (viewAs && adminToken) {
      console.log('🔐 Impersonation detected:', { viewAs, hasToken: !!adminToken });
      
      // Validate admin impersonation
      fetch(`${API_BASE}/api/auth/verify-impersonation?viewAs=${encodeURIComponent(viewAs)}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      })
        .then(r => {
          if (!r.ok) throw new Error('Invalid impersonation');
          return r.json();
        })
        .then(data => {
          console.log('✅ Impersonation validated:', data);
          setIsImpersonating(true);
          setImpersonationToken(adminToken);
          setViewAsEmail(viewAs);
          
          // Store in sessionStorage (cleared when tab closes)
          sessionStorage.setItem('impersonationToken', adminToken);
          sessionStorage.setItem('viewAsEmail', viewAs);
          
          // Clean URL (remove params)
          window.history.replaceState({}, '', window.location.pathname);
          setAuthChecked(true);
        })
        .catch(err => {
          console.error('❌ Impersonation validation failed:', err);
          setAuthChecked(true);
          navigate('/');
        });
    } else {
      // Check sessionStorage for existing impersonation
      const sessionToken = sessionStorage.getItem('impersonationToken');
      const sessionEmail = sessionStorage.getItem('viewAsEmail');
      
      if (sessionToken && sessionEmail) {
        console.log('🔄 Restoring impersonation from session');
        setIsImpersonating(true);
        setImpersonationToken(sessionToken);
        setViewAsEmail(sessionEmail);
        setAuthChecked(true);
      } else {
        // Normal auth check
        const normalToken = localStorage.getItem('token');
        if (!normalToken) {
          navigate('/');
        }
        setAuthChecked(true);
      }
    }
  }, [navigate]);

  // Load profile (modified to use impersonation email if present)
  useEffect(() => {
    if (!token) return;
    
    const url = isImpersonating 
      ? `${API_BASE}/api/auth/profile-by-email?email=${encodeURIComponent(viewAsEmail)}`
      : `${API_BASE}/api/auth/profile`;
    
    fetch(url, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => { 
        if (r.status === 401 && !isImpersonating) { 
          localStorage.clear(); 
          navigate('/'); 
        } 
        return r.json(); 
      })
      .then(setEmp)
      .catch(console.error);
  }, [token, navigate, isImpersonating, viewAsEmail]);

  // Load forms (modified to support impersonation)
  const loadForms = useCallback(() => {
    const url = isImpersonating 
      ? `${API_BASE}/api/forms/my?viewAs=${encodeURIComponent(viewAsEmail)}`
      : `${API_BASE}/api/forms/my`;
    
    fetch(url, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json())
      .then(data => setAllForms(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, [token, isImpersonating, viewAsEmail]);

  useEffect(() => { loadForms(); }, [loadForms]);

  // Load points from backend (includes slabs + adjustment) - supports impersonation
  const [backendPoints, setBackendPoints] = useState(null);
  useEffect(() => {
    if (!token) return;
    
    const url = isImpersonating 
      ? `${API_BASE}/api/forms/my-points?viewAs=${encodeURIComponent(viewAsEmail)}`
      : `${API_BASE}/api/forms/my-points`;
    
    fetch(url, { headers: { Authorization: 'Bearer ' + token } }) 
      .then(r => r.json())
      .then(d => {
        console.log('📊 Backend points data:', d);
        setAdjustment(d.pointsAdjustment || 0);
        setBackendPoints(d.totalPoints || 0);
      })
      .catch(() => {});
  }, [token, isImpersonating, viewAsEmail]);

  // Load task counts
  const loadTaskCounts = useCallback(() => {
    fetch(`${API_BASE}/api/tasks/my-tasks/count`, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json())
      .then(data => setTaskCounts(data))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    loadTaskCounts();
    const interval = setInterval(loadTaskCounts, 10000);
    return () => clearInterval(interval);
  }, [loadTaskCounts]);
  const getVerifyKey = (f) => {
    // ✅ MATCH BACKEND PRIORITY: formFillingFor → tideProduct → brand
    const p = f.formFillingFor || f.tideProduct || f.brand || '';
    // ✅ NORMALIZE: Convert to lowercase to match cache keys
    return p ? `${f.customerNumber}__${p.toLowerCase().trim()}` : f.customerNumber;
  };
  // Filtered forms
  const filtered = useMemo(() => {
    let list = allForms?.slice();
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (dateFilter === 'today') list = list.filter(f => new Date(f.createdAt) >= today);
    else if (dateFilter === 'week') {
      const ws = new Date(today); ws.setDate(today.getDate() - today.getDay());
      list = list.filter(f => new Date(f.createdAt) >= ws);
    } else if (dateFilter === 'month') {
      const ms = new Date(now.getFullYear(), now.getMonth(), 1);
      list = list.filter(f => new Date(f.createdAt) >= ms);
    } else if (dateFilter === 'custom' && (fromDate || toDate)) {
      list = list.filter(f => {
        const d = new Date(f.createdAt);
        if (fromDate && d < new Date(fromDate)) return false;
        if (toDate   && d > new Date(toDate + 'T23:59:59')) return false;
        return true;
      });
    }

    // Year / Month filter
    if (selYear)  list = list.filter(f => new Date(f.createdAt).getFullYear() === parseInt(selYear));
    if (selMonth) list = list.filter(f => new Date(f.createdAt).getMonth()    === parseInt(selMonth));

    // Product filter
    if (selProduct) {
      const sp = selProduct.toLowerCase().trim();
      list = list.filter(f => {
        const p1 = (f.formFillingFor || '').toLowerCase().trim();
        const p2 = (f.tideProduct || '').toLowerCase().trim();
        const p3 = (f.brand || '').toLowerCase().trim();
        const allP = [p1, p2, p3].join(' ');
        if (sp === 'tide msme') return allP.includes('msme');
        if (sp === 'tide insurance') return allP.includes('insurance');
        if (sp === 'tide credit card') return allP.includes('credit');
        if (sp === 'tide') {
          const hasTide = p1 === 'tide' || p2 === 'tide' || p3 === 'tide' || p1 === 'tide bt' || p2 === 'tide bt';
          return hasTide && !allP.includes('msme') && !allP.includes('insurance') && !allP.includes('credit');
        }
        return p1 === sp || p2 === sp || p3 === sp;
      });
    }

    if (activeKPI === 'onboard')  list = list.filter(f => f.status === 'Ready for Onboarding');
    if (activeKPI === 'notint')   list = list.filter(f => f.status === 'Not Interested');
    if (activeKPI === 'error')    list = list.filter(f => f.status === 'Try but not done due to error');
    if (activeKPI === 'revisit')  list = list.filter(f => f.status === 'Need to visit again');
    if (activeKPI === 'verified') list = list.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Fully Verified');
    if (activeKPI === 'partial')  list = list.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Partially Done');
    if (activeKPI === 'notver')   list = list.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Not Verified');
    if (activeKPI === 'phmatch')  list = list.filter(f => verifiedMap[getVerifyKey(f)]?.phoneMatch === true);
    if (activeKPI === 'phnomatch')list = list.filter(f => verifiedMap[getVerifyKey(f)]?.inSheet === true && verifiedMap[getVerifyKey(f)]?.phoneMatch === false);
    return list;
  }, [allForms, dateFilter, fromDate, toDate, selYear, selMonth, selProduct, activeKPI, verifiedMap]);

<<<<<<< Updated upstream
  // Exit impersonation handler
  const handleExitImpersonation = () => {
    sessionStorage.removeItem('impersonationToken');
    sessionStorage.removeItem('viewAsEmail');
    window.location.href = 'http://localhost:3002/merchant-forms';
  };

  // Fetch verification for ALL forms (not filtered — so counts stay accurate)
=======
// <<<<<<< Updated upstream
//   // Exit impersonation handler
//   const handleExitImpersonation = () => {
//     // Clear session storage
//     sessionStorage.removeItem('impersonationToken');
//     sessionStorage.removeItem('viewAsEmail');
    
//     // Redirect back to admin panel
//     window.location.href = 'http://localhost:3002/merchant-forms';
//   };

//   // Fetch verification for filtered forms (using Redis cache)
// =======
  // Fetch verification for ALL forms (not filtered — so counts stay accurate)Stashed changes
>>>>>>> Stashed changes
  useEffect(() => {
    if (!allForms.length) {
      console.log('⚠️ No forms to verify');
      return;
    }
    
    const phones   = allForms.map(f => f.customerNumber).join(',');
    const names    = allForms.map(f => encodeURIComponent(f.customerName)).join(',');
    const products = allForms.map(f => {
      const p = f.formFillingFor || f.tideProduct || f.brand || '';
      return encodeURIComponent(p.toLowerCase().trim());
    }).join(',');
    const months = allForms.map(f => 
      encodeURIComponent(new Date(f.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' }))
    ).join(',');

    const url = `${API_BASE}/api/verify/bulk-cached?phones=${encodeURIComponent(phones)}&names=${names}&products=${products}&months=${months}`;
    console.log('🔍 Fetching verification (Redis cached):', { 
      formCount: filtered.length, 
      endpoint: '/api/verify/bulk-cached',
      url: url.substring(0, 150) + '...'
    });

    // ✅ Use Redis-cached endpoint for fast verification
    fetch(url, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(r => {
        console.log('📡 Verification response status:', r.status);
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        }
        return r.json();
      })
      .then(vm => {
        console.log('✅ Verification data received:', { 
          keys: Object.keys(vm).length,
          sample: Object.keys(vm).slice(0, 3),
          fullData: vm
        });
        setVerifiedMap(vm);
        
        // Save verified points — deduplicate by customerNumber+product
        const counted = new Set();
        let autoPts = 0;
        allForms.forEach(f => {
          if (vm[getVerifyKey(f)]?.status === 'Fully Verified') {
            const dedupKey = `${f.customerNumber}__${(f.formFillingFor || '').toLowerCase().trim()}`;
            if (counted.has(dedupKey)) return;
            counted.add(dedupKey);
            const product = f.formFillingFor || f.tideProduct || f.brand || '';
            const normalizedProduct = normalizeProduct(product);
            const points = POINTS_MAP[normalizedProduct] || 0;
            console.log('🔍 Verified form:', {
              customerNumber: f.customerNumber,
              formFillingFor: f.formFillingFor,
              product,
              normalizedProduct,
              points,
              pointsMapKey: normalizedProduct,
              pointsMapValue: POINTS_MAP[normalizedProduct]
            });
            autoPts += points;
          }
        });
        
        console.log('💰 Total calculated points:', autoPts);
        console.log('💰 Verified forms count:', counted.size);
        
        fetch(`${API_BASE}/api/forms/save-verified-points`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ verifiedPoints: Math.round(autoPts * 10) / 10 })
        })
        .then(() => {
          // ✅ Reload backend points after saving to get fresh data
          console.log('✅ Points saved, reloading from backend...');
          return fetch(`${API_BASE}/api/forms/my-points`, { 
            headers: { Authorization: 'Bearer ' + token } 
          });
        })
        .then(r => r.json())
        .then(d => {
          console.log('📊 Reloaded backend points:', d);
          setAdjustment(d.pointsAdjustment || 0);
          setBackendPoints(d.totalPoints || 0);
        })
        .catch(() => {});
      })
      .catch(err => {
        console.error('❌ Verification fetch error:', err);
        setVerifiedMap({});
      });
  }, [allForms.length, token]); // eslint-disable-line
  const normalizeProduct = (product) => {
    const p = (product || '').toLowerCase().trim();
    if (p === 'tide insurance' || p === 'insurance') return 'Tide Insurance';
    if (p === 'tide' || p === 'tide onboarding' || p === 'pinelab') return 'Tide';
    if (p === 'msme' || p === 'tide msme') return 'Tide MSME';
    if (p === 'tide credit card') return 'Tide Credit Card';
    if (p === 'tide bt') return 'Tide BT';
    // If no match, return the original product (might not have points)
    console.warn('⚠️ Unknown product:', product, '→ No points assigned');
    return product;
  };

  // Use backend points if available (includes slabs), otherwise calculate from verified forms
  const totalPoints = useMemo(() => {
    // If backend returned total points (with slabs), use that
    if (backendPoints !== null) {
      console.log('💰 Using backend total points (includes slabs):', backendPoints);
      return backendPoints;
    }
    
    // Otherwise calculate from verified forms (fallback)
    const counted = new Set();
    let auto = 0;
    allForms.forEach(f => {
      if (verifiedMap[getVerifyKey(f)]?.status === 'Fully Verified') {
        const dedupKey = `${f.customerNumber}__${(f.formFillingFor || '').toLowerCase().trim()}`;
        if (counted.has(dedupKey)) return;
        counted.add(dedupKey);
        const product = f.formFillingFor || (f.brand === 'Tide' && f.tideProduct ? f.tideProduct : f.brand) || '';
        auto += POINTS_MAP[normalizeProduct(product)] || 0;

      }
    });
    const calculated = Math.round((auto + adjustment) * 10) / 10;
    console.log('💰 Calculated from verified forms:', calculated);
    return calculated;
  }, [allForms, verifiedMap, adjustment, backendPoints]);

  const kpis = [
    { key: 'all',      label: 'Total Responses',      value: allForms.length,                                                                    cls: 'kpi-total' },
    { key: 'onboard',  label: 'Ready for Onboarding', value: allForms.filter(f => f.status === 'Ready for Onboarding').length,                    cls: 'kpi-onboard' },
    { key: 'notint',   label: 'Not Interested',        value: allForms.filter(f => f.status === 'Not Interested').length,                          cls: 'kpi-notint' },
    { key: 'error',    label: 'Try but not done',      value: allForms.filter(f => f.status === 'Try but not done due to error').length,            cls: 'kpi-error' },
    { key: 'revisit',  label: 'Need to visit again',   value: allForms.filter(f => f.status === 'Need to visit again').length,                     cls: 'kpi-revisit' },
  ];

  const verifyKpis = [
    { key: 'verified',  label: 'Fully Verified',       value: allForms.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Fully Verified').length,  cls: 'kpi-verified' },
    { key: 'partial',   label: 'Partially Verified',   value: allForms.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Partially Done').length,   cls: 'kpi-error' },
    { key: 'notver',    label: 'Not Verified',          value: allForms.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Not Verified').length,     cls: 'kpi-notint' },
    { key: 'phmatch',   label: 'Phone Matched',         value: allForms.filter(f => verifiedMap[getVerifyKey(f)]?.phoneMatch === true).length,           cls: 'kpi-onboard' },
    { key: 'phnomatch', label: 'Phone Not Matched',     value: allForms.filter(f => verifiedMap[getVerifyKey(f)]?.inSheet === true && verifiedMap[getVerifyKey(f)]?.phoneMatch === false).length, cls: 'kpi-revisit' },
  ];

  const toggleKPI = (key) => setActiveKPI(p => p === key ? 'all' : key);
  console.log('=== POINTS DEBUG ===');
  console.log('Frontend calculated totalPoints:', totalPoints);
  console.log('Adjustment:', adjustment);
  console.log('All forms count:', allForms.length);
  console.log('Verified forms:', allForms.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Fully Verified').length);

// Check what products are in the forms
  allForms.forEach(f => {
    if (verifiedMap[getVerifyKey(f)]?.status === 'Fully Verified') {
      console.log('Verified form product:', f.formFillingFor);
      console.log('Normalized:', normalizeProduct(f.formFillingFor));
      console.log('Points:', POINTS_MAP[normalizeProduct(f.formFillingFor)]);
    }
  });
  // ... your JSX

  // Show loading while checking authentication
  if (!authChecked) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <>
      <Navbar emp={emp} taskCount={taskCounts.pending} token={token} />
      <div className="main-content">
        
        {/* Welcome card - Compact horizontal layout */}
        <div className="welcome-card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div className="welcome-avatar" style={{ width: 60, height: 60, fontSize: 24 }}>
            {emp?.image
              ? <img src={emp.image} />
              : (emp?.newJoinerName?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?')}
          </div>
          <div className="welcome-text" style={{ flex: 1, minWidth: 150 }}>
            <h2 style={{ fontSize: 20, marginBottom: 4 }}>Welcome, {emp?.newJoinerName?.split(' ')[0] || ''}!</h2>
            <p style={{ fontSize: 13, margin: 0 }}>{emp?.position} · {emp?.location}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 16px', color: '#fff', textAlign: 'center', border: '1px solid rgba(255,255,255,0.25)' }}>
              <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Points</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{totalPoints}</div>
            </div>
            <Link to="/profile" className="profile-btn" style={{ fontSize: 13, padding: '8px 16px' }}>View My Profile ›</Link>
          </div>
        </div>

        {/* Quick overview - Compact */}
        <div className="section-title" style={{ marginTop: 20, marginBottom: 10 }}>Quick Overview</div>
        <div className="info-grid" style={{ gap: 10 }}>
          {[
            { icon: '💼', label: 'Position',          value: emp?.position },
            { icon: '📍', label: 'Location',           value: emp?.location },
            { icon: '👤', label: 'Reporting Manager',  value: emp?.reportingManager },
            { icon: '●',  label: 'Status',             value: emp?.status },
          ].map(c => (
            <div className="info-card dash-card" key={c.label} style={{ padding: '12px 14px' }}>
              <div className="dash-icon" style={{ fontSize: 18, marginBottom: 6 }}>{c.icon}</div>
              <div className="label" style={{ fontSize: 10, marginBottom: 4 }}>{c.label}</div>
              <div className="value" style={{ fontSize: 14 }}>{c.value || '–'}</div>
            </div>
          ))}
        </div>

        {/* Action */}
        <div className="section-title" style={{ marginTop: 28 }}>Actions</div>
        <Link to="/merchant-form" className="action-card">
          <div className="action-icon">📋</div>
          <div className="action-text">
            <div className="action-title">Fill Merchant Visit Form</div>
            <div className="action-sub">Submit details after a merchant meeting</div>
          </div>
          <div className="action-arrow">›</div>
        </Link>

        {/* KPI cards */}
        <div className="kpi-row kpi-row-5" style={{ marginTop: 24 }}>
          {kpis.map(k => (
            <div key={k.key} className={`kpi-card ${k.cls}${activeKPI === k.key ? ' kpi-active' : ''}`} onClick={() => toggleKPI(k.key)}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
            </div>
          ))}
        </div>

        {/* Verification KPI cards */}
        <div className="kpi-row kpi-row-5" style={{ marginTop: 10 }}>
          {verifyKpis.map(k => (
            <div key={k.key} className={`kpi-card ${k.cls}${activeKPI === k.key ? ' kpi-active' : ''}`} onClick={() => toggleKPI(k.key)}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
            </div>
          ))}
        </div>

        {/* Merchants header + filters */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 28, marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>My Merchants</div>
          <div className="date-filter-bar">
            {['all', 'today', 'week'].map(f => (
              <button key={f} className={`date-filter-btn${dateFilter === f ? ' active' : ''}`}
                onClick={() => { setDateFilter(f); setFromDate(''); setToDate(''); }}>
                {f === 'all' ? 'All' : f === 'today' ? 'Today' : 'This Week'}
              </button>
            ))}
            <div className="date-filter-custom">
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              <span style={{ color: '#888', fontSize: 12 }}>to</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              <button className="date-filter-btn" onClick={() => setDateFilter('custom')}>Apply</button>
            </div>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <span style={{ position: 'absolute', top: -9, left: 10, fontSize: 11, color: '#40916c', background: '#fff', padding: '0 4px', fontWeight: 600, zIndex: 1, pointerEvents: 'none' }}>Year</span>
              <select value={selYear} onChange={e => setSelYear(e.target.value)}
                style={{ padding: '10px 32px 10px 12px', borderRadius: 10, border: '1.5px solid #40916c', fontSize: 14, color: selYear ? '#1a4731' : '#888', background: '#fff', cursor: 'pointer', appearance: 'none', minWidth: 100, outline: 'none' }}>
                <option value=""></option>
                {[2026,2025,2024,2023,2022,2021].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#40916c', fontSize: 12 }}>▼</span>
            </div>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <span style={{ position: 'absolute', top: -9, left: 10, fontSize: 11, color: '#40916c', background: '#fff', padding: '0 4px', fontWeight: 600, zIndex: 1, pointerEvents: 'none' }}>Month</span>
              <select value={selMonth} onChange={e => setSelMonth(e.target.value)}
                style={{ padding: '10px 32px 10px 12px', borderRadius: 10, border: '1.5px solid #40916c', fontSize: 14, color: selMonth !== '' ? '#1a4731' : '#888', background: '#fff', cursor: 'pointer', appearance: 'none', minWidth: 130, outline: 'none' }}>
                <option value="">All Months</option>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i) => (
                  <option key={i} value={i}>{m}</option>
                ))}
              </select>
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#40916c', fontSize: 12 }}>▼</span>
            </div>
          </div>
        </div>

        {/* Product filter chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, marginTop: 4 }}>
          {(() => {
            const products = ['Tide', 'Tide Insurance', 'Tide MSME', 'Tide Credit Card'];
            const counts = {};
            products.forEach(p => {
              const sp = p.toLowerCase().trim();
              counts[p] = allForms.filter(f => {
                const p1 = (f.formFillingFor || '').toLowerCase().trim();
                const p2 = (f.tideProduct || '').toLowerCase().trim();
                const p3 = (f.brand || '').toLowerCase().trim();
                const allP = [p1, p2, p3].join(' ');
                let match = false;
                if (sp === 'tide msme') match = allP.includes('msme');
                else if (sp === 'tide insurance') match = allP.includes('insurance');
                else if (sp === 'tide credit card') match = allP.includes('credit');
                else if (sp === 'tide') {
                  const hasTide = p1 === 'tide' || p2 === 'tide' || p3 === 'tide' || p1 === 'tide bt' || p2 === 'tide bt';
                  match = hasTide && !allP.includes('msme') && !allP.includes('insurance') && !allP.includes('credit');
                } else match = p1 === sp || p2 === sp || p3 === sp;
                return match && verifiedMap[getVerifyKey(f)]?.status === 'Fully Verified';
              }).length;
            });
            return (
              <>
                <button
                  onClick={() => setSelProduct('')}
                  style={{
                    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: selProduct === '' ? '2px solid #1a4731' : '1.5px solid #c8e6c9',
                    background: selProduct === '' ? '#1a4731' : '#fff',
                    color: selProduct === '' ? '#fff' : '#1a4731',
                    transition: 'all 0.15s'
                  }}>
                  All Products
                </button>
                {products.map(p => (
                  <button key={p}
                    onClick={() => setSelProduct(p)}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: selProduct === p ? '2px solid #1a4731' : '1.5px solid #c8e6c9',
                      background: selProduct === p ? '#1a4731' : '#fff',
                      color: selProduct === p ? '#fff' : '#1a4731',
                      transition: 'all 0.15s'
                    }}>
                    {p}: {counts[p]} ✓
                  </button>
                ))}
              </>
            );
          })()}
        </div>

        {/* Merchant count */}
        {filtered.length > 0 && (
          <div className="merchants-count">{filtered.length} merchant{filtered.length !== 1 ? 's' : ''} found</div>
        )}

        {/* Merchant list */}
        {allForms.length === 0 ? (
          <div className="merchants-empty">No merchant visits yet. Fill your first form above.</div>
        ) : filtered.length === 0 ? (
          <div className="merchants-empty">No merchants found.</div>
        ) : (
          filtered.map(f => {
            const info    = verifiedMap[getVerifyKey(f)] || {};
            const vstatus = info.status || 'Not Found';
            const b       = BADGE_MAP[vstatus] || BADGE_MAP['Not Found'];
            const sc      = STATUS_COLOR[f.status] || { color: '#333', bg: '#f5f5f5' };
           const product = f.formFillingFor 
           || (f.attemptedProducts?.join(', ')) 
           || (f.brand && f.tideProduct ? `${f.tideProduct}` : f.brand) 
           || '–';

            const date    = new Date(f.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            // const product = f.formFillingFor || (f.brand === 'Tide' && f.tideProduct ? f.tideProduct : f.brand) || '';
            const pts = (info.status === 'Fully Verified') ? (POINTS_MAP[normalizeProduct(product)] || null) : null;


            return (
              <Link key={f._id} to={`/merchant/${f._id}`} className="merchant-row">
                <div className="mr-avatar">{f.customerName.charAt(0).toUpperCase()}</div>
                <div className="mr-info">
                  <div className="mr-name">{f.customerName}</div>
                  <div className="mr-badges">
                    {info.inSheet === true && (
                      <span className={`phone-match-badge ${info.phoneMatch ? 'match' : 'mismatch'}`}>
                        📞 {info.phoneMatch ? 'Number Matched' : 'Number Mismatch'}
                      </span>
                    )}
                    {info.inSheet === false && <span className="phone-match-badge notfound">📞 Not in Sheet</span>}
                    <span className="verify-badge" style={{ background: b.bg, color: b.color, borderColor: b.bg }}>
                      {b.icon} {vstatus}
                    </span>
                      {pts !== null && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#e6f4ea', color: '#2e7d32', border: '1.5px solid #a8d5b5', borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 800 }}>
                          ⭐ {pts} pts
                        </span>
                      )}
                  </div>
                  <div className="mr-meta">
                    <span>📍 {f.location}</span>
                    <span>📄 {product}</span>
                    <span>📞 {f.customerNumber}</span>
                  </div>
                </div>
                <div className="mr-right">
                  <span className="mr-status" style={{ color: sc.color, background: sc.bg }}>{f.status}</span>
                  {pts !== null && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#e6f4ea', color: '#2e7d32', border: '1.5px solid #a8d5b5', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 800, marginTop: 4 }}>
                      ⭐ {pts} pts
                    </div>
                  )}
                  <div className="mr-date">{date}</div>
                </div>
              </Link>
            );
          })
        )}
      </div>
      <Footer />
    </>
  );
}
