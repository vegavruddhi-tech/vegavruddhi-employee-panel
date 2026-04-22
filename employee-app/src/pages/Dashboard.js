import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { API_BASE } from '../api';
import { useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

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
  const token = localStorage.getItem('token');

  const [emp,          setEmp]          = useState(null);
  const [allForms,     setAllForms]     = useState([]);
  const [verifiedMap,  setVerifiedMap]  = useState({});
  const [activeKPI,    setActiveKPI]    = useState('all');
  const [dateFilter,   setDateFilter]   = useState('all');
  const [fromDate,     setFromDate]     = useState('');
  const [toDate,       setToDate]       = useState('');
  const [adjustment,   setAdjustment]   = useState(0);
  const [taskCounts,   setTaskCounts]   = useState({ pending: 0, completed: 0, total: 0 });

  // Load profile
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/profile`, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => { if (r.status === 401) { localStorage.clear(); navigate('/'); } return r.json(); })
      .then(setEmp)
      .catch(console.error);
  }, [token, navigate]);

  // Load forms
  const loadForms = useCallback(() => {
    fetch(`${API_BASE}/api/forms/my`, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json())
      .then(data => setAllForms(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, [token]);

  useEffect(() => { loadForms(); }, [loadForms]);

  // Load points adjustment
  useEffect(() => {
    fetch(`${API_BASE}/api/forms/my-points`, { headers: { Authorization: 'Bearer ' + token } }) 
      .then(r => r.json()).then(d => setAdjustment(d.pointsAdjustment || 0)).catch(() => {});
  }, [token]);

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
    const p = f.formFillingFor || (f.brand === 'Tide' && f.tideProduct ? f.tideProduct : f.brand) || '';
    return p ? `${f.customerNumber}__${p}` : f.customerNumber;
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
  }, [allForms, dateFilter, fromDate, toDate, activeKPI, verifiedMap]);

  // Fetch verification for filtered forms
  useEffect(() => {
    if (!filtered.length) return;
    const phones   = filtered.map(f => f.customerNumber).join(',');
    const names    = filtered.map(f => encodeURIComponent(f.customerName)).join(',');
    const products = filtered.map(f => {
    const p = f.formFillingFor || (f.brand === 'Tide' && f.tideProduct ? f.tideProduct : f.brand) || '';
      return encodeURIComponent(p);
    }).join(',');

    fetch(`${API_BASE}/api/verify/bulk?phones=${encodeURIComponent(phones)}&names=${names}&products=${products}`, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(r => r.json())
      .then(vm => {
        setVerifiedMap(vm);
        // Save verified points — deduplicate by customerNumber+product
        const counted = new Set();
        let autoPts = 0;
        allForms.forEach(f => {
          if (vm[getVerifyKey(f)]?.status === 'Fully Verified') {
            const dedupKey = `${f.customerNumber}__${(f.formFillingFor || '').toLowerCase().trim()}`;
            if (counted.has(dedupKey)) return;
            counted.add(dedupKey);
            autoPts += POINTS_MAP[normalizeProduct(f.formFillingFor)] || 0;
          }
        });
        fetch(`${API_BASE}/api/forms/save-verified-points`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ verifiedPoints: Math.round(autoPts * 10) / 10 })
        }).catch(() => {});
      })
      .catch(() => {});
  }, [filtered.length, token]); // eslint-disable-line
  const normalizeProduct = (product) => {
  const p = (product || '').toLowerCase().trim();
  if (p === 'tide insurance' || p === 'insurance') return 'Tide Insurance';
  if (p === 'tide' || p === 'tide onboarding') return 'Tide';
  if (p === 'msme' || p === 'tide msme') return 'Tide MSME';
  return product; // fallback
};

  const totalPoints = useMemo(() => {
    // Deduplicate by customerNumber+product before counting points
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
    return Math.round((auto + adjustment) * 10) / 10;
  }, [allForms, verifiedMap, adjustment]);

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 28, marginBottom: 14 }}>
          <div className="section-title" style={{ margin: 0 }}>My Merchants</div>
          <div className="date-filter-bar">
            {['all', 'today', 'week', 'month'].map(f => (
              <button key={f} className={`date-filter-btn${dateFilter === f ? ' active' : ''}`}
                onClick={() => { setDateFilter(f); setFromDate(''); setToDate(''); }}>
                {f === 'all' ? 'All' : f === 'today' ? 'Today' : f === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
            <div className="date-filter-custom">
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              <span style={{ color: '#888', fontSize: 12 }}>to</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              <button className="date-filter-btn" onClick={() => setDateFilter('custom')}>Apply</button>
            </div>
          </div>
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
