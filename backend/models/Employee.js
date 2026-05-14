const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  employeeId:         { type: String, unique: true, sparse: true }, // VV0001, VV0002...
  email:              { type: String, required: true, unique: true },
  newJoinerName:      { type: String, required: true },
  newJoinerPhone:     { type: String, required: true },
  newJoinerEmailId:   { type: String, required: true },
  reportingManager:   { type: String, required: true },
  position:           { type: String, required: true },
  location:           { type: String, required: true },
  role:               { type: String, default: 'FSE', enum: ['FSE', 'TL', 'Manager'] }, // 🔥 NEW: Employee role
  dob: { type: String, default: '' },

  // 🔥 NEW FIELDS (Cloudinary URLs)
  image:              { type: String, default: '' },
  cv:                 { type: String, default: '' },

  password:           { type: String, required: true },
  status:             { type: String, default: 'Active', enum: ['Active', 'Inactive', 'On Leave'] },
  approvalStatus:     { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] },
  pointsAdjustment:   { type: Number, default: 0 },
  verifiedPoints:     { type: Number, default: 0 },
  createdAt:          { type: Date, default: Date.now }
}, { collection: 'Users' });

module.exports = mongoose.model('Employee', employeeSchema);