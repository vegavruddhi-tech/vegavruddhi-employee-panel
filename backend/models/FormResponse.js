const mongoose = require('mongoose');

const formResponseSchema = new mongoose.Schema({
  // Submitted by
  submittedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  employeeName:   { type: String },

  // Page 1 - Basic info
  customerName:   { type: String, required: true },
  customerNumber: { type: String, required: true },
  location:       { type: String, required: true },
  status:         { type: String, required: true, enum: [
    'Ready for Onboarding',
    'Not Interested',
    'Try but not done due to error',
    'Need to visit again'
  ]},
// formFillingFor: {
//   type: String,
//   required: function () {
//     return this.status === 'Ready for Onboarding';
//   },
//   default: undefined
// },
formFillingFor: { type: String, },

    // Non-onboarding
  reason:            { type: String },

  // Brand Name (new form)
  brand:             { type: String },
  tideProduct:       { type: String },

  // Tide fields
  tide_qrPosted:     { type: String },
  tide_upiTxnDone:   { type: String },

  // Tide BT
  tideBt_txnDone:    { type: String },

  // Insurance 2W/4W fields
  ins_vehicleNumber: { type: String },
  ins_vehicleType:   { type: String },
  ins_insuranceType: { type: String },

  // PineLab fields
  pine_cardTxn:      { type: String },
  pine_wifiConnected:{ type: String },

  // Tide Credit Card
  cc_cardName:       { type: String },

  // Tide Insurance
  tideIns_type:      { type: String },

  // Old fields (commented for reference)
  // formFillingFor:    { type: String },
  // attemptedProducts: [{ type: String }],
  // kotak_txnDone:     { type: String },
  // kotak_wifiBtOff:   { type: String },
  // bp_product:        { type: String },

  brand:          { type: String },
  tideProduct:    { type: String },
  tideBt_txnDone: { type: String, enum: ['Yes', 'No', ''] },
  reason:         { type: String },

  // Verification status (cached)
  verificationStatus: { type: String, enum: ['Fully Verified', 'Partially Done', 'Not Verified', 'Not Found'], default: 'Not Found' },
  verificationChecks: { type: Object }, // Store detailed check results
  verificationUpdatedAt: { type: Date },

  createdAt: { type: Date, default: Date.now }
}, { collection: 'Forms_respones' });

module.exports = mongoose.model('FormResponse', formResponseSchema);
