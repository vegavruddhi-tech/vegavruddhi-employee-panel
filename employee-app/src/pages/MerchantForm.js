import React, { useState, useEffect } from 'react';
import { API_BASE } from '../api';
import { useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const PRODUCTS = ['Tide','Kotak 811','Insurance','PineLab','Credit Card','Tide Insurance','MSME','Airtel Payments Bank','Equitas SF Bank','IndusInd Bank','Bharat Pay','Tide Credit Card'];
const ATTEMPTED = ['Tide','Kotak','Insurance','Pinelab','Credit Card','BharatPe'];
const BP_PRODUCTS = ['New Onboarding','QR Re-linking','Re-visit','Loan','Sound Box','Swipe','Mid Market Onboarding'];

function FormCard({ icon, title, sub, children }) {
  return (
    <div className="form-card">
      <div className="form-card-header">
        <div className="fch-icon">{icon}</div>
        <div><h3>{title}</h3><p>{sub}</p></div>
      </div>
      <div className="form-card-body">{children}</div>
    </div>
  );
}

function RadioGroup({ name, options, value, onChange }) {
  return (
    <div className="radio-group">
      {options.map(opt => (
        <label key={opt} className="radio-option" style={value === opt ? { borderColor: 'var(--green-dark)', background: 'var(--green-pale)', color: 'var(--green-dark)' } : {}}>
          <input type="radio" name={name} value={opt} checked={value === opt} onChange={() => onChange(opt)}
            style={{ accentColor: 'var(--green-dark)', width: 16, height: 16 }} />
          {opt}
        </label>
      ))}
    </div>
  );
}

export default function MerchantForm() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const [emp, setEmp] = useState(null);

  const [customerName,   setCustomerName]   = useState('');
  const [customerNumber, setCustomerNumber] = useState('');
  const [location,       setLocation]       = useState('');
  const [status,         setStatus]         = useState('');
  const [product,        setProduct]        = useState('');
  const [attempted,      setAttempted]      = useState([]);

  // Product sub-fields
  const [tideQR,       setTideQR]       = useState('');
  const [tideUPI,      setTideUPI]      = useState('');
  const [kotakTxn,     setKotakTxn]     = useState('');
  const [kotakWifi,    setKotakWifi]    = useState('');
  const [insVehicleNo, setInsVehicleNo] = useState('');
  const [insVehicle,   setInsVehicle]   = useState('');
  const [insType,      setInsType]      = useState('');
  const [pineCard,     setPineCard]     = useState('');
  const [pineWifi,     setPineWifi]     = useState('');
  const [ccName,       setCcName]       = useState('');
  const [tideInsType,  setTideInsType]  = useState('');
  const [bpProduct,    setBpProduct]    = useState('');

  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [dupModal, setDupModal] = useState(null); // { name, product, existingId }

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/profile`, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json()).then(setEmp).catch(console.error);
  }, [token]);

  const isOnboarding = status === 'Ready for Onboarding';

  const toggleAttempted = (val) => setAttempted(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!status) { setError('Please select a visit status.'); return; }
    if (isOnboarding && !product) { setError('Please select a product.'); return; }

    const payload = {
      customerName, customerNumber, location, status,
      ...(isOnboarding && product ? { formFillingFor: product } : {}),
      attemptedProducts: isOnboarding ? [] : attempted,
      tide_qrPosted: tideQR, tide_upiTxnDone: tideUPI,
      kotak_txnDone: kotakTxn, kotak_wifiBtOff: kotakWifi,
      ins_vehicleNumber: insVehicleNo, ins_vehicleType: insVehicle, ins_insuranceType: insType,
      pine_cardTxn: pineCard, pine_wifiConnected: pineWifi,
      cc_cardName: ccName, tideIns_type: tideInsType, bp_product: bpProduct,
    };

    setLoading(true);
    try {
      alert("Form submitting!");
      const res  = await fetch(`${API_BASE}/api/forms/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 409 && data.duplicate) {
        setDupModal({ name: customerName, product, existingId: data.existingId });
        return;
      }
      if (!res.ok) { setError(data.message || 'Submission failed'); return; }
      setSuccess('✓ Form submitted successfully! Redirecting...');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch { setError('Server error. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <>
      <Navbar emp={emp} />
      <div className="form-page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <Link to="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#fff', border: '1.5px solid #dde8dd', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--green-dark)', textDecoration: 'none' }}>
            ← Dashboard
          </Link>
          <div className="page-title" style={{ marginBottom: 0 }}>📋 Merchant Visit Form</div>
        </div>
        <div className="page-sub">Fill in the details after your merchant meeting</div>

        {error   && <div className="error-msg"   style={{ display: 'block' }}>{error}</div>}
        {success && <div className="success-msg" style={{ display: 'block' }}>{success}</div>}

        <form onSubmit={handleSubmit}>
          <FormCard icon="👥" title="Customer Details" sub="Basic merchant information">
            <div className="form-group">
              <label>Customer Name <span className="req">*</span></label>
              <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Enter customer name" required />
            </div>
            <div className="form-group">
              <label>Customer Number <span className="req">*</span></label>
              <input type="tel" value={customerNumber} onChange={e => setCustomerNumber(e.target.value)} placeholder="Enter phone number" required />
            </div>
            <div className="form-group">
              <label>Location <span className="req">*</span></label>
              <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="Enter location" required />
            </div>
          </FormCard>

          <FormCard icon="📌" title="Visit Status" sub="Outcome of the merchant visit">
            <div className="form-group">
              <label>Status <span className="req">*</span></label>
              <RadioGroup name="status" options={['Ready for Onboarding','Not Interested','Try but not done due to error','Need to visit again']} value={status} onChange={setStatus} />
            </div>
          </FormCard>

          {/* Ready for Onboarding */}
          {isOnboarding && (
            <FormCard icon="📄" title="Form Filling For" sub="Select the product / service">
              <div className="form-group">
                <label>Select Product <span className="req">*</span></label>
                <select value={product} onChange={e => setProduct(e.target.value)} style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #dde8dd', borderRadius: 8, fontSize: 14, background: '#fafcfa', outline: 'none' }}>
                  <option value="">-- Choose --</option>
                  {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              {product === 'Tide' && <>
                <div className="form-group"><label>QR Posted <span className="req">*</span></label><RadioGroup name="tide_qr" options={['Yes','No']} value={tideQR} onChange={setTideQR} /></div>
                <div className="form-group"><label>Rs 10/30 UPI Txn Done <span className="req">*</span></label><RadioGroup name="tide_upi" options={['Yes','No']} value={tideUPI} onChange={setTideUPI} /></div>
              </>}
              {product === 'Kotak 811' && <>
                <div className="form-group"><label>Rs 2000 Txn Done <span className="req">*</span></label><RadioGroup name="kotak_txn" options={['Yes','No']} value={kotakTxn} onChange={setKotakTxn} /></div>
                <div className="form-group"><label>Wi-Fi &amp; Bluetooth Off at Onboarding <span className="req">*</span></label><RadioGroup name="kotak_wifi" options={['Yes','No']} value={kotakWifi} onChange={setKotakWifi} /></div>
              </>}
              {product === 'Insurance' && <>
                <div className="form-group"><label>Vehicle Number <span className="req">*</span></label><input type="text" value={insVehicleNo} onChange={e => setInsVehicleNo(e.target.value)} placeholder="e.g. MH12AB1234" style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #dde8dd', borderRadius: 8, fontSize: 14, background: '#fafcfa', outline: 'none' }} /></div>
                <div className="form-group"><label>Vehicle Type <span className="req">*</span></label><RadioGroup name="ins_vehicle" options={['2 Wheeler','4 Wheeler','Commercial']} value={insVehicle} onChange={setInsVehicle} /></div>
                <div className="form-group"><label>Insurance Type <span className="req">*</span></label><RadioGroup name="ins_type" options={['3rd Party','Only OD','OD + 3rd Party']} value={insType} onChange={setInsType} /></div>
              </>}
              {product === 'PineLab' && <>
                <div className="form-group"><label>Card Txn done of Rs 100 <span className="req">*</span></label><RadioGroup name="pine_card" options={['Yes','No']} value={pineCard} onChange={setPineCard} /></div>
                <div className="form-group"><label>Machine connected with Wi-Fi <span className="req">*</span></label><RadioGroup name="pine_wifi" options={['Yes','No']} value={pineWifi} onChange={setPineWifi} /></div>
              </>}
              {product === 'Credit Card' && (
                <div className="form-group"><label>Name of the Credit Card <span className="req">*</span></label><input type="text" value={ccName} onChange={e => setCcName(e.target.value)} placeholder="e.g. HDFC Regalia" style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #dde8dd', borderRadius: 8, fontSize: 14, background: '#fafcfa', outline: 'none' }} /></div>
              )}
              {product === 'Tide Insurance' && (
                <div className="form-group"><label>Type of Insurance <span className="req">*</span></label><RadioGroup name="tideins" options={['Cyber Security','Accidental']} value={tideInsType} onChange={setTideInsType} /></div>
              )}
              {product === 'Bharat Pay' && (
                <div className="form-group">
                  <label>Product <span className="req">*</span></label>
                  <div className="chip-group">
                    {BP_PRODUCTS.map(p => (
                      <label key={p} className="chip" style={bpProduct === p ? { background: 'var(--green-dark)', color: '#fff', borderColor: 'var(--green-dark)' } : {}}>
                        <input type="radio" name="bp" value={p} checked={bpProduct === p} onChange={() => setBpProduct(p)} style={{ display: 'none' }} />
                        {p}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </FormCard>
          )}

          {/* Not onboarding */}
          {status && !isOnboarding && (
            <FormCard icon="☐" title="Products Discussed" sub="Select all products that were discussed">
              <div className="form-group">
                <label>Select Products <span className="req">*</span></label>
                <div className="checkbox-group">
                  {ATTEMPTED.map(p => (
                    <label key={p} className="checkbox-option" style={attempted.includes(p) ? { borderColor: 'var(--green-dark)', background: 'var(--green-pale)', color: 'var(--green-dark)', fontWeight: 600 } : {}}>
                      <input type="checkbox" checked={attempted.includes(p)} onChange={() => toggleAttempted(p)} style={{ accentColor: 'var(--green-dark)', width: 16, height: 16, flexShrink: 0 }} />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
            </FormCard>
          )}

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Submitting...' : '✓ Submit Form Response'}
          </button>
        </form>
      </div>

      {/* Duplicate modal */}
      {dupModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px 28px', maxWidth: 440, width: '90%', boxShadow: '0 8px 40px rgba(0,0,0,0.2)', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ color: '#1a4731', fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Duplicate Entry Detected</h3>
            <p style={{ color: '#555', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              You have already submitted a form for<br />
              <strong style={{ color: '#1a4731' }}>{dupModal.name}</strong> with product <strong style={{ color: '#1a4731' }}>{dupModal.product}</strong>.<br /><br />
              If the details are different, please edit the existing entry instead.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setDupModal(null)} style={{ padding: '10px 22px', border: '1.5px solid #dde8dd', borderRadius: 8, background: '#fff', color: '#1a4731', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => navigate(`/merchant/${dupModal.existingId}`)} style={{ padding: '10px 22px', border: 'none', borderRadius: 8, background: '#1a4731', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Edit Existing Entry</button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}
