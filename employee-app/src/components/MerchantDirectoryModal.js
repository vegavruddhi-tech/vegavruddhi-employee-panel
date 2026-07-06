import React, { useState, useEffect } from 'react';
import { API_BASE } from '../api';

export default function MerchantDirectoryModal({ isOpen, onClose, token }) {
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  // Pagination
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 5, hasMore: false });

  // Reset search query and results automatically when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setDebouncedSearch('');
      setMerchants([]);
      setError('');
      setPage(1);
    }
  }, [isOpen]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch data only when search query has at least 4 characters
  useEffect(() => {
    if (!isOpen || !token) return;

    if (!debouncedSearch || debouncedSearch.length < 4) {
      setMerchants([]);
      setPagination({ total: 0, pages: 1, limit: 5, hasMore: false });
      setLoading(false);
      setError('');
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError('');

    const queryParams = new URLSearchParams({
      page: page.toString(),
      limit: '5',
      search: debouncedSearch
    });

    fetch(`${API_BASE}/api/forms/directory?${queryParams}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async res => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || errData.error || `Error ${res.status}: Failed to load merchant check`);
        }
        return res.json();
      })
      .then(data => {
        if (isMounted && data.merchants) {
          setMerchants(data.merchants);
          setPagination(data.pagination || { total: data.merchants.length, pages: 1, limit: 5 });
        }
      })
      .catch(err => {
        if (isMounted) setError(err.message);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [isOpen, token, page, debouncedSearch]);

  if (!isOpen) return null;

  const formatDate = (dateStr) => {
    if (!dateStr) return '–';
    const d = new Date(dateStr);
    return isNaN(d) ? '–' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  };

  const isSearching = debouncedSearch && debouncedSearch.length >= 4;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)', zIndex: 9999,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      padding: 12
    }}>
      <div style={{
        backgroundColor: '#fff', borderRadius: 12, width: '100%', maxWidth: 850,
        height: 'auto', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 10px 40px rgba(0,0,0,0.35)', overflow: 'hidden', transition: 'all 0.2s ease'
      }}>
        {/* Compact Header */}
        <div style={{
          padding: '12px 16px', backgroundColor: '#0f3320', color: '#fff',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '2px solid #1a5c38'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              🏢 Global Merchant Check
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 11, opacity: 0.85 }}>
              Verify merchant name or mobile number before visit to prevent duplicate onboarding
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
              fontSize: 16, width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}
          >
            ✕
          </button>
        </div>

        {/* Compact Search Bar */}
        <div style={{
          padding: '12px 16px', backgroundColor: '#f8f9fa',
          borderBottom: isSearching ? '1px solid #e9ecef' : 'none',
          display: 'flex', flexDirection: 'column', gap: 8
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#888' }}>🔍</span>
              <input
                type="text"
                autoFocus
                placeholder="Type Merchant Name or Phone Number (min 4 chars)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%', padding: '8px 10px 8px 32px', borderRadius: 6,
                  border: '1.5px solid #1a5c38', fontSize: 13, outline: 'none', boxSizing: 'border-box'
                }}
              />
            </div>

            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  padding: '8px 14px', borderRadius: 6, border: '1px solid #ced4da',
                  backgroundColor: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600, flexShrink: 0
                }}
              >
                Clear
              </button>
            )}
          </div>
          {!isSearching && (
            <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>
              ℹ️ Enter at least 4 characters (e.g. shop name or 5 digits of phone number) to search.
            </div>
          )}
        </div>

        {/* Dynamic Table / Results Container (Only renders when searching) */}
        {isSearching && (
          <div style={{ overflowY: 'auto', overflowX: 'auto', padding: '0', maxHeight: '60vh' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 30, color: '#666' }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>⏳</div>
                <div style={{ fontSize: 12 }}>Checking records...</div>
              </div>
            ) : error ? (
              <div style={{ textAlign: 'center', padding: 30, color: '#c62828' }}>
                <div style={{ fontSize: 12 }}>❌ {error}</div>
              </div>
            ) : merchants.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: '#1a5c38' }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>✨</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>No duplicate merchant found!</div>
                <p style={{ fontSize: 11, color: '#666', margin: '4px 0 0' }}>This merchant/phone is not in our system yet. You can proceed with onboarding.</p>
              </div>
            ) : (
              <div>
                <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', textAlign: 'left', fontSize: 11 }}>
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: '#e9ecef', zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: '6px 8px', borderBottom: '2px solid #dee2e6', color: '#495057', width: '30%' }}>Merchant Name</th>
                      <th style={{ padding: '6px 8px', borderBottom: '2px solid #dee2e6', color: '#495057', width: '22%' }}>Phone Number</th>
                      <th style={{ padding: '6px 8px', borderBottom: '2px solid #dee2e6', color: '#495057', width: '18%' }}>Product</th>
                      <th style={{ padding: '6px 8px', borderBottom: '2px solid #dee2e6', color: '#495057', width: '18%' }}>Plan</th>
                      <th style={{ padding: '6px 8px', borderBottom: '2px solid #dee2e6', color: '#495057', width: '12%' }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {merchants.map((m, idx) => (
                      <tr key={m._id || idx} style={{ borderBottom: '1px solid #e9ecef', backgroundColor: idx % 2 === 0 ? '#fff' : '#fcfcfc' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 600, color: '#212529' }}>{m.merchantName}</td>
                        <td style={{ padding: '6px 8px', color: '#495057', fontWeight: 600, letterSpacing: '0.3px' }}>{m.merchantPhone || '–'}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{
                            display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                            backgroundColor: '#e6f4ea', color: '#1a5c38', whiteSpace: 'nowrap'
                          }}>
                            {m.product}
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', color: '#6c757d' }}>{m.subProduct || '–'}</td>
                        <td style={{ padding: '6px 8px', color: '#495057', whiteSpace: 'nowrap' }}>{formatDate(m.filledDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
