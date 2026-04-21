const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Task = require('../models/Task');
const FormResponse = require('../models/FormResponse');
const Employee = require('../models/Employee');
const TeamLead = require('../models/TeamLead');

function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try { 
    req.user = jwt.verify(token, process.env.JWT_SECRET); 
    next(); 
  } catch { 
    res.status(401).json({ message: 'Invalid token' }); 
  }
}

// ── ADMIN: Create Task for TL ──────────────────────────────────
router.post('/admin-to-tl', async (req, res) => {
  try {
    // Note: Admin authentication should be handled separately
    // For now, we'll allow this endpoint without token verification
    // TODO: Add proper admin authentication

    const { tlId, title, instructions, priority, deadline } = req.body;

    if (!tlId || !title || !instructions) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Get TL info
    const tl = await TeamLead.findById(tlId).select('name email');
    if (!tl) return res.status(404).json({ message: 'TL not found' });

    // Use a default admin name since we don't have admin auth yet
    const adminName = 'Admin';

    // Create task
    const task = await Task.create({
      assignedBy: 'admin',
      assignedByName: adminName,
      assignedTo: 'tl',
      tlId: tlId,
      tlName: tl.name,
      title,
      instructions,
      priority: priority || 'normal',
      isUrgent: priority === 'urgent',
      deadline: deadline || null,
    });

    res.status(201).json({ message: 'Task assigned to TL successfully', task });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Get Tasks Assigned by Admin ────────────────────────────
router.get('/my-admin-tasks', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can view admin tasks' });
    }

    const { status } = req.query;

    const query = { 
      tlId: req.user.id, 
      assignedBy: 'admin',
      assignedTo: 'tl'
    };
    if (status) query.status = status;

    const tasks = await Task.find(query).sort({ createdAt: -1 });

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Get Admin Task Count ───────────────────────────────────
router.get('/my-admin-tasks/count', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can view admin tasks' });
    }

    const pending = await Task.countDocuments({ 
      tlId: req.user.id, 
      assignedBy: 'admin',
      assignedTo: 'tl',
      status: 'pending' 
    });
    
    const completed = await Task.countDocuments({ 
      tlId: req.user.id, 
      assignedBy: 'admin',
      assignedTo: 'tl',
      status: 'completed' 
    });

    res.json({ pending, completed, total: pending + completed });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Complete Admin Task ────────────────────────────────────
router.put('/:id/complete-tl', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can complete tasks' });
    }

    const { completionNotes, completionProof } = req.body;

    const task = await Task.findOne({ 
      _id: req.params.id, 
      tlId: req.user.id,
      assignedBy: 'admin',
      assignedTo: 'tl'
    });
    
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (task.status === 'completed') {
      return res.status(400).json({ message: 'Task already completed' });
    }

    task.status = 'completed';
    task.completionNotes = completionNotes || '';
    task.completionProof = completionProof || '';
    task.completedAt = new Date();
    task.adminNotified = false; // Admin hasn't seen this completion yet

    await task.save();

    res.json({ message: 'Task marked as completed', task });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: Get TL Task Notifications ───────────────────────────
router.get('/admin-notifications', async (req, res) => {
  try {
    // Note: Admin authentication should be handled separately
    // For now, we'll allow this endpoint without token verification

    const notifications = await Task.find({
      assignedBy: 'admin',
      assignedTo: 'tl',
      status: 'completed',
      adminNotified: false
    }).sort({ completedAt: -1 });

    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: Get All Tasks (including read ones) ─────────────────
router.get('/admin-all-tasks', async (req, res) => {
  try {
    const { status } = req.query; // 'pending', 'completed', or undefined (all)

    const query = {
      assignedBy: 'admin',
      assignedTo: 'tl'
    };
    
    if (status) query.status = status;

    const tasks = await Task.find(query)
      .sort({ createdAt: -1 })
      .select('tlId tlName title instructions priority deadline status completionNotes completedAt createdAt isUrgent');

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADMIN: Mark Notification as Read ───────────────────────────
router.put('/admin-notifications/:id/read', async (req, res) => {
  try {
    // Note: Admin authentication should be handled separately
    // For now, we'll allow this endpoint without token verification

    const task = await Task.findOne({ 
      _id: req.params.id,
      assignedBy: 'admin',
      assignedTo: 'tl'
    });
    
    if (!task) return res.status(404).json({ message: 'Task not found' });

    task.adminNotified = true;
    await task.save();

    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Create Task ────────────────────────────────────────────
router.post('/create', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can create tasks' });
    }

    const { merchantId, reason, instructions, isUrgent, deadline, verificationDetails } = req.body;

    if (!merchantId || !reason || !instructions) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Validate urgent tasks have deadline
    if (isUrgent && !deadline) {
      return res.status(400).json({ message: 'Urgent tasks must have a deadline' });
    }

    // Get TL info
    const tl = await TeamLead.findById(req.user.id).select('name');
    if (!tl) return res.status(404).json({ message: 'TL not found' });

    // Get merchant form
    const form = await FormResponse.findById(merchantId);
    if (!form) return res.status(404).json({ message: 'Merchant form not found' });

    // Get FSE info
    const fse = await Employee.findById(form.submittedBy).select('newJoinerName');
    if (!fse) return res.status(404).json({ message: 'FSE not found' });

    // Create task
    const task = await Task.create({
      assignedBy: 'tl',
      assignedByName: tl.name,
      assignedTo: 'fse',
      tlId: req.user.id,
      tlName: tl.name,
      fseId: form.submittedBy,
      fseName: fse.newJoinerName || form.employeeName,
      merchantId: form._id,
      merchantName: form.customerName,
      merchantPhone: form.customerNumber,
      product: form.formFillingFor || form.tideProduct || form.brand || 'Unknown',
      location: form.location,
      reason,
      instructions,
      priority: isUrgent ? 'urgent' : 'normal',
      isUrgent: isUrgent || false,
      deadline: isUrgent ? deadline : null,
      verificationDetails: verificationDetails || {},
    });

    res.status(201).json({ message: 'Task created successfully', task });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── FSE: Get My Tasks ──────────────────────────────────────────
router.get('/my-tasks', verifyToken, async (req, res) => {
  try {
    const { status } = req.query; // 'pending', 'completed', or undefined (all)

    const query = { 
      fseId: req.user.id,
      assignedTo: 'fse'
    };
    if (status) query.status = status;

    const tasks = await Task.find(query).sort({ createdAt: -1 });

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── FSE: Get Task Count ────────────────────────────────────────
router.get('/my-tasks/count', verifyToken, async (req, res) => {
  try {
    const pending = await Task.countDocuments({ 
      fseId: req.user.id, 
      assignedTo: 'fse',
      status: 'pending' 
    });
    const completed = await Task.countDocuments({ 
      fseId: req.user.id, 
      assignedTo: 'fse',
      status: 'completed' 
    });

    res.json({ pending, completed, total: pending + completed });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── FSE: Complete Task ─────────────────────────────────────────
router.put('/:id/complete', verifyToken, async (req, res) => {
  try {
    const { completionNotes, completionProof } = req.body;

    const task = await Task.findOne({ _id: req.params.id, fseId: req.user.id });
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (task.status === 'completed') {
      return res.status(400).json({ message: 'Task already completed' });
    }

    // Fetch current verification status after FSE completed the task
    const form = await FormResponse.findById(task.merchantId);
    if (form) {
      const axios = require('axios');
      const product = (form.formFillingFor || form.tideProduct || form.brand || '').toLowerCase().trim();
      const month = new Date(form.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' });
      
      try {
        const verifyUrl = `${process.env.API_BASE || 'http://localhost:5000'}/api/verify/bulk-admin?phones=${encodeURIComponent(form.customerNumber)}&names=${encodeURIComponent(form.customerName)}&products=${encodeURIComponent(product)}&months=${encodeURIComponent(month)}`;
        const verifyResponse = await axios.get(verifyUrl, {
          headers: { Authorization: req.headers.authorization }
        });
        
        const vKey = product ? `${form.customerNumber}__${product}` : form.customerNumber;
        const verification = verifyResponse.data[vKey];
        
        if (verification) {
          task.verificationAfterCompletion = {
            status: verification.status || 'Not Found',
            passedConditions: (verification.checks || []).filter(c => c.pass).map(c => c.label),
            failedConditions: (verification.checks || []).filter(c => !c.pass).map(c => c.label),
            checkedAt: new Date()
          };
        }
      } catch (verifyErr) {
        console.error('Failed to fetch verification after completion:', verifyErr);
      }
    }

    task.status = 'completed';
    task.completionNotes = completionNotes || '';
    task.completionProof = completionProof || '';
    task.completedAt = new Date();
    task.tlNotified = false; // TL hasn't seen this completion yet

    await task.save();

    res.json({ message: 'Task marked as completed', task });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Get Notifications (Completed Tasks from FSE) ───────────
router.get('/tl-notifications', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can view notifications' });
    }

    // Get completed FSE tasks that TL hasn't seen yet
    const notifications = await Task.find({
      tlId: req.user.id,
      assignedBy: 'tl',
      assignedTo: 'fse',
      status: 'completed',
      tlNotified: false
    }).sort({ completedAt: -1 });

    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Get Notification Count ─────────────────────────────────
router.get('/tl-notifications/count', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can view notifications' });
    }

    const fseCompletedCount = await Task.countDocuments({
      tlId: req.user.id,
      assignedBy: 'tl',
      assignedTo: 'fse',
      status: 'completed',
      tlNotified: false
    });

    const adminPendingCount = await Task.countDocuments({
      tlId: req.user.id,
      assignedBy: 'admin',
      assignedTo: 'tl',
      status: 'pending'
    });

    res.json({ 
      fseCompleted: fseCompletedCount,
      adminPending: adminPendingCount,
      total: fseCompletedCount + adminPendingCount
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Mark Notification as Read ──────────────────────────────
router.put('/tl-notifications/:id/read', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can mark notifications' });
    }

    const task = await Task.findOne({ _id: req.params.id, tlId: req.user.id });
    if (!task) return res.status(404).json({ message: 'Task not found' });

    task.tlNotified = true;
    await task.save();

    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Get All Tasks (History) ────────────────────────────────
router.get('/tl-tasks', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can view all tasks' });
    }

    const { status } = req.query;

    const query = { tlId: req.user.id };
    if (status) query.status = status;

    const tasks = await Task.find(query).sort({ createdAt: -1 });

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Check Existing Task for Merchant ───────────────────────
router.get('/check-merchant-task/:merchantId', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can check tasks' });
    }

    const task = await Task.findOne({
      tlId: req.user.id,
      merchantId: req.params.merchantId,
      status: 'pending'
    }).sort({ createdAt: -1 });

    if (!task) {
      return res.json({ exists: false });
    }

    // Calculate days since task was created
    const daysSinceCreated = Math.floor((Date.now() - new Date(task.createdAt)) / (1000 * 60 * 60 * 24));
    const canSendReminder = daysSinceCreated >= 3;

    res.json({
      exists: true,
      task: task,
      daysSinceCreated,
      canSendReminder
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TL: Send Reminder (Update Existing Task) ───────────────────
router.put('/:id/send-reminder', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: 'Only TL can send reminders' });
    }

    const { reason, instructions, isUrgent, deadline, verificationDetails } = req.body;

    const task = await Task.findOne({ _id: req.params.id, tlId: req.user.id });
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (task.status === 'completed') {
      return res.status(400).json({ message: 'Cannot send reminder for completed task' });
    }

    // Update task with new instructions
    task.reason = reason || task.reason;
    task.instructions = instructions || task.instructions;
    task.isUrgent = isUrgent !== undefined ? isUrgent : task.isUrgent;
    task.deadline = isUrgent ? deadline : task.deadline;
    task.verificationDetails = verificationDetails || task.verificationDetails;
    task.updatedAt = new Date();

    await task.save();

    res.json({ message: 'Reminder sent successfully', task });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
