/**
 * verifyMerchant.js
 *
 * Logic:
 * 1. Use product as a HINT to search matching collections first
 * 2. If phone not found in hinted collections → search ALL collections
 * 3. Once phone is found → use that collection's rule to evaluate conditions
 * 4. Conditions are defined by admin per collection in VerificationRules
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

// All phone variants: string + number, with/without 91
function phoneVariants(phone) {
  const digits = String(phone).replace(/\D/g, '');
  const set = new Set();
  set.add(digits);
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

function last10Query(phone) {
  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  return { $or: PHONE_COLS.flatMap(col => [
    { [col]: { $regex: last10 + '$' } },
    { [col]: Number('91' + last10) },
    { [col]: Number(last10) },
  ])};
}

function last8Query(phone) {
  const last8 = String(phone).replace(/\D/g, '').slice(-8);
  return { $or: PHONE_COLS.map(col => ({ [col]: { $regex: last8 + '$' } })) };
}

function nameQuery(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { $or: NAME_COLS.map(col => ({ [col]: { $regex: new RegExp(escaped, 'i') } })) };
}

// Find record in a single collection using tiered matching
// When strictPhone=true, skip name fallback (used for hinted collections)
// When multiple records found, pick the one with highest QR_Load_Amount or Stage-3 (most complete data)
async function findInCollection(collection, phone, name, strictPhone = false) {
  // Helper to pick best record from multiple matches
  const pickBest = (records) => {
    if (!records || records.length === 0) return null;
    if (records.length === 1) return records[0];
    // Sort by QR_Load_Amount desc, then Stage-3 desc — pick most complete record
    return records.sort((a, b) => {
      const aScore = (parseFloat(a.QR_Load_Amount) || 0) + (parseFloat(a['Stage-3']) || 0);
      const bScore = (parseFloat(b.QR_Load_Amount) || 0) + (parseFloat(b['Stage-3']) || 0);
      return bScore - aScore;
    })[0];
  };

  let records = await collection.find(exactPhoneQuery(phone)).toArray();
  if (records.length > 0) return { record: pickBest(records), matchType: 'exact' };

  const digits = String(phone).replace(/\D/g, '');
  if (digits.length >= 10) {
    records = await collection.find(last10Query(phone)).toArray();
    if (records.length > 0) return { record: pickBest(records), matchType: 'exact' };
  }
  if (digits.length >= 8) {
    records = await collection.find(last8Query(phone)).toArray();
    if (records.length > 0) return { record: pickBest(records), matchType: 'fuzzy_phone' };
  }
  if (!strictPhone && name && name.trim().length > 2) {
    records = await collection.find(nameQuery(name.trim())).toArray();
    if (records.length > 0) return { record: pickBest(records), matchType: 'name' };
  }
  return { record: null, matchType: null };
}

// Evaluate a single condition against a record
function evaluateCondition(record, condition) {
  const rawVal = record[condition.field];
  if (rawVal === undefined || rawVal === null || rawVal === '') {
    return { pass: false, label: condition.label, actual: 'N/A' };
  }
  const actual   = String(rawVal).trim().toLowerCase();
  const expected = String(condition.value).trim().toLowerCase();

  // Multiple values (OR logic) — used when condition.values has entries
  const multiValues = (condition.values || []).filter(v => v && v.trim());

  let pass = false;
  switch (condition.operator) {
    case 'equals':
      if (multiValues.length > 0) {
        // OR: actual matches any of the values
        pass = multiValues.some(v => actual === v.trim().toLowerCase());
      } else {
        pass = actual === expected;
      }
      break;
    case 'in':
      // Explicit OR operator
      pass = multiValues.length > 0
        ? multiValues.some(v => actual === v.trim().toLowerCase())
        : actual === expected;
      break;
    case 'not_equals': pass = actual !== expected; break;
    case 'gte':        pass = parseFloat(rawVal) >= parseFloat(condition.value); break;
    case 'lte':        pass = parseFloat(rawVal) <= parseFloat(condition.value); break;
    case 'contains':   pass = actual.includes(expected); break;
    case 'exists':     pass = rawVal !== '' && rawVal !== null && rawVal !== undefined; break;
    default:           pass = false;
  }
  return { pass, label: condition.label, actual: String(rawVal) };
}

/**
 * Main verification:
 * 1. Sort rules — product-matching rules first (hint), then all others
 * 2. Search phone in each rule's collection in that order
 * 3. First collection where phone is found → evaluate its conditions
 * 4. If phone not found anywhere → Not Found
 */
async function verifyMerchant(db, phone, name, VerificationRule, product) {
  const allRules = await VerificationRule.find({ active: true });

  const hintedIds = product
    ? allRules.filter(r => r.productTypes && r.productTypes.some(p => p.toLowerCase() === product.toLowerCase())).map(r => String(r._id))
    : [];
  const hinted = allRules.filter(r => hintedIds.includes(String(r._id)));
  const rest    = allRules.filter(r => !hintedIds.includes(String(r._id)));
  const orderedRules = [...hinted, ...rest];

  for (const rule of orderedRules) {
    const col = db.collection(rule.collectionName);
    const isHinted = hintedIds.includes(String(rule._id));
    const { record, matchType } = await findInCollection(col, phone, name || '', isHinted);
    if (!record) continue;

    // Found the record — evaluate this rule's conditions
    const checks  = rule.conditions.map(cond => evaluateCondition(record, cond));
    const passed  = checks.filter(c => c.pass).length;
    const total   = checks.length;
    const status  = passed === total ? 'Fully Verified'
                  : passed > 0       ? 'Partially Done'
                  :                    'Not Verified';

    const sheetPhone = String(PHONE_COLS.map(c => record[c]).find(v => v != null) || '');
    const sheetName  = NAME_COLS.map(c => record[c]).find(v => v) || '';

    return {
      status, verified: passed === total,
      passed, total, checks,
      collection: rule.collectionName,
      monthLabel: rule.monthLabel,
      matchType, sheetPhone, sheetName
    };
  }

  return { status: 'Not Found', verified: false, passed: 0, total: 0, checks: [], matchType: null };
}

/**
 * Phone cross-check — same search logic, just returns match info
 */
async function crossCheckPhone(db, phone, name, VerificationRule, product) {
  const allRules = await VerificationRule.find({ active: true });
  const hintedIds = product
    ? allRules.filter(r => r.productTypes && r.productTypes.some(p => p.toLowerCase() === product.toLowerCase())).map(r => String(r._id))
    : [];
  const hinted = allRules.filter(r => hintedIds.includes(String(r._id)));
  const rest    = allRules.filter(r => !hintedIds.includes(String(r._id)));
  const orderedRules = [...hinted, ...rest];

  for (const rule of orderedRules) {
    const col = db.collection(rule.collectionName);
    const isHinted = hintedIds.includes(String(rule._id));
    const { record, matchType } = await findInCollection(col, phone, name || '', isHinted);
    if (!record) continue;

    const sheetPhone = String(PHONE_COLS.map(c => record[c]).find(v => v != null) || '');
    const sheetName  = NAME_COLS.map(c => record[c]).find(v => v) || '–';
    const formLast10  = String(phone).replace(/\D/g,'').slice(-10);
    const sheetLast10 = sheetPhone.replace(/\D/g,'').slice(-10);

    return {
      matched: true, formPhone: phone,
      sheetPhone, sheetName, matchType,
      phoneMatch: formLast10 === sheetLast10 && formLast10.length === 10,
      collection: rule.collectionName,
      monthLabel: rule.monthLabel
    };
  }

  return { matched: false, formPhone: phone, sheetPhone: null, sheetName: null, matchType: null, phoneMatch: false };
}

module.exports = { verifyMerchant, crossCheckPhone };
