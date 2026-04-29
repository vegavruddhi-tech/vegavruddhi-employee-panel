import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../api';

function NotificationPanel({ token, onClose }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`${API_BASE}/api/requests/my-notifications`, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(r => r.json())
      .then(data => { setNotifications(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id) => {
    await fetch(`${API_BASE}/api/requests/${id}/acknowledge`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token }
    });
    setNotifications(prev => prev.map(n => n._id === id ? { ...n, acknowledged: true } : n));
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.acknowledged);
    await Promise.all(unread.map(n =>
      fetch(`${API_BASE}/api/requests/${n._id}/acknowledge`, {
        method: 'PUT', headers: { Authorization: 'Bearer ' + token }
      })
    ));
    setNotifications(prev => prev.map(n => ({ ...n, acknowledged: true })));
  };

  const unreadCount = notifications.filter(n => !n.acknowledged).length;

  const renderNotif = (n) => {
    const isRead = n.acknowledged;
    const date = new Date(n.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Points adjustment notification (includes both manual adjustments and slab changes)
    if (n.type === 'points_adjustment') {
      // Check if this is a slab-based notification (new format)
      const hasSlabData = n.profileChanges?.product && n.profileChanges?.slabDetails;
      
      if (hasSlabData) {
        // New format: Slab-based points update
        const product = n.profileChanges.product;
        const slabDetails = n.profileChanges.slabDetails;
        const reason = n.profileChanges.reason || n.reason || '';
        const actionType = n.profileChanges.actionType || 'added';
        const points = Math.round((slabDetails.points || (slabDetails.forms * slabDetails.multiplier) || 0) * 100) / 100;
        const beforeTotal = n.profileChanges.beforeTotal;
        const newTotal    = n.profileChanges.newTotal;
        const adjustment  = actionType === 'removed' ? -points : points;

        const accentColor = actionType === 'added' ? '#2e7d32' : '#c62828';
        const bgColor = isRead ? '#fff' : (actionType === 'added' ? '#f0fdf4' : '#fff5f5');
        const emoji = actionType === 'added' ? '⭐' : '📉';

        return (
          <div key={n._id} style={{
            padding: '14px 16px', borderBottom: '1px solid #f0f0f0',
            background: bgColor, borderLeft: `4px solid ${accentColor}`,
            opacity: isRead ? 0.8 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 16 }}>{emoji}</span>
                  <span style={{ fontWeight: 800, fontSize: 13, color: accentColor }}>
                    Points {actionType === 'added' ? 'Added' : 'Deducted'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#1a1a1a', fontWeight: 600, marginBottom: 6 }}>
                  {actionType === 'added' ? '+' : ''}{adjustment} pts — {product}
                </div>
                {beforeTotal !== undefined && newTotal !== undefined && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 0,
                    background: '#fff', border: `1px solid ${accentColor}30`,
                    borderRadius: 8, overflow: 'hidden', marginBottom: 6,
                  }}>
                    <div style={{ flex: 1, textAlign: 'center', padding: '6px 10px', background: '#f5f5f5' }}>
                      <div style={{ fontSize: 9, color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>Before</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#555' }}>{beforeTotal} pts</div>
                    </div>
                    <div style={{ padding: '0 8px', fontSize: 16, color: accentColor, fontWeight: 800 }}>→</div>
                    <div style={{ flex: 1, textAlign: 'center', padding: '6px 10px', background: actionType === 'removed' ? '#fdecea' : '#e8f4fd' }}>
                      <div style={{ fontSize: 9, color: accentColor, fontWeight: 600, textTransform: 'uppercase' }}>After</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: accentColor }}>{newTotal} pts</div>
                    </div>
                  </div>
                )}
                {reason && (
                  <div style={{ fontSize: 11, color: '#333', fontWeight: 500, marginBottom: 4, background: '#f9f9f9', padding: '6px 8px', borderRadius: 6 }}>
                    📝 {reason}
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{date}</div>
              </div>
              <div style={{ flexShrink: 0 }}>
                {!isRead ? (
                  <button onClick={() => markRead(n._id)} style={{ padding: '4px 10px', background: accentColor, color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    Mark read
                  </button>
                ) : <span style={{ fontSize: 10, color: '#aaa' }}>✓ Read</span>}
              </div>
            </div>
          </div>
        );
      }
      
      // Old format: Manual adjustment
      const adj = n.profileChanges?.adjustment ?? 0;
      const newTotal = n.profileChanges?.newTotal;
      const beforeTotal = n.profileChanges?.beforeTotal;
      const isAdd = Number(adj) >= 0;
      const accentColor = isAdd ? '#1565c0' : '#c62828';
      const bgColor = isRead ? '#fff' : (isAdd ? '#f0f7ff' : '#fff5f5');
      return (
        <div key={n._id} style={{
          padding: '14px 16px', borderBottom: '1px solid #f0f0f0',
          background: bgColor,
          borderLeft: `4px solid ${accentColor}`,
          opacity: isRead ? 0.8 : 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 18 }}>{isAdd ? '⭐' : '📉'}</span>
                <span style={{ fontWeight: 800, fontSize: 13, color: accentColor }}>
                  Points {isAdd ? 'Added' : 'Deducted'}
                </span>
              </div>

              {/* Main message */}
              <div style={{ fontSize: 12, color: '#1a1a1a', fontWeight: 600, marginBottom: 8 }}>
                <b style={{ color: accentColor }}>{isAdd ? '+' : ''}{adj} point{Math.abs(Number(adj)) !== 1 ? 's' : ''}</b> {isAdd ? 'added to' : 'deducted from'} your account by admin.
              </div>

              {/* Before → After breakdown card */}
              {beforeTotal !== undefined && newTotal !== undefined && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 0,
                  background: '#fff', border: `1px solid ${accentColor}30`,
                  borderRadius: 8, overflow: 'hidden', marginBottom: 8,
                }}>
                  <div style={{ flex: 1, textAlign: 'center', padding: '6px 10px', background: '#f5f5f5' }}>
                    <div style={{ fontSize: 9, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Before</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#555' }}>{beforeTotal} pts</div>
                  </div>
                  <div style={{ padding: '0 8px', fontSize: 16, color: accentColor, fontWeight: 800 }}>→</div>
                  <div style={{ flex: 1, textAlign: 'center', padding: '6px 10px', background: isAdd ? '#e8f4fd' : '#fdecea' }}>
                    <div style={{ fontSize: 9, color: accentColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>After</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: accentColor }}>{newTotal} pts</div>
                  </div>
                </div>
              )}

              {/* Reason */}
              {n.reason && (
                <div style={{ fontSize: 11, color: '#333', fontWeight: 500, marginBottom: 4 }}>
                  📝 {n.reason}
                </div>
              )}

              {/* Date */}
              <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{date}</div>
            </div>

            {/* Action button */}
            <div style={{ flexShrink: 0 }}>
              {!isRead ? (
                <button onClick={() => markRead(n._id)} style={{
                  padding: '4px 10px', background: accentColor, color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                  Mark read
                </button>
              ) : (
                <span style={{ fontSize: 10, color: '#aaa' }}>✓ Read</span>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Duplicate alert
    if (n.type === 'duplicate_alert') {
      return (
        <div key={n._id} style={{
          padding: '14px 16px', borderBottom: '1px solid #f0f0f0',
          background: isRead ? '#fff' : '#fff8e1',
          borderLeft: '4px solid #ff9800',
          opacity: isRead ? 0.75 : 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, flex: 1 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#e65100' }}>Duplicate Merchant</div>
                <div style={{ fontSize: 12, color: '#333', marginTop: 2 }}>
                  Merchant <b>{n.duplicateMerchantName || n.duplicateMerchantPhone}</b> was also submitted by <b>{n.duplicateOtherEmployee || 'another employee'}</b>.
                </div>
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>{date}</div>
              </div>
            </div>
            {!isRead && (
              <button onClick={() => markRead(n._id)} style={{ padding: '4px 10px', background: '#e65100', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                Mark read
              </button>
            )}
            {isRead && <span style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap', flexShrink: 0 }}>✓ Read</span>}
          </div>
        </div>
      );
    }

    // Profile / merchant change requests
    const approved = n.status === 'approved';
    const color = approved ? '#2e7d32' : '#c62828';
    const typeLabel = n.type === 'profile_change' ? 'Profile Change' : n.type === 'merchant_edit' ? 'Merchant Edit' : n.type === 'merchant_delete' ? 'Merchant Delete' : 'Request';
    return (
      <div key={n._id} style={{
        padding: '14px 16px', borderBottom: '1px solid #f0f0f0',
        background: isRead ? '#fff' : (approved ? '#f0fdf4' : '#fff5f5'),
        borderLeft: `4px solid ${color}`,
        opacity: isRead ? 0.75 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10, flex: 1 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{approved ? '✅' : '❌'}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color }}>{approved ? 'Request Approved' : 'Request Rejected'}</div>
              <div style={{ fontSize: 12, color: '#333', marginTop: 2 }}>
                Your <b>{typeLabel}</b> request has been <b>{approved ? 'approved' : 'rejected'}</b> by the admin.
              </div>
              {n.reason && <div style={{ fontSize: 11, color: '#666', marginTop: 3, fontStyle: 'italic' }}>📝 {n.reason}</div>}
              <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>{date}</div>
            </div>
          </div>
          {!isRead && (
            <button onClick={() => markRead(n._id)} style={{ padding: '4px 10px', background: color, color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
              Mark read
            </button>
          )}
          {isRead && <span style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap', flexShrink: 0 }}>✓ Read</span>}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.25)' }} />
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '95vw',
        background: '#fff', zIndex: 1001, boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.22s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1a4731' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>🔔 Notifications</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', borderRadius: 6, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>Loading…</div>
          ) : notifications.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔕</div>
              <div style={{ fontWeight: 700, color: '#555' }}>No notifications yet</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>You'll see updates here</div>
            </div>
          ) : (
            notifications.map(renderNotif)
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid #eee', fontSize: 11, color: '#aaa', textAlign: 'center' }}>
          {notifications.length} total notification{notifications.length !== 1 ? 's' : ''} · history is never deleted
        </div>
      </div>
    </>
  );
}

export default function Navbar({ emp, taskCount, token }) {
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef();
  const navigate = useNavigate();

  const refreshCount = useCallback(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/requests/my-notifications`, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setUnreadCount(data.filter(n => !n.acknowledged).length);
      })
      .catch(() => {});
  }, [token]);

  // Poll unread count
  useEffect(() => {
    if (!token) return;
    refreshCount();
    const interval = setInterval(refreshCount, 15000);
    return () => clearInterval(interval);
  }, [token, refreshCount]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const logout = (e) => {
    e.preventDefault();
    localStorage.clear();
    navigate('/');
  };

  const initials = emp?.newJoinerName
    ? emp.newJoinerName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <>
      <nav className="navbar">
        <div className="nav-logo">
          <a href="/dashboard" onClick={e => { e.preventDefault(); navigate('/dashboard'); }}>
            <img src="https://res.cloudinary.com/dhhcykoqa/image/upload/v1775158486/logo-full_ueklky.png" alt="Vegavruddhi Pvt. Ltd." />
          </a>
        </div>
        <div className="nav-right">
          {/* Tasks Link with Badge */}
          <div
            onClick={() => navigate('/tasks')}
            style={{
              position: 'relative',
              marginRight: 8,
              cursor: 'pointer',
              padding: '8px 16px',
              borderRadius: 20,
              background: taskCount > 0 ? '#fff3e0' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s',
              border: taskCount > 0 ? '2px solid #ff9800' : '2px solid transparent'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#fff3e0'}
            onMouseLeave={e => e.currentTarget.style.background = taskCount > 0 ? '#fff3e0' : 'transparent'}>
            <span style={{ fontSize: 18 }}>📋</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: taskCount > 0 ? '#ff9800' : 'var(--text-mid)' }}>
              Tasks
            </span>
            {taskCount > 0 && (
              <span style={{ background: '#ff9800', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>
                {taskCount > 9 ? '9+' : taskCount}
              </span>
            )}
          </div>

          {/* 🔔 Notification Bell */}
          <div
            onClick={() => setNotifOpen(true)}
            style={{
              position: 'relative', marginRight: 8, cursor: 'pointer',
              width: 40, height: 40, borderRadius: '50%',
              background: unreadCount > 0 ? '#1a4731' : 'rgba(26,71,49,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: unreadCount > 0 ? '2px solid #40916c' : '2px solid transparent',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#1a4731'}
            onMouseLeave={e => e.currentTarget.style.background = unreadCount > 0 ? '#1a4731' : 'rgba(26,71,49,0.08)'}
          >
            <span style={{ fontSize: 18 }}>🔔</span>
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: '#e53935', color: '#fff', borderRadius: '50%',
                width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 800, border: '2px solid #fff',
              }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>

          <div className="nav-profile" ref={ref} onClick={(e) => { if (e.target.closest('a')) return; setOpen(p => !p); }}>
            <div className="nav-avatar">
              {emp?.image ? <img src={emp.image} alt="" /> : initials}
            </div>
            <div className="nav-info">
              <div className="name">{emp?.newJoinerName || 'Loading...'}</div>
              <div className="status-badge">{emp?.status || 'Active'}</div>
            </div>
            <span className="nav-chevron">▾</span>
            <div className={`dropdown-menu${open ? ' open' : ''}`}>
              <div className="dropdown-header">
                <div className="dh-name">{emp?.newJoinerName || '–'}</div>
                <div className="dh-email">{emp?.email || '–'}</div>
              </div>
              <a href="/dashboard" onClick={e => { e.preventDefault(); navigate('/dashboard'); }}>🏠&nbsp; Dashboard</a>
              <a href="/tasks" onClick={e => { e.preventDefault(); navigate('/tasks'); }}>📋&nbsp; My Tasks</a>
              <a href="/profile" onClick={e => { e.preventDefault(); navigate('/profile'); }}>👤&nbsp; My Profile</a>
              <a href="#logout" className="logout" onClick={logout}>🚪&nbsp; Logout</a>
            </div>
          </div>
        </div>
      </nav>

      {/* Notification Panel */}
      {notifOpen && (
        <NotificationPanel
          token={token}
          onClose={() => { setNotifOpen(false); refreshCount(); }}
        />
      )}
    </>
  );
}
