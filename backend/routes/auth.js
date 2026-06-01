const upload = require('../middleware/multer');
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
// const multer   = require('multer');
// const path     = require('path');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Storage for cv + photo
// const storage = multer.diskStorage({
//   destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads')),
//   filename:    (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
// });
// const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Verify JWT middleware
function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}

// POST /api/auth/register
router.post(
  '/register',
  upload.fields([
    { name: 'cv', maxCount: 1 },
    { name: 'photo', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const {
        email,
        newJoinerName,
        newJoinerPhone,
        newJoinerEmailId,
        reportingManager,
        position,
        location,
        password
      } = req.body;

     const exists = await Employee.findOne({ email });
if (exists && exists.approvalStatus !== 'rejected') {
  return res.status(400).json({ message: 'Email already registered' });
}
if (exists && exists.approvalStatus === 'rejected') {
  await Employee.findByIdAndDelete(exists._id); // delete the rejected record
}


      if (!req.files?.photo) {
        return res.status(400).json({ message: 'Profile photo is required' });
      }

      const rawPassword = password || Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
const hashed = await bcrypt.hash(rawPassword, 10);


      const employee = await Employee.create({
        email,
        newJoinerName,
        newJoinerPhone,
        newJoinerEmailId,
        reportingManager,
        position,
        location,
        password: hashed,

        // ✅ Cloudinary URLs
        image: req.files?.photo?.[0]?.path || '',
        cv: req.files?.cv?.[0]?.path || ''
      });

      // ✅ Auto-assign employee ID
      const { generateNextEmployeeId } = require('../utils/employeeIdGenerator');
      const empId = await generateNextEmployeeId();
      await Employee.findByIdAndUpdate(employee._id, { employeeId: empId });
      console.log(`✅ New employee ${newJoinerName} assigned ID: ${empId}`);

      res.status(201).json({
        message: 'Registered successfully',
        id: employee._id
      });

    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
// POST /api/auth/register-tl — TL registration → saves to TeamLeads collection
const TeamLead = require('../models/TeamLead');

router.post(
  '/register-tl',
  upload.fields([
    { name: 'cv', maxCount: 1 },
    { name: 'photo', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const {
        email, name, phone, emailId,
        reportingManager, location, dob, password
      } = req.body;

      if (!req.files?.photo) {
        return res.status(400).json({ message: 'Profile photo is required' });
      }

      const exists = await TeamLead.findOne({ email });
      if (exists && exists.approvalStatus !== 'rejected') {
        return res.status(400).json({ message: 'Email already registered' });
      }
      if (exists && exists.approvalStatus === 'rejected') {
        await TeamLead.findByIdAndDelete(exists._id);
      }

      const hashed = await bcrypt.hash(
        password || Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10),
        10
      );

      const tl = await TeamLead.create({
        email,
        name,
        phone,
        emailId,
        reportingManager,
        location,
        dob: dob || '',
        password: hashed,
        image: req.files?.photo?.[0]?.path || '',
        cv:    req.files?.cv?.[0]?.path   || ''
      });

      res.status(201).json({ message: 'Registered successfully', id: tl._id });

    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  '/update-photo',
  verifyToken,
  upload.single('photo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No photo uploaded' });
      }

      await Employee.findByIdAndUpdate(req.user.id, {
        image: req.file.path // ✅ Cloudinary URL
      });

      res.json({
        message: 'Photo updated',
        image: req.file.path
      });

    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const employee = await Employee.findOne({ email });
    if (!employee) return res.status(400).json({ message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, employee.password);
    if (!match) return res.status(400).json({ message: 'Invalid credentials' });

    // Block login if not approved
    if (employee.approvalStatus === 'pending') {
      return res.status(403).json({ message: 'Your account is pending admin approval. Please wait.' });
    }
    if (employee.approvalStatus === 'rejected') {
      return res.status(403).json({ message: 'Your account registration was rejected. Please contact admin.' });
    }

    const token = jwt.sign({ id: employee._id, email: employee.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
    
    // ✅ MARK ATTENDANCE
    try {
      const now = new Date();
      const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const today = istTime.toISOString().split('T')[0];
      
      let attendance = await Attendance.findOne({
        userId: employee._id,
        date: today
      });
      
      if (!attendance) {
        // Normalize userType to match enum
        const pos = (employee.position || '').toLowerCase();
        let userType = 'employee';
        if (pos.includes('manager')) userType = 'manager';
        else if (pos.includes('tl') || pos.includes('teamlead') || pos.includes('team lead') || pos.includes('team_lead')) userType = 'teamlead';

        // First login today - mark attendance
        attendance = await Attendance.create({
          userId: employee._id,
          userEmail: employee.email,
          userName: employee.newJoinerName,
          userType: userType,
          date: today,
          firstLoginTime: now,
          lastActivityTime: now,
          attendanceMarked: true,
          reloginCount: 0,
          status: 'present'
        });
        console.log(`✅ Attendance marked: ${employee.email} at ${istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      } else {
        // Re-login - update last activity
        attendance.reloginCount += 1;
        attendance.lastActivityTime = now;
        attendance.lastLogoutTime = null;
        attendance.duration = null;
        await attendance.save();
        console.log(`✅ Re-login: ${employee.email} - Activity updated (Re-login #${attendance.reloginCount})`);
      }
    } catch (attErr) {
      console.error('Attendance marking error:', attErr.message);
      // Don't block login if attendance fails
    }
    
    res.json({ token, employee: { newJoinerName: employee.newJoinerName, email: employee.email, position: employee.position, status: employee.status } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/google-login
router.post('/google-login', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Google credential required' });

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const googleEmail = payload.email.toLowerCase();

    // Match against newJoinerEmailId (the joining email the employee registered with)
    const employee = await Employee.findOne({
      newJoinerEmailId: { $regex: new RegExp(`^${googleEmail}$`, 'i') }
    });

    if (!employee) {
      return res.status(404).json({
        message: 'No registered employee found with this Google account. Please use the email you provided during registration.'
      });
    }

    if (employee.approvalStatus === 'pending') {
      return res.status(403).json({ message: 'Your account is pending admin approval. Please wait.' });
    }
    if (employee.approvalStatus === 'rejected') {
      return res.status(403).json({ message: 'Your account registration was rejected. Please contact admin.' });
    }

    // Generate JWT with admin flag for impersonation support
    const token = jwt.sign({ 
      id: employee._id, 
      email: employee.email,
      role: employee.position || 'fse',
      isAdmin: employee.position === 'admin' || employee.email === process.env.ADMIN_EMAIL || false
    }, process.env.JWT_SECRET, { expiresIn: '8h' });
    
    // ✅ MARK ATTENDANCE (same as password login)
    try {
      const now = new Date();
      const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const today = istTime.toISOString().split('T')[0];
      
      let attendance = await Attendance.findOne({
        userId: employee._id,
        date: today
      });
      
      if (!attendance) {
        // Normalize userType to match enum
        const pos = (employee.position || '').toLowerCase();
        let userType = 'employee';
        if (pos.includes('manager')) userType = 'manager';
        else if (pos.includes('tl') || pos.includes('teamlead') || pos.includes('team lead') || pos.includes('team_lead')) userType = 'teamlead';

        // First login today - mark attendance
        attendance = await Attendance.create({
          userId: employee._id,
          userEmail: employee.email,
          userName: employee.newJoinerName,
          userType: userType,
          date: today,
          firstLoginTime: now,
          lastActivityTime: now,
          attendanceMarked: true,
          reloginCount: 0,
          status: 'present'
        });
        console.log(`✅ Attendance marked (Google): ${employee.email} at ${istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      } else {
        // Re-login - update last activity
        attendance.reloginCount += 1;
        attendance.lastActivityTime = now;
        attendance.lastLogoutTime = null;
        attendance.duration = null;
        await attendance.save();
        console.log(`✅ Re-login (Google): ${employee.email} - Activity updated (Re-login #${attendance.reloginCount})`);
      }
    } catch (attErr) {
      console.error('Attendance marking error (Google):', attErr.message);
      // Don't block login if attendance fails
    }
    
    res.json({
      token,
      employee: {
        newJoinerName: employee.newJoinerName,
        email:         employee.email,
        position:      employee.position,
        status:        employee.status,
        picture:       payload.picture || '',
      }
    });
  } catch (err) {
    console.error('Google login error:', err.message);
    res.status(401).json({ message: 'Google sign-in failed. Please try again.' });
  }
});

// GET /api/auth/profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const employee = await Employee.findById(req.user.id).select('-password');
    if (!employee) return res.status(404).json({ message: 'Not found' });
    res.json(employee);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/profile-by-email - Get profile by email (for admin impersonation)
router.get('/profile-by-email', verifyToken, async (req, res) => {
  try {
    const { email } = req.query;
    
    // Security check: Only admins can fetch other users' profiles
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized: Admin access required' });
    }
    
    if (!email) {
      return res.status(400).json({ message: 'Email parameter required' });
    }
    
    const employee = await Employee.findOne({ 
      newJoinerEmailId: email 
    }).select('-password');
    
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    res.json(employee);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/verify-impersonation - Validate admin impersonation request
router.get('/verify-impersonation', verifyToken, async (req, res) => {
  try {
    const { viewAs } = req.query;
    
    // Security check: Only admins can impersonate
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({ 
        allowed: false, 
        error: 'Unauthorized: Admin access required' 
      });
    }
    
    if (!viewAs) {
      return res.status(400).json({ 
        allowed: false, 
        error: 'Missing viewAs parameter' 
      });
    }
    
    // Find target user
    const targetUser = await Employee.findOne({ 
      newJoinerEmailId: viewAs 
    }).select('-password');
    
    if (!targetUser) {
      return res.status(404).json({ 
        allowed: false, 
        error: `User not found: ${viewAs}` 
      });
    }
    
    // Return impersonation data
    res.json({
      allowed: true,
      targetUser: {
        userId: targetUser._id,
        email: targetUser.newJoinerEmailId,
        name: targetUser.newJoinerName,
        role: targetUser.position || 'fse',
        phone: targetUser.newJoinerPhone
      },
      adminUser: {
        email: req.user.email,
        name: req.user.name || 'Admin'
      }
    });
    
  } catch (err) {
    console.error('Impersonation verification error:', err);
    res.status(500).json({ 
      allowed: false, 
      error: err.message 
    });
  }
});

// POST /api/auth/generate-impersonation-token - Generate temporary admin token for impersonation
router.post('/generate-impersonation-token', async (req, res) => {
  try {
    const { adminEmail, targetEmail } = req.body;
    
    if (!adminEmail || !targetEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing adminEmail or targetEmail' 
      });
    }
    
    // Security check: Verify admin email is in allowed list
    const allowedAdmins = (process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase());
    if (!allowedAdmins.includes(adminEmail.toLowerCase())) {
      return res.status(403).json({ 
        success: false, 
        error: 'Unauthorized: Not an admin email' 
      });
    }
    
    // Find target user to verify they exist
    const targetUser = await Employee.findOne({ 
      newJoinerEmailId: targetEmail 
    }).select('_id newJoinerName newJoinerEmailId position');
    
    if (!targetUser) {
      return res.status(404).json({ 
        success: false, 
        error: `Target user not found: ${targetEmail}` 
      });
    }
    
    // Generate temporary impersonation token (valid for 1 hour)
    const impersonationToken = jwt.sign(
      { 
        id: 'admin-impersonation',
        email: adminEmail,
        role: 'admin',
        isAdmin: true,
        impersonating: true,
        targetEmail: targetEmail
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '1h' }
    );
    
    console.log(`✅ Generated impersonation token for admin ${adminEmail} to view ${targetEmail}`);
    
    res.json({
      success: true,
      token: impersonationToken,
      targetUser: {
        name: targetUser.newJoinerName,
        email: targetUser.newJoinerEmailId,
        role: targetUser.position || 'fse'
      }
    });
    
  } catch (err) {
    console.error('Generate impersonation token error:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// GET /api/auth/pending — list pending registrations (admin)
router.get('/pending', async (req, res) => {
  try {
    const employees = await Employee.find({ approvalStatus: 'pending' }).select('-password').sort({ createdAt: -1 });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/all-employees — all employees with approval status (admin)
// router.get('/all-employees', async (req, res) => {
//   try {
//     const employees = await Employee.find({}).select('-password').sort({ createdAt: -1 });
//     res.json(employees);
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });
router.get('/all-employees', async (req, res) => {
  try {
    const employees = await Employee.find({ approvalStatus: 'approved' })
      .select('newJoinerName newJoinerPhone newJoinerEmailId reportingManager');
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/all-employees-admin — ALL employees regardless of status (for admin approvals page)
router.get('/all-employees-admin', async (req, res) => {
  try {
    const employees = await Employee.find({}).select('-password').sort({ createdAt: -1 });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/approved — approved employees only
router.get('/approved', async (req, res) => {
  try {
    const employees = await Employee.find({ approvalStatus: 'approved' }).select('-password').sort({ createdAt: -1 });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/rejected — rejected employees only
router.get('/rejected', async (req, res) => {
  try {
    const employees = await Employee.find({ approvalStatus: 'rejected' }).select('-password').sort({ createdAt: -1 });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/auth/admin/update-employee/:id  (admin — can update position)
router.put('/admin/update-employee/:id', async (req, res) => {
  try {
    const allowed = ['newJoinerName', 'newJoinerPhone', 'newJoinerEmailId', 'location', 'reportingManager', 'position', 'status'];
    const update  = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });
    // Keep email and newJoinerEmailId in sync
    if (update.newJoinerEmailId) {
      update.email = update.newJoinerEmailId;
    }
    const emp = await Employee.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).select('-password');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    res.json({ message: 'Employee updated', employee: emp });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/request-position — employee requests a position change
const PositionRequest = require('../models/PositionRequest');

router.post('/request-position', verifyToken, async (req, res) => {
  try {
    const { requestedPosition, reason } = req.body;
    if (!requestedPosition) return res.status(400).json({ message: 'Requested position is required' });
    const emp = await Employee.findById(req.user.id).select('newJoinerName position');
    const request = await PositionRequest.create({
      employeeId:        req.user.id,
      employeeName:      emp.newJoinerName,
      currentPosition:   emp.position,
      requestedPosition,
      reason: reason || ''
    });
    res.status(201).json({ message: 'Position change request sent to admin', request });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/my-position-request — employee checks their latest request
router.get('/my-position-request', verifyToken, async (req, res) => {
  try {
    const request = await PositionRequest.findOne({ employeeId: req.user.id }).sort({ createdAt: -1 });
    res.json(request || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/position-requests', async (req, res) => {
  try {
    const requests = await PositionRequest.find({}).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/auth/position-requests/:id/approve
router.put('/position-requests/:id/approve', async (req, res) => {
  try {
    const request = await PositionRequest.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    if (!request) return res.status(404).json({ message: 'Request not found' });
    // Apply the position change to the employee
    await Employee.findByIdAndUpdate(request.employeeId, { position: request.requestedPosition });
    res.json({ message: 'Position updated and request approved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/auth/position-requests/:id/reject
router.put('/position-requests/:id/reject', async (req, res) => {
  try {
    const request = await PositionRequest.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
    if (!request) return res.status(404).json({ message: 'Request not found' });
    res.json({ message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.put('/approve/:id', async (req, res) => {
  try {
    const emp = await Employee.findByIdAndUpdate(
      req.params.id,
      { approvalStatus: 'approved' },
      { new: true }
    ).select('-password');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    res.json({ message: 'Employee approved', employee: emp });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/auth/reject/:id
router.put('/reject/:id', async (req, res) => {
  try {
    const emp = await Employee.findByIdAndUpdate(
      req.params.id,
      { approvalStatus: 'rejected' },
      { new: true }
    ).select('-password');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    res.json({ message: 'Employee rejected', employee: emp });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/logout - Manual logout with attendance update
router.post('/logout', verifyToken, async (req, res) => {
  try {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const today = istTime.toISOString().split('T')[0];
    
    const attendance = await Attendance.findOne({
      userId: req.user.id,
      date: today
    });
    
    if (attendance) {
      const durationMs = now - attendance.firstLoginTime;
      const durationHours = durationMs / (1000 * 60 * 60);
      
      attendance.lastLogoutTime = now;
      attendance.lastActivityTime = now;
      attendance.duration = parseFloat(durationHours.toFixed(2));
      await attendance.save();
      
      console.log(`✅ Logout: ${req.user.email} - Duration: ${durationHours.toFixed(2)}h`);
    }
    
    res.json({ 
      success: true,
      message: 'Logged out successfully',
      note: 'You can login again before 11:59 PM'
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/auto-logout - Auto logout at 11:59 PM
router.post('/auto-logout', verifyToken, async (req, res) => {
  try {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const today = istTime.toISOString().split('T')[0];
    
    const attendance = await Attendance.findOne({
      userId: req.user.id,
      date: today
    });
    
    if (attendance && !attendance.lastLogoutTime) {
      const durationMs = now - attendance.firstLoginTime;
      const durationHours = durationMs / (1000 * 60 * 60);
      
      attendance.lastLogoutTime = now;
      attendance.lastActivityTime = now;
      attendance.duration = parseFloat(durationHours.toFixed(2));
      attendance.autoCheckOut = true;
      await attendance.save();
      
      console.log(`✅ Auto logout: ${req.user.email} - Duration: ${durationHours.toFixed(2)}h`);
    }
    
    res.json({ 
      success: true,
      message: 'Auto logged out at 11:59 PM'
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/update-photo
router.post('/update-photo', verifyToken, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No photo uploaded' });
await Employee.findByIdAndUpdate(req.user.id, {
  image: req.file.path   // ✅ Cloudinary URL
});

res.json({
  message: 'Photo updated',
  image: req.file.path
});
    // res.json({ message: 'Photo updated', photoFileName: req.file.filename });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/auth/update-profile  (position is NOT allowed to be changed)
router.put('/update-profile', verifyToken, async (req, res) => {
  try {
    const allowed = ['newJoinerName', 'newJoinerPhone', 'newJoinerEmailId', 'reportingManager', 'location'];
    const update  = {};
    allowed.forEach(field => { if (req.body[field] !== undefined) update[field] = req.body[field]; });
    const emp = await Employee.findByIdAndUpdate(req.user.id, { $set: update }, { new: true }).select('-password');
    res.json({ message: 'Profile updated', employee: emp });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/check-tidebt-access - Check if user has Tide BT access
router.get('/check-tidebt-access', verifyToken, async (req, res) => {
  try {
    console.log('🔍 Checking Tide BT access for employee...');
    
    const employee = await Employee.findById(req.user.id).select('newJoinerName position');
    if (!employee) {
      console.log('❌ Employee not found');
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    console.log('👤 Employee name:', employee.newJoinerName);

    // Check if user exists in TideBT_Access collection (case-insensitive)
    const db = Employee.db;
    const TideBTAccess = db.collection('TideBT_Access');
    
    // Get all FSE records
    const allRecords = await TideBTAccess.find({ hasTideBTAccess: true }).toArray();
    console.log('📊 Total records in TideBT_Access:', allRecords.length);
    
    // Fuzzy name matching with 3-tier priority
    const employeeName = employee.newJoinerName.toLowerCase().trim();
    const employeeParts = employeeName.split(/\s+/);
    const employeeFirstName = employeeParts[0];
    const employeeSurnameInitial = employeeParts[1] ? employeeParts[1][0] : null;
    
    let matchedRecord = null;
    let matchType = null;
    
    // Priority 1: Exact full name match
    matchedRecord = allRecords.find(record => 
      record.fseName && 
      record.fseName.toLowerCase().trim() === employeeName
    );
    if (matchedRecord) {
      matchType = 'exact';
      console.log('✅ Exact match found:', matchedRecord.fseName);
    }
    
    // Priority 2: First name + first letter of surname match
    if (!matchedRecord && employeeSurnameInitial) {
      const potentialMatches = allRecords.filter(record => {
        if (!record.fseName) return false;
        const dbParts = record.fseName.toLowerCase().trim().split(/\s+/);
        const dbFirstName = dbParts[0];
        const dbSurnameInitial = dbParts[1] ? dbParts[1][0] : null;
        
        return dbFirstName === employeeFirstName && 
               dbSurnameInitial === employeeSurnameInitial;
      });
      
      if (potentialMatches.length === 1) {
        matchedRecord = potentialMatches[0];
        matchType = 'first-name-initial';
        console.log('✅ First name + initial match found:', matchedRecord.fseName);
      } else if (potentialMatches.length > 1) {
        console.log('⚠️ Multiple matches found for first name + initial - denying access for safety');
        matchType = 'ambiguous';
      }
    }
    
    // Priority 3: First name only match (fallback)
    if (!matchedRecord && matchType !== 'ambiguous') {
      const potentialMatches = allRecords.filter(record => {
        if (!record.fseName) return false;
        const dbFirstName = record.fseName.toLowerCase().trim().split(/\s+/)[0];
        return dbFirstName === employeeFirstName;
      });
      
      if (potentialMatches.length === 1) {
        matchedRecord = potentialMatches[0];
        matchType = 'first-name-only';
        console.log('✅ First name only match found:', matchedRecord.fseName);
      } else if (potentialMatches.length > 1) {
        console.log('⚠️ Multiple matches found for first name - denying access for safety');
        console.log('   Ambiguous matches:', potentialMatches.map(m => m.fseName).join(', '));
        matchType = 'ambiguous';
      }
    }
    
    const hasAccess = !!matchedRecord && matchType !== 'ambiguous';
    
    console.log('✅ Access granted:', hasAccess);
    if (matchedRecord) {
      console.log('   Match type:', matchType);
      console.log('   Matched with:', matchedRecord.fseName);
    }

    res.json({
      hasTideBTAccess: hasAccess,
      userName: employee.newJoinerName,
      userRole: employee.position,
      matchType: matchType || 'none'
    });
  } catch (err) {
    console.error('❌ Error checking Tide BT access:', err);
    res.status(500).json({ message: err.message, error: err.toString() });
  }
});

// POST /api/auth/tidebt-daily-visit - FSE submits Tide BT daily visit form
router.post('/tidebt-daily-visit', verifyToken, async (req, res) => {
  try {
    const TideBTFormResponse = require('../models/TideBTFormResponse');
    const employee = await Employee.findById(req.user.id).select('newJoinerName newJoinerEmailId');
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const data = {
      ...req.body,
      formType: 'daily-visit',
      submittedBy: req.user.id,
      employeeName: employee.newJoinerName,
      employeeEmail: employee.newJoinerEmailId,
    };

    const form = await TideBTFormResponse.create(data);
    res.status(201).json({ message: 'Form submitted successfully', form });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/tidebt-mobikwik-withdraw - FSE submits Mobikwik/Payzapp withdraw form
router.post('/tidebt-mobikwik-withdraw', verifyToken, async (req, res) => {
  try {
    const TideBTFormResponse = require('../models/TideBTFormResponse');
    const employee = await Employee.findById(req.user.id).select('newJoinerName newJoinerEmailId');
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const data = {
      ...req.body,
      formType: 'mobikwik-withdraw',
      submittedBy: req.user.id,
      employeeName: employee.newJoinerName,
      employeeEmail: employee.newJoinerEmailId,
      merchantOpinion: 'Ready For Onboarding',
      merchantCategory: 'Others',
      merchantName: req.body.merchantName,
      merchantNumber: req.body.merchantNumber,
    };

    const form = await TideBTFormResponse.create(data);
    res.status(201).json({ message: 'Form submitted successfully', form });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/tidebt-my-forms - FSE gets their own Tide BT forms
router.get('/tidebt-my-forms', verifyToken, async (req, res) => {
  try {
    const TideBTFormResponse = require('../models/TideBTFormResponse');
    const forms = await TideBTFormResponse.find({ submittedBy: req.user.id }).sort({ createdAt: -1 });
    res.json(forms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/tidebt-received-payments - FSE gets payments received
router.get('/tidebt-received-payments', verifyToken, async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const emp = await Employee.findById(req.user.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const db = require('mongoose').connection.db;
    const empName = emp.newJoinerName?.trim();
    
    // Match payments where transferTo contains the employee name OR employee name contains transferTo
    // This handles "Niteesh kumar" matching "Niteesh Kumar Saroj" and vice versa
    const allPayments = await db.collection('TideBT_Payments')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    
    // Filter: match if either name contains the other (case-insensitive)
    const payments = allPayments.filter(p => {
      const transferTo = (p.transferTo || '').toLowerCase().trim();
      const myName = empName.toLowerCase();
      return transferTo === myName || 
             transferTo.includes(myName) || 
             myName.includes(transferTo);
    });

    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
