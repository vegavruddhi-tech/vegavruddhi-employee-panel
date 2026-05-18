const mongoose = require('mongoose');

/**
 * UnfilledForm Model
 * Stores merchants from Google Sheet who don't have forms filled by FSEs
 * Used to track missing forms and identify FSEs who forgot to submit
 */
const unfilledFormSchema = new mongoose.Schema({
  // Customer Information (from Google Sheet)
  customerPhone: {
    type: String,
    required: true,
    index: true
  },
  customerName: {
    type: String,
    required: true
  },
  
  // Product Information
  product: {
    type: String,
    required: true,
    index: true
  },
  
  // Time Period
  expectedMonth: {
    type: String,
    required: true,
    index: true
  },
  expectedYear: {
    type: Number,
    required: true,
    index: true
  },
  
  // Assignment
  assignedTo: {
    type: String,
    default: 'Dheeraj Anand',  // Default for unfilled forms
    index: true
  },
  
  // Status Tracking
  status: {
    type: String,
    enum: ['unfilled', 'filled_late', 'resolved', 'invalid'],
    default: 'unfilled',
    index: true
  },
  
  // Unique Key for Matching (based on verification rules)
  uniqueKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Verification Rule Used
  verificationRule: {
    matchFields: [String],  // ['phone', 'name'] or ['phone']
    timeWindow: String      // 'same_month'
  },
  
  // Google Sheet Metadata
  sheetRowNumber: {
    type: Number
  },
  sheetTabName: {
    type: String
  },
  
  // Link to Filled Form (if filled later)
  filledFormId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FormResponse',
    default: null
  },
  filledAt: {
    type: Date
  },
  filledByEmployee: {
    type: String
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  syncedAt: {
    type: Date,
    default: Date.now
  },
  resolvedAt: {
    type: Date
  },
  resolvedBy: {
    type: String
  },
  
  // Additional Notes
  notes: {
    type: String
  }
}, {
  timestamps: true,
  collection: 'UnfilledForms'
});

// Compound indexes for efficient queries
unfilledFormSchema.index({ expectedMonth: 1, expectedYear: 1, status: 1 });
unfilledFormSchema.index({ product: 1, status: 1 });
unfilledFormSchema.index({ assignedTo: 1, status: 1 });
unfilledFormSchema.index({ customerPhone: 1, product: 1, expectedMonth: 1, expectedYear: 1 });

// Static method to create unique key based on verification rules
unfilledFormSchema.statics.createUniqueKey = function(phone, name, product, month, year, verificationRule) {
  const normalizedPhone = phone.trim().toLowerCase();
  const normalizedProduct = product.trim().toLowerCase();
  const normalizedMonth = month.trim().toLowerCase();
  
  if (verificationRule && verificationRule.matchFields.includes('name')) {
    // Match by phone + name
    const normalizedName = name.trim().toLowerCase();
    return `${normalizedPhone}_${normalizedName}_${normalizedProduct}_${normalizedMonth}_${year}`;
  } else {
    // Match by phone only
    return `${normalizedPhone}_${normalizedProduct}_${normalizedMonth}_${year}`;
  }
};

// Instance method to mark as filled late
unfilledFormSchema.methods.markAsFilledLate = async function(formId, employeeName) {
  this.status = 'filled_late';
  this.filledFormId = formId;
  this.filledAt = new Date();
  this.filledByEmployee = employeeName;
  return this.save();
};

// Instance method to mark as resolved
unfilledFormSchema.methods.markAsResolved = async function(resolvedBy, notes) {
  this.status = 'resolved';
  this.resolvedAt = new Date();
  this.resolvedBy = resolvedBy;
  if (notes) this.notes = notes;
  return this.save();
};

module.exports = mongoose.model('UnfilledForm', unfilledFormSchema);
