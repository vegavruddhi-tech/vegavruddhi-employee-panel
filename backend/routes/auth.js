const upload = require('../middleware/multer');
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
// const multer   = require('multer');
// const path     = require('path');
const Employee = require('../models/Employee');
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
      if (exists) {
        return res.status(400).json({ message: 'Email already registered' });
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

      res.status(201).json({
        message: 'Registered successfully',
        id: employee._id
      });

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

    const token = jwt.sign({ id: employee._id, email: employee.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
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
router.get('/all-employees', async (req, res) => {
  try {
    const employees = await Employee.find({}).select('-password').sort({ createdAt: -1 });
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

module.exports = router;
