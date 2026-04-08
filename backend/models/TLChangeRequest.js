const mongoose = require('mongoose');

const tlChangeRequestSchema = new mongoose.Schema({
  tlId:       { type: mongoose.Schema.Types.ObjectId, ref: 'TeamLead', required: true },
  tlName:     { type: String, required: true },
  tlEmail:    { type: String, required: true },
  changes:    { type: Object, required: true }, // { name, phone, location, reportingManager }
  reason:     { type: String, required: true },
  status:     { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] },
  createdAt:  { type: Date, default: Date.now }
}, { collection: 'TLChangeRequests' });

module.exports = mongoose.model('TLChangeRequest', tlChangeRequestSchema);
