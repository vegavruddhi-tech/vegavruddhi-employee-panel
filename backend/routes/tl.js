const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const upload         = require('../middleware/multer');
const TeamLead       = require('../models/TeamLead');
const Employee       = require('../models/Employee');
const TLChangeRequest = require('../models/TLChangeRequest');
const mongoose = require('mongoose');

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

// ── POST /api/tl/register ───────────────────────────────────────
router.post(
  '/register',
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'cv', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { name, phone, location, emailId, reportingManager, dob } = req.body;

      if (!name) {
        return res.status(400).json({ message: 'Name is required' });
      }

      if (!req.files?.photo) {
        return res.status(400).json({ message: 'Profile photo is required' });
      }

      await TeamLead.create({
        email:            emailId || '',
        name,
        phone:            phone || '',
        location:         location || '',
        emailId:          emailId || '',
        reportingManager: reportingManager || '',
        position:         'Team Lead',
        password:         '',
        dob:              dob || '',
        image:            req.files?.photo?.[0]?.path || '',
        cv:               req.files?.cv?.[0]?.path || '',
      });

      res.status(201).json({ message: 'Registration successful' });
    } catch (err) {
      console.error('TL register error:', err.message);
      res.status(500).json({ message: err.message });
    }
  }
);

// ── POST /api/tl/google-login ───────────────────────────────────
router.post('/google-login', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Google credential required' });

    const ticket = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload     = ticket.getPayload();
    const googleEmail = payload.email.toLowerCase();

    // Find TL by their login email
    let tl = await TeamLead.findOne({ email: { $regex: new RegExp(`^${googleEmail}$`, 'i') } });

    if (!tl) {
      return res.status(403).json({
        message: 'No registered Team Lead found with this Google account. Please register first.'
      });
    }
    if (tl.approvalStatus === 'pending') {
        return res.status(403).json({ message: 'Your account is pending admin approval. Please wait.' });
      }
      if (tl.approvalStatus === 'rejected') {
        return res.status(403).json({ message: 'Your account was rejected. Contact admin.' });
      }


    const token = jwt.sign({ id: tl._id, email: tl.email, role: 'tl' }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, tl: { name: tl.name, email: tl.email, image: tl.image, location: tl.location } });
  } catch (err) {
    console.error('TL google-login error:', err.message);
    res.status(401).json({ message: 'Google sign-in failed. Please try again.' });
  }
});

// ── GET /api/tl/profile ─────────────────────────────────────────
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const tl = await TeamLead.findById(req.user.id).select('-password');
    if (!tl) return res.status(404).json({ message: 'Team Lead not found' });
    res.json(tl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/tl/update-profile ──────────────────────────────────
router.put('/update-profile', verifyToken, async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'location', 'reportingManager', 'emailId'];
    const update  = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });
    const tl = await TeamLead.findByIdAndUpdate(req.user.id, { $set: update }, { new: true }).select('-password');
    res.json({ message: 'Profile updated', tl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/tl/update-photo ───────────────────────────────────
router.post('/update-photo', verifyToken, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No photo uploaded' });
    await TeamLead.findByIdAndUpdate(req.user.id, { image: req.file.path });
    res.json({ message: 'Photo updated', image: req.file.path });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/tl/stats ───────────────────────────────────────────
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const tl = await TeamLead.findById(req.user.id).select('name email');
    if (!tl) return res.status(404).json({ message: 'TL not found' });

    const tlName  = tl.name.trim();
    const tlEmail = tl.email.trim();

    // Search FSEs in TeamLeads collection (role=fse) by TL email as RM
    const fsesByEmail = await TeamLead.find({
      role: 'fse',
      reportingManager: { $regex: new RegExp(tlEmail, 'i') }
    });

    // Also search by TL name in Users collection
    const fsesByName = await Employee.find({
      reportingManager: { $regex: new RegExp(tlName, 'i') }
    });

    // Combine both
    const allFSEs = [...fsesByEmail, ...fsesByName];
    const total   = allFSEs.length;
    const working = allFSEs.filter(e => e.status === 'Active' || e.status === 'Working').length;
    const left    = allFSEs.filter(e => e.status !== 'Active' && e.status !== 'Working').length;

    res.json({ total, working, left });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/tl/employees ───────────────────────────────────────
router.get('/employees', verifyToken, async (req, res) => {
  try {
    const tl = await TeamLead.findById(req.user.id).select('name email');
    if (!tl) return res.status(404).json({ message: 'TL not found' });

    const tlName  = tl.name.trim();
    const tlEmail = tl.email.trim();

    // FSEs from TeamLeads collection (role=fse) matched by TL email
    const fsesByEmail = await TeamLead.find({
      role: 'fse',
      reportingManager: { $regex: new RegExp(tlEmail, 'i') }
    }).select('-password').sort({ createdAt: -1 });

    // FSEs from Users collection matched by TL name
    const fsesByName = await Employee.find({
      reportingManager: { $regex: new RegExp(tlName, 'i') }
    }).select('-password').sort({ createdAt: -1 });

    // Normalize both to same shape for frontend
    const normalized = [
      ...fsesByEmail.map(f => ({
        _id:            f._id,
        newJoinerName:  f.email,   // email field has actual name (swapped during import)
        newJoinerPhone: String(f.phone || '').replace('.0', ''),
        emailId:        f.name,    // name field has email (swapped during import)
        position:       f.position || 'FSE',
        location:       f.location,
        status:         f.status,
      })),
      ...fsesByName.map(e => ({
        _id:            e._id,
        newJoinerName:  e.newJoinerName,
        newJoinerPhone: e.newJoinerPhone,
        position:       e.position || 'FSE',
        location:       e.location,
        status:         e.status,
      }))
    ];

    res.json(normalized);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/tl/my-forms ────────────────────────────────────────
// Forms submitted by the TL themselves
router.get('/my-forms', verifyToken, async (req, res) => {
  try {
    const FormResponse = require('../models/FormResponse');
    const forms = await FormResponse.find({ submittedBy: req.user.id }).sort({ createdAt: -1 });
    res.json(forms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/tl/team-forms ──────────────────────────────────────
// Forms submitted by FSEs under this TL
router.get('/team-forms', verifyToken, async (req, res) => {
  try {
    const FormResponse = require('../models/FormResponse');
    const tl = await TeamLead.findById(req.user.id).select('name email');
    if (!tl) return res.status(404).json({ message: 'TL not found' });

    const tlEmail = tl.email.trim();

    // Get FSE IDs from TeamLeads collection (role=fse) under this TL
    const fseRecords = await TeamLead.find({
      role: 'fse',
      reportingManager: { $regex: new RegExp(tlEmail, 'i') }
    }).select('email name');

    // Get FSE IDs from Users collection under this TL
    const fseUsers = await Employee.find({
      reportingManager: { $regex: new RegExp(tl.name.trim(), 'i') }
    }).select('_id newJoinerName');

    const fseUserIds = fseUsers.map(e => e._id);
    const fseNames   = [
      ...fseRecords.map(f => f.email), // actual names stored in email field
      ...fseUsers.map(e => e.newJoinerName)
    ];

    // Get forms by FSE user IDs or employee names
    const forms = await FormResponse.find({
      $or: [
        { submittedBy: { $in: fseUserIds } },
        { employeeName: { $in: fseNames } }
      ]
    }).sort({ createdAt: -1 });

    res.json(forms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// TL submits a profile edit request
router.post('/request-edit', verifyToken, async (req, res) => {
  try {
    const { changes, reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ message: 'Reason is required' });
    if (!changes || Object.keys(changes).length === 0) return res.status(400).json({ message: 'No changes provided' });

    const tl = await TeamLead.findById(req.user.id).select('name email');
    if (!tl) return res.status(404).json({ message: 'TL not found' });

    // Check if there's already a pending request
    const existing = await TLChangeRequest.findOne({ tlId: req.user.id, status: 'pending' });
    if (existing) return res.status(400).json({ message: 'You already have a pending request. Please wait for admin to review it.' });

    const request = await TLChangeRequest.create({
      tlId:    req.user.id,
      tlName:  tl.name,
      tlEmail: tl.email,
      changes,
      reason:  reason.trim(),
    });
    res.status(201).json({ message: 'Edit request sent to admin', request });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/tl/my-request ──────────────────────────────────────
// TL checks their latest request status
router.get('/my-request', verifyToken, async (req, res) => {
  try {
    const request = await TLChangeRequest.findOne({ tlId: req.user.id }).sort({ createdAt: -1 });
    res.json(request || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/tl/change-requests ────────────────────────────────
// Admin gets all pending TL change requests
router.get('/change-requests', async (req, res) => {
  try {
    const requests = await TLChangeRequest.find({}).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/tl/change-requests/:id/approve ────────────────────
// Admin approves — applies changes to TL profile
router.put('/change-requests/:id/approve', async (req, res) => {
  try {
    const request = await TLChangeRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    // Apply changes to TL profile
    await TeamLead.findByIdAndUpdate(request.tlId, { $set: request.changes });
    await TLChangeRequest.findByIdAndUpdate(req.params.id, { status: 'approved' });

    res.json({ message: 'Request approved and profile updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/tl/change-requests/:id/reject ─────────────────────
// Admin rejects the request
router.put('/change-requests/:id/reject', async (req, res) => {
  try {
    const request = await TLChangeRequest.findByIdAndUpdate(
      req.params.id, { status: 'rejected' }, { new: true }
    );
    if (!request) return res.status(404).json({ message: 'Request not found' });
    res.json({ message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// GET /api/tl/pending — admin: get all pending TL registrations
// GET /api/tl/pending
router.get('/pending', async (req, res) => {
  try {
    const tls = await TeamLead.find({ approvalStatus: 'pending' }).select('-password');
    res.json(tls);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/tl/approve/:id
router.put('/approve/:id', async (req, res) => {
  try {
    await TeamLead.findByIdAndUpdate(req.params.id, { approvalStatus: 'approved' });
    res.json({ message: 'TL approved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/tl/reject/:id
router.put('/reject/:id', async (req, res) => {
  try {
    await TeamLead.findByIdAndUpdate(req.params.id, { approvalStatus: 'rejected' });
    res.json({ message: 'TL rejected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


module.exports = router;
// // GET all pending TLs
// router.get('/pending', async (req, res) => {
//   const tls = await TeamLead.find({ approvalStatus: 'pending' }).select('-password');
//   res.json(tls);
// });

// // Approve TL
// router.put('/approve/:id', async (req, res) => {
//   await TeamLead.findByIdAndUpdate(req.params.id, { approvalStatus: 'approved' });
//   res.json({ message: 'TL approved' });
// });

// // Reject TL
// router.put('/reject/:id', async (req, res) => {
//   await TeamLead.findByIdAndUpdate(req.params.id, { approvalStatus: 'rejected' });
//   res.json({ message: 'TL rejected' });
// });
