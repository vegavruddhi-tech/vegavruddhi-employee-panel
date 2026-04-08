const mongoose = require('mongoose');

const teamLeadSchema = new mongoose.Schema({
  email:            { type: String, required: true, unique: true },
  emailId:          { type: String, default: '' },
  name:             { type: String, required: true },
  phone:            { type: String, default: '' },
  location:         { type: String, default: '' },
  reportingManager: { type: String, default: '' },
  position:         { type: String, default: 'Team Lead' },
  image:            { type: String, default: '' },
  cv:               { type: String, default: '' },
  password:         { type: String, default: '' },
  dob:              { type: String, default: '' },
  status:           { type: String, default: 'Active' },
  role:             { type: String, default: 'tl' },
  createdAt:        { type: Date, default: Date.now }
}, { collection: 'TeamLeads' });

module.exports = mongoose.model('TeamLead', teamLeadSchema);
