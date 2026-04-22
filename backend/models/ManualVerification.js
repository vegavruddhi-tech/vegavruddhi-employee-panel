const mongoose = require('mongoose');

const manualVerificationSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    index: true
  },
  product: {
    type: String,
    required: true,
    index: true
  },
  month: {
    type: String,
    required: false
  },
  status: {
    type: String,
    enum: ['Fully Verified', 'Partially Done', 'Not Verified'],
    default: 'Fully Verified'
  },
  verifiedBy: {
    type: String,
    required: true // Admin email/name
  },
  reason: {
    type: String,
    default: 'Manual verification by admin'
  },
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false // Optional reference to the form
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for fast lookups
manualVerificationSchema.index({ phone: 1, product: 1, month: 1 });

// Update timestamp on save
manualVerificationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ManualVerification', manualVerificationSchema);