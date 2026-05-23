const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const upload   = require('../middleware/multer');
const Manager  = require('../models/Manager');
const TeamLead = require('../models/TeamLead');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const FormResponse   = require('../models/FormResponse');
const TLFormResponse = require('../models/TLFormResponse');
const ManagerChangeRequest = require('../models/ManagerChangeRequest');

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
    const { name, phone, email, emailId, location, dob } = req.body;
    const emailValue = email || emailId || '';
    if (!name)              return res.status(400).json({ message: 'Name is required' });
    if (!emailValue)        return res.status(400).json({ message: 'Email is required' });
    if (!req.files?.photo)  return res.status(400).json({ message: 'Profile photo is required' });

    const exists = await Manager.findOne({ email: emailValue });
    if (exists && exists.approvalStatus === 'approved') {
      return res.status(400).json({ message: 'Email already registered and approved' });
    }
    if (exists) await Manager.findByIdAndDelete(exists._id);

    await Manager.create({
      email:    emailValue,
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

    // ✅ MARK ATTENDANCE
    try {
      const now = new Date();
      const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const today = istTime.toISOString().split('T')[0];

      let attendance = await Attendance.findOne({ userId: manager._id, date: today });
      if (!attendance) {
        attendance = await Attendance.create({
          userId: manager._id,
          userEmail: manager.email,
          userName: manager.name,
          userType: 'manager',
          position: 'Manager',
          location: manager.location || '',
          reportingManager: '',
          date: today,
          firstLoginTime: now,
          lastActivityTime: now,
          attendanceMarked: true,
          reloginCount: 0,
          status: 'present'
        });
        console.log(`✅ Attendance marked (Manager): ${manager.email} at ${istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      } else {
        attendance.reloginCount += 1;
        attendance.lastActivityTime = now;
        attendance.lastLogoutTime = null;
        attendance.duration = null;
        await attendance.save();
        console.log(`✅ Re-login (Manager): ${manager.email} - Re-login #${attendance.reloginCount}`);
      }
    } catch (attErr) {
      console.error('Attendance marking error (Manager):', attErr.message);
    }

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

// ── GET /api/manager/kpi-detail ────────────────────────────────
router.get('/kpi-detail', verifyToken, async (req, res) => {
  try {
    const { type } = req.query;
    const manager = await Manager.findById(req.user.id).select('name email');
    if (!manager) return res.status(404).json({ message: 'Manager not found' });

    // Get all TLs under this manager
    const tls = await TeamLead.find({
      role: { $ne: 'fse' },
      reportingManager: { $regex: new RegExp(manager.name.trim(), 'i') },
    }).select('-password');

    const tlNames  = tls.map(t => t.name.trim());
    const tlEmails = tls.map(t => t.email.trim());

    // Get all FSEs under those TLs
    const fsesByTL = await TeamLead.find({
      role: 'fse',
      $or: [
        { reportingManager: { $in: tlEmails.map(e => new RegExp(e, 'i')) } },
        { reportingManager: { $in: tlNames.map(n => new RegExp(n, 'i')) } },
      ],
    }).select('-password');

    const fsesByEmployee = await Employee.find({
      reportingManager: { $in: tlNames.map(n => new RegExp(n, 'i')) },
    }).select('-password');

    const allFSENames = [
      ...fsesByTL.map(f => f.name),
      ...fsesByEmployee.map(f => f.newJoinerName),
    ];

    // Date helpers
    const now        = new Date();
    const todayIST   = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const todayStr   = todayIST.toISOString().split('T')[0];
    const monthStart = new Date(todayIST.getFullYear(), todayIST.getMonth(), 1);

    if (type === 'totalTLs') {
      return res.json(tls.map(t => ({
        name: t.name, email: t.email, phone: t.phone || '—', location: t.location || '—',
      })));
    }

    if (type === 'activeTLs') {
      const [fForms, tForms] = await Promise.all([
        FormResponse.find({ employeeName: { $in: allFSENames }, createdAt: { $gte: monthStart } }).select('employeeName'),
        TLFormResponse.find({ employeeName: { $in: allFSENames }, createdAt: { $gte: monthStart } }).select('employeeName'),
      ]);
      const activeNames = new Set([...fForms, ...tForms].map(f => f.employeeName));
      const activeTLs = tls.filter(tl => {
        const myFSEs = [
          ...fsesByTL.filter(f => (f.reportingManager||'').toLowerCase().includes(tl.name.toLowerCase())).map(f => f.name),
          ...fsesByEmployee.filter(f => (f.reportingManager||'').toLowerCase().includes(tl.name.toLowerCase())).map(f => f.newJoinerName),
        ];
        return myFSEs.some(n => activeNames.has(n));
      });
      return res.json(activeTLs.map(t => ({
        name: t.name, email: t.email, phone: t.phone || '—', location: t.location || '—',
      })));
    }

    if (type === 'totalFSEs') {
      const all = [
        ...fsesByTL.map(f => ({ name: f.name, email: f.email, phone: f.phone || '—', location: f.location || '—', position: f.position || 'FSE' })),
        ...fsesByEmployee.map(f => ({ name: f.newJoinerName, email: f.email || f.newJoinerEmailId, phone: f.newJoinerPhone || '—', location: f.location || '—', position: f.position || 'FSE' })),
      ];
      return res.json(all);
    }

    if (type === 'activeFSEs') {
      const [fForms, tForms] = await Promise.all([
        FormResponse.find({ employeeName: { $in: allFSENames }, createdAt: { $gte: monthStart } }).select('employeeName'),
        TLFormResponse.find({ employeeName: { $in: allFSENames }, createdAt: { $gte: monthStart } }).select('employeeName'),
      ]);
      const activeNames = new Set([...fForms, ...tForms].map(f => f.employeeName));
      const all = [
        ...fsesByTL.filter(f => activeNames.has(f.name)).map(f => ({ name: f.name, email: f.email, phone: f.phone || '—', location: f.location || '—', position: f.position || 'FSE' })),
        ...fsesByEmployee.filter(f => activeNames.has(f.newJoinerName)).map(f => ({ name: f.newJoinerName, email: f.email || f.newJoinerEmailId, phone: f.newJoinerPhone || '—', location: f.location || '—', position: f.position || 'FSE' })),
      ];
      return res.json(all);
    }

    // Forms-based KPIs
    const { dateFilter } = req.query;
    const dateQuery = dateFilter === 'alltime'
      ? { employeeName: { $in: allFSENames } }
      : { employeeName: { $in: allFSENames }, createdAt: { $gte: monthStart } };

    const [fForms, tForms] = await Promise.all([
      FormResponse.find(dateQuery).select('employeeName customerName customerNumber status verificationStatus formFillingFor createdAt'),
      TLFormResponse.find(dateQuery).select('employeeName customerName customerNumber status formFillingFor createdAt'),
    ]);
    let allForms = [...fForms, ...tForms].map(f => ({
      fse: f.employeeName,
      customer: f.customerName || '—',
      phone: f.customerNumber || '—',
      product: f.formFillingFor || '—',
      status: f.status,
      verificationStatus: f.verificationStatus || '—',
      date: new Date(f.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      _date: f.createdAt,
    }));

    if (type === 'totalForms')        return res.json(allForms);
    if (type === 'ready')             return res.json(allForms.filter(f => f.status === 'Ready for Onboarding'));
    if (type === 'fullyVerified')     return res.json(allForms.filter(f => f.verificationStatus === 'Fully Verified'));
    if (type === 'partiallyDone')     return res.json(allForms.filter(f => f.verificationStatus === 'Partially Done'));
    if (type === 'notInterested')     return res.json(allForms.filter(f => f.status === 'Not Interested'));
    if (type === 'today')             return res.json(allForms.filter(f => new Date(f._date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === todayStr));

    return res.status(400).json({ message: 'Invalid type' });

  } catch (err) {
    console.error('KPI detail error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/manager/kpis ───────────────────────────────────────
router.get('/kpis', verifyToken, async (req, res) => {
  try {
    const manager = await Manager.findById(req.user.id).select('name email');
    if (!manager) return res.status(404).json({ message: 'Manager not found' });

    // Get all TLs under this manager
    const tls = await TeamLead.find({
      role: { $ne: 'fse' },
      reportingManager: { $regex: new RegExp(manager.name.trim(), 'i') },
    }).select('_id name email');

    const tlNames  = tls.map(t => t.name.trim());
    const tlEmails = tls.map(t => t.email.trim());

    // Get all FSE names under those TLs
    const fsesByTL = await TeamLead.find({
      role: 'fse',
      $or: [
        { reportingManager: { $in: tlEmails.map(e => new RegExp(e, 'i')) } },
        { reportingManager: { $in: tlNames.map(n => new RegExp(n, 'i')) } },
      ],
    }).select('name email');

    const fsesByEmployee = await Employee.find({
      reportingManager: { $in: tlNames.map(n => new RegExp(n, 'i')) },
    }).select('newJoinerName email');

    const allFSENames = [
      ...fsesByTL.map(f => f.name),
      ...fsesByEmployee.map(f => f.newJoinerName),
    ];

    const totalTLs  = tls.length;
    const totalFSEs = allFSENames.length;

    // Date helpers
    const now      = new Date();
    const todayIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const todayStr = todayIST.toISOString().split('T')[0];

    // Apply date filter from query params
    const { dateFilter, fromDate, toDate, year, month } = req.query;
    let monthStart = new Date(todayIST.getFullYear(), todayIST.getMonth(), 1);

    if (dateFilter === 'today') {
      monthStart = new Date(todayIST.getFullYear(), todayIST.getMonth(), todayIST.getDate());
    } else if (dateFilter === 'week') {
      const ws = new Date(todayIST);
      ws.setDate(todayIST.getDate() - todayIST.getDay());
      ws.setHours(0,0,0,0);
      monthStart = ws;
    } else if (dateFilter === 'custom' && fromDate) {
      monthStart = new Date(fromDate);
    } else if (year || month !== undefined) {
      const y = year ? parseInt(year) : todayIST.getFullYear();
      const m = (month !== undefined && month !== '') ? parseInt(month) : 0;
      monthStart = new Date(y, m, 1);
    }

    let dateEnd = null;
    if (dateFilter === 'custom' && toDate) {
      dateEnd = new Date(toDate + 'T23:59:59');
    } else if (year && month !== undefined && month !== '') {
      dateEnd = new Date(parseInt(year), parseInt(month) + 1, 0, 23, 59, 59);
    } else if (year && (month === undefined || month === '')) {
      dateEnd = new Date(parseInt(year), 11, 31, 23, 59, 59);
    }

    // Forms in selected period by FSEs under this manager
    const dateQuery = dateEnd
      ? { $gte: monthStart, $lte: dateEnd }
      : { $gte: monthStart };

    const [fseFormsMonth, tlFormsMonth] = await Promise.all([
      FormResponse.find({
        employeeName: { $in: allFSENames },
        createdAt: dateQuery,
      }).select('employeeName status verificationStatus createdAt'),
      TLFormResponse.find({
        employeeName: { $in: allFSENames },
        createdAt: dateQuery,
      }).select('employeeName status createdAt'),
    ]);

    const allFormsMonth = [...fseFormsMonth, ...tlFormsMonth];

    // Today's forms
    const todayForms = allFormsMonth.filter(f => {
      const d = new Date(f.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      return d === todayStr;
    });

    // Fully Verified
    const fullyVerifiedForms = allFormsMonth.filter(f => f.verificationStatus === 'Fully Verified');

    // Partially Done
    const partiallyDoneForms = allFormsMonth.filter(f => f.verificationStatus === 'Partially Done');

    // Not Interested
    const notInterestedForms = allFormsMonth.filter(f => f.status === 'Not Interested');
    // Active TLs — for each TL, directly query forms by FSEs under that TL
    const activeTLs = await Promise.all(tls.map(async tl => {
      const [tlFSEsFromTL, tlFSEsFromEmp] = await Promise.all([
        TeamLead.find({
          role: 'fse',
          $or: [
            { reportingManager: { $regex: new RegExp(tl.email.trim(), 'i') } },
            { reportingManager: { $regex: new RegExp(tl.name.trim(), 'i') } },
          ],
        }).select('name'),
        Employee.find({
          reportingManager: { $regex: new RegExp(tl.name.trim(), 'i') },
        }).select('newJoinerName'),
      ]);

      const tlFSENames = [
        ...tlFSEsFromTL.map(f => f.name),
        ...tlFSEsFromEmp.map(f => f.newJoinerName),
      ].filter(Boolean);

      if (tlFSENames.length === 0) return null;

      const count = await FormResponse.countDocuments({
        employeeName: { $in: tlFSENames },
        createdAt: dateQuery,
      });

      return count > 0 ? tl : null;
    }));

    const activeTLsFiltered = activeTLs.filter(Boolean);

    // Active FSEs — case-insensitive match
    const activeFSENamesLower = new Set([...allFormsMonth].map(f => (f.employeeName || '').toLowerCase().trim()));
    const activeFSECount = allFSENames.filter(n =>
      activeFSENamesLower.has((n || '').toLowerCase().trim())
    ).length;

    res.json({
      totalTLs,
      activeTLs: activeTLsFiltered.length,
      totalFSEs,
      activeFSEs: activeFSECount,
      totalForms: allFormsMonth.length,
      fullyVerified: fullyVerifiedForms.length,
      partiallyDone: partiallyDoneForms.length,
      notInterested: notInterestedForms.length,
      todayForms: todayForms.length,
    });

  } catch (err) {
    console.error('Manager KPIs error:', err.message);
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

// ── GET /api/manager/tl/:id/tl-forms ──────────────────────────
router.get('/tl/:id/tl-forms', verifyToken, async (req, res) => {
  try {
    const tl = await TeamLead.findById(req.params.id).select('name');
    if (!tl) return res.status(404).json({ message: 'TL not found' });

    const { year, month } = req.query;
    let dateFilter = {};
    if (year || month !== undefined) {
      const y = year ? parseInt(year) : new Date().getFullYear();
      const m = (month !== undefined && month !== '') ? parseInt(month) : 0;
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59);
      dateFilter = { createdAt: { $gte: start, $lte: end } };
    }

    const forms = await TLFormResponse.find({ employeeName: tl.name, ...dateFilter }).sort({ createdAt: -1 }).lean();
    res.json(forms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/manager/tl/:id/fse-forms ──────────────────────────
router.get('/tl/:id/fse-forms', verifyToken, async (req, res) => {
  try {
    const tl = await TeamLead.findById(req.params.id).select('name email');
    if (!tl) return res.status(404).json({ message: 'TL not found' });

    // Get FSEs under this TL
    const fsesByEmail = await TeamLead.find({
      role: 'fse',
      reportingManager: { $regex: new RegExp(tl.email.trim(), 'i') },
    }).select('name');

    const fsesByName = await Employee.find({
      reportingManager: { $regex: new RegExp(tl.name.trim(), 'i') },
    }).select('newJoinerName');

    const fseNames = [
      ...fsesByEmail.map(f => f.name),
      ...fsesByName.map(f => f.newJoinerName),
    ].filter(Boolean);

    if (fseNames.length === 0) return res.json([]);

    // Date filter
    const { year, month } = req.query;
    let dateFilter = {};
    if (year || month !== undefined) {
      const y = year ? parseInt(year) : new Date().getFullYear();
      const m = (month !== undefined && month !== '') ? parseInt(month) : 0;
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59);
      dateFilter = { createdAt: { $gte: start, $lte: end } };
    }

    // Get all forms by these FSEs
    const [fseForms, tlForms] = await Promise.all([
      FormResponse.find({ employeeName: { $in: fseNames }, ...dateFilter }).sort({ createdAt: -1 }).lean(),
      TLFormResponse.find({ employeeName: { $in: fseNames }, ...dateFilter }).sort({ createdAt: -1 }).lean(),
    ]);

    const allForms = [...fseForms, ...tlForms];
    res.json(allForms);
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

// ── Admin: GET /api/manager/approved-list ──────────────────────
router.get('/approved-list', async (req, res) => {
  try {
    const managers = await Manager.find({ approvalStatus: 'approved' })
      .select('_id name email phone location image status createdAt')
      .sort({ name: 1 });
    res.json(managers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: GET /api/manager/rejected-list ──────────────────────
router.get('/rejected-list', async (req, res) => {
  try {
    const managers = await Manager.find({ approvalStatus: 'rejected' })
      .select('_id name email phone location image status createdAt approvalStatus')
      .sort({ name: 1 });
    res.json(managers);
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

// ── POST /api/manager/request-edit ─────────────────────────────
router.post('/request-edit', verifyToken, async (req, res) => {
  try {
    const { changes, reason } = req.body;
    if (!reason?.trim()) {
      return res.status(400).json({ message: 'Reason is required' });
    }

    const manager = await Manager.findById(req.user.id).select('name');
    if (!manager) {
      return res.status(404).json({ message: 'Manager not found' });
    }

    // Check if there's already a pending request
    const existing = await ManagerChangeRequest.findOne({
      managerId: req.user.id,
      status: 'pending'
    });

    if (existing) {
      return res.status(400).json({ message: 'You already have a pending request' });
    }

    await ManagerChangeRequest.create({
      managerId: req.user.id,
      managerName: manager.name,
      changes,
      reason: reason.trim()
    });

    res.json({ message: 'Request submitted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/manager/my-forms ───────────────────────────────────
router.get('/my-forms', verifyToken, async (req, res) => {
  try {
    const ManagerForm = require('../models/ManagerForm');
    const forms = await ManagerForm.find({ submittedBy: req.user.id }).sort({ createdAt: -1 });
    res.json(forms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/my-request', verifyToken, async (req, res) => {
  try {
    const request = await ManagerChangeRequest.findOne({
      managerId: req.user.id
    }).sort({ createdAt: -1 });

    if (!request) {
      return res.json(null);
    }

    res.json(request);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: GET /api/manager/change-requests ────────────────────
router.get('/change-requests', async (req, res) => {
  try {
    const requests = await ManagerChangeRequest.find({})
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: PUT /api/manager/change-requests/:id/approve ────────
router.put('/change-requests/:id/approve', async (req, res) => {
  try {
    const request = await ManagerChangeRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'approved' },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // Apply the changes to the manager profile
    if (request.changes) {
      await Manager.findByIdAndUpdate(request.managerId, {
        $set: request.changes
      });
    }

    res.json({ message: 'Manager profile updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: PUT /api/manager/change-requests/:id/reject ─────────
router.put('/change-requests/:id/reject', async (req, res) => {
  try {
    const request = await ManagerChangeRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected' },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    res.json({ message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
