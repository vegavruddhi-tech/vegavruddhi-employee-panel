const express      = require('express');
const jwt          = require('jsonwebtoken');
const FormResponse   = require('../models/FormResponse');
const TLFormResponse = require('../models/TLFormResponse');
const Employee     = require('../models/Employee');
const TeamLead     = require('../models/TeamLead');

/**
 * Forms Routes with Enhanced Connection Management
 * 
 * This module provides form management endpoints using the ConnectionManager
 * for reliable database access with circuit breaker and health monitoring.
 */

module.exports = (connectionManager, connectDB) => {
  const router = express.Router();

  function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
    catch { res.status(401).json({ message: 'Invalid token' }); }
  }

  // ---------- CONNECTION MIDDLEWARE ----------
  /**
   * Middleware to ensure database connection is available
   * Adds req.db with the database connection
   * Waits for MongoDB connection if not ready yet
   */
  router.use(async (req, res, next) => {
    try {
      // Wait for MongoDB connection to be established
      const mongooseConn = await connectDB();
      
      if (!mongooseConn) {
        return res.status(503).json({
          message: 'Database connection unavailable, please try again',
          error: 'mongodb_connection_failed',
          retryAfter: 5,
          timestamp: new Date().toISOString()
        });
      }
      
      // Ensure ConnectionManager is initialized (lazy init on first request)
      await connectionManager.ensureInitialized();
      
      // Get the database connection
      req.db = connectionManager.getConnection();
      next();
    } catch (error) {
      console.error('🔴 Database connection error in forms routes:', error.message);
      
      // Determine appropriate error response based on error type
      if (error.message.includes('Circuit breaker open')) {
        return res.status(503).json({
          message: 'Database temporarily unavailable due to high error rate',
          error: 'circuit_breaker_open',
          retryAfter: 60,
          timestamp: new Date().toISOString()
        });
      } else if (error.message.includes('not ready')) {
        return res.status(503).json({
          message: 'Database connection not ready, please try again',
          error: 'database_not_ready',
          retryAfter: 5,
          timestamp: new Date().toISOString()
        });
      } else {
        return res.status(503).json({
          message: 'Database service unavailable',
          error: 'database_unavailable',
          details: error.message,
          retryAfter: 30,
          timestamp: new Date().toISOString()
        });
      }
    }
  });

// POST /api/forms/submit
router.post('/submit', verifyToken, async (req, res) => {
  try {
    const isTL = req.user.role === 'tl';
    const Model = isTL ? TLFormResponse : FormResponse;

    let employeeName = '';
    if (isTL) {
      const tl = await TeamLead.findById(req.user.id).select('name');
      employeeName = tl?.name || '';
    } else {
      const emp = await Employee.findById(req.user.id).select('newJoinerName');
      employeeName = emp?.newJoinerName || '';
    }

    // Duplicate check: only when a product is selected (onboarding only)
    // Allow same merchant + same brand if sub-type is different (e.g. Tide Insurance Accidental vs Life)
    if (req.body.formFillingFor) {
      const query = {
        submittedBy:    req.user.id,
        customerNumber: req.body.customerNumber,
        formFillingFor: req.body.formFillingFor,
      };
      // Add sub-type fields to the check so different sub-types are NOT blocked
      if (req.body.tideIns_type)      query.tideIns_type      = req.body.tideIns_type;
      if (req.body.ins_insuranceType) query.ins_insuranceType = req.body.ins_insuranceType;
      if (req.body.tideProduct)       query.tideProduct       = req.body.tideProduct;

      const existing = await Model.findOne(query);
      if (existing) {
        return res.status(409).json({
          duplicate: true,
          message: `You have already submitted a form for this merchant (${req.body.customerName}) with product "${req.body.formFillingFor}" and the same sub-type. If the details are different, please edit the existing entry.`,
          existingId: existing._id,
        });
      }
    }

    const body = { ...req.body };
    if (!body.formFillingFor) delete body.formFillingFor;

    const data = { ...body, submittedBy: req.user.id, employeeName };
    console.log(data);
    const form = await Model.create(data);
    
    // Update verification status after form creation (async, don't wait)
    if (!isTL) {
      const { updateFormVerificationStatus } = require('../utils/updateVerificationStatus');
      updateFormVerificationStatus(form._id.toString(), req.db).catch(console.error);
    }
    
    res.status(201).json({ message: 'Form submitted successfully', id: form._id });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ── ADMIN EDIT & DELETE (no auth — admin panel access) ────────

// PUT /api/forms/admin/update/:id — admin can edit any form
// PUT /api/forms/admin/update/:id — admin can update any form
router.put('/admin/update/:id', async (req, res) => {
  try {
    const { reason, ...updateData } = req.body;
    const form = await FormResponse.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    );
    if (!form) return res.status(404).json({ message: 'Form not found' });

    // Update verification status after form update
    const { updateFormVerificationStatus } = require('../utils/updateVerificationStatus');
    updateFormVerificationStatus(req.params.id, req.db).catch(console.error); // Run async, don't wait
    
    res.json({ message: 'Form updated successfully', form });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/forms/admin/delete/:id — admin can delete any form
router.delete('/admin/delete/:id', async (req, res) => {
  try {
    const form = await FormResponse.findByIdAndDelete(req.params.id);
    if (!form) return res.status(404).json({ message: 'Form not found' });
    res.json({ message: 'Form deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/forms/my  — get logged-in employee's submissions (supports impersonation)
router.get('/my', verifyToken, async (req, res) => {
  try {
    const { viewAs } = req.query;
    
    let userId = req.user.id;
    
    // If admin is impersonating, fetch forms for the target user
    if (viewAs && (req.user.isAdmin || req.user.role === 'admin')) {
      const Employee = require('../models/Employee');
      const targetUser = await Employee.findOne({ newJoinerEmailId: viewAs });
      if (!targetUser) {
        return res.status(404).json({ message: 'Target user not found' });
      }
      userId = targetUser._id;
      console.log(`🔐 Admin impersonation: Fetching forms for ${viewAs} (ID: ${userId})`);
    }
    
    const forms = await FormResponse.find({ submittedBy: userId }).sort({ createdAt: -1 });
    res.json(forms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/forms/detail/:id
router.get('/detail/:id', verifyToken, async (req, res) => {
  try {
    const isTL = req.user.role === 'tl';
    // TLs can view any form; FSEs can only view their own
    const query = isTL
      ? { _id: req.params.id }
      : { _id: req.params.id, submittedBy: req.user.id };
    const form = await FormResponse.findOne(query);
    if (!form) return res.status(404).json({ message: 'Not found' });
    res.json(form);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/forms/update/:id
router.put('/update/:id', verifyToken, async (req, res) => {
  try {
    const form = await FormResponse.findOneAndUpdate(
      { _id: req.params.id, submittedBy: req.user.id },
      { $set: req.body },
      { new: true }
    );
    if (!form) return res.status(404).json({ message: 'Not found or not authorized' });
    res.json({ message: 'Updated successfully', form });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/forms/delete/:id
router.delete('/delete/:id', verifyToken, async (req, res) => {
  try {
    const form = await FormResponse.findOneAndDelete({ _id: req.params.id, submittedBy: req.user.id });
    if (!form) return res.status(404).json({ message: 'Not found or not authorized' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN ROUTES (no auth required for admin panel access) ──────────────

// GET /api/forms/admin/all — all forms grouped by employee
router.get('/admin/all', async (req, res) => {
  try {
    const forms = await FormResponse.find({}).sort({ createdAt: -1 }).lean();
    res.json(forms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/forms/admin/duplicates — merchants submitted by multiple employees (cross-employee duplicates)
router.get('/admin/duplicates', async (req, res) => {
  try {
    const DuplicateSettlement = require('../models/DuplicateSettlement');

    // Get all settled phone+product combos to mark them (NOT exclude)
    const settled = await DuplicateSettlement.find({}).lean();
    const settledMap = {};
    settled.forEach(s => { settledMap[`${s.customerNumber}__${s.product}`] = s; });

    const groups = await FormResponse.aggregate([
      {
        $group: {
          _id: { 
            customerNumber: '$customerNumber', 
            formFillingFor: '$formFillingFor',
            // Include product-specific fields to differentiate sub-types
            tideIns_type: '$tideIns_type',           // Tide Insurance type (Accidental, Life, Cyber Security, etc.)
            ins_vehicleNumber: '$ins_vehicleNumber', // Vehicle Insurance vehicle number
            cc_cardName: '$cc_cardName',             // Credit Card name
            tideProduct: '$tideProduct'              // Tide product type (MSME, BT, etc.)
          },
          count:         { $sum: 1 },
          employees:     { $addToSet: '$employeeName' },
          employeeIds:   { $addToSet: '$submittedBy' },
          customerNames: { $addToSet: '$customerName' },
          records:       { $push: '$$ROOT' },
        }
      },
      { $match: { 'employeeIds.1': { $exists: true } } },
      { $sort: { count: -1 } }
    ]);

    // Attach settlement info to each group
    const result = groups.map(g => {
      const key        = `${g._id.customerNumber}__${g._id.formFillingFor}`;
      const settlement = settledMap[key] || null;
      return { ...g, settled: !!settlement, settlementInfo: settlement };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/forms/admin/settle-duplicate — admin marks a duplicate as settled
router.post('/admin/settle-duplicate', async (req, res) => {
  try {
    const DuplicateSettlement = require('../models/DuplicateSettlement');
    const { customerNumber, customerName, product, employees, note } = req.body;
    if (!customerNumber) return res.status(400).json({ message: 'customerNumber required' });

    // Upsert — if already settled, update the record
    await DuplicateSettlement.findOneAndUpdate(
      { customerNumber, product },
      { customerNumber, customerName, product, employees, note: note || '', settledAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ message: 'Duplicate marked as settled' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/forms/admin/settlements — all settled duplicate records
router.get('/admin/settlements', async (req, res) => {
  try {
    const DuplicateSettlement = require('../models/DuplicateSettlement');
    const settlements = await DuplicateSettlement.find({}).sort({ settledAt: -1 }).lean();
    res.json(settlements);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POINTS SYSTEM ────────────────────────────────────────────

const POINTS_MAP = {
  'Tide':             2,
  'MSME':             0.3,
  'Tide Insurance':   1,
  'Tide Credit Card': 1,
};

// ⚠️ OLD ENDPOINT - DISABLED - Returns Employee collection instead of EmployeePoints
// GET /api/forms/admin/employee-points — all employees with auto + adjusted points
/*
router.get('/admin/employee-points', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Employee = require('../models/Employee');

    // Get all fully-verified forms grouped by employee
    // We can't know verification status server-side (it's checked via external sheet),
    // so we return all forms and let the client calculate auto-points,
    // but we store admin adjustments in Employee.pointsAdjustment
    const employees = await Employee.find({ approvalStatus: 'approved' })
      .select('_id newJoinerName pointsAdjustment verifiedPoints').lean();

    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
*/

// ⚠️ OLD ENDPOINT - DISABLED - Use the one at line 667 instead
// PUT /api/forms/admin/adjust-points/:employeeId — admin adds/subtracts points
// Accepts either Employee._id OR EmployeePoints._id
/*
router.put('/admin/adjust-points/:employeeId', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const Employee = require('../models/Employee');
    const { adjustment, reason } = req.body;
    if (adjustment === undefined) return res.status(400).json({ message: 'adjustment required' });

    // Try Employee._id first, then EmployeePoints._id
    let emp = null;
    let realEmployeeId = req.params.employeeId;

    try { emp = await Employee.findById(req.params.employeeId).select('newJoinerName _id'); } catch {}

    if (!emp) {
      // It's an EmployeePoints _id — look up via that
      const epDoc = await EmployeePoints.findById(req.params.employeeId).catch(() => null);
      if (epDoc) {
        emp = await Employee.findOne({ newJoinerName: epDoc.newJoinerName }).select('newJoinerName _id').catch(() => null);
        if (emp) realEmployeeId = emp._id.toString();
      }
    }

    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    // Store in EmployeePoints with history
    const doc = await EmployeePoints.findOneAndUpdate(
      { newJoinerName: emp.newJoinerName },
      {
        $inc: { pointsAdjustment: Number(adjustment) },
        $push: { adjustmentHistory: { delta: Number(adjustment), reason: reason || '', updatedBy: 'admin', updatedAt: new Date() } },
        $set: { updatedAt: new Date() }
      },
      { upsert: true, new: true }
    );

    // Also update Employee.pointsAdjustment for backward compat
    await Employee.findByIdAndUpdate(realEmployeeId, { $inc: { pointsAdjustment: Number(adjustment) } });

    // Note: Frontend handles notifications via /requests/notify-points
    // to support per-product breakdown notifications

    res.json({ message: 'Points updated', doc });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
*/

// DELETE /api/forms/admin/adjust-points/:employeeId/history/:historyId — delete a specific adjustment
router.delete('/admin/adjust-points/:employeeId/history/:historyId', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const Employee = require('../models/Employee');
    const ChangeRequest = require('../models/ChangeRequest');
    const { deleteReason } = req.body;

    // Try EmployeePoints._id first, then employeeId field, then Employee lookup
    let doc = await EmployeePoints.findById(req.params.employeeId).catch(() => null);
    if (!doc) doc = await EmployeePoints.findOne({ employeeId: req.params.employeeId });
    if (!doc) {
      const emp = await Employee.findById(req.params.employeeId).select('newJoinerName');
      if (!emp) return res.status(404).json({ message: 'Employee not found' });
      doc = await EmployeePoints.findOne({
        newJoinerName: { $regex: new RegExp(`^${emp.newJoinerName.trim()}\\s*$`, 'i') }
      });
      if (!doc) return res.status(404).json({ message: 'Points record not found' });
      req._empName = emp.newJoinerName;
    }
    req._empDoc  = doc;
    req._empName = req._empName || doc.newJoinerName;

    const empDoc = req._empDoc;
    const entry = empDoc.adjustmentHistory.id(req.params.historyId);
    if (!entry) return res.status(404).json({ message: 'Adjustment not found' });

    const delta = entry.delta;

    // Remove from history and reverse the adjustment
    empDoc.adjustmentHistory.pull(req.params.historyId);
    empDoc.pointsAdjustment = (empDoc.pointsAdjustment || 0) - delta;
    empDoc.updatedAt = new Date();
    await empDoc.save();

    // Sync Employee.pointsAdjustment
    await Employee.findByIdAndUpdate(req.params.employeeId, { $inc: { pointsAdjustment: -delta } });

    // Notify FSE about deletion — permanent, never deleted by admin
    try {
      const { autoPoints: frontendAutoPoints } = req.body;
      const verifiedPts = frontendAutoPoints !== undefined
        ? Number(frontendAutoPoints)
        : (empDoc.verifiedPoints || 0);
      const beforeTotal   = Math.round((verifiedPts + empDoc.pointsAdjustment + delta) * 10) / 10;
      const newTotalAfter = Math.round((verifiedPts + empDoc.pointsAdjustment) * 10) / 10;
      const notifReason = `Admin removed a previous adjustment of ${delta >= 0 ? '+' : ''}${delta} pts. Reason: ${deleteReason || 'No reason provided'}`;

      // FSE notification — permanent
      await ChangeRequest.create({
        type: 'points_adjustment',
        employeeId: req.params.employeeId,
        employeeName: req._empName,
        profileChanges: { adjustment: -delta, deleted: true, beforeTotal, newTotal: newTotalAfter },
        reason: notifReason,
        status: 'approved',
      });

      // Admin activity log — deletable by admin
      const PointsActivityLog = require('../models/PointsActivityLog');
      await PointsActivityLog.create({
        employeeId: req.params.employeeId,
        employeeName: req._empName,
        adjustment: -delta,
        beforeTotal,
        newTotal: newTotalAfter,
        reason: notifReason,
      });

      // TL notification — permanent
      try {
        const emp2 = await Employee.findById(req.params.employeeId).select('reportingManager');
        if (emp2?.reportingManager) {
          const TeamLead = require('../models/TeamLead');
          const allTLs = await TeamLead.find({}).select('_id name email').lean();
          const rmLower = emp2.reportingManager.trim().toLowerCase();
          const tl = allTLs.find(t =>
            (t.name || '').trim().toLowerCase() === rmLower ||
            (t.email || '').trim().toLowerCase() === rmLower
          );
          if (tl) {
            const TLNotification = require('../models/TLNotification');
            await TLNotification.create({
              tlId: tl._id, tlName: tl.name, type: 'fse_points_update',
              fseName: req._empName, adjustment: -delta, beforeTotal, newTotal: newTotalAfter,
              reason: notifReason,
            });
          }
        }
      } catch { /* ignore */ }
    } catch { /* ignore */ }

    res.json({ message: 'Adjustment deleted', newTotal: empDoc.pointsAdjustment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/forms/admin/adjustment-history/:employeeId — get adjustment history
router.get('/admin/adjustment-history/:employeeId', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const Employee = require('../models/Employee');
    const emp = await Employee.findById(req.params.employeeId).select('newJoinerName');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    const doc = await EmployeePoints.findOne({ newJoinerName: emp.newJoinerName });
    res.json(doc?.adjustmentHistory || []);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ⚠️ OLD ENDPOINT REMOVED - Use the one at line 858 instead (EmployeePoints collection)
// GET /api/forms/my-points — employee gets their own points adjustment
/*
router.get('/my-points', verifyToken, async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const emp = await Employee.findById(req.user.id).select('pointsAdjustment verifiedPoints').lean();
    res.json({ pointsAdjustment: emp?.pointsAdjustment || 0, verifiedPoints: emp?.verifiedPoints || 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
*/

// ⚠️ OLD ENDPOINT REMOVED - Use the one at line 616 instead (EmployeePoints collection)
// PUT /api/forms/save-verified-points — employee dashboard saves auto-calculated verified points
/*
router.put('/save-verified-points', verifyToken, async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const { verifiedPoints } = req.body;
    await Employee.findByIdAndUpdate(req.user.id, { verifiedPoints: Number(verifiedPoints) || 0 });
    res.json({ message: 'Saved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
*/
// GET /api/forms/admin/tl-overview
router.get('/admin/tl-overview', async (req, res) => {
  try {
    // Use connection from middleware
    const db = req.db;
    const [tls, users, forms] = await Promise.all([
      db.collection('TeamLeads').find({ $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }] }).toArray(),
      Employee.find({}).lean(),
      FormResponse.find({}).sort({ createdAt: -1 }).lean(),
    ]);

    // Also get FSEs from TeamLeads collection (role=fse)
    const tlFSEs = tls.filter(t => t.role === 'fse');

    const result = tls
      .filter(t => t.role !== 'fse') // only actual TLs
      .map(tl => {
        const tlName  = (tl.name  || '').trim();
        const tlEmail = (tl.email || '').trim();

        // FSEs from Users collection matched by TL name (case-insensitive)
        const fsesFromUsers = users.filter(u =>
          u.reportingManager &&
          u.reportingManager.trim().toLowerCase() === tlName.toLowerCase()
        );

        // FSEs from TeamLeads collection matched by TL email as reportingManager
        const fsesFromTL = tlFSEs.filter(f =>
          f.reportingManager &&
          (f.reportingManager.trim().toLowerCase() === tlEmail.toLowerCase() ||
           f.reportingManager.trim().toLowerCase() === tlName.toLowerCase())
        );

        // Combine all FSE names
        const fseNamesFromUsers = fsesFromUsers.map(u => u.newJoinerName).filter(Boolean);
        const fseNamesFromTL    = fsesFromTL.map(f => f.email || f.name).filter(Boolean); // email field has actual name

        const allFseNames = [...new Set([...fseNamesFromUsers, ...fseNamesFromTL])];

        // All FSE objects combined
        const allFses = [
          ...fsesFromUsers,
          ...fsesFromTL.map(f => ({
            _id: f._id,
            newJoinerName: f.email, // swapped during import
            newJoinerPhone: String(f.phone || '').replace('.0', ''),
            email: f.name,          // swapped during import
            location: f.location,
            status: f.status,
            reportingManager: tlName,
          }))
        ];

        // Forms by FSEs + TL's own forms
        const tlForms = forms.filter(f =>
          allFseNames.includes(f.employeeName) ||
          f.employeeName === tlName
        );

        return { tl, fses: allFses, forms: tlForms };
      });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get('/admin/overview', async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const TeamLead = require('../models/TeamLead');

    const [forms, employees, tls] = await Promise.all([
      FormResponse.find({}).sort({ createdAt: -1 }),
      Employee.find({ approvalStatus: 'approved' }).select('newJoinerName newJoinerPhone newJoinerEmailId reportingManager position location status'),
      TeamLead.find({ $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }] }).select('name email phone location reportingManager status'),
    ]);

    res.json({ forms, employees, tls });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/forms/save-verified-points ────────────────────────
// Employee saves their auto-calculated verified points
router.put('/save-verified-points', verifyToken, async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const Employee = require('../models/Employee');
    const { verifiedPoints } = req.body;

    const emp = await Employee.findById(req.user.id).select('newJoinerName');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    await EmployeePoints.findOneAndUpdate(
      { newJoinerName: emp.newJoinerName },
      { $set: { newJoinerName: emp.newJoinerName, employeeId: req.user.id, verifiedPoints: verifiedPoints || 0, updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    res.json({ message: 'Verified points saved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/forms/admin/employee-points ───────────────────────
router.get('/admin/employee-points', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const points = await EmployeePoints.find({}).sort({ newJoinerName: 1 }).lean();
    
    console.log('📊 Returning employee points, count:', points.length);
    if (points.length > 0) {
      console.log('📊 Sample record:', JSON.stringify(points[0], null, 2));
    }
    
    res.json(points);
  } catch (err) {
    console.error('❌ Error fetching employee points:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/forms/admin/employee-points/:name ─────────────────
// Get specific employee's points data for debugging
router.get('/admin/employee-points/:name', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const data = await EmployeePoints.findOne({ newJoinerName: req.params.name }).lean();
    
    console.log('📊 Employee points for', req.params.name, ':', JSON.stringify(data, null, 2));
    
    if (!data) {
      return res.status(404).json({ message: 'Employee points not found' });
    }
    
    res.json(data);
  } catch (err) {
    console.error('❌ Error fetching employee points:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/forms/admin/adjust-points/:id ──────────────────────
// id = EmployeePoints _id OR employeeId
router.put('/admin/adjust-points/:id', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const { adjustment, reason, productSlabs } = req.body;
    const delta = parseFloat(adjustment) || 0;

    console.log('📝 Adjust points request:', { 
      id: req.params.id, 
      delta, 
      reason, 
      productSlabs: JSON.stringify(productSlabs, null, 2)
    });

    let doc = await EmployeePoints.findById(req.params.id);
    if (!doc) {
      console.error('❌ Employee points record not found:', req.params.id);
      return res.status(404).json({ message: 'Employee points record not found' });
    }

    // Normalize name to prevent duplicates
    const normalizedName = doc.newJoinerName.trim();
    if (doc.newJoinerName !== normalizedName) {
      doc.newJoinerName = normalizedName;
    }

    console.log('✅ Found employee points record BEFORE update:', { 
      newJoinerName: doc.newJoinerName, 
      currentAdjustment: doc.pointsAdjustment,
      currentSlabs: JSON.stringify(doc.productSlabs, null, 2)
    });

    doc.pointsAdjustment += delta;
    
    // ✅ Save product slabs as plain object
    if (productSlabs !== undefined) {
      // Notifications handled by frontend via /points-activity/bulk-create
      console.log('💾 Setting productSlabs to:', JSON.stringify(productSlabs, null, 2));
      doc.productSlabs = productSlabs;
      doc.markModified('productSlabs');
    }

    // Only record history if there was an actual adjustment
    if (delta !== 0) {
      doc.adjustmentHistory.push({ 
        delta, 
        reason: reason || '', 
        updatedBy: 'admin', 
        updatedAt: new Date() 
      });
    }
    doc.updatedAt = new Date();
    
    // Save and wait for it to complete
    await doc.save();
    console.log('💾 Document saved to database');
    
    // Fetch fresh data directly from database to confirm save
    const freshDoc = await EmployeePoints.findById(req.params.id).lean();
    
    console.log('✅ Points updated successfully - AFTER save from DB:', { 
      newJoinerName: freshDoc.newJoinerName, 
      newAdjustment: freshDoc.pointsAdjustment,
      newSlabs: JSON.stringify(freshDoc.productSlabs, null, 2)
    });

    res.json({ message: 'Points updated', doc: freshDoc });

    // ── Notify FSE + TL for manual adjustment ────────────────────────────
    if (delta !== 0) {
      try {
        const ChangeRequest  = require('../models/ChangeRequest');
        const TLNotification = require('../models/TLNotification');

        const empName = freshDoc.newJoinerName.trim();
        const emp = await Employee.findOne({
          newJoinerName: { $regex: new RegExp(`^${empName}\\s*$`, 'i') }
        }).select('_id reportingManager');

        // Calculate slab bonus from productSlabs
        let slabBonus = 0;
        if (freshDoc.productSlabs) {
          Object.values(freshDoc.productSlabs).forEach(ps => {
            const tiers = ps?.slabTiers || (Array.isArray(ps) ? ps : []);
            tiers.forEach(t => { slabBonus += (parseFloat(t.forms) || 0) * (parseFloat(t.multiplier) || 0); });
          });
        }
        slabBonus = Math.round(slabBonus * 100) / 100;

        const verifiedPts = freshDoc.verifiedPoints || 0;
        const newTotal    = Math.round((verifiedPts + slabBonus + freshDoc.pointsAdjustment) * 100) / 100;
        const beforeTotal = Math.round((newTotal - delta) * 100) / 100;
        const adjReason   = reason || (delta >= 0 ? 'Manual points added by admin' : 'Manual points deducted by admin');

        if (emp) {
          await ChangeRequest.create({
            type:         'points_adjustment',
            employeeId:   emp._id,
            employeeName: freshDoc.newJoinerName,
            profileChanges: {
              product:    'Manual Adjustment',
              slabDetails: { forms: 1, multiplier: Math.abs(delta), points: Math.abs(delta) },
              reason:     adjReason,
              actionType: delta >= 0 ? 'added' : 'removed',
              beforeTotal,
              newTotal
            },
            status:       'approved',
            reason:       adjReason,
            acknowledged: false,
            createdAt:    new Date()
          });

          // TL notification
          if (emp.reportingManager) {
            const allTLs = await TeamLead.find({}).select('_id name email').lean();
            const rmLower = emp.reportingManager.trim().toLowerCase();
            const tl = allTLs.find(t =>
              (t.name || '').trim().toLowerCase() === rmLower ||
              (t.email || '').trim().toLowerCase() === rmLower
            );
            if (tl) {
              await TLNotification.create({
                tlId:         tl._id,
                tlName:       tl.name,
                type:         'fse_points_update',
                fseName:      freshDoc.newJoinerName,
                adjustment:   delta,
                beforeTotal,
                newTotal,
                reason:       adjReason,
                acknowledged: false,
                createdAt:    new Date()
              });
            }
          }
        }
      } catch (notifErr) {
        console.error('⚠️ Manual adjustment notification failed:', notifErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Error in adjust-points:', err);
    res.status(500).json({ message: err.message, error: err.toString(), stack: err.stack });
  }
});

// ── POST /api/forms/admin/init-employee-points ──────────────────
// Creates EmployeePoints record if not exists for an employee
router.post('/admin/init-employee-points', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const { newJoinerName, employeeId } = req.body;
    if (!newJoinerName) return res.status(400).json({ message: 'newJoinerName required' });

    const trimmedName = newJoinerName.trim();
    let doc = await EmployeePoints.findOne({
      newJoinerName: { $regex: new RegExp(`^${trimmedName}\\s*$`, 'i') }
    });
    if (!doc) {
      doc = await EmployeePoints.create({ newJoinerName: trimmedName, employeeId: employeeId || null });
    }
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/forms/my-points ────────────────────────────────────
// Employee views their own points (supports impersonation)
router.get('/my-points', verifyToken, async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const Employee = require('../models/Employee');
    
    const { viewAs } = req.query;
    let empName;
    
    // If admin is impersonating, fetch points for the target user
    if (viewAs && (req.user.isAdmin || req.user.role === 'admin')) {
      const targetUser = await Employee.findOne({ newJoinerEmailId: viewAs }).select('newJoinerName');
      if (!targetUser) {
        return res.status(404).json({ message: 'Target user not found' });
      }
      empName = targetUser.newJoinerName;
      console.log(`🔐 Admin impersonation: Fetching points for ${viewAs} (${empName})`);
    } else {
      const emp = await Employee.findById(req.user.id).select('newJoinerName');
      if (!emp) return res.status(404).json({ message: 'Employee not found' });
      empName = emp.newJoinerName;
    }

    const trimmedName = empName.trim();
    // Find the record with slabs if multiple exist
    const docs = await EmployeePoints.find({
      newJoinerName: { $regex: new RegExp(`^${trimmedName}\\s*$`, 'i') }
    }).lean();
    const doc = docs.find(d => d.productSlabs && Object.keys(d.productSlabs).length > 0) || docs[0];

    // Calculate slab bonus
    let slabBonus = 0;
    if (doc?.productSlabs) {
      Object.values(doc.productSlabs).forEach(ps => {
        const tiers = ps?.slabTiers || (Array.isArray(ps) ? ps : []);
        tiers.forEach(t => { slabBonus += (parseFloat(t.forms) || 0) * (parseFloat(t.multiplier) || 0); });
      });
    }
    slabBonus = Math.round(slabBonus * 100) / 100;

    const verifiedPoints   = doc?.verifiedPoints   || 0;
    const pointsAdjustment = doc?.pointsAdjustment || 0;
    const totalPoints      = Math.round((verifiedPoints + slabBonus + pointsAdjustment) * 10) / 10;

    res.json({
      newJoinerName:    empName,
      verifiedPoints,
      slabBonus,
      pointsAdjustment,
      totalPoints,
      adjustmentHistory: doc?.adjustmentHistory || []
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/forms/admin/recalculate-all-points ───────────────
// Runs verification for ALL employees' forms and saves points automatically
// Called by cron or manually — no frontend interaction needed
router.post('/admin/recalculate-all-points', async (req, res) => {
  try {
    const EmployeePoints   = require('../models/EmployeePoints');
    const VerificationRule = require('../models/VerificationRule');
    const { verifyMerchant } = require('../utils/verifyMerchant');

    // Must match exactly what the frontend Dashboard.js uses
    const POINTS_MAP = {
      'Tide':             2,
      'Tide MSME':        0.3,
      'Tide Insurance':   1,
      'Tide Credit Card': 1,
      'Tide BT':          1,
    };

    // Use connection from middleware
    const db = req.db;

    // Get all forms grouped by employee
    const allForms = await FormResponse.find({}).lean();

    // Group forms by employeeName
    const byEmployee = {};
    allForms.forEach(f => {
      const name = f.employeeName || 'Unknown';
      if (!byEmployee[name]) byEmployee[name] = [];
      byEmployee[name].push(f);
    });

    let updatedCount = 0;

    for (const [employeeName, forms] of Object.entries(byEmployee)) {
      if (employeeName === 'Unknown') continue;

      let autoPoints = 0;
      const counted = new Set(); // deduplicate by customerNumber+product

      // Run verification for each form
      for (const f of forms) {
        try {
          const product = f.formFillingFor || '';
          const month   = f.createdAt
            ? new Date(f.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' })
            : '';

          // Deduplicate — same merchant+product only counts once
          const dedupKey = `${f.customerNumber}__${product.toLowerCase().trim()}`;
          if (counted.has(dedupKey)) continue;

          const result = await verifyMerchant(
            db,
            f.customerNumber,
            f.customerName || '',
            VerificationRule,
            product,
            month
          );

          if (result.status === 'Fully Verified') {
            counted.add(dedupKey); // mark as counted only when verified
            autoPoints += POINTS_MAP[product] || 0;
          }
        } catch (e) {
          // skip individual form errors
        }
      }

      autoPoints = Math.round(autoPoints * 10) / 10;

      // Save to EmployeePoints collection
      await EmployeePoints.findOneAndUpdate(
        { newJoinerName: employeeName },
        {
          $set: {
            newJoinerName: employeeName,
            verifiedPoints: autoPoints,
            updatedAt: new Date()
          }
        },
        { upsert: true, new: true }
      );

      updatedCount++;
    }

    res.json({ message: `Points recalculated for ${updatedCount} employees` });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/forms/admin/refresh-verification — Refresh verification status for all or specific forms
router.post('/admin/refresh-verification', async (req, res) => {
  try {
    const { formIds, phone } = req.body;
    const { updateFormVerificationStatus, updateMultipleFormsVerification, updateVerificationByPhone } = require('../utils/updateVerificationStatus');
    
    if (phone) {
      // Update all forms with this phone number
      await updateVerificationByPhone(phone, req.db);
      res.json({ message: `Verification updated for all forms with phone ${phone}` });
    } else if (formIds && Array.isArray(formIds)) {
      // Update specific forms
      await updateMultipleFormsVerification(formIds, req.db);
      res.json({ message: `Verification updated for ${formIds.length} forms` });
    } else {
      // Update all forms (use with caution!)
      const forms = await FormResponse.find({}).select('_id').limit(1000);
      await updateMultipleFormsVerification(forms.map(f => f._id.toString()), req.db);
      res.json({ message: `Verification updated for ${forms.length} forms` });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/forms/admin/delete-slab ─────────────────────────────────────
router.post('/admin/delete-slab', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const ChangeRequest  = require('../models/ChangeRequest');
    const TLNotification = require('../models/TLNotification');
    const { empPointsId, product, tierIdx, deleteReason } = req.body;

    if (!empPointsId || !product || tierIdx === undefined) {
      return res.status(400).json({ message: 'empPointsId, product and tierIdx required' });
    }

    // Find the record — prefer the one that actually has slabs for this product
    let doc = await EmployeePoints.findById(empPointsId);
    if (!doc) return res.status(404).json({ message: 'Employee points record not found' });

    console.log(`[delete-slab] Found doc: "${doc.newJoinerName}", has product "${product}":`, !!doc.productSlabs?.[product]);

    // If this doc has no slabs for the product, find the correct one by name
    if (!doc.productSlabs?.[product]) {
      console.log(`[delete-slab] Searching for better record by name: "${doc.newJoinerName}"`);
      const better = await EmployeePoints.findOne({
        newJoinerName: { $regex: new RegExp(`^${doc.newJoinerName.trim()}\\s*$`, 'i') },
        [`productSlabs.${product}`]: { $exists: true }
      });
      console.log(`[delete-slab] Better record found:`, better ? better._id : 'NONE');
      if (better) doc = better;
    }

    const ps = doc.productSlabs?.[product];
    if (!ps) return res.status(404).json({ message: `No slabs found for product "${product}"` });

    // Support both new {slabTiers:[]} and old flat array format
    const tiers = ps.slabTiers || (Array.isArray(ps) ? ps : []);
    const deleted = tiers[tierIdx];
    if (!deleted) return res.status(404).json({ message: `Slab tier at index ${tierIdx} not found` });

    const pts = Math.round((parseFloat(deleted.forms) || 0) * (parseFloat(deleted.multiplier) || 0) * 10) / 10;

    // Remove the tier
    const updatedTiers = tiers.filter((_, i) => i !== tierIdx);
    const newProductSlabs = { ...doc.productSlabs };
    if (updatedTiers.length === 0) {
      delete newProductSlabs[product];
    } else {
      // Preserve format — if was flat array keep flat array, else use slabTiers
      newProductSlabs[product] = ps.slabTiers
        ? { slabTiers: updatedTiers }
        : updatedTiers;
    }
    doc.productSlabs = newProductSlabs;
    doc.markModified('productSlabs');
    await doc.save();

    // Notifications are sent by the frontend via /points-activity/bulk-create
    res.json({ message: 'Slab deleted', updatedSlabs: doc.productSlabs });
  } catch (err) {
    console.error('[delete-slab] Error:', err.message, err.stack);
    res.status(500).json({ message: err.message });
  }
});

  return router;
};
