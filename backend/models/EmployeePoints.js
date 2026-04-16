const mongoose = require('mongoose');

const employeePointsSchema = new mongoose.Schema({
  employeeId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  newJoinerName:     { type: String, required: true },
  verifiedPoints:    { type: Number, default: 0 },   // auto-calculated from verified forms
  pointsAdjustment:  { type: Number, default: 0 },   // manual admin adjustment (+/-)
  adjustmentHistory: [{
    delta:     { type: Number },
    reason:    { type: String, default: '' },
    updatedBy: { type: String, default: 'admin' },
    updatedAt: { type: Date, default: Date.now }
  }],
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'EmployeePoints' });

module.exports = mongoose.model('EmployeePoints', employeePointsSchema);
