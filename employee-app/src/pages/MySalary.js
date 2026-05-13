import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../api';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function MySalary() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const [emp, setEmp] = useState(null);
  const [salarySlips, setSalarySlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedSlip, setSelectedSlip] = useState(null);
  const [viewModal, setViewModal] = useState(false);

  // Load profile
  useEffect(() => {
    if (!token) {
      navigate('/');
      return;
    }
    fetch(`${API_BASE}/api/auth/profile`, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(r => {
        if (r.status === 401) {
          localStorage.clear();
          navigate('/');
        }
        return r.json();
      })
      .then(setEmp)
      .catch(console.error);
  }, [token, navigate]);

  // Load salary slips
  const loadSalarySlips = useCallback(async () => {
    if (!emp?.email) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/salary/employee/${encodeURIComponent(emp.email)}?year=${selectedYear}`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('Failed to load salary slips');
      const data = await res.json();
      setSalarySlips(data.slips || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [emp?.email, selectedYear, token]);

  useEffect(() => {
    loadSalarySlips();
  }, [loadSalarySlips]);

  // View slip details
  const handleViewSlip = (slip) => {
    setSelectedSlip(slip);
    setViewModal(true);
  };

  // Open PDF directly from backend
  const handleDownloadPDF = (slip) => {
    const url = `${API_BASE}/api/salary/${slip._id}/view-pdf`;
    window.open(url, '_blank');
  };

  // Calculate salary breakdown (same as pdfGenerator)
  const calcBreakdown = (slip) => {
    const FIXED_GROSS = 25000;
    // Total calendar days in the month (including Sundays)
    const MONTHS_LIST = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const mIdx = MONTHS_LIST.indexOf(slip.month);
    const TOTAL_WORKING_DAYS = new Date(slip.year, mIdx + 1, 0).getDate();
    const pointsSalary     = ((slip.totalPoints || 0) > 0 ? slip.totalPoints : slip.pointsEarned || 0) * (slip.pointValue || 250);
    const hasIncentive     = pointsSalary > FIXED_GROSS;
    const incentive        = hasIncentive ? Math.round((pointsSalary - FIXED_GROSS) * 10) / 10 : 0;
    const workingDays      = hasIncentive ? TOTAL_WORKING_DAYS : Math.round((pointsSalary / FIXED_GROSS) * TOTAL_WORKING_DAYS);
    // Breakdown: ₹25k base if incentive, else actual salary
    const breakBase = hasIncentive ? FIXED_GROSS : pointsSalary;
    const pctB = slip.pctBasic || 50;
    const pctH = slip.pctHRA   || 25;
    const pctC = slip.pctConv  || 5;
    const pctS = slip.pctSpec  || 20;
    const basic            = Math.round(breakBase * pctB / 100);
    const hra              = Math.round(breakBase * pctH / 100);
    const conveyance       = Math.round(breakBase * pctC / 100);
    const specialAllowance = Math.round(breakBase * pctS / 100);
    const dedPF   = slip.deductionPF   || 0;
    const dedPT   = slip.deductionPT   || 0;
    const dedESIC = slip.deductionESIC || 0;
    const dedTDS  = slip.deductionTDS  || 0;
    const totalDeductions = dedPF + dedPT + dedESIC + dedTDS;
    const grossSalary      = pointsSalary;
    const netSalary        = grossSalary - totalDeductions;
    return { FIXED_GROSS, basic, hra, conveyance, specialAllowance, pointsSalary, hasIncentive, incentive, workingDays, TOTAL_WORKING_DAYS, dedPF, dedPT, dedESIC, dedTDS, totalDeductions, grossSalary, netSalary };
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'paid': return { bg: '#e6f4ea', color: '#2e7d32', label: 'Paid' };
      case 'sent': return { bg: '#e3f2fd', color: '#1565c0', label: 'Sent' };
      case 'generated': return { bg: '#fff8e1', color: '#f57f17', label: 'Generated' };
      case 'draft': return { bg: '#f5f5f5', color: '#666', label: 'Draft' };
      default: return { bg: '#f5f5f5', color: '#666', label: status };
    }
  };

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <>
      <Navbar emp={emp} taskCount={0} token={token} />
      <div className="page-container" style={{ minHeight: 'calc(100vh - 140px)', padding: '24px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1a4731', marginBottom: 8 }}>
              💰 My Salary Slips
            </h1>
            <p style={{ fontSize: 14, color: '#666' }}>
              View and download your salary slips
            </p>
          </div>

          {error && (
            <div style={{ padding: 16, background: '#fdecea', border: '1px solid #c62828', borderRadius: 8, marginBottom: 24, color: '#c62828' }}>
              {error}
            </div>
          )}

          {/* Year Filter */}
          <div style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
            <label style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>Filter by Year:</label>
            {years.map(year => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                style={{
                  padding: '8px 20px',
                  background: selectedYear === year ? '#1a4731' : '#fff',
                  color: selectedYear === year ? '#fff' : '#333',
                  border: selectedYear === year ? 'none' : '1px solid #ddd',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {year}
              </button>
            ))}
          </div>

          {/* Salary Slips List */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
              <div>Loading salary slips...</div>
            </div>
          ) : salarySlips.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, background: '#f9f9f9', borderRadius: 12 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#555', marginBottom: 6 }}>
                No salary slips found
              </div>
              <div style={{ fontSize: 14, color: '#aaa' }}>
                Salary slips for {selectedYear} will appear here
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {salarySlips.map(slip => {
                const statusInfo = getStatusColor(slip.status);
                return (
                  <div
                    key={slip._id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e0e0e0',
                      borderRadius: 12,
                      padding: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      transition: 'all 0.2s',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                  >
                    {/* Left: Month/Year */}
                    <div style={{ flex: '0 0 140px' }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#1a4731' }}>
                        {slip.month} {slip.year}
                      </div>
                      <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                        Generated: {new Date(slip.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    </div>

                    {/* Middle: Points & Salary */}
                    <div style={{ flex: 1, display: 'flex', gap: 24 }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
                          Points Earned
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#1565c0' }}>
                          {slip.pointsEarned} pts
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
                          Total Salary
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#2e7d32' }}>
                          ₹{slip.totalSalary.toLocaleString('en-IN')}
                        </div>
                      </div>
                    </div>

                    {/* Right: Status & Actions */}
                    <div style={{ flex: '0 0 200px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                      <div
                        style={{
                          padding: '6px 14px',
                          background: statusInfo.bg,
                          color: statusInfo.color,
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 700,
                          textTransform: 'uppercase'
                        }}
                      >
                        {statusInfo.label}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleViewSlip(slip); }}
                          style={{
                            padding: '8px 16px',
                            background: '#1a4731',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          👁 View
                        </button>
                        {slip.pdfUrl && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadPDF(slip); }}
                            style={{
                              padding: '8px 16px',
                              background: '#d32f2f',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 8,
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: 'pointer',
                              transition: 'all 0.2s'
                            }}
                          >
                            📄 PDF
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* View Modal - Full Salary Breakdown */}
      {viewModal && selectedSlip && (() => {
        const c = calcBreakdown(selectedSlip);
        const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
        return (
          <>
            <div onClick={() => setViewModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: '#fff', borderRadius: 16, padding: 32, maxWidth: 640, width: '95%',
              maxHeight: '92vh', overflowY: 'auto', zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1a4731', margin: 0 }}>Salary Slip</h2>
                  <p style={{ fontSize: 13, color: '#888', margin: '4px 0 0' }}>{selectedSlip.month} {selectedSlip.year}</p>
                </div>
                <button onClick={() => setViewModal(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>✕</button>
              </div>

              {/* Employee Info */}
              <div style={{ background: '#f5f5f5', borderRadius: 10, padding: '14px 16px', marginBottom: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
                <div><span style={{ color: '#888', fontWeight: 600 }}>Name: </span><span style={{ fontWeight: 700 }}>{selectedSlip.employeeName}</span></div>
                <div><span style={{ color: '#888', fontWeight: 600 }}>Role: </span><span style={{ fontWeight: 700 }}>{selectedSlip.role}</span></div>
                <div><span style={{ color: '#888', fontWeight: 600 }}>Department: </span><span style={{ fontWeight: 700 }}>Sales</span></div>
                <div><span style={{ color: '#888', fontWeight: 600 }}>Working Days: </span><span style={{ fontWeight: 700 }}>{c.workingDays}</span></div>
                <div><span style={{ color: '#888', fontWeight: 600 }}>Points: </span><span style={{ fontWeight: 700 }}>{selectedSlip.pointsEarned} × ₹{selectedSlip.pointValue} = ₹{fmt(c.pointsSalary)}</span></div>
              </div>

              {/* Earnings Table - NO % column for employee */}
              <div style={{ fontWeight: 700, color: '#1a4731', borderBottom: '2px solid #1a4731', paddingBottom: 6, marginBottom: 10, fontSize: 14 }}>Earnings</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14, fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f0f0f0' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Component</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Basic', val: c.basic },
                    { label: 'HRA', val: c.hra },
                    { label: 'Conveyance / Fuel', val: c.conveyance },
                    { label: 'Special Allowance', val: c.specialAllowance },
                  ].map(row => (
                    <tr key={row.label} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px 10px' }}>{row.label}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>₹{fmt(row.val)}</td>
                    </tr>
                  ))}
                  {c.hasIncentive && (
                    <tr style={{ borderBottom: '1px solid #eee', color: '#e65100' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                        Incentive <span style={{ fontSize: 11, fontWeight: 400 }}>(₹{fmt(c.pointsSalary)} − ₹{fmt(c.FIXED_GROSS)})</span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>₹{fmt(c.incentive)}</td>
                    </tr>
                  )}
                  <tr style={{ background: '#f9f9f9', fontWeight: 700, borderTop: '2px solid #ccc' }}>
                    <td style={{ padding: '10px 10px' }}>Gross Salary</td>
                    <td style={{ padding: '10px 10px', textAlign: 'right' }}>₹{fmt(c.grossSalary)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Deductions - black text */}
              <div style={{ fontWeight: 700, color: '#1a4731', borderBottom: '2px solid #1a4731', paddingBottom: 6, marginBottom: 10, fontSize: 14 }}>Deductions</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14, fontSize: 13 }}>
                <tbody>
                  {[
                    { label: 'Employee PF', val: c.dedPF },
                    { label: 'Professional Tax', val: c.dedPT },
                    { label: 'ESIC (if applicable)', val: c.dedESIC },
                    { label: 'TDS (as applicable)', val: c.dedTDS },
                  ].map(d => (
                    <tr key={d.label} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px 10px', color: '#333' }}>{d.label}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: d.val > 0 ? '#333' : '#bbb', fontStyle: d.val > 0 ? 'normal' : 'italic' }}>
                        {d.val > 0 ? `₹${fmt(d.val)}` : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: '#f9f9f9', fontWeight: 700, borderTop: '2px solid #ccc' }}>
                    <td style={{ padding: '10px 10px' }}>Total Deductions</td>
                    <td style={{ padding: '10px 10px', textAlign: 'right' }}>₹{fmt(c.totalDeductions)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Net Salary */}
              <div style={{ background: '#1a4731', color: '#fff', padding: '16px 20px', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>Net Salary (Take Home)</span>
                <span style={{ fontSize: 24, fontWeight: 800 }}>₹{fmt(c.netSalary)}</span>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                {selectedSlip.pdfUrl && (
                  <button onClick={() => { handleDownloadPDF(selectedSlip); }}
                    style={{ padding: '10px 20px', background: '#d32f2f', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    📄 Download PDF
                  </button>
                )}
                <button onClick={() => setViewModal(false)}
                  style={{ padding: '10px 20px', background: '#fff', color: '#333', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Close
                </button>
              </div>
            </div>
          </>
        );
      })()}

      <Footer />

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translate(-50%, -45%); }
          to { opacity: 1; transform: translate(-50%, -50%); }
        }
      `}</style>
    </>
  );
}
