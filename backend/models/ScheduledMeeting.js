// File: vegavruddhi-employee-panel/backend/models/ScheduledMeeting.js

const mongoose = require('mongoose');

const scheduledMeetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  meetingLink: {
    type: String,
    required: true
  },
  roomName: {
    type: String,
    required: true
  },
  scheduledDate: {
    type: String, // YYYY-MM-DD format
    required: true
  },
  scheduledTime: {
    type: String, // HH:MM format
    required: true
  },
  scheduledDateTime: {
    type: Date,
    required: true
  },
  duration: {
    type: Number, // in minutes
    required: true
  },
  attendees: [{
    name: String,
    email: String
  }],
  createdBy: {
    type: String,
    default: 'admin'
  },
  status: {
    type: String,
    enum: ['scheduled', 'live', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  isInstant: {
    type: Boolean,
    default: false // true for instant meetings, false for scheduled ones
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
scheduledMeetingSchema.index({ scheduledDateTime: 1, status: 1 });

module.exports = mongoose.model('ScheduledMeeting', scheduledMeetingSchema);
