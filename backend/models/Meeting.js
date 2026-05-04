const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  meetLink: {
    type: String,
    required: true
  },
  eventId: {
    type: String, // Google Calendar event ID
    required: true
  },
  calendarLink: {
    type: String
  },
  attendees: [{
    email: String,
    name: String
  }],
  createdBy: {
    type: String,
    default: 'Admin'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Meeting', meetingSchema);
