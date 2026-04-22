const mongoose = require('mongoose');

const changeRequestSchema = new mongoose.Schema({
  type:         { type: String, required: true, enum: ['profile_change', 'merchant_edit', 'merchant_delete', 'duplicate_alert', 'points_adjustment'] },
  employeeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName: { type: String },
  // For profile changes
  profileChanges: { type: Object, default: null },
  // For merchant changes
  merchantId:     { type: String, default: null },
  merchantName:   { type: String, default: null },
  merchantChanges:{ type: Object, default: null },
  // For duplicate alerts
  duplicateMerchantName:   { type: String, default: null },
  duplicateMerchantPhone:  { type: String, default: null },
  duplicateOtherEmployee:  { type: String, default: null },
  // Status
  status:   { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] },
  reason:   { type: String, default: '' },
  acknowledged: { type: Boolean, default: false },
  createdAt:{ type: Date, default: Date.now }
}, { collection: 'ChangeRequests' });

module.exports = mongoose.model('ChangeRequest', changeRequestSchema);
