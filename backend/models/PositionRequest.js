const mongoose = require('mongoose');

const positionRequestSchema = new mongoose.Schema({
  employeeId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeName:    { type: String },
  currentPosition: { type: String },
  requestedPosition: { type: String, required: true },
  reason:          { type: String, default: '' },
  status:          { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] },
  createdAt:       { type: Date, default: Date.now }
}, { collection: 'PositionRequests' });

module.exports = mongoose.model('PositionRequest', positionRequestSchema);
