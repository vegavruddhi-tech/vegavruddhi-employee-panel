const mongoose = require('mongoose');

// Same schema as FormResponse but saves to 'TL Form Responses' collection
const tlFormResponseSchema = new mongoose.Schema({
  submittedBy:    { type: mongoose.Schema.Types.ObjectId },
  employeeName:   { type: String },
  customerName:   { type: String, required: true },
  customerNumber: { type: String, required: true },
  location:       { type: String, required: true },
  status:         { type: String, required: true },
  formFillingFor: { type: String },
  reason:         { type: String },
  brand:          { type: String },
  tideProduct:    { type: String },
  tide_qrPosted:  { type: String },
  tide_upiTxnDone:{ type: String },
  tideBt_txnDone: { type: String },
  ins_vehicleNumber: { type: String },
  ins_vehicleType:   { type: String },
  ins_insuranceType: { type: String },
  pine_cardTxn:      { type: String },
  pine_wifiConnected:{ type: String },
  cc_cardName:       { type: String },
  tideIns_type:      { type: String },
  
  // Verification status (cached)
  verificationStatus: { type: String, enum: ['Fully Verified', 'Partially Done', 'Not Verified', 'Not Found'], default: 'Not Found' },
  verificationChecks: { type: Object }, // Store detailed check results
  verificationUpdatedAt: { type: Date },
  
  // 🔥 NEW: Settled from unfilled forms metadata
  settledFromUnfilled: { type: Boolean, default: false },
  unfilledFormId: { type: mongoose.Schema.Types.ObjectId, ref: 'UnfilledForm' },
  settledBy: { type: String },
  settledAt: { type: Date },
  
  createdAt: { type: Date, default: Date.now }
}, { collection: 'TL Form Responses', strict: false });

module.exports = mongoose.model('TLFormResponse', tlFormResponseSchema);
