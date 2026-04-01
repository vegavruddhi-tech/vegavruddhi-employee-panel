import React, { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: '', newJoinerName: '', location: '', newJoinerPhone: '',
    newJoinerEmailId: '', reportingManager: '', position: '', password: '', confirmPassword: ''
  });
  const [photo, setPhoto]       = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [cvFile, setCvFile]     = useState(null);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [camOpen, setCamOpen]   = useState(false);
  const videoRef  = useRef();
  const canvasRef = useRef();
  const streamRef = useRef();

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const setPhotoFile = (file) => {
    setPhoto(file);
    const reader = new FileReader();
    reader.onload = (e) => setPhotoPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const openCamera = async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      videoRef.current.srcObject = streamRef.current;
      setCamOpen(true);
    } catch (err) { alert('Camera error: ' + err.message); }
  };

  const capture = () => {
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      setPhotoFile(new File([blob], 'photo-' + Date.now() + '.jpg', { type: 'image/jpeg' }));
      stopCamera();
    }, 'image/jpeg', 0.9);
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    setCamOpen(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return; }
    if (!photo) { setError('Profile photo is required'); return; }

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => { if (k !== 'confirmPassword') fd.append(k, v); });
    fd.append('photo', photo);
    if (cvFile) fd.append('cv', cvFile);

    setLoading(true);
    try {
      const res  = await fetch('/api/auth/register', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Registration failed'); return; }
      setSuccess('✓ Registration successful! Redirecting to login...');
      setTimeout(() => navigate('/'), 2000);
    } catch { setError('Server error. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <div className="auth-logo">
          <img src="/logo-full.png" alt="Vegavruddhi Pvt. Ltd." />
          <span className="tagline">IT &amp; Business Consultation Services</span>
        </div>
        <hr className="auth-divider" />
        <h2>New Joiner Registration</h2>
        <p className="subtitle">VV – New Joining Candidate Details</p>

        {error   && <div className="error-msg"   style={{ display: 'block' }}>{error}</div>}
        {success && <div className="success-msg" style={{ display: 'block' }}>{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email Address <span className="req">*</span></label>
            <input type="email" value={form.email} onChange={set('email')} placeholder="your@email.com" required />
          </div>

          {/* Photo upload */}
          <div className="form-group">
            <label>Profile Photo <span className="req">*</span></label>
            <div className="photo-upload-box">
              <div className="photo-preview-wrap">
                <div className="photo-preview" style={photoPreview ? { backgroundImage: `url(${photoPreview})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
                  {!photoPreview && '👤'}
                </div>
              </div>
              <div className="photo-actions">
                <button type="button" className="photo-btn" onClick={openCamera}>📷 Take Photo</button>
                <label className="photo-btn">
                  🖼 Choose from Gallery
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files[0] && setPhotoFile(e.target.files[0])} />
                </label>
              </div>
              <div className="file-name">{photo ? photo.name : 'No photo selected'}</div>
            </div>
          </div>

          {/* CV upload */}
          <div className="form-group">
            <label>Upload CV <span className="req">*</span></label>
            <div className="file-upload-box">
              <label className="file-label">
                📄 Add File <small style={{ fontWeight: 400, color: '#888' }}>(PDF/DOC · Max 10 MB)</small>
                <input type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={e => setCvFile(e.target.files[0])} />
              </label>
              <div className="file-name">{cvFile ? cvFile.name : 'No file chosen'}</div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>New Joiner Name <span className="req">*</span></label>
              <input type="text" value={form.newJoinerName} onChange={set('newJoinerName')} placeholder="Full name" required />
            </div>
            <div className="form-group">
              <label>Location <span className="req">*</span></label>
              <input type="text" value={form.location} onChange={set('location')} placeholder="City / Office" required />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Phone Number <span className="req">*</span></label>
              <input type="tel" value={form.newJoinerPhone} onChange={set('newJoinerPhone')} placeholder="+91 XXXXX XXXXX" required />
            </div>
            <div className="form-group">
              <label>Joiner Email ID <span className="req">*</span></label>
              <input type="email" value={form.newJoinerEmailId} onChange={set('newJoinerEmailId')} placeholder="joiner@email.com" required />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Reporting Manager <span className="req">*</span></label>
              <input type="text" value={form.reportingManager} onChange={set('reportingManager')} placeholder="Manager name" required />
            </div>
            <div className="form-group">
              <label>For Position <span className="req">*</span></label>
              <select value={form.position} onChange={set('position')} required>
                <option value="">Choose...</option>
                <option>Team Lead</option>
                <option>FSE</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Create Password <span className="req">*</span></label>
              <input type="password" value={form.password} onChange={set('password')} placeholder="Min 6 characters" required minLength={6} />
            </div>
            <div className="form-group">
              <label>Confirm Password <span className="req">*</span></label>
              <input type="password" value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="Repeat password" required />
            </div>
          </div>

          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Registration'}
          </button>
        </form>

        <div className="auth-link">
          Already registered? <Link to="/">Sign in here</Link>
        </div>
      </div>

      {/* Camera Modal */}
      {camOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxWidth: 420, borderRadius: 12 }} />
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={capture} style={{ padding: '12px 28px', background: '#1a4731', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>📷 Capture</button>
            <button onClick={stopCamera} style={{ padding: '12px 28px', background: '#555', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
      )}
    </div>
  );
}
