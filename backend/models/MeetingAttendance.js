// File: vegavruddhi-employee-panel/backend/models/MeetingAttendance.js

const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  participantId: String,
  name: String,
  email: String,
  joinTime: Date,
  leaveTime: Date,
  duration: Number, // in seconds
  status: {
    type: String,
    enum: ['in-meeting', 'left'],
    default: 'in-meeting'
  }
}, { _id: false });

const meetingAttendanceSchema = new mongoose.Schema({
  meetingId: {
    type: String,
    required: true,
    unique: true
  },
  scheduledMeetingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ScheduledMeeting'
  },
  roomName: {
    type: String,
    required: true
  },
  meetingTitle: String,
  meetingLink: String,
  startTime: Date,
  endTime: Date,
  totalDuration: Number, // in seconds
  participants: [participantSchema],
  status: {
    type: String,
    enum: ['ongoing', 'completed'],
    default: 'ongoing'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
meetingAttendanceSchema.index({ meetingId: 1 });
meetingAttendanceSchema.index({ roomName: 1 });
meetingAttendanceSchema.index({ startTime: -1 });

module.exports = mongoose.model('MeetingAttendance', meetingAttendanceSchema);
