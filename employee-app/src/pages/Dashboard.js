import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const POINTS_MAP = { 'Tide': 2, 'MSME': 0.3, 'Tide Insurance': 1, 'Tide Credit Card': 1 };

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
  const [notifications,setNotifications]= useState([]);

  // Load profile
  useEffect(() => {
    fetch('/api/auth/profile', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => { if (r.status === 401) { localStorage.clear(); navigate('/'); } return r.json(); })
      .then(setEmp)
      .catch(console.error);
  }, [token, navigate]);

  // Load forms
  const loadForms = useCallback(() => {
    fetch('/api/forms/my', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json()).then(setAllForms).catch(console.error);
  }, [token]);

  useEffect(() => { loadForms(); }, [loadForms]);

  // Load points adjustment
  useEffect(() => {
    fetch('/api/forms/my-points', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json()).then(d => setAdjustment(d.pointsAdjustment || 0)).catch(() => {});
  }, [token]);

  // Load notifications
  const loadNotifications = useCallback(() => {
    fetch('/api/requests/my-notifications', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json()).then(data => setNotifications(data.filter(n => !n.acknowledged)))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 10000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const acknowledge = async (id) => {
    await fetch(`/api/requests/${id}/acknowledge`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token } });
    setNotifications(prev => prev.filter(n => n._id !== id));
  };

  // Filtered forms
  const filtered = useMemo(() => {
    let list = allForms.slice();
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
    if (activeKPI === 'verified') list = list.filter(f => verifiedMap[f.customerNumber]?.status === 'Fully Verified');
    return list;
  }, [allForms, dateFilter, fromDate, toDate, activeKPI, verifiedMap]);

  // Fetch verification for filtered forms
  useEffect(() => {
    if (!filtered.length) return;
    const phones   = filtered.map(f => f.customerNumber).join(',');
    const names    = filtered.map(f => encodeURIComponent(f.customerName)).join(',');
    const products = filtered.map(f => encodeURIComponent(f.formFillingFor || '')).join(',');
    fetch(`/api/verify/bulk?phones=${encodeURIComponent(phones)}&names=${names}&products=${products}`, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(r => r.json())
      .then(vm => {
        setVerifiedMap(vm);
        // Save verified points
        let autoPts = 0;
        allForms.forEach(f => {
          if (vm[f.customerNumber]?.status === 'Fully Verified') autoPts += POINTS_MAP[f.formFillingFor] || 0;
        });
        fetch('/api/forms/save-verified-points', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ verifiedPoints: Math.round(autoPts * 10) / 10 })
        }).catch(() => {});
      })
      .catch(() => {});
  }, [filtered.length, token]); // eslint-disable-line

  const totalPoints = useMemo(() => {
    let auto = 0;
    allForms.forEach(f => {
      if (verifiedMap[f.customerNumber]?.status === 'Fully Verified') auto += POINTS_MAP[f.formFillingFor] || 0;
    });
    return Math.round((auto + adjustment) * 10) / 10;
  }, [allForms, verifiedMap, adjustment]);

  const kpis = [
    { key: 'all',      label: 'Total Responses',      value: allForms.length,                                                                    cls: 'kpi-total' },
    { key: 'onboard',  label: 'Ready for Onboarding', value: allForms.filter(f => f.status === 'Ready for Onboarding').length,                    cls: 'kpi-onboard' },
    { key: 'notint',   label: 'Not Interested',        value: allForms.filter(f => f.status === 'Not Interested').length,                          cls: 'kpi-notint' },
    { key: 'error',    label: 'Try but not done',      value: allForms.filter(f => f.status === 'Try but not done due to error').length,            cls: 'kpi-error' },
    { key: 'revisit',  label: 'Need to visit again',   value: allForms.filter(f => f.status === 'Need to visit again').length,                     cls: 'kpi-revisit' },
    { key: 'verified', label: 'Fully Verified',        value: allForms.filter(f => verifiedMap[f.customerNumber]?.status === 'Fully Verified').length, cls: 'kpi-verified' },
  ];

  const toggleKPI = (key) => setActiveKPI(p => p === key ? 'all' : key);

  return (
    <>
      <Navbar emp={emp} />
      <div className="main-content">

        {/* Welcome card */}
        <div className="welcome-card">
          <div className="welcome-avatar">
            {emp?.photoFileName
              ? <img src={`/uploads/${emp.photoFileName}`} alt="avatar" />
              : (emp?.newJoinerName?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?')}
          </div>
          <div className="welcome-text">
            <h2>Welcome, {emp?.newJoinerName?.split(' ')[0] || ''}!</h2>
            <p>{emp?.position} · {emp?.location}</p>
          </div>
          <Link to="/profile" className="profile-btn">View My Profile ›</Link>
        </div>

        {/* Notifications banner */}
        {notifications.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {notifications.map(req => {
              if (req.type === 'duplicate_alert') return (
                <div key={req._id} style={{ background: '#fff3e0', border: '1.5px solid #ffb74d', borderRadius: 12, padding: '14px 18px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 20 }}>⚠️</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#e65100' }}>Duplicate Merchant Detected</div>
                      <div style={{ fontSize: 12, color: '#bf360c', marginTop: 3 }}>
                        Merchant <b>{req.duplicateMerchantName || req.duplicateMerchantPhone}</b>
                        {req.duplicateMerchantPhone ? ` (${req.duplicateMerchantPhone})` : ''} was also submitted by <b>{req.duplicateOtherEmployee || 'another employee'}</b>.
                      </div>
                    </div>
                  </div>
                  <button onClick={() => acknowledge(req._id)} style={{ padding: '6px 16px', background: '#e65100', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Got it</button>
                </div>
              );
              const approved = req.status === 'approved';
              const color = approved ? '#2e7d32' : '#c62828';
              const bg    = approved ? '#e6f4ea' : '#fdecea';
              const typeLabel = req.type === 'profile_change' ? 'Profile Change' : req.type === 'merchant_edit' ? 'Merchant Edit' : req.type === 'merchant_delete' ? 'Merchant Delete' : 'Position Change';
              return (
                <div key={req._id} style={{ background: bg, border: `1.5px solid ${approved ? '#a8d5b5' : '#f5a5a5'}`, borderRadius: 12, padding: '14px 18px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 20 }}>{approved ? '✅' : '❌'}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color }}>{approved ? 'Request Approved' : 'Request Rejected'}</div>
                      <div style={{ fontSize: 12, color, marginTop: 2 }}>Your <b>{typeLabel}</b> request has been <b>{approved ? 'approved' : 'rejected'}</b> by the admin.</div>
                    </div>
                  </div>
                  <button onClick={() => acknowledge(req._id)} style={{ padding: '6px 16px', background: color, color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Got it</button>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick overview */}
        <div className="section-title">Quick Overview</div>
        <div className="info-grid">
          {[
            { icon: '💼', label: 'Position',          value: emp?.position },
            { icon: '📍', label: 'Location',           value: emp?.location },
            { icon: '👤', label: 'Reporting Manager',  value: emp?.reportingManager },
            { icon: '●',  label: 'Status',             value: emp?.status },
          ].map(c => (
            <div className="info-card dash-card" key={c.label}>
              <div className="dash-icon">{c.icon}</div>
              <div className="label">{c.label}</div>
              <div className="value">{c.value || '–'}</div>
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
        <div className="kpi-row" style={{ marginTop: 24 }}>
          {kpis.map(k => (
            <div key={k.key} className={`kpi-card ${k.cls}${activeKPI === k.key ? ' kpi-active' : ''}`} onClick={() => toggleKPI(k.key)}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
            </div>
          ))}
          <div className="kpi-card" style={{ borderTopColor: '#f4a261', cursor: 'default' }}>
            <div className="kpi-label">⭐ Total Points</div>
            <div className="kpi-value" style={{ color: '#e76f51' }}>{totalPoints}</div>
          </div>
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
            const info    = verifiedMap[f.customerNumber] || {};
            const vstatus = info.status || 'Not Found';
            const b       = BADGE_MAP[vstatus] || BADGE_MAP['Not Found'];
            const sc      = STATUS_COLOR[f.status] || { color: '#333', bg: '#f5f5f5' };
            const product = f.formFillingFor || (f.attemptedProducts?.join(', ')) || '–';
            const date    = new Date(f.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const pts     = (info.status === 'Fully Verified') ? (POINTS_MAP[f.formFillingFor] || null) : null;

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
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#fff8e1', color: '#e76f51', border: '1.5px solid #f4a261', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 800, marginTop: 4 }}>
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
