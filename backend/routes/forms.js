const express      = require('express');
const router       = express.Router();
const jwt          = require('jsonwebtoken');
const FormResponse = require('../models/FormResponse');
const Employee     = require('../models/Employee');

function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Invalid token' }); }
}

// POST /api/forms/submit
router.post('/submit', verifyToken, async (req, res) => {
  try {
    const emp = await Employee.findById(req.user.id).select('newJoinerName');

    // Duplicate check: only when a product is selected (onboarding only)
    if (req.body.formFillingFor) {
      const existing = await FormResponse.findOne({
        submittedBy:    req.user.id,
        customerNumber: req.body.customerNumber,
        formFillingFor: req.body.formFillingFor,
      });
      if (existing) {
        return res.status(409).json({
          duplicate: true,
          message: `You have already submitted a form for this merchant (${req.body.customerName}) with product "${req.body.formFillingFor}". If the details are different, please edit the existing entry.`,
          existingId: existing._id,
        });
      }
    }  // ← if block ends HERE

    // This runs for ALL statuses
    const body = { ...req.body };
    if (!body.formFillingFor) delete body.formFillingFor;

    const data = { ...body, submittedBy: req.user.id, employeeName: emp?.newJoinerName || '' };
    console.log(data);
    const form = await FormResponse.create(data);
    res.status(201).json({ message: 'Form submitted successfully', id: form._id });

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
    const form = await FormResponse.findOne({ _id: req.params.id, submittedBy: req.user.id });
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
          _id: { customerNumber: '$customerNumber', formFillingFor: '$formFillingFor' },
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

module.exports = router;
