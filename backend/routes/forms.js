const express      = require('express');
const router       = express.Router();
const jwt          = require('jsonwebtoken');
const FormResponse   = require('../models/FormResponse');
const TLFormResponse = require('../models/TLFormResponse');
const Employee     = require('../models/Employee');
const TeamLead     = require('../models/TeamLead');
const mongoose = require('mongoose');

function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Invalid token' }); }
}

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
      updateFormVerificationStatus(form._id.toString()).catch(console.error);
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
    const form = await FormResponse.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    if (!form) return res.status(404).json({ message: 'Form not found' });
    
    // Update verification status after form update
    const { updateFormVerificationStatus } = require('../utils/updateVerificationStatus');
    updateFormVerificationStatus(req.params.id).catch(console.error); // Run async, don't wait
    
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

// GET /api/forms/my  — get logged-in employee's submissions
router.get('/my', verifyToken, async (req, res) => {
  try {
    const forms = await FormResponse.find({ submittedBy: req.user.id }).sort({ createdAt: -1 });
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

// GET /api/forms/admin/employee-points — all employees with auto + adjusted points
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

// PUT /api/forms/admin/adjust-points/:employeeId — admin adds/subtracts points
router.put('/admin/adjust-points/:employeeId', async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const { adjustment } = req.body; // can be positive or negative
    if (adjustment === undefined) return res.status(400).json({ message: 'adjustment required' });

    const emp = await Employee.findByIdAndUpdate(
      req.params.employeeId,
      { $inc: { pointsAdjustment: Number(adjustment) } },
      { new: true }
    ).select('newJoinerName pointsAdjustment');

    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    res.json({ message: 'Points updated', employee: emp });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/forms/my-points — employee gets their own points adjustment
router.get('/my-points', verifyToken, async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const emp = await Employee.findById(req.user.id).select('pointsAdjustment verifiedPoints').lean();
    res.json({ pointsAdjustment: emp?.pointsAdjustment || 0, verifiedPoints: emp?.verifiedPoints || 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/forms/save-verified-points — employee dashboard saves auto-calculated verified points
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
// GET /api/forms/admin/tl-overview
router.get('/admin/tl-overview', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const [tls, users, forms] = await Promise.all([
      db.collection('TeamLeads').find({ approvalStatus: 'approved' }).toArray(),
      Employee.find({}).lean(),
      FormResponse.find({}).sort({ createdAt: -1 }).lean(),
    ]);

    const result = tls.map(tl => {
      const tlName = tl.name || tl.email;
      const fses = users.filter(u =>
        u.reportingManager && tlName &&
        u.reportingManager.trim().toLowerCase() === tlName.trim().toLowerCase()
      );
      const fseNames = fses.map(u => u.newJoinerName);
      const tlForms = forms.filter(f => fseNames.includes(f.employeeName));
      return { tl, fses, forms: tlForms };
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
      TeamLead.find({ approvalStatus: 'approved' }).select('name email phone location reportingManager status'),
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
    const points = await EmployeePoints.find({}).sort({ newJoinerName: 1 });
    res.json(points);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /api/forms/admin/adjust-points/:id ──────────────────────
// id = EmployeePoints _id OR employeeId
router.put('/admin/adjust-points/:id', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const { adjustment, reason } = req.body;
    const delta = parseFloat(adjustment) || 0;

    let doc = await EmployeePoints.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Employee points record not found' });

    doc.pointsAdjustment += delta;
    doc.adjustmentHistory.push({ delta, reason: reason || '', updatedBy: 'admin', updatedAt: new Date() });
    doc.updatedAt = new Date();
    await doc.save();

    res.json({ message: 'Points updated', doc });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/forms/admin/init-employee-points ──────────────────
// Creates EmployeePoints record if not exists for an employee
router.post('/admin/init-employee-points', async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const { newJoinerName, employeeId } = req.body;
    if (!newJoinerName) return res.status(400).json({ message: 'newJoinerName required' });

    let doc = await EmployeePoints.findOne({ newJoinerName });
    if (!doc) {
      doc = await EmployeePoints.create({ newJoinerName, employeeId: employeeId || null });
    }
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/forms/my-points ────────────────────────────────────
// Employee views their own points
router.get('/my-points', verifyToken, async (req, res) => {
  try {
    const EmployeePoints = require('../models/EmployeePoints');
    const Employee = require('../models/Employee');
    const emp = await Employee.findById(req.user.id).select('newJoinerName');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const doc = await EmployeePoints.findOne({ newJoinerName: emp.newJoinerName });
    res.json({
      newJoinerName:    emp.newJoinerName,
      verifiedPoints:   doc?.verifiedPoints   || 0,
      pointsAdjustment: doc?.pointsAdjustment || 0,
      totalPoints:      Math.round(((doc?.verifiedPoints || 0) + (doc?.pointsAdjustment || 0)) * 10) / 10,
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

    const db = mongoose.connection.db;

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
      await updateVerificationByPhone(phone);
      res.json({ message: `Verification updated for all forms with phone ${phone}` });
    } else if (formIds && Array.isArray(formIds)) {
      // Update specific forms
      await updateMultipleFormsVerification(formIds);
      res.json({ message: `Verification updated for ${formIds.length} forms` });
    } else {
      // Update all forms (use with caution!)
      const forms = await FormResponse.find({}).select('_id').limit(1000);
      await updateMultipleFormsVerification(forms.map(f => f._id.toString()));
      res.json({ message: `Verification updated for ${forms.length} forms` });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
