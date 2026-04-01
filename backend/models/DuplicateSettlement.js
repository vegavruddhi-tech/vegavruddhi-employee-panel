const mongoose = require('mongoose');

const duplicateSettlementSchema = new mongoose.Schema({
  customerNumber:  { type: String, required: true },
  customerName:    { type: String },
  product:         { type: String },
  employees:       [{ type: String }],       // employee names involved
  settledBy:       { type: String, default: 'Admin' },
  settledAt:       { type: Date, default: Date.now },
  note:            { type: String, default: '' },
}, { collection: 'DuplicateSettlements' });

module.exports = mongoose.model('DuplicateSettlement', duplicateSettlementSchema);
