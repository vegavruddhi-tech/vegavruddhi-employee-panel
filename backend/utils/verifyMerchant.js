/**
 * verifyMerchant.js (WITH EXACT PRODUCT MATCHING ONLY)
 */

const PHONE_COLS = [
  'Mobile_No_', 'Mobile_Number', 'Phone_Number', 'Number',
  'phone', 'Phone', 'Mobile', 'mobile', 'Contact',
  'Customer_Number', 'Merchant_Number', 'Mobile_No',
  'mobile_no_', 'mobile_number', 'phone_number', 'number',
  'contact', 'customer_number', 'merchant_number', 'mobile_no'
];

const NAME_COLS = [
  'Lead', 'lead', 'Name', 'name', 'Member_Name',
  'All_Onboarding_Businesses_Member_Full_Name__RED_',
  'Customer', 'Merchant'
];

// ---------- HELPERS ----------
const normalize = (s) => String(s || '').toLowerCase().trim();
const normalizeProduct = (p) => {
  let val = (p || '').toLowerCase().trim();
  if (val === 'msme') val = 'tide msme';
  return val;
};
// ---------- PHONE ----------
function phoneVariants(phone) {
  const raw = typeof phone === 'number' ? Math.round(phone).toString() : String(phone);
  const digits = raw.replace(/\D/g, '');

  const set = new Set();
  // 10-digit variants
  set.add(digits);
  set.add(parseFloat(digits));
  set.add(Number(digits));

  if (!digits.startsWith('91') && digits.length === 10) {
    // add 91 prefix variants — string, number, and float
    set.add('91' + digits);
    set.add(Number('91' + digits));
    set.add(parseFloat('91' + digits));
    // also add as integer string (some sheets store as "9.17480045353E9")
    set.add(String(Number('91' + digits)));
  }
  if (digits.startsWith('91') && digits.length === 12) {
    // strip 91 prefix variants
    set.add(digits.slice(2));
    set.add(Number(digits.slice(2)));
    set.add(parseFloat(digits.slice(2)));
    set.add(String(Number(digits.slice(2))));
  }
  return [...set];
}

function exactPhoneQuery(phone) {
  const variants = phoneVariants(phone);
  return { $or: PHONE_COLS.flatMap(col => variants.map(v => ({ [col]: v }))) };
}

// ---------- FIND ----------
const indexedCollections = new Set();

async function findInCollection(collection, phone, name, strictPhone = false, merchantMap = null) {
  // 🔥 SOLUTION 3: Check True In-Memory Map first! (0 DB calls, instant lookup)
  if (merchantMap) {
    const variants = phoneVariants(phone);
    for (const v of variants) {
      const key = `${collection.collectionName}__${String(v).trim()}`;
      if (merchantMap.has(key)) {
        return { record: merchantMap.get(key), matchType: 'exact' };
      }
    }
  }

  // 🔥 AUTO-CREATE INDEXES TO PREVENT 30-SECOND QUERY DELAYS
  // Python script drops collections frequently when syncing, stripping all indexes.
  // We dynamically recreate them in the background so the Details API is instant.
  if (!indexedCollections.has(collection.collectionName)) {
    indexedCollections.add(collection.collectionName);
    Promise.all(PHONE_COLS.map(col => 
      collection.createIndex({ [col]: 1 }, { background: true, sparse: true })
        .catch(() => {}) // Ignore errors if column doesn't exist
    ));
  }

  let records = await collection.find(exactPhoneQuery(phone)).toArray();
  if (records.length > 0) return { record: records[0], matchType: 'exact' };

  return { record: null, matchType: null };
}

// ---------- CONDITION ----------
function parseRecordDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();
  if (!s || s === '0' || s === 'N/A' || s === 'null' || s === 'None' || s === 'undefined') return null;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const parts = s.slice(0, 10).split('-');
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function evaluateCondition(record, condition) {
  let rawVal = record[condition.field];

  // 🔥 Smart Fallback for date_difference_days (Intent to Approval gap)
  if ((condition.field === 'date_difference_days' || condition.field === 'date_difference') &&
      (rawVal === undefined || rawVal === null || rawVal === '' || isNaN(Number(rawVal)))) {
    const intentVal = record.intent_date || record['Intent Date'] || record['intentDate'];
    const approvedVal = record.approved_date || record['Approved Date'] || record['approvedDate'];
    if (intentVal && approvedVal) {
      const dIntent = parseRecordDate(intentVal);
      const dApproved = parseRecordDate(approvedVal);
      if (dIntent && dApproved) {
        const diffMs = dApproved.getTime() - dIntent.getTime();
        rawVal = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      }
    }
  }

  // 🔥 Display Only / Informational condition (e.g. CIBIL score display only)
  const isDisplayOnly = Boolean(
    condition.isDisplayOnly ||
    condition.displayOnly ||
    condition.isOptional ||
    condition.optional ||
    /cibil/i.test(condition.field || '') ||
    /cibil/i.test(condition.label || '') ||
    /bank.*transfer/i.test(condition.field || '') ||
    /bank.*transfer/i.test(condition.label || '')
  );

  if (isDisplayOnly) {
    const hasVal = rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '' && String(rawVal).trim() !== 'N/A' && String(rawVal).trim() !== '-';
    return {
      pass: true,
      label: condition.label,
      actual: hasVal ? String(rawVal).trim() : '0',
      field: condition.field,
      sheetValue: rawVal ?? '',
      operator: condition.operator,
      expected: condition.value,
      isDisplayOnly: true
    };
  }

  if (rawVal === undefined || rawVal === null || rawVal === '') {
    return { 
      pass: false, 
      label: condition.label, 
      actual: 'N/A',
      field: condition.field,        // ✅ ADD: Exact field name from rule
      sheetValue: null,              // ✅ ADD: Actual value from sheet (null if missing)
      operator: condition.operator,  // ✅ ADD: Operator used
      expected: condition.value      // ✅ ADD: Expected value
    };
  }

  const actual   = normalize(rawVal);
  const expected = normalize(condition.value);

  let pass = false;

  switch (condition.operator) {
    case 'equals': pass = actual === expected; break;
    case 'not_equals': pass = actual !== expected; break;
    case 'gte': pass = parseFloat(rawVal) >= parseFloat(condition.value); break;
    case 'lte': pass = parseFloat(rawVal) <= parseFloat(condition.value); break;
    case 'contains': pass = actual.includes(expected); break;
    case 'exists': pass = !!rawVal; break;
    default: pass = false;
  }

  return { 
    pass, 
    label: condition.label, 
    actual: String(rawVal),
    field: condition.field,        // ✅ ADD: Exact field name from rule
    sheetValue: rawVal,            // ✅ ADD: Actual value from sheet (raw, not normalized)
    operator: condition.operator,  // ✅ ADD: Operator used
    expected: condition.value      // ✅ ADD: Expected value
  };
}

// ---------- CHECK MANUAL VERIFICATION ----------
async function checkManualVerification(phone, product, month, manualVerificationsMap = null) {
  try {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const cleanProduct = normalizeProduct(product);
    const cleanMonth = month ? normalize(month) : null;

    if (manualVerificationsMap) {
      const keyExact = cleanMonth ? `${cleanPhone}__${cleanProduct}__${cleanMonth}` : null;
      const keyAny = `${cleanPhone}__${cleanProduct}`;
      const manualVerification = (keyExact && manualVerificationsMap.get(keyExact)) || manualVerificationsMap.get(keyAny);
      if (manualVerification) {
        return {
          status: manualVerification.status,
          verified: manualVerification.status === 'Fully Verified',
          passed: manualVerification.status === 'Fully Verified' ? 1 : 0,
          total: 1,
          checks: [{
            pass: manualVerification.status === 'Fully Verified',
            label: 'Manual Verification',
            actual: `Verified by ${manualVerification.verifiedBy || 'Admin'}`
          }],
          collection: 'manual_verification',
          matchType: 'manual',
          manualVerification: true,
          verifiedBy: manualVerification.verifiedBy || 'Admin',
          verifiedAt: manualVerification.createdAt
        };
      }
      return null;
    }

    const ManualVerification = require('../models/ManualVerification');
    
    // Build query for manual verification
    const query = {
      phone: cleanPhone, // Normalize phone
      product: cleanProduct
    };
    
    // Add month filter if provided
    if (cleanMonth) {
      query.month = cleanMonth;
    }
    
    const manualVerification = await ManualVerification.findOne(query).sort({ createdAt: -1 });
    
    if (manualVerification) {
      return {
        status: manualVerification.status,
        verified: manualVerification.status === 'Fully Verified',
        passed: manualVerification.status === 'Fully Verified' ? 1 : 0,
        total: 1,
        checks: [{
          pass: manualVerification.status === 'Fully Verified',
          label: 'Manual Verification',
          actual: `Verified by ${manualVerification.verifiedBy}`
        }],
        collection: 'manual_verification',
        matchType: 'manual',
        manualVerification: true,
        verifiedBy: manualVerification.verifiedBy,
        verifiedAt: manualVerification.createdAt
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error checking manual verification:', error);
    return null;
  }
}

// ---------- VERIFY (WITH EXACT PRODUCT MATCHING ONLY) ----------
async function verifyMerchant(db, phone, name, VerificationRule, product, month, ruleCache = null, merchantMap = null, manualVerificationsMap = null) {

  // ✅ FIRST: Check for manual verification override
  const manualResult = await checkManualVerification(phone, product, month, manualVerificationsMap);
  if (manualResult) {
    return manualResult;
  }

  // ✅ Use cached rules if provided, otherwise fetch from database
  const allRulesRaw = ruleCache 
    ? ruleCache.filter(r => r.active !== false)
    : await VerificationRule.find({ active: true });

  const allRules = month
    ? allRulesRaw.filter(r => {
        const rM = normalize(r.monthLabel);
        const qM = normalize(month);
        if (!rM || !qM) return true;
        return rM === qM || rM.includes(qM) || qM.includes(rM) || (rM.split(' ')[0] && rM.split(' ')[0] === qM.split(' ')[0]);
      })
    : allRulesRaw;

  // ✅ Filter rules by product with EXACT matching (case-insensitive)
  // - Only exact matches work: "tide" = "Tide", "tide msme" = "Tide MSME"
  // - No partial matching: "tide" does NOT match "Tide BT" or "Tide Credit Card"
  // - To match variations, add them explicitly to productTypes in the rule
  const hinted = product
    ? allRules.filter(r =>
        !r.productTypes || 
        r.productTypes.length === 0 ||
        r.productTypes.some(p => {
          const ruleProduct = normalizeProduct(p);
          const searchProduct = normalizeProduct(product);
          
          // EXACT match only (case-insensitive)
          return ruleProduct === searchProduct;
        })
      )
    : allRules;

  // Don't return "Not Found" immediately - let it try to verify with available rules

  const orderedRules = hinted;

  for (const rule of orderedRules) {

    const col = db.collection(rule.collectionName);

    const { record, matchType } = await findInCollection(
      col,
      phone,
      name || '',
      true,
      merchantMap
    );

    if (!record) continue;

    if (!rule.conditions || rule.conditions.length === 0) {
      return { status: 'Not Verified', verified: false };
    }

    const checks = rule.conditions.map(cond => evaluateCondition(record, cond));
    const passed = checks.filter(c => c.pass).length;
    const total  = checks.length;

    // Display-only conditions never block 'Fully Verified'
    const isConditionDisplayOnly = (c) => Boolean(
      c.isDisplayOnly || c.displayOnly || c.isOptional || c.optional ||
      /cibil/i.test(c.field || '') || /cibil/i.test(c.label || '') ||
      /bank.*transfer/i.test(c.field || '') || /bank.*transfer/i.test(c.label || '')
    );
    const requiredConditions = rule.conditions.filter(c => !isConditionDisplayOnly(c));
    const requiredChecks = checks.filter((c, i) => !isConditionDisplayOnly(rule.conditions[i]));
    const requiredPassed = requiredChecks.filter(c => c.pass).length;
    const requiredTotal = requiredChecks.length;

    // ✅ Check for critical condition failures
    const criticalConditions = rule.conditions.filter(c => c.isCritical);
    const criticalChecks = checks.filter((c, i) => rule.conditions[i].isCritical);
    const criticalFailed = criticalChecks.filter(c => !c.pass);
    const hasCriticalFailure = criticalFailed.length > 0;

    const status =
      hasCriticalFailure ? 'Critical Failure' :
      requiredPassed === requiredTotal ? 'Fully Verified' :
      requiredPassed > 0 ? 'Partially Done' :
                           'Not Verified';

    return {
      status,
      verified: requiredPassed === requiredTotal && !hasCriticalFailure,
      passed,
      total,
      checks,
      collection: rule.collectionName,
      matchType,
      hasCriticalFailure,
      criticalFailed: criticalFailed.map((c, i) => ({
        ...c,
        field: criticalConditions[criticalChecks.indexOf(c)]?.field,
        label: c.label
      })),
      record: record || null
    };
  }

  return { status: 'Not Found', verified: false };
}

// ---------- CROSS CHECK (WITH EXACT PRODUCT MATCHING ONLY) ----------
async function crossCheckPhone(db, phone, name, VerificationRule, product, month, ruleCache = null, merchantMap = null, manualVerificationsMap = null) {

  // ✅ FIRST: Check for manual verification override
  const manualResult = await checkManualVerification(phone, product, month, manualVerificationsMap);
  if (manualResult) {
    return { matched: true, phoneMatch: true, manualVerification: true };
  }

  // ✅ Use cached rules if provided, otherwise fetch from database
  const allRulesRaw = ruleCache 
    ? ruleCache.filter(r => r.active !== false)
    : await VerificationRule.find({ active: true });

  const allRules = month
    ? allRulesRaw.filter(r => {
        const rM = normalize(r.monthLabel);
        const qM = normalize(month);
        if (!rM || !qM) return true;
        return rM === qM || rM.includes(qM) || qM.includes(rM) || (rM.split(' ')[0] && rM.split(' ')[0] === qM.split(' ')[0]);
      })
    : allRulesRaw;

  // ✅ Filter rules by product with EXACT matching (case-insensitive)
  // - Only exact matches work: "tide" = "Tide", "tide msme" = "Tide MSME"
  // - No partial matching: "tide" does NOT match "Tide BT" or "Tide Credit Card"
  // - To match variations, add them explicitly to productTypes in the rule
  const hinted = product
    ? allRules.filter(r =>
        !r.productTypes || 
        r.productTypes.length === 0 ||
        r.productTypes.some(p => {
          const ruleProduct = normalizeProduct(p);
          const searchProduct = normalizeProduct(product);
          
          // EXACT match only (case-insensitive)
          return ruleProduct === searchProduct;
        })
      )
    : allRules;

  // Don't return "not matched" immediately - let it try to verify with available rules

  const orderedRules = hinted;

  for (const rule of orderedRules) {

    const col = db.collection(rule.collectionName);

    const { record } = await findInCollection(
      col,
      phone,
      name || '',
      true,
      merchantMap
    );

    if (!record) continue;

    return { matched: true, phoneMatch: true };
  }

  return { matched: false, phoneMatch: false };
}

module.exports = { verifyMerchant, crossCheckPhone };
