const express       = require('express');
const router        = express.Router();
const jwt           = require('jsonwebtoken');
const ChangeRequest = require('../models/ChangeRequest');
const Employee      = require('../models/Employee');
const FormResponse  = require('../models/FormResponse');

function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Invalid token' }); }
}

// POST /api/requests/profile — employee requests profile change
router.post('/profile', verifyToken, async (req, res) => {
  try {
    const emp = await Employee.findById(req.user.id).select('newJoinerName');
    const request = await ChangeRequest.create({
      type: 'profile_change',
      employeeId:     req.user.id,
      employeeName:   emp.newJoinerName,
      profileChanges: req.body.changes,
      reason:         req.body.reason || ''
    });
    res.status(201).json({ message: 'Profile change request sent to admin', request });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/requests/merchant-edit — employee requests merchant edit
router.post('/merchant-edit', verifyToken, async (req, res) => {
  try {
    const emp = await Employee.findById(req.user.id).select('newJoinerName');
    const request = await ChangeRequest.create({
      type: 'merchant_edit',
      employeeId:      req.user.id,
      employeeName:    emp.newJoinerName,
      merchantId:      req.body.merchantId,
      merchantName:    req.body.merchantName,
      merchantChanges: req.body.changes,
      reason:          req.body.reason || ''
    });
    res.status(201).json({ message: 'Merchant edit request sent to admin', request });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/requests/merchant-delete — employee requests merchant delete
router.post('/merchant-delete', verifyToken, async (req, res) => {
  try {
    const emp = await Employee.findById(req.user.id).select('newJoinerName');
    const request = await ChangeRequest.create({
      type: 'merchant_delete',
      employeeId:   req.user.id,
      employeeName: emp.newJoinerName,
      merchantId:   req.body.merchantId,
      merchantName: req.body.merchantName,
      reason:       req.body.reason || ''
    });
    res.status(201).json({ message: 'Merchant delete request sent to admin', request });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/requests/notify-duplicate — admin notifies both employees about a duplicate merchant
router.post('/notify-duplicate', async (req, res) => {
  try {
    const { employeeNames, merchantName, merchantPhone, product } = req.body;
    if (!employeeNames || !employeeNames.length) return res.status(400).json({ message: 'employeeNames required' });

    // Find employee IDs by name
    const employees = await Employee.find({ newJoinerName: { $in: employeeNames } }).select('_id newJoinerName');
    if (!employees.length) return res.status(404).json({ message: 'No matching employees found' });

    // Create a duplicate_alert notification for each employee
    const notifications = await Promise.all(employees.map(emp => {
      const others = employees.filter(e => e._id.toString() !== emp._id.toString()).map(e => e.newJoinerName);
      return ChangeRequest.create({
        type:                   'duplicate_alert',
        employeeId:             emp._id,
        employeeName:           emp.newJoinerName,
        duplicateMerchantName:  merchantName,
        duplicateMerchantPhone: merchantPhone,
        duplicateOtherEmployee: others.join(', '),
        status:                 'approved', // show immediately as a notification
        acknowledged:           false,
      });
    }));

    res.json({ message: `Notified ${notifications.length} employee(s)`, count: notifications.length });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/requests/my-notifications — employee checks their approved/rejected requests
router.get('/my-notifications', verifyToken, async (req, res) => {
  try {
    const requests = await ChangeRequest.find({
      employeeId: req.user.id,
      status: { $in: ['approved', 'rejected'] }
    }).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/requests/:id/acknowledge — employee marks notification as seen
router.put('/:id/acknowledge', verifyToken, async (req, res) => {
  try {
    await ChangeRequest.findOneAndUpdate(
      { _id: req.params.id, employeeId: req.user.id },
      { $set: { acknowledged: true } }
    );
    res.json({ message: 'Acknowledged' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});
router.get('/all', async (req, res) => {
  try {
    const requests = await ChangeRequest.find({}).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/requests/all-points-activity — admin gets all points_adjustment history (separate from FSE notifications)
router.get('/all-points-activity', async (req, res) => {
  try {
    const PointsActivityLog = require('../models/PointsActivityLog');
    const logs = await PointsActivityLog.find({})
      .sort({ createdAt: -1 })
      .limit(500);
    res.json(logs);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/requests/delete-notification/:id — admin deletes from activity log only (FSE/TL notifications unaffected)
router.delete('/delete-notification/:id', async (req, res) => {
  try {
    const PointsActivityLog = require('../models/PointsActivityLog');
    await PointsActivityLog.findByIdAndDelete(req.params.id);
    res.json({ message: 'Activity log entry deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/requests/delete-notifications-bulk — admin bulk deletes from activity log only
router.delete('/delete-notifications-bulk', async (req, res) => {
  try {
    const PointsActivityLog = require('../models/PointsActivityLog');
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ message: 'ids required' });
    await PointsActivityLog.deleteMany({ _id: { $in: ids } });
    res.json({ message: `${ids.length} entries deleted` });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/requests/:id/approve — admin approves
router.put('/:id/approve', async (req, res) => {
  try {
    const request = await ChangeRequest.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    if (!request) return res.status(404).json({ message: 'Not found' });

    // Apply the change
    if (request.type === 'profile_change' && request.profileChanges) {
      await Employee.findByIdAndUpdate(request.employeeId, { $set: request.profileChanges });
    }
    if (request.type === 'merchant_edit' && request.merchantChanges) {
      await FormResponse.findByIdAndUpdate(request.merchantId, { $set: request.merchantChanges });
    }
    if (request.type === 'merchant_delete') {
      await FormResponse.findByIdAndDelete(request.merchantId);
    }

    res.json({ message: 'Approved and applied' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/requests/:id/reject — admin rejects
router.put('/:id/reject', async (req, res) => {
  try {
    await ChangeRequest.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    res.json({ message: 'Rejected' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;


// POST /api/requests/notify-points — admin notifies FSE about points adjustment
router.post('/notify-points', async (req, res) => {
  try {
    const { employeeName, adjustment, newTotal, beforeTotal, reason } = req.body;
    const emp = await Employee.findOne({ newJoinerName: employeeName }).select('_id reportingManager');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    // 1. Notify FSE — permanent, never deleted by admin
    await ChangeRequest.create({
      type: 'points_adjustment',
      employeeId: emp._id,
      employeeName,
      profileChanges: { adjustment, newTotal, beforeTotal },
      reason: reason || 'Points adjusted by admin',
      status: 'approved',
    });

    // 2. Save to admin activity log — admin can delete this separately
    const PointsActivityLog = require('../models/PointsActivityLog');
    await PointsActivityLog.create({
      employeeId: emp._id,
      employeeName,
      adjustment,
      beforeTotal,
      newTotal,
      reason: reason || 'Points adjusted by admin',
    });

    // 3. Notify TL — permanent, never deleted by admin
    if (emp.reportingManager) {
      try {
        const TeamLead = require('../models/TeamLead');
        const tl = await TeamLead.findOne({ name: emp.reportingManager }).select('_id name email');
        if (tl) {
          const TLNotification = require('../models/TLNotification');
          await TLNotification.create({
            tlId: tl._id,
            tlName: tl.name,
            type: 'fse_points_update',
            fseName: employeeName,
            adjustment,
            beforeTotal,
            newTotal,
            reason: reason || 'Points adjusted by admin',
          });
        }
      } catch { /* ignore TL notification errors */ }
    }

    res.json({ message: 'Notification sent to FSE' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
