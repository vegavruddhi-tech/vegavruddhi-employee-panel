// File: vegavruddhi-employee-panel/backend/routes/meetings.js

const express = require('express');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ScheduledMeeting = require('../models/ScheduledMeeting');
const MeetingAttendance = require('../models/MeetingAttendance');
const jwt = require('jsonwebtoken');

// Load service account credentials (lazy — only if file exists)
let serviceAccount = null;
const credPath = path.join(__dirname, '../google_credentials.json');
if (fs.existsSync(credPath)) {
  try { serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8')); } catch (_) {}
}

// Google Calendar setup with Domain-Wide Delegation
const calendar = google.calendar('v3');

// Create JWT auth with domain-wide delegation
function getAuthClient() {
  return new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    subject: 'saurabh@vegavruddhi.com' // ← Manager's email for domain-wide delegation
  });
}

// Email setup (using Gmail)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.ADMIN_EMAIL,
    pass: process.env.ADMIN_EMAIL_PASSWORD  // App password
  }
});

// POST /api/meetings/create
router.post('/create', async (req, res) => {
  try {
    const { 
      title,           // Meeting title
      description,     // Meeting description
      startTime,       // ISO datetime: "2026-04-30T10:00:00+05:30"
      endTime,         // ISO datetime: "2026-04-30T11:00:00+05:30" (optional, defaults to +1 hour)
      attendees        // Array: [{email: "fse@example.com", name: "FSE Name"}]
    } = req.body;

    console.log('📅 Meeting creation request:', { title, startTime, endTime, attendeeCount: attendees?.length });

    // ✅ Validation
    if (!title || !startTime || !attendees || attendees.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          title: !!title,
          startTime: !!startTime,
          attendees: attendees?.length || 0
        }
      });
    }

    // ✅ Format datetime properly (add seconds and timezone if missing)
    const formatDateTime = (dt) => {
      let formatted = dt;
      // Add seconds if missing
      if (!formatted.includes(':00:') && formatted.split(':').length === 2) {
        formatted += ':00';
      }
      // Add timezone if missing
      if (!formatted.includes('+') && !formatted.includes('Z')) {
        formatted += '+05:30';
      }
      return formatted;
    };

    const formattedStart = formatDateTime(startTime);
    
    // If endTime not provided, default to 1 hour after start
    let formattedEnd;
    if (endTime) {
      formattedEnd = formatDateTime(endTime);
    } else {
      const startDate = new Date(formattedStart);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // Add 1 hour
      formattedEnd = endDate.toISOString().replace('Z', '+05:30');
    }

    console.log('📅 Formatted times:', { formattedStart, formattedEnd });

    // ✅ Validate end is after start
    if (new Date(formattedEnd) <= new Date(formattedStart)) {
      return res.status(400).json({ 
        error: 'End time must be after start time',
        start: formattedStart,
        end: formattedEnd
      });
    }

    // Step 1: Create Google Calendar event WITH auto-generated Google Meet link
    const event = {
      summary: title,
      description: description || '',
      start: {
        dateTime: formattedStart,
        timeZone: 'Asia/Kolkata'
      },
      end: {
        dateTime: formattedEnd,
        timeZone: 'Asia/Kolkata'
      },
      // ✅ Auto-generate Google Meet link
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`, // Unique ID for this meeting
          conferenceSolutionKey: {
            type: 'hangoutsMeet'
          }
        }
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 30 },
          { method: 'popup', minutes: 10 }
        ]
      }
    };

    console.log('📅 Creating calendar event with auto-generated Meet link...');
    
    const authClient = getAuthClient();
    
    const response = await calendar.events.insert({
      auth: authClient,
      calendarId: 'primary',
      conferenceDataVersion: 1, // ← Required for conferenceData
      resource: event,
      sendUpdates: 'none'
    });

    console.log('✅ Calendar event created:', response.data.id);

    const eventId = response.data.id;
    const calendarLink = response.data.htmlLink;
    
    // Extract auto-generated Google Meet link
    const finalMeetLink = response.data.conferenceData?.entryPoints?.find(
      ep => ep.entryPointType === 'video'
    )?.uri || response.data.hangoutLink;
    
    if (!finalMeetLink) {
      console.error('❌ Failed to generate Google Meet link');
      return res.status(500).json({
        error: 'Failed to generate Google Meet link',
        message: 'Domain-wide delegation may not be configured correctly. Please check Google Workspace admin settings.',
        calendarEventCreated: true,
        eventId,
        calendarLink
      });
    }

    console.log('📅 Calendar event link:', calendarLink);

    // Step 2: Send custom email notification (including admin)
    const allRecipients = [
      ...attendees,
      { email: process.env.ADMIN_EMAIL, name: 'Admin' }
    ];
    
    console.log('📧 Sending emails to', allRecipients.length, 'recipients (including admin)...');
    
    const emailPromises = allRecipients.map(attendee => {
      const mailOptions = {
        from: process.env.ADMIN_EMAIL,
        to: attendee.email,
        subject: `Meeting Invitation: ${title}`,
        html: `
          <h2>You're invited to a meeting</h2>
          <p><strong>Title:</strong> ${title}</p>
          <p><strong>Description:</strong> ${description || 'No description'}</p>
          <p><strong>Time:</strong> ${new Date(formattedStart).toLocaleString('en-IN')}</p>
          <p><strong>Duration:</strong> ${Math.round((new Date(formattedEnd) - new Date(formattedStart)) / 60000)} minutes</p>
          <br>
          <a href="${finalMeetLink}" style="background:#4285f4;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;">
            Join Google Meet
          </a>
          <br><br>
          <p>Or copy this link: <a href="${finalMeetLink}">${finalMeetLink}</a></p>
        `
      };
      return transporter.sendMail(mailOptions);
    });

    await Promise.all(emailPromises);
    console.log('✅ Emails sent successfully to all recipients including admin');

    res.json({
      success: true,
      meetLink: finalMeetLink,
      eventId,
      calendarLink,
      message: `Meeting created! Invitations sent to ${attendees.length} attendees + admin.`
    });

  } catch (err) {
    console.error('❌ Meeting creation error:', err);
    console.error('Error details:', err.response?.data || err.message);
    res.status(500).json({ 
      error: err.message,
      details: err.response?.data?.error || 'Unknown error'
    });
  }
});

// POST /api/meetings/jitsi/create - Create Jitsi meeting and send email invitations
router.post('/jitsi/create', async (req, res) => {
  try {
    const { 
      title,           // Meeting title
      meetingLink,     // Jitsi meeting link
      roomName,        // Jitsi room name
      attendees,       // Array: [{email: "fse@example.com", name: "FSE Name"}]
      isScheduled,     // Boolean: true if scheduled for later
      scheduledDate,   // String: "2026-05-31" (if scheduled)
      scheduledTime,   // String: "14:30" (if scheduled)
      duration         // Number: duration in minutes (if scheduled)
    } = req.body;

    console.log('🎥 Jitsi meeting creation request:', { 
      title, 
      roomName, 
      attendeeCount: attendees?.length,
      isScheduled,
      scheduledDate,
      scheduledTime,
      duration
    });

    // Validation
    if (!title || !meetingLink || !roomName || !attendees || attendees.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          title: !!title,
          meetingLink: !!meetingLink,
          roomName: !!roomName,
          attendees: attendees?.length || 0
        }
      });
    }

    // Validate scheduled meeting fields
    if (isScheduled && (!scheduledDate || !scheduledTime || !duration)) {
      return res.status(400).json({ 
        error: 'Missing scheduled meeting fields',
        details: {
          scheduledDate: !!scheduledDate,
          scheduledTime: !!scheduledTime,
          duration: !!duration
        }
      });
    }

    // Format scheduled datetime
    let scheduledDateTime = null;
    let endDateTime = null;
    if (isScheduled) {
      scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}:00+05:30`);
      endDateTime = new Date(scheduledDateTime.getTime() + duration * 60000);
      
      // Validate scheduled time is in future
      if (scheduledDateTime <= new Date()) {
        return res.status(400).json({ 
          error: 'Scheduled time must be in the future'
        });
      }
    }

    // Send email invitations to all attendees
    console.log('📧 Sending Jitsi meeting invitations to', attendees.length, 'recipients...');
    
    const emailPromises = attendees.map(attendee => {
      // Create personalized Jitsi link with employee's name and skip pre-join page
      const personalizedLink = `${meetingLink}#userInfo.displayName="${encodeURIComponent(attendee.name)}"&config.prejoinPageEnabled=false`;
      
      // Build email content based on meeting type
      const meetingTimeHtml = isScheduled 
        ? `
          <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1565c0;">
            <p style="margin: 0 0 10px 0; color: #0d47a1;"><strong>📅 Scheduled Time:</strong></p>
            <p style="margin: 0 0 8px 0; font-size: 18px; color: #1565c0; font-weight: 600;">
              ${scheduledDateTime.toLocaleString('en-IN', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
            <p style="margin: 0; color: #0d47a1;">
              <strong>Duration:</strong> ${duration} minutes
            </p>
          </div>
        `
        : `
          <div style="background: #fff3e0; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f57c00;">
            <p style="margin: 0; color: #e65100; font-weight: 600;">
              ⚡ This is an instant meeting - Join now!
            </p>
          </div>
        `;
      
      const mailOptions = {
        from: process.env.ADMIN_EMAIL,
        to: attendee.email,
        subject: isScheduled 
          ? `Scheduled Video Call: ${title} - ${scheduledDateTime.toLocaleDateString('en-IN')}`
          : `Video Call Invitation: ${title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #1a3b2a 0%, #2e7d32 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">
                ${isScheduled ? '📅 Scheduled Video Call' : '🎥 Video Call Invitation'}
              </h1>
            </div>
            
            <div style="background: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px;">
              <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2 style="color: #1a3b2a; margin-top: 0;">Hello ${attendee.name},</h2>
                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                  You've been invited to join a video call${isScheduled ? ' scheduled for later' : ''}.
                </p>
                
                <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2e7d32;">
                  <p style="margin: 0 0 10px 0; color: #1a3b2a;"><strong>Meeting Title:</strong></p>
                  <p style="margin: 0; font-size: 18px; color: #2e7d32; font-weight: 600;">${title}</p>
                </div>
                
                ${meetingTimeHtml}
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${personalizedLink}" 
                     style="background: linear-gradient(135deg, #2e7d32 0%, #1a3b2a 100%); 
                            color: white; 
                            padding: 16px 40px; 
                            text-decoration: none; 
                            border-radius: 8px; 
                            display: inline-block; 
                            font-size: 18px; 
                            font-weight: 600;
                            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
                            transition: transform 0.2s;">
                    🎥 ${isScheduled ? 'Join at Scheduled Time' : 'Join Video Call Now'}
                  </a>
                </div>
                
                <div style="background: #fff3e0; padding: 15px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 0 0 8px 0; color: #e65100; font-weight: 600;">📋 Meeting Link:</p>
                  <p style="margin: 0; word-break: break-all; font-size: 13px;">
                    <a href="${personalizedLink}" style="color: #1565c0;">${personalizedLink}</a>
                  </p>
                </div>
                
                ${isScheduled ? `
                  <div style="background: #e1f5fe; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #01579b; font-size: 14px;">
                      <strong>💡 Tip:</strong> Save this email or add a reminder to join at the scheduled time!
                    </p>
                  </div>
                ` : ''}
                
                <div style="margin-top: 25px; padding-top: 20px; border-top: 2px solid #e0e0e0;">
                  <p style="color: #777; font-size: 14px; margin: 0;">
                    <strong>Note:</strong> No account or app installation required. Just click the link to join!
                  </p>
                </div>
              </div>
              
              <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
                <p>This is an automated invitation from Vegavruddhi Admin Panel</p>
              </div>
            </div>
          </div>
        `
      };
      return transporter.sendMail(mailOptions);
    });

    await Promise.all(emailPromises);
    console.log('✅ Jitsi meeting invitations sent successfully to all recipients');

    // Save meeting to database (both instant and scheduled)
    try {
      // For instant meetings, set scheduled time to current time + 5 minutes
      let meetingScheduledDateTime;
      let meetingScheduledDate;
      let meetingScheduledTime;
      let meetingDuration;
      
      if (isScheduled) {
        // Scheduled meeting - use provided date/time
        meetingScheduledDateTime = scheduledDateTime;
        meetingScheduledDate = scheduledDate;
        meetingScheduledTime = scheduledTime;
        meetingDuration = duration;
      } else {
        // Instant meeting - set to current time (LIVE NOW)
        const now = new Date();
        meetingScheduledDateTime = now;
        meetingScheduledDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
        meetingScheduledTime = now.toTimeString().slice(0, 5); // HH:MM
        meetingDuration = 60; // Default 60 minutes for instant meetings
      }
      
      const scheduledMeeting = new ScheduledMeeting({
        title,
        meetingLink,
        roomName,
        scheduledDate: meetingScheduledDate,
        scheduledTime: meetingScheduledTime,
        scheduledDateTime: meetingScheduledDateTime,
        duration: meetingDuration,
        attendees,
        createdBy: 'admin',
        status: 'scheduled',
        isInstant: !isScheduled // Flag to identify instant meetings
      });
      
      await scheduledMeeting.save();
      console.log('✅ Meeting saved to database:', scheduledMeeting._id);
      
      res.json({
        success: true,
        meetingLink,
        roomName,
        isScheduled,
        scheduledDateTime: isScheduled ? scheduledDateTime.toISOString() : new Date().toISOString(),
        scheduledMeetingId: scheduledMeeting._id, // 🔥 Return the ID so we can end it later
        message: isScheduled 
          ? `Jitsi meeting scheduled! Invitations sent to ${attendees.length} attendees.`
          : `Jitsi meeting created! Invitations sent to ${attendees.length} attendees.`
      });
      return; // Early return since we responded
    } catch (dbErr) {
      console.error('⚠️ Failed to save meeting to database:', dbErr);
      // Fallback response if DB fails
      res.json({
        success: true,
        meetingLink,
        roomName,
        isScheduled,
        scheduledDateTime: isScheduled ? scheduledDateTime.toISOString() : new Date().toISOString(),
        message: isScheduled 
          ? `Jitsi meeting scheduled! Invitations sent to ${attendees.length} attendees.`
          : `Jitsi meeting created! Invitations sent to ${attendees.length} attendees.`
      });
    }

  } catch (err) {
    console.error('❌ Jitsi meeting creation error:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to send Jitsi meeting invitations'
    });
  }
});

// GET /api/meetings/jitsi/scheduled - Get all scheduled meetings
router.get('/jitsi/scheduled', async (req, res) => {
  try {
    console.log('📋 Fetching scheduled meetings...');

    // Fetch all scheduled meetings, sorted by date/time
    const meetings = await ScheduledMeeting.find({ 
      status: { $in: ['scheduled', 'completed'] }
    }).sort({ scheduledDateTime: 1 });

    console.log(`✅ Found ${meetings.length} scheduled meetings`);

    res.json({
      success: true,
      meetings
    });

  } catch (err) {
    console.error('❌ Error fetching scheduled meetings:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to fetch scheduled meetings'
    });
  }
});

// DELETE /api/meetings/jitsi/:id - Cancel a scheduled meeting
router.delete('/jitsi/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ Cancelling meeting:', id);

    const meeting = await ScheduledMeeting.findByIdAndUpdate(
      id,
      { status: 'cancelled' },
      { new: true }
    );

    if (!meeting) {
      return res.status(404).json({ 
        error: 'Meeting not found'
      });
    }

    console.log('✅ Meeting cancelled:', meeting.title);

    res.json({
      success: true,
      message: 'Meeting cancelled successfully',
      meeting
    });

  } catch (err) {
    console.error('❌ Error cancelling meeting:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to cancel meeting'
    });
  }
});

// POST /api/meetings/attendance/start - Start tracking attendance for a meeting
router.post('/attendance/start', async (req, res) => {
  try {
    const { meetingId, roomName, meetingTitle, meetingLink, scheduledMeetingId } = req.body;
    
    console.log('📊 Starting attendance tracking for meeting:', meetingId);

    // Check if attendance record already exists
    let attendance = await MeetingAttendance.findOne({ meetingId });
    
    if (!attendance) {
      attendance = new MeetingAttendance({
        meetingId,
        roomName,
        meetingTitle,
        meetingLink,
        scheduledMeetingId,
        startTime: new Date(),
        status: 'ongoing',
        participants: []
      });
      await attendance.save();
      console.log('✅ Attendance tracking started');
    }

    // 🔥 NEW: Update ScheduledMeeting status to 'live' when meeting starts
    if (scheduledMeetingId) {
      try {
        await ScheduledMeeting.findByIdAndUpdate(
          scheduledMeetingId,
          { status: 'live' },
          { new: true }
        );
        console.log('✅ Meeting status updated to LIVE');
      } catch (err) {
        console.error('⚠️ Failed to update meeting status to live:', err);
      }
    }

    res.json({
      success: true,
      attendanceId: attendance._id,
      message: 'Attendance tracking started'
    });

  } catch (err) {
    console.error('❌ Error starting attendance tracking:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to start attendance tracking'
    });
  }
});

// POST /api/meetings/attendance/join - Record participant join
router.post('/attendance/join', async (req, res) => {
  try {
    const { meetingId, participantId, name, email } = req.body;
    
    console.log('👤 Participant joined:', name, 'in meeting:', meetingId);

    const attendance = await MeetingAttendance.findOne({ meetingId });
    
    if (!attendance) {
      return res.status(404).json({ error: 'Meeting attendance record not found' });
    }

    // Check if participant already exists
    const existingParticipant = attendance.participants.find(
      p => p.participantId === participantId
    );

    if (!existingParticipant) {
      attendance.participants.push({
        participantId,
        name,
        email: email || '',
        joinTime: new Date(),
        status: 'in-meeting'
      });
      await attendance.save();
      console.log('✅ Participant join recorded');
    }

    res.json({
      success: true,
      message: 'Participant join recorded'
    });

  } catch (err) {
    console.error('❌ Error recording participant join:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to record participant join'
    });
  }
});

// POST /api/meetings/attendance/leave - Record participant leave
router.post('/attendance/leave', async (req, res) => {
  try {
    const { meetingId, participantId } = req.body;
    
    console.log('👋 Participant left:', participantId, 'from meeting:', meetingId);

    const attendance = await MeetingAttendance.findOne({ meetingId });
    
    if (!attendance) {
      return res.status(404).json({ error: 'Meeting attendance record not found' });
    }

    const participant = attendance.participants.find(
      p => p.participantId === participantId
    );

    if (participant && participant.status === 'in-meeting') {
      participant.leaveTime = new Date();
      participant.status = 'left';
      
      // Calculate duration in seconds
      if (participant.joinTime) {
        participant.duration = Math.floor(
          (participant.leaveTime - participant.joinTime) / 1000
        );
      }
      
      await attendance.save();
      console.log('✅ Participant leave recorded');
    }

    res.json({
      success: true,
      message: 'Participant leave recorded'
    });

  } catch (err) {
    console.error('❌ Error recording participant leave:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to record participant leave'
    });
  }
});

// POST /api/meetings/attendance/end - End meeting and finalize attendance
router.post('/attendance/end', async (req, res) => {
  try {
    const { meetingId, scheduledMeetingId } = req.body;
    
    console.log('🏁 Ending meeting:', meetingId);

    const attendance = await MeetingAttendance.findOne({ meetingId });
    
    if (!attendance) {
      return res.status(404).json({ error: 'Meeting attendance record not found' });
    }

    attendance.endTime = new Date();
    attendance.status = 'completed';
    
    // Calculate total meeting duration
    if (attendance.startTime) {
      attendance.totalDuration = Math.floor(
        (attendance.endTime - attendance.startTime) / 1000
      );
    }

    // Mark any remaining participants as left
    attendance.participants.forEach(p => {
      if (p.status === 'in-meeting') {
        p.leaveTime = attendance.endTime;
        p.status = 'left';
        if (p.joinTime) {
          p.duration = Math.floor((p.leaveTime - p.joinTime) / 1000);
        }
      }
    });

    await attendance.save();
    console.log('✅ Meeting ended and attendance finalized');

    // 🔥 NEW: Update ScheduledMeeting status to 'completed' so it disappears from employee notifications
    if (scheduledMeetingId) {
      try {
        await ScheduledMeeting.findByIdAndUpdate(
          scheduledMeetingId,
          { status: 'completed' },
          { new: true }
        );
        console.log('✅ Meeting status updated to completed in database');
      } catch (err) {
        console.error('⚠️ Failed to update meeting status:', err);
      }
    }

    res.json({
      success: true,
      attendance,
      message: 'Meeting ended successfully'
    });

  } catch (err) {
    console.error('❌ Error ending meeting:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to end meeting'
    });
  }
});

// GET /api/meetings/attendance/:meetingId - Get attendance for a specific meeting
router.get('/attendance/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log('📊 Fetching attendance for meeting:', meetingId);

    const attendance = await MeetingAttendance.findOne({ meetingId });
    
    if (!attendance) {
      return res.status(404).json({ error: 'Meeting attendance record not found' });
    }

    res.json({
      success: true,
      attendance
    });

  } catch (err) {
    console.error('❌ Error fetching attendance:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to fetch attendance'
    });
  }
});

// GET /api/meetings/attendance/report/:meetingId - Get formatted attendance report
router.get('/attendance/report/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log('📋 Generating attendance report for meeting:', meetingId);

    const attendance = await MeetingAttendance.findOne({ meetingId })
      .populate('scheduledMeetingId');
    
    if (!attendance) {
      return res.status(404).json({ error: 'Meeting attendance record not found' });
    }

    // Format report
    const report = {
      meetingTitle: attendance.meetingTitle,
      meetingLink: attendance.meetingLink,
      startTime: attendance.startTime,
      endTime: attendance.endTime,
      totalDuration: attendance.totalDuration,
      status: attendance.status,
      totalParticipants: attendance.participants.length,
      currentlyInMeeting: attendance.participants.filter(p => p.status === 'in-meeting').length,
      leftMeeting: attendance.participants.filter(p => p.status === 'left').length,
      participants: attendance.participants.map(p => ({
        name: p.name,
        email: p.email,
        joinTime: p.joinTime,
        leaveTime: p.leaveTime,
        duration: p.duration,
        status: p.status
      }))
    };

    res.json({
      success: true,
      report
    });

  } catch (err) {
    console.error('❌ Error generating attendance report:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to generate attendance report'
    });
  }
});

// 🔔 GET /api/meetings/my-meetings - Get meetings for logged-in user (by email)
router.get('/my-meetings', async (req, res) => {
  try {
    // Get user email from auth token (assuming it's added to req.user by auth middleware)
    const userEmail = req.query.email || req.user?.email;
    
    if (!userEmail) {
      return res.status(400).json({ error: 'User email required' });
    }

    console.log('🔔 Fetching meetings for user:', userEmail);

    // Get current date/time
    const now = new Date();

    // Fetch scheduled, live, and completed meetings where user is an attendee
    const meetings = await ScheduledMeeting.find({
      'attendees.email': userEmail,
      status: { $in: ['scheduled', 'live', 'completed'] }
    }).sort({ scheduledDateTime: 1 });

    // Categorize meetings - Show scheduled AND live meetings in upcoming
    const upcoming = meetings.filter(m => {
      // Show both scheduled and live meetings
      if (m.status === 'scheduled' || m.status === 'live') return true;
      return false;
    });
    
    const past = meetings.filter(m => {
      // Only show completed/cancelled in past
      return m.status === 'completed' || m.status === 'cancelled';
    });
    
    // Count unread (upcoming meetings that user hasn't joined yet)
    const unreadCount = upcoming.length;

    console.log(`✅ Found ${meetings.length} meetings (${upcoming.length} upcoming, ${past.length} past)`);

    res.json({
      success: true,
      meetings: {
        all: meetings,
        upcoming,
        past
      },
      unreadCount
    });

  } catch (err) {
    console.error('❌ Error fetching user meetings:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Failed to fetch meetings'
    });
  }
});

// 🔑 GET /api/meetings/jaas-jwt - Generate 8x8 JaaS JWT token
router.get('/jaas-jwt', (req, res) => {
  try {
    const { name, email, avatar, isModerator } = req.query;
    
    // Read the private key
    const privateKeyPath = path.join(__dirname, '../jaas_private_key.pem');
    if (!fs.existsSync(privateKeyPath)) {
      return res.status(500).json({ error: 'JaaS private key not found' });
    }
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

    const appId = process.env.JAAS_APP_ID;
    const kid = process.env.JAAS_KID;
    
    if (!appId || !kid) {
      return res.status(500).json({ error: 'JaaS App ID or Key ID not configured in .env' });
    }

    const payload = {
      aud: "jitsi",
      iss: "chat",
      sub: appId,
      room: "*", // Wildcard to allow this token to join any room
      context: {
        user: {
          name: name || email?.split('@')[0] || "Guest",
          email: email || "",
          avatar: avatar || "",
          moderator: isModerator === 'true',
        },
        features: {
          recording: isModerator === 'true',
          livestreaming: "false",
          "screen-sharing": "true"
        }
      }
    };

    const token = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      keyid: kid,
      expiresIn: '4h' // Token valid for 4 hours
    });

    res.json({ token, appId });
  } catch (err) {
    console.error('❌ Error generating JaaS JWT:', err);
    res.status(500).json({ error: 'Failed to generate meeting token' });
  }
});

module.exports = router;
