const mongoose = require('mongoose');

const managerSchema = new mongoose.Schema({
  email:          { type: String, required: true, unique: true },
  name:           { type: String, required: true },
  phone:          { type: String, default: '' },
  location:       { type: String, default: '' },
  image:          { type: String, default: '' },
  dob:            { type: String, default: '' },
  password:       { type: String, default: '' },
  status:         { type: String, default: 'Active' },
  role:           { type: String, default: 'manager' },
  approvalStatus: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] },
  createdAt:      { type: Date, default: Date.now },
}, { collection: 'Managers' });

module.exports = mongoose.model('Manager', managerSchema);
