const express = require('express');
const router = express.Router();
const PointsActivity = require('../models/PointsActivity');
const ChangeRequest = require('../models/ChangeRequest');
const Employee = require('../models/Employee');

// ---------- GET ALL POINTS ACTIVITY (FOR ADMIN) ----------
router.get('/all', async (req, res) => {
  try {
    const { page = 1, limit = 50, employeeName, product } = req.query;
    
    const query = {};
    if (employeeName) query.employeeName = new RegExp(employeeName, 'i');
    if (product) query.product = new RegExp(product, 'i');
    
    const total = await PointsActivity.countDocuments(query);
    const activities = await PointsActivity.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    res.json({
      activities,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------- GET POINTS ACTIVITY FOR SPECIFIC EMPLOYEE ----------
router.get('/employee/:employeeName', async (req, res) => {
  try {
    const activities = await PointsActivity.find({ 
      employeeName: req.params.employeeName 
    }).sort({ createdAt: -1 });
    
    res.json(activities);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------- CREATE POINTS ACTIVITY & SEND NOTIFICATION ----------
router.post('/create', async (req, res) => {
  try {
    const { employeeName, employeeId, product, slabDetails, reason, actionType } = req.body;
    
    if (!employeeName || !product || !slabDetails) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Create activity record
    const activity = await PointsActivity.create({
      employeeName,
      employeeId,
      product,
      slabDetails: {
        forms: slabDetails.forms,
        multiplier: slabDetails.multiplier,
        points: slabDetails.forms * slabDetails.multiplier
      },
      reason: reason || '',
      actionType: actionType || 'added',
      performedBy: 'admin',
      createdAt: new Date()
    });
    
    // Find employee to get their ID for notification
    const employee = await Employee.findOne({ newJoinerName: employeeName });
    
    if (employee) {
      // Create notification for FSE using ChangeRequest
      const notificationMessage = `Admin ${actionType || 'added'} points for ${product}: ${slabDetails.forms} forms × ${slabDetails.multiplier} = ${slabDetails.forms * slabDetails.multiplier} pts${reason ? `\nReason: ${reason}` : ''}`;
      
      await ChangeRequest.create({
        type: 'points_adjustment',
        employeeId: employee._id,
        employeeName: employee.newJoinerName,
        profileChanges: {
          product,
          slabDetails,
          reason,
          actionType,
          message: notificationMessage
        },
        status: 'approved',
        reason: reason || '',
        acknowledged: false,
        createdAt: new Date()
      });
    }
    
    res.status(201).json({ 
      message: 'Points activity created and notification sent',
      activity 
    });
  } catch (err) {
    console.error('Error creating points activity:', err);
    res.status(500).json({ message: err.message });
  }
});

// ---------- BULK CREATE POINTS ACTIVITIES ----------
router.post('/bulk-create', async (req, res) => {
  try {
    const { employeeName, employeeId, activities } = req.body;
    
    console.log('📝 Bulk create activities request:', { 
      employeeName, 
      employeeId, 
      activitiesCount: activities?.length 
    });
    
    if (!employeeName || !activities || !Array.isArray(activities)) {
      console.error('❌ Missing required fields:', { employeeName, activities: !!activities });
      return res.status(400).json({ message: 'Missing required fields: employeeName and activities array required' });
    }
    
    const createdActivities = [];
    const employee = await Employee.findOne({ newJoinerName: employeeName });
    
    if (!employee) {
      console.warn('⚠️ Employee not found for notifications:', employeeName);
    } else {
      console.log('✅ Found employee for notifications:', { 
        name: employee.newJoinerName, 
        id: employee._id 
      });
    }
    
    for (const activity of activities) {
      const { product, slabDetails, reason, actionType } = activity;
      
      if (!product || !slabDetails) {
        console.warn('⚠️ Skipping activity with missing data:', activity);
        continue;
      }
      
      // Create activity record
      const newActivity = await PointsActivity.create({
        employeeName,
        employeeId: employee?._id || employeeId || null,
        product,
        slabDetails: {
          forms: slabDetails.forms,
          multiplier: slabDetails.multiplier,
          points: slabDetails.forms * slabDetails.multiplier
        },
        reason: reason || '',
        actionType: actionType || 'added',
        performedBy: 'admin',
        createdAt: new Date()
      });
      
      createdActivities.push(newActivity);
      console.log('✅ Activity created:', { 
        product, 
        forms: slabDetails.forms, 
        multiplier: slabDetails.multiplier 
      });
      
      // Create notification for FSE using ChangeRequest
      if (employee) {
        const notificationMessage = `Admin ${actionType || 'added'} points for ${product}: ${slabDetails.forms} forms × ${slabDetails.multiplier} = ${slabDetails.forms * slabDetails.multiplier} pts${reason ? `\nReason: ${reason}` : ''}`;
        
        await ChangeRequest.create({
          type: 'points_adjustment',
          employeeId: employee._id,
          employeeName: employee.newJoinerName,
          profileChanges: {
            product,
            slabDetails,
            reason,
            actionType,
            message: notificationMessage
          },
          status: 'approved',
          reason: reason || '',
          acknowledged: false,
          createdAt: new Date()
        });
        
        console.log('✅ Notification created for:', employee.newJoinerName);
      }
    }
    
    console.log(`✅ Bulk create completed: ${createdActivities.length} activities created`);
    
    res.status(201).json({ 
      message: `Created ${createdActivities.length} activities and sent notifications`,
      activities: createdActivities 
    });
  } catch (err) {
    console.error('❌ Error bulk creating points activities:', err);
    res.status(500).json({ message: err.message, error: err.toString() });
  }
});

module.exports = router;
