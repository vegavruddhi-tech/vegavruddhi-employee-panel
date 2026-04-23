const mongoose = require('mongoose');

// Separate collection for admin's Points Activity view
// Admin can delete from here without affecting FSE/TL notifications
const pointsActivityLogSchema = new mongoose.Schema({
  employeeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  employeeName: { type: String, required: true },
  adjustment:   { type: Number, required: true },
  beforeTotal:  { type: Number },
  newTotal:     { type: Number },
  reason:       { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
}, { collection: 'PointsActivityLogs' });

module.exports = mongoose.model('PointsActivityLog', pointsActivityLogSchema);
