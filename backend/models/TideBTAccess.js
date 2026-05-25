const mongoose = require('mongoose');

const tideBTAccessSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['FSE', 'TL', 'Manager', 'Admin'],
    default: 'FSE'
  },
  hasTideBTAccess: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'TideBT_Access'
});

module.exports = mongoose.model('TideBTAccess', tideBTAccessSchema);
