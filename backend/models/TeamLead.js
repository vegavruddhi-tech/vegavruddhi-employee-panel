const mongoose = require('mongoose');

const teamLeadSchema = new mongoose.Schema({
  employeeId: {
    type: String,
    unique: true,
    sparse: true,  // Allow null/undefined for existing records
    index: true
  },
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
  approvalStatus: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] },
  createdAt:        { type: Date, default: Date.now }
}, { collection: 'TeamLeads' });

// Auto-generate employeeId before saving (VVT0001, VVT0002, etc.)
teamLeadSchema.pre('save', async function(next) {
  if (this.isNew && !this.employeeId) {
    try {
      // Find the highest existing TL employee ID
      const lastTL = await this.constructor.findOne(
        { employeeId: { $regex: /^VVT\d{4}$/ } },
        { employeeId: 1 }
      ).sort({ employeeId: -1 }).lean();
      
      let nextNumber = 1;
      if (lastTL && lastTL.employeeId) {
        const lastNumber = parseInt(lastTL.employeeId.substring(3));
        nextNumber = lastNumber + 1;
      }
      
      this.employeeId = `VVT${String(nextNumber).padStart(4, '0')}`;
      console.log(`✅ Generated TL Employee ID: ${this.employeeId}`);
    } catch (error) {
      console.error('Error generating TL employee ID:', error);
    }
  }
  next();
});

module.exports = mongoose.model('TeamLead', teamLeadSchema);
