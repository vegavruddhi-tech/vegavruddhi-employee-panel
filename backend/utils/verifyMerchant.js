/**
 * verifyMerchant.js (WITH MANUAL VERIFICATION SUPPORT)
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
  const val = (p || '').toLowerCase().trim();
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
async function findInCollection(collection, phone, name, strictPhone = false) {
  let records = await collection.find(exactPhoneQuery(phone)).toArray();
  if (records.length > 0) return { record: records[0], matchType: 'exact' };

  return { record: null, matchType: null };
}

// ---------- CONDITION ----------
function evaluateCondition(record, condition) {
  const rawVal = record[condition.field];

  if (rawVal === undefined || rawVal === null || rawVal === '') {
    return { pass: false, label: condition.label, actual: 'N/A' };
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

  return { pass, label: condition.label, actual: String(rawVal) };
}

// ---------- CHECK MANUAL VERIFICATION ----------
async function checkManualVerification(phone, product, month) {
  try {
    const ManualVerification = require('../models/ManualVerification');
    
    // Build query for manual verification
    const query = {
      phone: String(phone).replace(/\D/g, ''), // Normalize phone
      product: normalizeProduct(product)
    };
    
    // Add month filter if provided
    if (month) {
      query.month = normalize(month);
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

// ---------- VERIFY (OPTIMIZED WITH MANUAL VERIFICATION SUPPORT) ----------
async function verifyMerchant(db, phone, name, VerificationRule, product, month, ruleCache = null) {

  // ✅ FIRST: Check for manual verification override
  const manualResult = await checkManualVerification(phone, product, month);
  if (manualResult) {
    return manualResult;
  }

  // ✅ Use cached rules if provided, otherwise fetch from database
  const allRulesRaw = ruleCache 
    ? ruleCache.filter(r => r.active !== false)
    : await VerificationRule.find({ active: true });

  const allRules = month
    ? allRulesRaw.filter(r => normalize(r.monthLabel) === normalize(month))
    : allRulesRaw;

  // ✅ FIXED PRODUCT MATCH - Return "Not Found" if no rule exists for this product
const hinted = product
  ? allRules.filter(r =>
      r.productTypes &&
      r.productTypes.some(p =>
        normalizeProduct(product) === normalizeProduct(p)
      )
    )
  : [];

  // If product specified but no matching rules found, return Not Found immediately
  if (product && hinted.length === 0) {
    return { status: 'Not Found', verified: false };
  }

  const orderedRules = hinted.length > 0 ? hinted : allRules;

  for (const rule of orderedRules) {

    const col = db.collection(rule.collectionName);

    const { record, matchType } = await findInCollection(
      col,
      phone,
      name || '',
      true
    );

    if (!record) continue;

    if (!rule.conditions || rule.conditions.length === 0) {
      return { status: 'Not Verified', verified: false };
    }

    const checks = rule.conditions.map(cond => evaluateCondition(record, cond));
    const passed = checks.filter(c => c.pass).length;
    const total  = checks.length;

    const status =
      passed === total ? 'Fully Verified' :
      passed > 0       ? 'Partially Done' :
                         'Not Verified';

    return {
      status,
      verified: passed === total,
      passed,
      total,
      checks,
      collection: rule.collectionName,
      matchType
    };
  }

  return { status: 'Not Found', verified: false };
}

// ---------- CROSS CHECK (WITH MANUAL VERIFICATION SUPPORT) ----------
async function crossCheckPhone(db, phone, name, VerificationRule, product, month, ruleCache = null) {

  // ✅ FIRST: Check for manual verification override
  const manualResult = await checkManualVerification(phone, product, month);
  if (manualResult) {
    return { matched: true, phoneMatch: true, manualVerification: true };
  }

  // ✅ Use cached rules if provided, otherwise fetch from database
  const allRulesRaw = ruleCache 
    ? ruleCache.filter(r => r.active !== false)
    : await VerificationRule.find({ active: true });

  const allRules = month
    ? allRulesRaw.filter(r => normalize(r.monthLabel) === normalize(month))
    : allRulesRaw;

  // ✅ SAME FIX HERE ALSO - Return "Not Found" if no rule exists for this product
const hinted = product
  ? allRules.filter(r =>
      r.productTypes &&
      r.productTypes.some(p =>
        normalizeProduct(product) === normalizeProduct(p)
      )
    )
  : [];

  // If product specified but no matching rules found, return not matched immediately
  if (product && hinted.length === 0) {
    return { matched: false, phoneMatch: false };
  }

  const orderedRules = hinted.length > 0 ? hinted : allRules;

  for (const rule of orderedRules) {

    const col = db.collection(rule.collectionName);

    const { record } = await findInCollection(
      col,
      phone,
      name || '',
      true
    );

    if (!record) continue;

    return { matched: true, phoneMatch: true };
  }

  return { matched: false, phoneMatch: false };
}

module.exports = { verifyMerchant, crossCheckPhone };