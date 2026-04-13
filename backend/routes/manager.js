const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const upload   = require('../middleware/multer');
const Manager  = require('../models/Manager');
const TeamLead = require('../models/TeamLead');
const Employee = require('../models/Employee');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── JWT middleware ──────────────────────────────────────────────
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

// ── POST /api/manager/register ──────────────────────────────────
router.post('/register', upload.fields([{ name: 'photo', maxCount: 1 }]), async (req, res) => {
  try {
    const { name, phone, emailId, location, dob } = req.body;
    if (!name)              return res.status(400).json({ message: 'Name is required' });
    if (!req.files?.photo)  return res.status(400).json({ message: 'Profile photo is required' });

    const exists = await Manager.findOne({ email: emailId });
    if (exists && exists.approvalStatus === 'approved') {
      return res.status(400).json({ message: 'Email already registered and approved' });
    }
    if (exists) await Manager.findByIdAndDelete(exists._id);

    await Manager.create({
      email:    emailId || '',
      name,
      phone:    phone    || '',
      location: location || '',
      dob:      dob      || '',
      image:    req.files?.photo?.[0]?.path || '',
    });

    res.status(201).json({ message: 'Registration successful. Awaiting admin approval.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/manager/google-login ─────────────────────────────
router.post('/google-login', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Google credential required' });

    const ticket  = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email   = payload.email.toLowerCase();

    const manager = await Manager.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
    if (!manager) return res.status(403).json({ message: 'No registered Manager found with this Google account. Please register first.' });
    if (manager.approvalStatus === 'pending')  return res.status(403).json({ message: 'Your account is pending admin approval. Please wait.' });
    if (manager.approvalStatus === 'rejected') return res.status(403).json({ message: 'Your account was rejected. Contact admin.' });

    const token = jwt.sign({ id: manager._id, email: manager.email, role: 'manager' }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, manager: { name: manager.name, email: manager.email, image: manager.image, location: manager.location } });
  } catch (err) {
    res.status(401).json({ message: 'Google sign-in failed. Please try again.' });
  }
});

// ── GET /api/manager/profile ────────────────────────────────────
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const manager = await Manager.findById(req.user.id).select('-password');
    if (!manager) return res.status(404).json({ message: 'Manager not found' });
    res.json(manager);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/manager/stats ──────────────────────────────────────
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const manager = await Manager.findById(req.user.id).select('name email');
    if (!manager) return res.status(404).json({ message: 'Manager not found' });

    // TLs whose reportingManager matches this manager's name or email
    const tls = await TeamLead.find({
      role: { $ne: 'fse' },
      reportingManager: { $regex: new RegExp(manager.name.trim(), 'i') },
    }).select('_id name email');

    const tlNames  = tls.map(t => t.name.trim());
    const tlEmails = tls.map(t => t.email.trim());

    // FSEs under those TLs
    const fseCount = await TeamLead.countDocuments({
      role: 'fse',
      $or: [
        { reportingManager: { $in: tlEmails.map(e => new RegExp(e, 'i')) } },
        { reportingManager: { $in: tlNames.map(n => new RegExp(n, 'i')) } },
      ],
    });

    const fseCountUsers = await Employee.countDocuments({
      reportingManager: { $in: tlNames.map(n => new RegExp(n, 'i')) },
    });

    res.json({ totalTLs: tls.length, totalFSEs: fseCount + fseCountUsers });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/manager/my-tls ─────────────────────────────────────
router.get('/my-tls', verifyToken, async (req, res) => {
  try {
    const manager = await Manager.findById(req.user.id).select('name email');
    if (!manager) return res.status(404).json({ message: 'Manager not found' });

    const tls = await TeamLead.find({
      role: { $ne: 'fse' },
      reportingManager: { $regex: new RegExp(manager.name.trim(), 'i') },
    }).select('-password').sort({ createdAt: -1 });

    // Attach FSE count per TL
    const result = await Promise.all(tls.map(async (tl) => {
      const fseCount = await TeamLead.countDocuments({
        role: 'fse',
        reportingManager: { $regex: new RegExp(tl.email.trim(), 'i') },
      });
      const fseCountUsers = await Employee.countDocuments({
        reportingManager: { $regex: new RegExp(tl.name.trim(), 'i') },
      });
      return { ...tl.toObject(), fseCount: fseCount + fseCountUsers };
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/manager/tl/:id/fses ───────────────────────────────
router.get('/tl/:id/fses', verifyToken, async (req, res) => {
  try {
    const tl = await TeamLead.findById(req.params.id).select('name email');
    if (!tl) return res.status(404).json({ message: 'TL not found' });

    const fsesByEmail = await TeamLead.find({
      role: 'fse',
      reportingManager: { $regex: new RegExp(tl.email.trim(), 'i') },
    }).select('-password');

    const fsesByName = await Employee.find({
      reportingManager: { $regex: new RegExp(tl.name.trim(), 'i') },
    }).select('-password');

    const normalized = [
      ...fsesByEmail.map(f => ({
        _id: f._id, name: f.email, phone: String(f.phone || '').replace('.0', ''),
        location: f.location, status: f.status, position: f.position || 'FSE',
      })),
      ...fsesByName.map(e => ({
        _id: e._id, name: e.newJoinerName, phone: e.newJoinerPhone,
        location: e.location, status: e.status, position: e.position || 'FSE',
      })),
    ];

    res.json(normalized);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: GET /api/manager/pending ────────────────────────────
router.get('/pending', async (req, res) => {
  try {
    const managers = await Manager.find({ approvalStatus: 'pending' }).select('-password');
    res.json(managers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: PUT /api/manager/approve/:id ────────────────────────
router.put('/approve/:id', async (req, res) => {
  try {
    await Manager.findByIdAndUpdate(req.params.id, { approvalStatus: 'approved' });
    res.json({ message: 'Manager approved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: PUT /api/manager/reject/:id ─────────────────────────
router.put('/reject/:id', async (req, res) => {
  try {
    await Manager.findByIdAndUpdate(req.params.id, { approvalStatus: 'rejected' });
    res.json({ message: 'Manager rejected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
