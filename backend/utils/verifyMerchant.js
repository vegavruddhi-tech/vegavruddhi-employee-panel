/**
 * verifyMerchant.js (FINAL FIXED VERSION)
 */

const PHONE_COLS = [
  'Mobile_No_', 'Mobile_Number', 'Phone_Number', 'Number',
  'phone', 'Phone', 'Mobile', 'mobile', 'Contact',
  'Customer_Number', 'Merchant_Number', 'Mobile_No'
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

  if (val.includes('msme')) return 'msme';
  if (val.includes('insurance')) return 'insurance';
  if (val.includes('credit')) return 'credit card';
  if (val.includes('tide')) return 'tide';

  return val;
};
// ---------- PHONE ----------
function phoneVariants(phone) {
  const raw = typeof phone === 'number' ? Math.round(phone).toString() : String(phone);
  const digits = raw.replace(/\D/g, '');

  const set = new Set();
  set.add(digits);
  set.add(parseFloat(digits));
  set.add(Number(digits));

  if (!digits.startsWith('91') && digits.length === 10) {
    set.add('91' + digits);
    set.add(Number('91' + digits));
  }
  if (digits.startsWith('91') && digits.length === 12) {
    set.add(digits.slice(2));
    set.add(Number(digits.slice(2)));
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

// ---------- VERIFY ----------
async function verifyMerchant(db, phone, name, VerificationRule, product, month) {

  const allRulesRaw = await VerificationRule.find({ active: true });

  const allRules = month
    ? allRulesRaw.filter(r => normalize(r.monthLabel) === normalize(month))
    : allRulesRaw;

  // ✅ FIXED PRODUCT MATCH
const hinted = product
  ? allRules.filter(r =>
      r.productTypes &&
      r.productTypes.some(p =>
        normalizeProduct(product) === normalizeProduct(p)
      )
    )
  : [];

  const orderedRules = hinted.length > 0 ? hinted : [];

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
    console.log("PHONE:", phone);
    console.log("PRODUCT:", product);
    console.log("RECORD:", record);
    console.log("CHECKS:", checks);
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

// ---------- CROSS CHECK ----------
async function crossCheckPhone(db, phone, name, VerificationRule, product, month) {

  const allRulesRaw = await VerificationRule.find({ active: true });

  const allRules = month
    ? allRulesRaw.filter(r => normalize(r.monthLabel) === normalize(month))
    : allRulesRaw;

  // ✅ SAME FIX HERE ALSO
const hinted = product
  ? allRules.filter(r =>
      r.productTypes &&
      r.productTypes.some(p =>
        normalizeProduct(product) === normalizeProduct(p)
      )
    )
  : [];

  const orderedRules = hinted.length > 0 ? hinted : [];

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