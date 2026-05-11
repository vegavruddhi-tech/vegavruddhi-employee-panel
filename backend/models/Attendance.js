const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  // User info
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Employee', 
    required: true 
  },
  userEmail: { 
    type: String, 
    required: true 
  },
  userName: { 
    type: String 
  },
  userType: { 
    type: String, 
    enum: ['employee', 'teamlead', 'manager'], 
    required: true 
  },
  
  // Extra profile info (stored at login time for cross-collection support)
  position: { type: String, default: '' },
  location: { type: String, default: '' },
  reportingManager: { type: String, default: '' },
  
  // Date
  date: { 
    type: String, 
    required: true 
  }, // "2026-05-09" format
  
  // Time tracking
  firstLoginTime: { 
    type: Date, 
    required: true 
  },  // Attendance time (pehla login)
  
  lastActivityTime: { 
    type: Date, 
    required: true 
  },  // Last kab active tha (updated on every login)
  
  lastLogoutTime: { 
    type: Date 
  },  // Last logout time
  
  // Duration
  duration: { 
    type: Number 
  },  // Hours (lastLogout - firstLogin)
  
  // Tracking
  attendanceMarked: { 
    type: Boolean, 
    default: true 
  },  // Attendance lagi ya nahi
  
  reloginCount: { 
    type: Number, 
    default: 0 
  },  // Kitni baar dobara login kiya
  
  // Status
  status: { 
    type: String, 
    enum: ['present', 'absent', 'half-day', 'leave'], 
    default: 'present' 
  },
  
  autoCheckOut: { 
    type: Boolean, 
    default: false 
  }
  
}, { 
  timestamps: true,
  collection: 'Attendance' 
});

// Unique index: One attendance per user per day
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
