// File: vegavruddhi-employee-panel/backend/routes/meetings.js

const express = require('express');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Load service account credentials
const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../google_credentials.json'), 'utf8')
);

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

module.exports = router;
