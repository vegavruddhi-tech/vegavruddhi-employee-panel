const mongoose = require('mongoose');

const managerFormSchema = new mongoose.Schema({
  submittedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'Manager' },
  employeeName:   { type: String },

  customerName:   { type: String, required: true },
  customerNumber: { type: String, required: true },
  location:       { type: String, required: true },
  status:         { type: String, required: true, enum: [
    'Ready for Onboarding',
    'Not Interested',
    'Try but not done due to error',
    'Need to visit again'
  ]},

  formFillingFor:    { type: String },
  brand:             { type: String },
  tideProduct:       { type: String },
  reason:            { type: String },

  tide_qrPosted:     { type: String },
  tide_upiTxnDone:   { type: String },
  tideBt_txnDone:    { type: String, enum: ['Yes', 'No', ''] },
  ins_vehicleNumber: { type: String },
  ins_vehicleType:   { type: String },
  ins_insuranceType: { type: String },
  pine_cardTxn:      { type: String },
  pine_wifiConnected:{ type: String },
  cc_cardName:       { type: String },
  tideIns_type:      { type: String },

  verificationStatus:    { type: String, enum: ['Fully Verified', 'Partially Done', 'Not Verified', 'Not Found'], default: 'Not Found' },
  verificationChecks:    { type: Object },
  verificationUpdatedAt: { type: Date },

  // 🔥 NEW: Settled from unfilled forms metadata
  settledFromUnfilled: { type: Boolean, default: false },
  unfilledFormId: { type: mongoose.Schema.Types.ObjectId, ref: 'UnfilledForm' },
  settledBy: { type: String },
  settledAt: { type: Date },

  createdAt: { type: Date, default: Date.now }
}, { collection: 'ManagerForms', strict: false });

module.exports = mongoose.model('ManagerForm', managerFormSchema);
