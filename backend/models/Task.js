const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  // Assignment metadata
  assignedBy: { type: String, enum: ['admin', 'tl'], required: true }, // Who created the task
  assignedByName: { type: String, required: true }, // Name of admin or TL
  assignedTo: { type: String, enum: ['tl', 'fse'], required: true }, // Who receives the task
  
  // TL info (for both admin->TL and TL->FSE tasks)
  tlId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamLead', required: true },
  tlName: { type: String, required: true },
  
  // FSE info (only for TL->FSE tasks)
  fseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  fseName: { type: String },
  
  // Merchant info (only for TL->FSE tasks)
  merchantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormResponse' },
  merchantName: { type: String },
  merchantPhone: { type: String },
  product: { type: String },
  location: { type: String },
  
  // Task details
  title: { type: String }, // For admin->TL tasks
  reason: { type: String }, // For TL->FSE tasks (why partially done)
  instructions: { type: String, required: true },
  
  // Priority
  priority: { type: String, enum: ['normal', 'urgent'], default: 'normal' },
  isUrgent: { type: Boolean, default: false },
  deadline: { type: Date },
  
  // Verification details (only for TL->FSE tasks)
  verificationDetails: {
    status: { type: String },
    passedConditions: [{ type: String }],
    failedConditions: [{ type: String }],
  },
  
  // Status
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  
  // Completion
  completionNotes: { type: String },
  completionProof: { type: String },
  completedAt: { type: Date },
  
  // Verification after completion (only for TL->FSE tasks)
  verificationAfterCompletion: {
    status: { type: String },
    passedConditions: [{ type: String }],
    failedConditions: [{ type: String }],
    checkedAt: { type: Date }
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  
  // Notification tracking
  tlNotified: { type: Boolean, default: false }, // For TL->FSE: Has TL seen FSE completion
  adminNotified: { type: Boolean, default: false }, // For admin->TL: Has admin seen TL completion
}, { collection: 'Tasks' });

// Indexes for faster queries
taskSchema.index({ fseId: 1, status: 1 });
taskSchema.index({ tlId: 1, status: 1, assignedTo: 1 });
taskSchema.index({ merchantId: 1 });
taskSchema.index({ assignedBy: 1, assignedTo: 1 });

module.exports = mongoose.model('Task', taskSchema);
