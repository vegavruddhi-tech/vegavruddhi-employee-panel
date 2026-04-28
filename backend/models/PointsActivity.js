const mongoose = require('mongoose');

const pointsActivitySchema = new mongoose.Schema({
  employeeName:     { type: String, required: true },
  employeeId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  product:          { type: String, required: true },
  slabDetails: {
    forms:          { type: Number, required: true },
    multiplier:     { type: Number, required: true },
    points:         { type: Number, required: true }  // forms × multiplier
  },
  reason:           { type: String, default: '' },
  actionType:       { type: String, enum: ['added', 'modified', 'removed'], default: 'added' },
  performedBy:      { type: String, default: 'admin' },
  createdAt:        { type: Date, default: Date.now }
}, { collection: 'PointsActivity' });

module.exports = mongoose.model('PointsActivity', pointsActivitySchema);
