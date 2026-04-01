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
  formFillingFor: { type: String, required: true, enum: [
    'Tide', 'Kotak 811', 'Insurance', 'PineLab',
    'Credit Card', 'Tide Insurance', 'MSME',
    'Airtel Payments Bank', 'Equitas SF Bank',
    'IndusInd Bank', 'Bharat Pay', 'Tide Credit Card'
  ]},

  // For non-onboarding statuses — checkbox list of products attempted
  attemptedProducts: [{ type: String }],
  tide_qrPosted:    { type: String, enum: ['Yes', 'No', ''] },
  tide_upiTxnDone:  { type: String, enum: ['Yes', 'No', ''] },

  // Kotak 811 fields
  kotak_txnDone:    { type: String, enum: ['Yes', 'No', ''] },
  kotak_wifiBtOff:  { type: String, enum: ['Yes', 'No', ''] },

  // Insurance fields
  ins_vehicleNumber: { type: String },
  ins_vehicleType:   { type: String, enum: ['2 Wheeler', '4 Wheeler', 'Commercial', ''] },
  ins_insuranceType: { type: String, enum: ['3rd Party', 'Only OD', 'OD + 3rd Party', ''] },

  // PineLab fields
  pine_cardTxn:      { type: String, enum: ['Yes', 'No', ''] },
  pine_wifiConnected:{ type: String, enum: ['Yes', 'No', ''] },

  // Credit Card fields
  cc_cardName:       { type: String },

  // Tide Insurance fields
  tideIns_type:      { type: String, enum: ['Cyber Security', 'Accidental', ''] },

  // Bharat Pay fields
  bp_product:        { type: String, enum: [
    'New Onboarding', 'QR Re-linking', 'Re-visit',
    'Loan', 'Sound Box', 'Swipe', 'Mid Market Onboarding', ''
  ]},

  createdAt: { type: Date, default: Date.now }
}, { collection: 'Forms_respones' });

module.exports = mongoose.model('FormResponse', formResponseSchema);
