const mongoose = require('mongoose');

/**
 * EmployeeMonthlyPoints - Stores pre-calculated points per employee per month
 * Updated daily when Merchant Forms page loads
 * Used by Salary Slips for fast, accurate point lookup
 */
const employeeMonthlyPointsSchema = new mongoose.Schema({
  employeeName: {
    type: String,
    required: true,
    index: true
  },
  employeeEmail: {
    type: String,
    default: ''
  },
  month: {
    type: String,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  basePoints: {
    type: Number,
    default: 0  // Auto-calculated from verified forms (same as Merchant Forms)
  },
  slabPoints: {
    type: Number,
    default: 0  // Slab/bonus points from EmployeePoints.productSlabs
  },
  totalPoints: {
    type: Number,
    default: 0  // basePoints + slabPoints
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index for fast lookup
employeeMonthlyPointsSchema.index({ employeeName: 1, month: 1, year: 1 }, { unique: true });
employeeMonthlyPointsSchema.index({ month: 1, year: 1 });

module.exports = mongoose.model('EmployeeMonthlyPoints', employeeMonthlyPointsSchema);
