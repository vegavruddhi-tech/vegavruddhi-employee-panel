const mongoose = require('mongoose');

const managerChangeRequestSchema = new mongoose.Schema({
  managerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Manager', required: true },
  managerName: { type: String, required: true },
  changes:    { type: Object, required: true },
  reason:     { type: String, required: true },
  status:     { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] },
  createdAt:  { type: Date, default: Date.now }
}, { collection: 'ManagerChangeRequests' });

module.exports = mongoose.model('ManagerChangeRequest', managerChangeRequestSchema);
