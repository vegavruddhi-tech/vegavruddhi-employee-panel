import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../api';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function Profile() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const [emp, setEmp] = useState(null);
  const [posModal, setPosModal] = useState(false);
  const [profModal, setProfModal] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [photoMenu, setPhotoMenu] = useState(false);
  const videoRef = useRef(); const canvasRef = useRef(); const streamRef = useRef();

  // Position request state
  const [posNew, setPosNew] = useState(''); const [posReason, setPosReason] = useState('');
  const [posErr, setPosErr] = useState(''); const [posOk, setPosOk] = useState(''); const [posSaving, setPosSaving] = useState(false);

  // Profile request state
  const [pf, setPf] = useState({ newJoinerName:'',newJoinerPhone:'',newJoinerEmailId:'',location:'',reportingManager:'',reason:'' });
  const [pfErr, setPfErr] = useState(''); const [pfOk, setPfOk] = useState(''); const [pfSaving, setPfSaving] = useState(false);

  const loadProfile = () => {
    fetch(`${API_BASE}/api/auth/profile`, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => { if (r.status === 401) { localStorage.clear(); navigate('/'); } return r.json(); })
      .then(setEmp).catch(console.error);
  };
  useEffect(loadProfile, [token]); // eslint-disable-line

  const openCamera = async () => {
    setPhotoMenu(false);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      videoRef.current.srcObject = streamRef.current;
      setCamOpen(true);
    } catch (err) { alert('Camera error: ' + err.message); }
  };
  const stopCamera = () => { streamRef.current?.getTracks().forEach(t => t.stop()); setCamOpen(false); };
  const capture = () => {
    const c = canvasRef.current, v = videoRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(blob => { stopCamera(); uploadPhoto(new File([blob], 'photo-' + Date.now() + '.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.9);
  };
  const uploadPhoto = async (file) => {
    const fd = new FormData(); fd.append('photo', file);
    const res = await fetch(`${API_BASE}/api/auth/update-photo`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
    const data = await res.json();
    if (!res.ok) { alert(data.message || 'Upload failed'); return; }
    setEmp(e => ({ ...e, photoFileName: data.photoFileName }));
  };

  const sendPosRequest = async () => {
    if (!posNew) { setPosErr('Please select a position.'); return; }
    if (posNew === emp?.position) { setPosErr('You already have this position.'); return; }
    setPosSaving(true); setPosErr('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/request-position`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ requestedPosition: posNew, reason: posReason }) });
      const data = await res.json();
      if (!res.ok) { setPosErr(data.message || 'Failed'); return; }
      setPosOk('✓ Request sent! Admin will review and update your position.');
      setTimeout(() => setPosModal(false), 2000);
    } catch { setPosErr('Server error.'); } finally { setPosSaving(false); }
  };

  const openProfModal = () => {
    setPf({ newJoinerName: emp?.newJoinerName||'', newJoinerPhone: emp?.newJoinerPhone||'', newJoinerEmailId: emp?.newJoinerEmailId||'', location: emp?.location||'', reportingManager: emp?.reportingManager||'', reason: '' });
    setPfErr(''); setPfOk(''); setProfModal(true);
  };
  const sendProfRequest = async () => {
    if (!pf.newJoinerName) { setPfErr('Full name is required.'); return; }
    setPfSaving(true); setPfErr('');
    try {
      const { reason, ...changes } = pf;
      const res = await fetch(`${API_BASE}/api/requests/profile`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ changes, reason }) });
      const data = await res.json();
      if (!res.ok) { setPfErr(data.message || 'Failed'); return; }
      setPfOk('✓ Request sent! Admin will review and apply your changes.');
      setTimeout(() => setProfModal(false), 2000);
    } catch { setPfErr('Server error.'); } finally { setPfSaving(false); }
  };

  const initials = emp?.newJoinerName?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  const joined   = emp?.createdAt ? new Date(emp.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : '–';
console.log(emp)
  return (
    <>
      <Navbar emp={emp} />
      <div className="profile-page">
        {/* Hero */}
        <div className="profile-hero">
          <div
            className="avatar-edit-wrap"
            onClick={() => setPhotoMenu((p) => !p)}
            title="Click to change photo"
          >
            <div className="hero-avatar">
              {emp?.image ? (
                <img
                  src={emp.image}
                  alt="avatar"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    borderRadius: "50%",
                  }}
                />
              ) : (
                initials
              )}
            </div>
            <div className="avatar-edit-overlay">
              <span className="eo-icon">✏</span>Edit Photo
            </div>
            {photoMenu && (
              <div
                style={{
                  position: "absolute",
                  top: 90,
                  left: 0,
                  background: "#fff",
                  borderRadius: 12,
                  boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
                  zIndex: 200,
                  overflow: "hidden",
                  minWidth: 200,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={openCamera}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "14px 18px",
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#1a4731",
                  }}
                >
                  📷 Take Photo
                </button>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "14px 18px",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#1a4731",
                    borderTop: "1px solid #f0f5f0",
                  }}
                >
                  🖼 Choose from Gallery
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        setPhotoMenu(false);
                        uploadPhoto(e.target.files[0]);
                      }
                    }}
                  />
                </label>
              </div>
            )}
          </div>
          <div className="hero-info">
            <h1 id="heroName">{emp?.newJoinerName || "–"}</h1>
            <div className="hero-role">
              IT &amp; Business Consultation Services
            </div>
            <div className="hero-badges">
              <span className="hero-badge">{emp?.position || "–"}</span>
              <span className="hero-badge">{emp?.location || "–"}</span>
              <span className="hero-badge active">
                {emp?.status || "Active"}
              </span>
            </div>
          </div>
          <a
            href="/dashboard"
            className="hero-back"
            onClick={(e) => {
              e.preventDefault();
              navigate("/dashboard");
            }}
          >
            ← Dashboard
          </a>
        </div>

        {/* Personal Info */}
        <div className="profile-section">
          <div
            className="section-header"
            style={{ justifyContent: "space-between" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="sec-icon">👤</div>
              <h3>Personal Information</h3>
            </div>
            <button className="prof-edit-btn" onClick={openProfModal}>
              🔔 Request Change
            </button>
          </div>
          <div className="field-grid">
            {[
              ["Full Name", emp?.newJoinerName],
              ["Phone Number", emp?.newJoinerPhone],
              ["Login Email", emp?.email],
              ["Joiner Email ID", emp?.newJoinerEmailId],
            ].map(([lbl, val]) => (
              <div className="field-item" key={lbl}>
                <div className="f-label">{lbl}</div>
                <div className="f-value">{val || "–"}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Work Info */}
        <div className="profile-section">
          <div className="section-header">
            <div className="sec-icon">💼</div>
            <h3>Work Information</h3>
          </div>
          <div className="field-grid">
            <div className="field-item">
              <div className="f-label">
                Position{" "}
                <span style={{ fontSize: 10, color: "#aaa", fontWeight: 400 }}>
                  (not editable)
                </span>
              </div>
              <div className="f-value">{emp?.position || "–"}</div>
            </div>
            <div className="field-item">
              <div className="f-label">Location</div>
              <div className="f-value">{emp?.location || "–"}</div>
            </div>
            <div className="field-item">
              <div className="f-label">Reporting Manager</div>
              <div className="f-value">{emp?.reportingManager || "–"}</div>
            </div>
            <div className="field-item">
              <div className="f-label">Joined On</div>
              <div className="f-value">{joined}</div>
            </div>
            <div className="field-item">
              <div className="f-label">Employment Status</div>
              <div className="f-value">
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 12px",
                    borderRadius: 20,
                    background: "var(--green-pale)",
                    color: "var(--green-dark)",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {emp?.status || "–"}
                </span>
              </div>
            </div>
            <div className="field-item">
              <div className="f-label">CV Document</div>
              <div className="f-value">
                {emp?.cv ? (
                  <a href={emp.cv} target="_blank" rel="noopener noreferrer">
                    View CV
                  </a>
                ) : (
                  "Not uploaded"
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Camera modal */}
      {camOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{ width: "100%", maxWidth: 420, borderRadius: 12 }}
          />
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={capture}
              style={{
                padding: "12px 28px",
                background: "#1a4731",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              📷 Capture
            </button>
            <button
              onClick={stopCamera}
              style={{
                padding: "12px 28px",
                background: "#555",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
      )}

      {/* Position request modal */}
      {posModal && (
        <div
          style={{
            display: "flex",
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 600,
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPosModal(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 440,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <div
              style={{
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f0f5f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: "var(--green-dark)",
                }}
              >
                🔔 Request Position Change
              </h3>
              <button
                onClick={() => setPosModal(false)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  border: "none",
                  background: "#f5f5f5",
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "20px 24px" }}>
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                    color: "var(--text-mid)",
                    marginBottom: 6,
                  }}
                >
                  Current Position
                </label>
                <div
                  style={{
                    padding: "10px 14px",
                    background: "#f5f5f5",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {emp?.position || "–"}
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                    color: "var(--text-mid)",
                    marginBottom: 6,
                  }}
                >
                  Requested Position <span className="req">*</span>
                </label>
                <select
                  value={posNew}
                  onChange={(e) => setPosNew(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    border: "1.5px solid #dde8dd",
                    borderRadius: 8,
                    fontSize: 14,
                    outline: "none",
                  }}
                >
                  <option value="">-- Select --</option>
                  <option>Team Lead</option>
                  <option>FSE</option>
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                    color: "var(--text-mid)",
                    marginBottom: 6,
                  }}
                >
                  Reason (optional)
                </label>
                <textarea
                  value={posReason}
                  onChange={(e) => setPosReason(e.target.value)}
                  rows={3}
                  placeholder="Why do you want this position change?"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    border: "1.5px solid #dde8dd",
                    borderRadius: 8,
                    fontSize: 14,
                    outline: "none",
                    resize: "vertical",
                  }}
                />
              </div>
              {posErr && (
                <div className="error-msg" style={{ display: "block" }}>
                  {posErr}
                </div>
              )}
              {posOk && (
                <div className="success-msg" style={{ display: "block" }}>
                  {posOk}
                </div>
              )}
            </div>
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #f0f5f0",
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => setPosModal(false)}
                style={{
                  padding: "10px 20px",
                  background: "#f5f5f5",
                  color: "var(--text-dark)",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={sendPosRequest}
                disabled={posSaving}
                style={{
                  padding: "10px 24px",
                  background: "var(--green-dark)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {posSaving ? "Sending..." : "🔔 Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile change modal */}
      {profModal && (
        <div
          style={{
            display: "flex",
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 500,
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setProfModal(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 520,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <div
              style={{
                padding: "20px 24px 16px",
                borderBottom: "1px solid #f0f5f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                position: "sticky",
                top: 0,
                background: "#fff",
                zIndex: 10,
              }}
            >
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: "var(--green-dark)",
                }}
              >
                🔔 Request Profile Change
              </h3>
              <button
                onClick={() => setProfModal(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  border: "none",
                  background: "#f5f5f5",
                  cursor: "pointer",
                  fontSize: 18,
                  color: "#666",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "20px 24px" }}>
              <div
                style={{
                  background: "#e3f2fd",
                  border: "1px solid #90caf9",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 18,
                  fontSize: 12,
                  color: "#1565c0",
                }}
              >
                ℹ Fill in the new values you want. Admin will review and apply
                the changes.
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                {[
                  ["Full Name", "newJoinerName", "text", true],
                  ["Phone Number", "newJoinerPhone", "tel", false],
                  ["Joiner Email ID", "newJoinerEmailId", "email", false],
                  ["Location", "location", "text", false],
                  ["Reporting Manager", "reportingManager", "text", true],
                ].map(([lbl, key, type, full]) => (
                  <div key={key} style={full ? { gridColumn: "1/-1" } : {}}>
                    <label
                      style={{
                        display: "block",
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.6px",
                        color: "var(--text-mid)",
                        marginBottom: 6,
                      }}
                    >
                      {lbl}
                    </label>
                    <input
                      type={type}
                      value={pf[key]}
                      onChange={(e) =>
                        setPf((f) => ({ ...f, [key]: e.target.value }))
                      }
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        border: "1.5px solid #dde8dd",
                        borderRadius: 8,
                        fontSize: 14,
                        outline: "none",
                      }}
                    />
                  </div>
                ))}
                <div style={{ gridColumn: "1/-1" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.6px",
                      color: "var(--text-mid)",
                      marginBottom: 6,
                    }}
                  >
                    Reason for change
                  </label>
                  <textarea
                    value={pf.reason}
                    onChange={(e) =>
                      setPf((f) => ({ ...f, reason: e.target.value }))
                    }
                    rows={2}
                    placeholder="Why do you want these changes?"
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      border: "1.5px solid #dde8dd",
                      borderRadius: 8,
                      fontSize: 14,
                      outline: "none",
                      resize: "vertical",
                    }}
                  />
                </div>
              </div>
              {pfErr && (
                <div
                  className="error-msg"
                  style={{ display: "block", marginTop: 14 }}
                >
                  {pfErr}
                </div>
              )}
              {pfOk && (
                <div
                  className="success-msg"
                  style={{ display: "block", marginTop: 14 }}
                >
                  {pfOk}
                </div>
              )}
            </div>
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #f0f5f0",
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                position: "sticky",
                bottom: 0,
                background: "#fff",
              }}
            >
              <button
                onClick={() => setProfModal(false)}
                style={{
                  padding: "10px 20px",
                  background: "#f5f5f5",
                  color: "var(--text-dark)",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={sendProfRequest}
                disabled={pfSaving}
                style={{
                  padding: "10px 24px",
                  background: "var(--green-dark)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {pfSaving ? "Sending..." : "🔔 Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}
