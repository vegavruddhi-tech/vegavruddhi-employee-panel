import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { API_BASE } from '../api';
import { useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import ImpersonationBanner from '../components/ImpersonationBanner';
import TideMerchantTimeline from '../components/TideMerchantTimeline';
import { subscribeUserToPush } from '../pushSubscriptionHelper';
import MerchantDirectoryModal from '../components/MerchantDirectoryModal';



const STATUS_COLOR = {
  'Ready for Onboarding': { color: '#2e7d32', bg: '#e6f4ea' },
  'Not Interested': { color: '#c62828', bg: '#fdecea' },
  'Try but not done due to error': { color: '#e65100', bg: '#fff3e0' },
  'Need to visit again': { color: '#1565c0', bg: '#e3f2fd' },
};

const BADGE_MAP = {
  'Fully Verified': { bg: '#e6f4ea', color: '#2e7d32', icon: '✓' },
  'Critical Failure': { bg: '#ffebee', color: '#c62828', icon: '⚠' },
  'Partially Done': { bg: '#fff8e1', color: '#f57f17', icon: '◑' },
  'Not Verified': { bg: '#fdecea', color: '#c62828', icon: '✗' },
  'Not Found': { bg: '#f5f5f5', color: '#888', icon: '–' },
};

function formatProductDisplay(f, info) {
  const baseProduct = f.formFillingFor
    || (f.attemptedProducts?.join(', '))
    || (f.brand && f.tideProduct ? `${f.tideProduct}` : f.brand)
    || '–';

  if (baseProduct === '–') return baseProduct;
  if (baseProduct.includes('(')) return baseProduct;

  let subType = '';
  const productKey = baseProduct.toLowerCase().trim();
  const cfg = window.dynamicPointsMap?.[productKey];

  if (cfg) {
    if (cfg.type === 'mapped' && cfg.fieldMapping?.mappedColumn) {
      const col = cfg.fieldMapping.mappedColumn;
      let val = String(f[col] || '').trim();
      if (!val && info?.record) {
        val = String(info.record[col] || info.record[col.toLowerCase()] || '').trim();
      }
      if (!val && info?.checks && Array.isArray(info.checks)) {
        const match = info.checks.find(c => c.field && c.field.toLowerCase() === col.toLowerCase());
        if (match?.sheetValue) val = String(match.sheetValue).trim();
        if (!val) {
          const broader = info.checks.find(c => c.field && c.field.toLowerCase().includes(col.toLowerCase()));
          if (broader?.sheetValue) val = String(broader.sheetValue).trim();
        }
      }
      if (!val && info?.points !== undefined && Array.isArray(cfg.valueMapping)) {
        const mapped = cfg.valueMapping.find(m => Number(m.points) === Number(info.points));
        if (mapped && mapped.value) val = String(mapped.value).trim();
      }
      if (val) {
        const num = parseFloat(val);
        subType = !isNaN(num) ? `${num}` : val;
      }
    } else if (cfg.type === 'complex' && cfg.fieldMapping) {
      const planField = cfg.fieldMapping.planField || 'planName';
      const tierField = cfg.fieldMapping.tierField || 'tierName';
      const planVal = String(f[planField] || '').trim();
      const tierVal = String(f[tierField] || '').trim();
      if (planVal && tierVal) subType = `${planVal} - ${tierVal}`;
      else if (planVal) subType = planVal;
      else if (tierVal) subType = tierVal;
    }
  }

  // Generic fallback if cfg didn't catch it or wasn't loaded (specifically for Tide Insurance)
  if (!subType && productKey === 'tide insurance') {
    let val = String(f.ins_amount || f.tideIns_amount || f.amount || '').trim();
    if (!val && info?.checks && Array.isArray(info.checks)) {
      const match = info.checks.find(c => c.field && (c.field.toLowerCase() === 'amount' || c.field.toLowerCase().includes('amount') || c.field.toLowerCase().includes('plan')));
      if (match?.sheetValue) val = String(match.sheetValue).trim();
    }
    if (!val && info?.record) {
      val = String(info.record.amount || info.record.Amount || '').trim();
    }
    if (val) {
      const num = parseFloat(val);
      subType = !isNaN(num) ? `${num}` : val;
    }
  }

  let insuranceType = '';
  if (productKey === 'tide insurance' || productKey === 'insurance' || productKey.includes('insurance')) {
    const getVal = (...keys) => {
      for (const k of keys) {
        if (f?.[k]) return f[k];
        if (info?.record?.[k]) return info.record[k];
        if (info?.checks && Array.isArray(info.checks)) {
          const check = info.checks.find(c => c.field && c.field.toLowerCase() === k.toLowerCase());
          if (check?.actual || check?.sheetValue) return check.actual || check.sheetValue;
        }
      }
      return '';
    };
    insuranceType = getVal('tideIns_type', 'tideInsType', 'insurance_plan', 'ins_insuranceType', 'insuranceType', 'insurance_type');
  }

  let displayLabel = baseProduct;
  if (subType) {
    const cleanSub = String(subType).replace('₹', '');
    displayLabel += ` (₹${cleanSub})`;
  }
  if (insuranceType) {
    displayLabel += ` (${insuranceType})`;
  }
  return displayLabel;
}

export default function Dashboard() {
  const navigate = useNavigate();

  // ✅ Check for impersonation parameters first
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonationToken, setImpersonationToken] = useState(null);
  const [viewAsEmail, setViewAsEmail] = useState(null);
  const [authChecked, setAuthChecked] = useState(false); // Track if auth check is complete

  const token = isImpersonating ? impersonationToken : localStorage.getItem('token');

  const [emp, setEmp] = useState(null);
  const [allForms, setAllForms] = useState([]);
  const [verifiedMap, setVerifiedMap] = useState({});
  const [activeKPI, setActiveKPI] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selYear, setSelYear] = useState(new Date().getFullYear().toString());
  const [selMonth, setSelMonth] = useState(new Date().getMonth().toString());
  const [selProduct, setSelProduct] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [adjustment, setAdjustment] = useState(0);
  const [taskCounts, setTaskCounts] = useState({ pending: 0, completed: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [showDirectoryModal, setShowDirectoryModal] = useState(false);


  // ✅ Check for impersonation on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewAs = params.get('viewAs');
    const adminToken = params.get('adminToken') || params.get('token');

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

  // Subscribe to push notifications when profile is loaded
  useEffect(() => {
    if (token && emp && !isImpersonating) {
      subscribeUserToPush(API_BASE, token);
    }
  }, [token, emp, isImpersonating]);

  // Load dynamic points map for formatting product badges (e.g. Tide Insurance (699))
  useEffect(() => {
    fetch(`${API_BASE}/api/points-config`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.configs) {
          const map = {};
          data.configs.forEach(cfg => {
            const productKey = cfg.productName.toLowerCase().trim();
            const configData = {
              type: cfg.productType,
              fieldMapping: cfg.fieldMapping || {},
            };
            if (cfg.productType === 'simple') {
              configData.points = cfg.simplePoints;
            } else if (cfg.productType === 'complex') {
              configData.plans = {};
              (cfg.plans || []).forEach(plan => {
                const planKey = plan.planName.toLowerCase();
                configData.plans[planKey] = {};
                (plan.tiers || []).forEach(tier => {
                  const tierKey = tier.name.toLowerCase();
                  configData.plans[planKey][tierKey] = {
                    points: tier.points,
                    price: tier.price
                  };
                });
              });
            } else if (cfg.productType === 'mapped') {
              configData.valueMapping = cfg.valueMapping || [];
            }
            map[productKey] = configData;
          });
          window.dynamicPointsMap = map;
        }
      })
      .catch(console.error);
  }, []);

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
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthParam = selMonth !== '' ? `&month=${encodeURIComponent(monthNames[parseInt(selMonth)])}` : '';
    const yearParam = selYear ? `&year=${encodeURIComponent(selYear)}` : '';

    const url = isImpersonating
      ? `${API_BASE}/api/forms/my-points?viewAs=${encodeURIComponent(viewAsEmail)}${monthParam}${yearParam}`
      : `${API_BASE}/api/forms/my-points?1=1${monthParam}${yearParam}`;

    fetch(url, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json())
      .then(d => {
        console.log('📊 Backend points data:', d);
        setAdjustment(d.pointsAdjustment || 0);
        setBackendPoints(d.totalPoints);
      })
      .catch(() => { });
  }, [token, isImpersonating, viewAsEmail, selMonth, selYear]);

  // Load task counts
  const loadTaskCounts = useCallback(() => {
    fetch(`${API_BASE}/api/tasks/my-tasks/count`, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json())
      .then(data => setTaskCounts(data))
      .catch(() => { });
  }, [token]);

  useEffect(() => {
    loadTaskCounts();
    const interval = setInterval(loadTaskCounts, 10000);
    return () => clearInterval(interval);
  }, [loadTaskCounts]);
  const getVerifyKey = (f) => f._id || f.customerNumber;
  // Filtered forms
  const filtered = useMemo(() => {
    let list = allForms?.slice();
    const now = new Date();
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
        if (toDate && d > new Date(toDate + 'T23:59:59')) return false;
        return true;
      });
    }

    // Year / Month filter
    if (selYear) list = list.filter(f => new Date(f.createdAt).getFullYear() === parseInt(selYear));
    if (selMonth) list = list.filter(f => new Date(f.createdAt).getMonth() === parseInt(selMonth));

    // Product filter
    if (selProduct) {
      list = list.filter(f => {
        const info = verifiedMap[getVerifyKey(f)] || {};
        const label = formatProductDisplay(f, info);
        return label === selProduct;
      });
    }

    if (activeKPI === 'onboard') list = list.filter(f => f.status === 'Ready for Onboarding');
    if (activeKPI === 'notint') list = list.filter(f => f.status === 'Not Interested');
    if (activeKPI === 'error') list = list.filter(f => f.status === 'Try but not done due to error');
    if (activeKPI === 'revisit') list = list.filter(f => f.status === 'Need to visit again');
    if (activeKPI === 'verified') list = list.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Fully Verified');
    if (activeKPI === 'critical') list = list.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Critical Failure');
    if (activeKPI === 'partial') list = list.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Partially Done');
    if (activeKPI === 'notver') list = list.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Not Verified');
    if (activeKPI === 'phmatch') list = list.filter(f => verifiedMap[getVerifyKey(f)]?.phoneMatch === true);
    if (activeKPI === 'phnomatch') list = list.filter(f => verifiedMap[getVerifyKey(f)]?.inSheet === true && verifiedMap[getVerifyKey(f)]?.phoneMatch === false);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(f => {
        const name = (f.customerName || '').toLowerCase();
        const phone = (f.customerNumber || '').toLowerCase();
        const loc = (f.location || '').toLowerCase();
        const product = (f.formFillingFor || f.tideProduct || f.brand || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || loc.includes(q) || product.includes(q);
      });
    }

    return list;
  }, [allForms, dateFilter, fromDate, toDate, selYear, selMonth, selProduct, activeKPI, verifiedMap, searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [dateFilter, fromDate, toDate, selYear, selMonth, selProduct, activeKPI, searchQuery]);


  // Exit impersonation handler
  const handleExitImpersonation = () => {
    sessionStorage.removeItem('impersonationToken');
    sessionStorage.removeItem('viewAsEmail');
    if (window.opener && !window.opener.closed) {
      window.close();
    } else {
      const adminAppUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'https://vegavruddhi-admin-tide-bt-cyej.vercel.app';
      window.location.href = adminAppUrl;
    }
  };
  useEffect(() => {
    if (!allForms.length) {
      console.log('⚠️ No forms to verify');
      return;
    }

    // 🔥 FIX: Fallback points for sub-products stored with points=0
    const FALLBACK_PTS = { 'tide': 2, 'tide msme': 0.3, 'tide insurance': 1, 'tide credit card': 1, 'tide bt': 1 };
    const normProductForPts = (raw) => {
      const n = (raw || '').toLowerCase().trim();
      if (n.includes('tide insurance')) return 'tide insurance';
      if (n.includes('tide msme')) return 'tide msme';
      if (n.includes('tide credit card')) return 'tide credit card';
      if (n.includes('tide bt')) return 'tide bt';
      if (n.includes('tide')) return 'tide';
      return n;
    };

    // 1️⃣ Build initial verification map instantly from database fields (0 latency, 0 timeouts)
    const initialMap = {};
    let dbAutoPts = 0;
    allForms.forEach(f => {
      const vstatus = f.verificationStatus || f.verificationChecks?.status || 'Not Found';
      let vpoints = f.verificationChecks?.points ?? 0;
      // 🔥 FIX: If points=0 but Fully Verified, compute from product name
      if (vpoints === 0 && vstatus === 'Fully Verified') {
        const baseP = normProductForPts(f.formFillingFor || f.tideProduct || f.brand || '');
        vpoints = FALLBACK_PTS[baseP] || 0;
      }
      const isFound = vstatus !== 'Not Found';
      const vinfo = {
        status: vstatus,
        points: vpoints,
        phoneMatch: isFound ? true : (f.verificationChecks?.phoneMatch || false),
        inSheet: isFound ? true : (f.verificationChecks?.inSheet || false),
        ...f.verificationChecks,
        points: vpoints,  // override spread with corrected value
        status: vstatus
      };
      if (isFound) {
        vinfo.phoneMatch = true;
        vinfo.inSheet = true;
      }
      initialMap[f._id] = vinfo;
      if (f.customerNumber) initialMap[f.customerNumber] = vinfo;
      if (vstatus === 'Fully Verified') {
        dbAutoPts += vpoints;
      }
    });
    setVerifiedMap(initialMap);

    const formsToCheck = allForms.filter(f => !f.verificationStatus || f.verificationStatus === 'Not Found').slice(0, 30);
    if (formsToCheck.length === 0) {
      console.log('✅ All forms loaded with verification status from DB');
      // 🔥 FIX: Still save corrected points (sub-product fix) even when all already verified
      fetch(`${API_BASE}/api/forms/save-verified-points`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ verifiedPoints: Math.round(dbAutoPts * 10) / 10 })
      }).then(() => {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthParam = selMonth !== '' ? `&month=${encodeURIComponent(monthNames[parseInt(selMonth)])}` : '';
        const yearParam = selYear ? `&year=${encodeURIComponent(selYear)}` : '';
        const url = isImpersonating
          ? `${API_BASE}/api/forms/my-points?viewAs=${encodeURIComponent(viewAsEmail)}${monthParam}${yearParam}`
          : `${API_BASE}/api/forms/my-points?1=1${monthParam}${yearParam}`;
        return fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      }).then(r => r.json()).then(d => {
        setAdjustment(d.pointsAdjustment || 0);
        setBackendPoints(d.totalPoints || 0);
      }).catch(() => { });
      return;
    }


    console.log('🔍 Fetching verification update (POST bulk-admin):', {
      formCount: formsToCheck.length,
      endpoint: '/api/verify/bulk-admin'
    });

    // 2️⃣ Background fetch from bulk-admin to catch newly verified records
    fetch(`${API_BASE}/api/verify/bulk-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        phones: formsToCheck.map(f => f.customerNumber || ''),
        names: formsToCheck.map(f => f.customerName || ''),
        products: formsToCheck.map(f => (f.formFillingFor || f.tideProduct || f.brand || '').toLowerCase().trim()),
        months: formsToCheck.map(f => f.createdAt ? new Date(f.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : ''),
      }),
    })
      .then(r => {
        if (!r.ok) return null;
        return r.json();
      })
      .then(vm => {
        if (!vm || Object.keys(vm).length === 0) return;
        const updatedMap = { ...initialMap };
        let autoPts = 0;

        allForms.forEach(f => {
          const rawP = (f.formFillingFor || f.tideProduct || f.brand || '').toLowerCase().trim();
          const normP = rawP === 'msme' ? 'tide msme' : rawP;
          const month = f.createdAt ? new Date(f.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : '';

          const k1 = normP ? `${f.customerNumber}__${normP}__${month}` : `${f.customerNumber}__${month}`;
          const k2 = normP ? `${f.customerNumber}__${normP}` : f.customerNumber;
          const k3 = rawP ? `${f.customerNumber}__${rawP}__${month}` : `${f.customerNumber}__${month}`;
          const k4 = rawP ? `${f.customerNumber}__${rawP}` : f.customerNumber;

          const backendInfo = vm[k1] || vm[k2] || vm[k3] || vm[k4] || vm[f.customerNumber];
          if (backendInfo) {
            updatedMap[f._id] = backendInfo;
            if (f.customerNumber) updatedMap[f.customerNumber] = backendInfo;
          }

          if ((updatedMap[f._id]?.status || 'Not Found') === 'Fully Verified') {
            let pts = updatedMap[f._id]?.points || 0;
            // 🔥 FIX: If points=0 but Fully Verified, compute from product name
            if (pts === 0) {
              const baseP = normProductForPts(f.formFillingFor || f.tideProduct || f.brand || '');
              pts = FALLBACK_PTS[baseP] || 0;
              // Update map with corrected points
              if (updatedMap[f._id]) updatedMap[f._id] = { ...updatedMap[f._id], points: pts };
            }
            autoPts += pts;
          }
        });

        setVerifiedMap(updatedMap);

        // Save verified points
        fetch(`${API_BASE}/api/forms/save-verified-points`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ verifiedPoints: Math.round(autoPts * 10) / 10 })
        })
          .then(() => {
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const monthParam = selMonth !== '' ? `&month=${encodeURIComponent(monthNames[parseInt(selMonth)])}` : '';
            const yearParam = selYear ? `&year=${encodeURIComponent(selYear)}` : '';
            const url = isImpersonating
              ? `${API_BASE}/api/forms/my-points?viewAs=${encodeURIComponent(viewAsEmail)}${monthParam}${yearParam}`
              : `${API_BASE}/api/forms/my-points?1=1${monthParam}${yearParam}`;
            return fetch(url, { headers: { Authorization: 'Bearer ' + token } });
          })
          .then(r => r.json())
          .then(d => {
            setAdjustment(d.pointsAdjustment || 0);
            setBackendPoints(d.totalPoints || 0);
          })
          .catch(() => { });
      })
      .catch(() => { });
  }, [allForms.length, token, selMonth, selYear, isImpersonating, viewAsEmail]); // eslint-disable-line
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

  // Calculate total points dynamically according to selected month/period filter and search bar
  const totalPoints = useMemo(() => {
    const isCustomFiltered = searchQuery.trim() !== '' || selProduct !== '' || (dateFilter && dateFilter !== 'all') || activeKPI !== 'all';
    if (!isCustomFiltered && backendPoints !== null && backendPoints !== undefined) {
      return backendPoints;
    }
    let auto = 0;
    filtered.forEach(f => {
      if (verifiedMap[getVerifyKey(f)]?.status === 'Fully Verified') {
        auto += verifiedMap[getVerifyKey(f)]?.points || 0;
      }
    });
    const adj = (!isCustomFiltered && selMonth === '') ? adjustment : 0;
    return Math.round((auto + adj) * 10) / 10;
  }, [backendPoints, filtered, verifiedMap, adjustment, selMonth, dateFilter, searchQuery, selProduct, activeKPI]);

  const kpis = [
    { key: 'all', label: 'Total Responses', value: filtered.length, cls: 'kpi-total' },
    { key: 'onboard', label: 'Ready for Onboarding', value: filtered.filter(f => f.status === 'Ready for Onboarding').length, cls: 'kpi-onboard' },
    { key: 'notint', label: 'Not Interested', value: filtered.filter(f => f.status === 'Not Interested').length, cls: 'kpi-notint' },
    { key: 'error', label: 'Try but not done', value: filtered.filter(f => f.status === 'Try but not done due to error').length, cls: 'kpi-error' },
    { key: 'revisit', label: 'Need to visit again', value: filtered.filter(f => f.status === 'Need to visit again').length, cls: 'kpi-revisit' },
  ];

  const verifyKpis = [
    { key: 'verified', label: 'Fully Verified', value: filtered.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Fully Verified').length, cls: 'kpi-verified' },
    { key: 'critical', label: 'Critical Failure', value: filtered.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Critical Failure').length, cls: 'kpi-critical' },
    { key: 'partial', label: 'Partially Verified', value: filtered.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Partially Done').length, cls: 'kpi-error' },
    { key: 'notver', label: 'Not Verified', value: filtered.filter(f => verifiedMap[getVerifyKey(f)]?.status === 'Not Verified').length, cls: 'kpi-notint' },
    { key: 'phmatch', label: 'Phone Matched', value: filtered.filter(f => verifiedMap[getVerifyKey(f)]?.phoneMatch === true).length, cls: 'kpi-onboard' },
    { key: 'phnomatch', label: 'Phone Not Matched', value: filtered.filter(f => verifiedMap[getVerifyKey(f)]?.inSheet === true && verifiedMap[getVerifyKey(f)]?.phoneMatch === false).length, cls: 'kpi-revisit' },
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
      console.log('Points:', verifiedMap[getVerifyKey(f)]?.points);
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
        <ImpersonationBanner
          isImpersonating={isImpersonating}
          targetName={emp?.newJoinerName || viewAsEmail}
          targetEmail={viewAsEmail}
          onExit={handleExitImpersonation}
        />

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
            {emp?.employeeId && (
              <div style={{ marginTop: 4, display: 'inline-block', background: 'rgba(255,255,255,0.2)', borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', border: '1px solid rgba(255,255,255,0.3)' }}>
                🪪 {emp.employeeId}
              </div>
            )}
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
            { icon: '💼', label: 'Position', value: emp?.position },
            { icon: '📍', label: 'Location', value: emp?.location },
            { icon: '👤', label: 'Reporting Manager', value: emp?.reportingManager },
            { icon: '●', label: 'Status', value: emp?.status },
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
        <div onClick={() => setShowDirectoryModal(true)} className="action-card" style={{ cursor: 'pointer', marginTop: 12 }}>
          <div className="action-icon">🏢</div>
          <div className="action-text">
            <div className="action-title">Global Merchant Check</div>
            <div className="action-sub">Verify shop name or phone before visit to avoid filling duplicate forms</div>
          </div>
          <div className="action-arrow">›</div>
        </div>

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
                {[2026, 2025, 2024, 2023, 2022, 2021].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#40916c', fontSize: 12 }}>▼</span>
            </div>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <span style={{ position: 'absolute', top: -9, left: 10, fontSize: 11, color: '#40916c', background: '#fff', padding: '0 4px', fontWeight: 600, zIndex: 1, pointerEvents: 'none' }}>Month</span>
              <select value={selMonth} onChange={e => setSelMonth(e.target.value)}
                style={{ padding: '10px 32px 10px 12px', borderRadius: 10, border: '1.5px solid #40916c', fontSize: 14, color: selMonth !== '' ? '#1a4731' : '#888', background: '#fff', cursor: 'pointer', appearance: 'none', minWidth: 130, outline: 'none' }}>
                <option value="">All Months</option>
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                  <option key={i} value={i.toString()}>{m}</option>
                ))}
              </select>
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#40916c', fontSize: 12 }}>▼</span>
            </div>
          </div>
        </div>

        {/* Product filter chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, marginTop: 4 }}>
          {(() => {
            const productSet = new Set();

            allForms.forEach(f => {
              if (selMonth !== '') {
                const formDate = new Date(f.createdAt);
                if (formDate.getMonth() !== parseInt(selMonth)) return;
              }
              if (selYear) {
                const formDate = new Date(f.createdAt);
                if (formDate.getFullYear() !== parseInt(selYear)) return;
              }

              const info = verifiedMap[getVerifyKey(f)] || {};
              if (info.status === 'Fully Verified') {
                const label = formatProductDisplay(f, info);
                if (label && label !== '–') productSet.add(label);
              }
            });

            const baseProducts = ['Tide', 'Tide Insurance', 'Tide MSME', 'Tide Credit Card'];
            baseProducts.forEach(p => productSet.add(p));

            const products = Array.from(productSet).sort();
            const counts = {};

            products.forEach(p => {
              counts[p] = allForms.filter(f => {
                if (selMonth !== '') {
                  const formDate = new Date(f.createdAt);
                  if (formDate.getMonth() !== parseInt(selMonth)) return false;
                }
                if (selYear) {
                  const formDate = new Date(f.createdAt);
                  if (formDate.getFullYear() !== parseInt(selYear)) return false;
                }

                const info = verifiedMap[getVerifyKey(f)] || {};
                const label = formatProductDisplay(f, info);
                return label === p && info?.status === 'Fully Verified';
              }).length;
            });

            const visibleProducts = products.filter(p => counts[p] > 0 || (baseProducts.includes(p) && p !== 'Tide Insurance'));

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
                {visibleProducts.map(p => (
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

        {/* Search Bar */}
        <div style={{ marginBottom: 16, position: 'relative' }}>
          <input
            type="text"
            placeholder="🔍 Search by merchant name, phone number, location or product..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 36px 12px 16px',
              borderRadius: '12px',
              border: '1.5px solid #c8e6c9',
              fontSize: '14px',
              outline: 'none',
              background: '#fff',
              boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
              transition: 'border-color 0.2s'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: '#888',
                fontSize: '16px',
                cursor: 'pointer'
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Merchant count */}
        {filtered.length > 0 && (
          <div className="merchants-count">{filtered.length} merchant{filtered.length !== 1 ? 's' : ''} found</div>
        )}

        {/* Merchant list */}
        {(() => {
          if (allForms.length === 0) {
            return <div className="merchants-empty">No merchant visits yet. Fill your first form above.</div>;
          }
          if (filtered.length === 0) {
            return <div className="merchants-empty">No merchants found.</div>;
          }

          const pageSize = 10;
          const totalPages = Math.ceil(filtered.length / pageSize) || 1;
          const currentPage = Math.min(page, totalPages);
          const paginatedList = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

          return (
            <>
              {paginatedList.map(f => {
                const info = verifiedMap[getVerifyKey(f)] || {};
                const vstatus = info.status || 'Not Found';
                const b = BADGE_MAP[vstatus] || BADGE_MAP['Not Found'];
                const sc = STATUS_COLOR[f.status] || { color: '#333', bg: '#f5f5f5' };
                const product = formatProductDisplay(f, info);
                const date = new Date(f.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                const pts = (info.status === 'Fully Verified') ? (info.points || null) : null;

                return (
                  <div key={f._id} style={{ marginBottom: '12px', position: 'relative' }}>
                    <Link to={`/merchant/${f._id}`} className="merchant-row" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="mr-avatar">{f.customerName.charAt(0).toUpperCase()}</div>
                      <div className="mr-info" style={{ flex: 1 }}>
                        <div className="mr-name">{f.customerName}</div>
                        <div className="mr-badges">
                          {vstatus === 'Not Found' ? (
                            <span className="phone-match-badge notfound">📞 Not in Sheet</span>
                          ) : (
                            <span className={`phone-match-badge ${(info.phoneMatch !== false || vstatus === 'Fully Verified') ? 'match' : 'mismatch'}`}>
                              📞 {(info.phoneMatch !== false || vstatus === 'Fully Verified') ? 'Number Matched' : 'Number Mismatch'}
                            </span>
                          )}
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
                      <div className="mr-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span className="mr-status" style={{ color: sc.color, background: sc.bg }}>{f.status}</span>
                        <div className="mr-date">{date}</div>
                      </div>
                    </Link>
                    {/* Timeline icon - outside Link, positioned absolutely on the right */}
                    {(f.brand === 'Tide' && f.tideProduct === 'Tide') && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute',
                          top: '12px',
                          right: '12px',
                          zIndex: 10
                        }}
                      >
                        <TideMerchantTimeline phone={f.customerNumber} customerName={f.customerName} />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Pagination Bar */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#fbfbfb', border: '1.5px solid #e0e0e0', borderRadius: '12px', marginTop: '16px' }}>
                  <span style={{ fontSize: '13px', color: '#555', fontWeight: 600 }}>
                    Showing {Math.min((currentPage - 1) * pageSize + 1, filtered.length)} - {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} forms
                  </span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      disabled={currentPage <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      style={{ padding: '6px 14px', borderRadius: '8px', border: '1.5px solid #dde8dd', background: currentPage <= 1 ? '#f5f5f5' : '#fff', color: currentPage <= 1 ? '#aaa' : '#1b4332', fontWeight: 700, fontSize: '13px', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}
                    >
                      Previous
                    </button>
                    <span style={{ fontWeight: 800, fontSize: '13px', color: '#1b4332', padding: '0 6px' }}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      style={{ padding: '6px 14px', borderRadius: '8px', border: '1.5px solid #dde8dd', background: currentPage >= totalPages ? '#f5f5f5' : '#fff', color: currentPage >= totalPages ? '#aaa' : '#1b4332', fontWeight: 700, fontSize: '13px', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <MerchantDirectoryModal
        isOpen={showDirectoryModal}
        onClose={() => setShowDirectoryModal(false)}
        token={token}
      />

      <Footer />
    </>
  );
}
