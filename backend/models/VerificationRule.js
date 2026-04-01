const mongoose = require('mongoose');

/**
 * VerificationRule stores conditions per month/collection.
 * Admin will update these later via admin panel.
 * Each rule has a list of field checks — all must pass for "Verified".
 *
 * Example doc:
 * {
 *   collectionName: "TL_connect_March",
 *   monthLabel: "March 2026",
 *   active: true,
 *   conditions: [
 *     { field: "UPI_Active",  operator: "equals",  value: "Yes",  label: "UPI Onboarding Done" },
 *     { field: "Stage-3",     operator: "equals",  value: "Yes",  label: "QR Done" },
 *     { field: "Pass_Live",   operator: "equals",  value: "Yes",  label: "PPI Active" },
 *     { field: "T_AMT__LTD_", operator: "gte",     value: "5000", label: "5000 Txn Done" }
 *   ]
 * }
 */
const conditionSchema = new mongoose.Schema({
  field:    { type: String, required: true },
  operator: { type: String, required: true, enum: ['equals', 'not_equals', 'gte', 'lte', 'contains', 'exists', 'in'] },
  value:    { type: String, default: '' },       // single value (for backward compat)
  values:   { type: [String], default: [] },     // multiple values for OR logic (used with 'in' or 'equals')
  label:    { type: String, default: '' }
}, { _id: false });

const verificationRuleSchema = new mongoose.Schema({
  collectionName: { type: String, required: true, unique: true },
  monthLabel:     { type: String, required: true },
  active:         { type: Boolean, default: true },
  // Which form products this rule applies to.
  // e.g. ["Tide","Kotak 811"] means only verify when formFillingFor is Tide or Kotak 811
  // Empty array = applies to ALL products (fallback)
  productTypes:   { type: [String], default: [] },
  conditions:     [conditionSchema],
  updatedAt:      { type: Date, default: Date.now }
}, { collection: 'VerificationRules' });

module.exports = mongoose.model('VerificationRule', verificationRuleSchema);
