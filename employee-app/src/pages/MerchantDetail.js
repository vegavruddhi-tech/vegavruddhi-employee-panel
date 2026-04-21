import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { API_BASE } from '../api';

const STATUS_COLOR = {
  'Ready for Onboarding':          { color: '#2e7d32', bg: '#e6f4ea' },
  'Not Interested':                { color: '#c62828', bg: '#fdecea' },
  'Try but not done due to error': { color: '#e65100', bg: '#fff3e0' },
  'Need to visit again':           { color: '#1565c0', bg: '#e3f2fd' },
};

function YN({ val }) {
  if (!val) return <span style={{ color: '#aaa' }}>–</span>;
  return val === 'Yes'
    ? <span style={{ background: '#e6f4ea', color: '#2e7d32', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>✓ Yes</span>
    : <span style={{ background: '#fdecea', color: '#c62828', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>✗ No</span>;
}

function Field({ label, children, full }) {
  return (
    <div className={`detail-field${full ? ' full' : ''}`}>
      <div className="df-label">{label}</div>
      <div className="df-value">{children || <span style={{ color: '#aaa' }}>–</span>}</div>
    </div>
  );
}

function Section({ icon, title, children }) {
  return (
    <div className="detail-section">
      <div className="detail-section-header">
        <div className="dsh-icon">{icon}</div>
        <h3>{title}</h3>
      </div>
      <div className="detail-field-grid">{children}</div>
    </div>
  );
}

export default function MerchantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  const [emp,    setEmp]    = useState(null);
  const [form,   setForm]   = useState(null);
  const [vData,  setVData]  = useState(null);
  const [loading,setLoading]= useState(true);
  const [taskCount, setTaskCount] = useState(0);

  // Request modal
  const [reqOpen,  setReqOpen]  = useState(false);
  const [reqForm,  setReqForm]  = useState({ customerName: '', customerNumber: '', location: '', status: '', reason: '' });
  const [reqError, setReqError] = useState('');
  const [reqOk,    setReqOk]    = useState('');
  const [reqSaving,setReqSaving]= useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/profile`, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json()).then(setEmp).catch(console.error);
  }, [token]);

  // Load task count
  useEffect(() => {
    fetch(`${API_BASE}/api/tasks/my-tasks/count`, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json())
      .then(data => setTaskCount(data.pending || 0))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    fetch(`${API_BASE}/api/forms/detail/${id}`, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => { if (!r.ok) { navigate('/dashboard'); return null; } return r.json(); })
      .then(f => {
        if (!f) return;
        setForm(f);
        return fetch(`${API_BASE}/api/verify/check?phone=${encodeURIComponent(f.customerNumber)}&name=${encodeURIComponent(f.customerName)}&product=${encodeURIComponent(f.formFillingFor || '')}`, {
          headers: { Authorization: 'Bearer ' + token }
        }).then(r => r.json()).then(setVData).catch(() => {});
      })
      .catch(() => navigate('/dashboard'))
      .finally(() => setLoading(false));
  }, [id, token, navigate]);

  const openEdit = () => {
    setReqForm({ customerName: form.customerName, customerNumber: form.customerNumber, location: form.location, status: form.status, reason: '' });
    setReqError(''); setReqOk('');
    setReqOpen(true);
  };

const openDelete = () => {
    const reason = window.prompt(`Reason for deleting "${form?.customerName}"? (required)`);
    if (!reason?.trim()) return;
    fetch(`${API_BASE}/api/requests/merchant-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ merchantId: form._id, merchantName: form.customerName, reason: reason.trim() })
    }).then(() => alert('✓ Delete request sent to admin for approval.')).catch(() => alert('Server error.'));
  };


  const sendRequest = async () => {
    if (!reqForm.reason.trim()) { setReqError('Please provide a reason.'); return; }
    setReqSaving(true); setReqError('');
    try {
      const res  = await fetch(`${API_BASE}/api/requests/merchant-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ merchantId: form._id, merchantName: form.customerName, reason: reqForm.reason, changes: { customerName: reqForm.customerName, customerNumber: reqForm.customerNumber, location: reqForm.location, status: reqForm.status } })
      });
      const data = await res.json();
      if (!res.ok) { setReqError(data.message || 'Failed'); return; }
      setReqOk('✓ Edit request sent! Admin will review and apply the change.');
      setTimeout(() => setReqOpen(false), 2000);
    } catch { setReqError('Server error.'); }
    finally { setReqSaving(false); }
  };

  if (loading) return <><Navbar emp={emp} taskCount={taskCount} /><div className="detail-page"><div className="merchants-loading">Loading merchant details...</div></div><Footer /></>;
  if (!form)   return null;

  const sc   = STATUS_COLOR[form.status] || { color: '#333', bg: '#f5f5f5' };
  const date = new Date(form.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = new Date(form.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const v  = vData?.verification || {};
  const pc = vData?.phoneCheck   || {};
  const VBADGE = { 'Fully Verified': { bg: '#e6f4ea', color: '#2e7d32', icon: '✓' }, 'Partially Done': { bg: '#fff8e1', color: '#f57f17', icon: '◑' }, 'Not Verified': { bg: '#fdecea', color: '#c62828', icon: '✗' }, 'Not Found': { bg: '#f5f5f5', color: '#888', icon: '–' } };
  const vb = VBADGE[v.status] || VBADGE['Not Found'];

  return (
    <>
      <Navbar emp={emp} taskCount={taskCount} />
      <div className="detail-page">
        <div className="action-btns">
          <button className="btn-edit" onClick={openEdit}>🔔 Request Edit</button>
          <button className="btn-delete" onClick={openDelete}>🔔 Request Delete</button>
        </div>

        <div className="detail-hero">
          <div className="detail-hero-avatar">{form.customerName.charAt(0).toUpperCase()}</div>
          <div className="detail-hero-info">
            <h2>{form.customerName}</h2>
            <p>📞 {form.customerNumber} &nbsp;·&nbsp; 📍 {form.location}</p>
            <div className="detail-hero-badges">
              <span className="detail-badge">📄 {form.formFillingFor || form.attemptedProducts?.join(', ') || '–'}</span>
              <span className="detail-badge" style={{ background: sc.bg, color: sc.color, borderColor: sc.bg }}>{form.status}</span>
            </div>
          </div>
          <Link to="/dashboard" className="detail-back">← Dashboard</Link>
        </div>

        <Section icon="👤" title="Customer Information">
          <Field label="Customer Name">{form.customerName}</Field>
          <Field label="Customer Number">{form.customerNumber}</Field>
          <Field label="Location">{form.location}</Field>
          <Field label="Submitted On">{date} at {time}</Field>
        </Section>

        <Section icon="📋" title="Visit Information">
          <Field label="Form Filled For">{form.formFillingFor || form.attemptedProducts?.join(', ') || '–'}</Field>
          <Field label="Visit Status" full>
            <span style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, color: sc.color, background: sc.bg }}>{form.status}</span>
          </Field>
        </Section>

        {/* Product-specific fields */}
        {form.formFillingFor === 'Tide' && <Section icon="🌊" title="Tide Details"><Field label="QR Posted"><YN val={form.tide_qrPosted} /></Field><Field label="Rs 10/30 UPI Txn Done"><YN val={form.tide_upiTxnDone} /></Field></Section>}
        {form.formFillingFor === 'Kotak 811' && <Section icon="🏦" title="Kotak 811 Details"><Field label="Rs 2000 Txn Done"><YN val={form.kotak_txnDone} /></Field><Field label="Wi-Fi & Bluetooth Off"><YN val={form.kotak_wifiBtOff} /></Field></Section>}
        {form.formFillingFor === 'Insurance' && <Section icon="🛡️" title="Insurance Details"><Field label="Vehicle Number">{form.ins_vehicleNumber}</Field><Field label="Vehicle Type">{form.ins_vehicleType}</Field><Field label="Insurance Type" full>{form.ins_insuranceType}</Field></Section>}
        {form.formFillingFor === 'PineLab' && <Section icon="💳" title="PineLab Details"><Field label="Card Txn of Rs 100 Done"><YN val={form.pine_cardTxn} /></Field><Field label="Machine Connected with Wi-Fi"><YN val={form.pine_wifiConnected} /></Field></Section>}
        {form.formFillingFor === 'Credit Card' && <Section icon="💳" title="Credit Card Details"><Field label="Name of Credit Card" full>{form.cc_cardName}</Field></Section>}
        {form.formFillingFor === 'Tide Insurance' && <Section icon="🛡️" title="Tide Insurance Details"><Field label="Type of Insurance" full>{form.tideIns_type}</Field></Section>}
        {form.formFillingFor === 'Bharat Pay' && <Section icon="📲" title="Bharat Pay Details"><Field label="Product" full>{form.bp_product}</Field></Section>}

        {/* Verification */}
        {vData && (
          <div className="detail-section">
            <div className="detail-section-header">
              <div className="dsh-icon">🔍</div>
              <h3>
                Verification Status&nbsp;
                <span style={{ marginLeft: 10, padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: vb.bg, color: vb.color, border: `1.5px solid ${vb.color}20` }}>{vb.icon} {v.status || 'Not Found'}</span>
                {v.monthLabel && <span style={{ fontSize: 11, color: '#aaa', marginLeft: 8 }}>{v.monthLabel}</span>}
              </h3>
            </div>
            <div className="detail-field-grid">
              {pc.matched ? (
                <div className="detail-field full" style={{ background: '#fffdf0', borderLeft: `3px solid ${pc.phoneMatch ? '#2e7d32' : '#c62828'}` }}>
                  <div className="df-label">Phone Cross-Check (vs Google Sheet)</div>
                  <div className="df-value" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ background: pc.phoneMatch ? '#e6f4ea' : '#fdecea', color: pc.phoneMatch ? '#2e7d32' : '#c62828', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                      {pc.phoneMatch ? '✓ Number Matched' : '⚠ Number Mismatch'}
                    </span>
                    <span style={{ fontSize: 13, color: '#555' }}>Form: <b>{pc.formPhone}</b></span>
                    <span style={{ fontSize: 13, color: '#555' }}>Sheet: <b>{pc.sheetPhone || '–'}</b></span>
                  </div>
                </div>
              ) : (
                <div className="detail-field full" style={{ background: '#f9f9f9' }}>
                  <div className="df-label">Phone Cross-Check</div>
                  <div className="df-value"><span style={{ background: '#f5f5f5', color: '#888', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>– Number not found in sheet</span></div>
                </div>
              )}
              {(v.checks || []).length > 0 && (
                <div className="detail-field full" style={{ background: '#f8fdf9' }}>
                  <div className="df-label" style={{ marginBottom: 10 }}>Condition Summary — {v.monthLabel || ''}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {v.checks.map((c, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: c.pass ? '#e6f4ea' : '#fdecea', color: c.pass ? '#2e7d32' : '#c62828', border: `1.5px solid ${c.pass ? '#a8d5b5' : '#f5a5a5'}` }}>
                        {c.pass ? '✓' : '✗'} {c.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(v.checks || []).map((c, i) => (
                <div key={i} className="detail-field">
                  <div className="df-label">{c.label}</div>
                  <div className="df-value" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: c.pass ? '#e6f4ea' : '#fdecea', color: c.pass ? '#2e7d32' : '#c62828', padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, border: `1.5px solid ${c.pass ? '#a8d5b5' : '#f5a5a5'}` }}>
                      {c.pass ? '✓ Done' : '✗ Not Done'}
                    </span>
                    <span style={{ fontSize: 12, color: '#888' }}>Actual: <b>{c.actual}</b></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Request modal */}
      {reqOpen && (
        <div className="edit-modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setReqOpen(false); }}>
          <div className="edit-modal" style={{ maxWidth: 480 }}>
            <div className="edit-modal-header">
              <h3>🔔 Request Merchant Edit</h3>
              <button className="edit-modal-close" onClick={() => setReqOpen(false)}>✕</button>
            </div>
            <div className="edit-modal-body">
              <div style={{ background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#1565c0' }}>
                ℹ Your request will be sent to admin for review. Changes will be applied after approval.
              </div>
              {[['Customer Name','customerName','text'],['Customer Number','customerNumber','tel'],['Location','location','text']].map(([lbl, key, type]) => (
                <div className="edit-field" key={key}>
                  <label>{lbl}</label>
                  <input type={type} value={reqForm[key]} onChange={e => setReqForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
              <div className="edit-field">
                <label>Visit Status</label>
                <select value={reqForm.status} onChange={e => setReqForm(f => ({ ...f, status: e.target.value }))}>
                  {['Ready for Onboarding','Not Interested','Try but not done due to error','Need to visit again'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="edit-field">
                <label>Reason for request <span className="req">*</span></label>
                <textarea rows={3} value={reqForm.reason} onChange={e => setReqForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why do you want this change?" style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #dde8dd', borderRadius: 8, fontSize: 14, outline: 'none', resize: 'vertical' }} />
              </div>
              {reqError && <div className="error-msg"   style={{ display: 'block' }}>{reqError}</div>}
              {reqOk    && <div className="success-msg" style={{ display: 'block' }}>{reqOk}</div>}
            </div>
            <div className="edit-modal-footer">
              <button className="btn-cancel-modal" onClick={() => setReqOpen(false)}>Cancel</button>
              <button className="btn-save" onClick={sendRequest} disabled={reqSaving}>{reqSaving ? 'Sending...' : '🔔 Send Request'}</button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}
