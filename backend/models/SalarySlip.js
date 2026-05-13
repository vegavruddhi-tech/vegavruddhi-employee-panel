const mongoose = require('mongoose');

const salarySlipSchema = new mongoose.Schema({
  // Employee Info
  employeeId: {
    type: String,
    required: false, // Optional - some employees might not have ID in system
    index: true
  },
  employeeName: {
    type: String,
    required: true
  },
  employeeEmail: {
    type: String,
    required: true,
    index: true
  },
  employeePhone: {
    type: String
  },
  role: {
    type: String,
    enum: ['FSE', 'TL', 'Manager'],
    required: true
  },
  
  // Period
  month: {
    type: String,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  
  // Salary Calculation (Points Based)
  pointsEarned: {
    type: Number,
    required: true,
    default: 0
  },
  slabPoints: {
    type: Number,
    default: 0
  },
  totalPoints: {
    type: Number,
    default: 0
  },
  pointValue: {
    type: Number,
    required: true,
    default: 250
  },
  totalSalary: {
    type: Number,
    required: true,
    default: 0
  },

  // Editable breakdown percentages (admin only)
  pctBasic: { type: Number, default: 50 },
  pctHRA:   { type: Number, default: 25 },
  pctConv:  { type: Number, default: 5  },
  pctSpec:  { type: Number, default: 20 },

  // Editable deductions (admin only)
  deductionPF:   { type: Number, default: 0 },
  deductionPT:   { type: Number, default: 0 },
  deductionESIC: { type: Number, default: 0 },
  deductionTDS:  { type: Number, default: 0 },
  
  // PDF & Status
  pdfUrl: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['draft', 'generated', 'sent', 'paid'],
    default: 'draft'
  },
  
  // Payment Info
  paymentDate: {
    type: Date,
    default: null
  },
  paymentMode: {
    type: String,
    default: 'Bank Transfer'
  },
  remarks: {
    type: String,
    default: ''
  },
  
  // Audit Trail
  generatedBy: {
    type: String,
    required: true
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  lastEditedBy: {
    type: String,
    default: null
  },
  lastEditedAt: {
    type: Date,
    default: null
  },
  
  // Edit History
  editHistory: [{
    field: String,
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
    editedBy: String,
    editedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes for faster queries
salarySlipSchema.index({ employeeEmail: 1, month: 1, year: 1 });
salarySlipSchema.index({ status: 1 });
salarySlipSchema.index({ year: 1, month: 1 });

// Calculate total salary before saving
salarySlipSchema.pre('save', function(next) {
  if (this.isModified('pointsEarned') || this.isModified('slabPoints') || this.isModified('pointValue')) {
    this.totalPoints = (this.pointsEarned || 0) + (this.slabPoints || 0);
    this.totalSalary = this.totalPoints * this.pointValue;
  }
  next();
});

module.exports = mongoose.model('SalarySlip', salarySlipSchema);
