const express = require('express');
const router = express.Router();
const UnfilledForm = require('../models/UnfilledForm');

/**
 * Unfilled Forms API Routes
 * Provides endpoints to read and manage unfilled forms
 * (No sync endpoint - sync happens via cron job automatically)
 */

// ========== GET UNFILLED FORMS LIST ==========

/**
 * GET /api/unfilled-forms/list
 * Get all unfilled forms with filters
 */
router.get('/list', async (req, res) => {
  try {
    const { month, year, product, status, assignedTo } = req.query;

    // Build query
    const query = {};
    if (month) query.expectedMonth = month;
    if (year) query.expectedYear = parseInt(year);
    if (product) query.product = new RegExp(product, 'i');
    if (status) query.status = status;
    if (assignedTo) query.assignedTo = assignedTo;

    // Default: only show unfilled and filled_late (not resolved)
    if (!status) {
      query.status = { $in: ['unfilled', 'filled_late'] };
    }

    const unfilledForms = await UnfilledForm.find(query)
      .populate('filledFormId', 'employeeName createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      unfilledForms,
      total: unfilledForms.length
    });
  } catch (error) {
    console.error('Error fetching unfilled forms:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== GET FILLED LATE FORMS (FOR ADMIN NOTIFICATION) ==========

/**
 * GET /api/unfilled-forms/filled-late
 * Get forms that were unfilled but are now filled by FSEs
 * These need admin review to settle
 * 🔥 NEW: Gets original date from product collection using VerificationRules
 */
router.get('/filled-late', async (req, res) => {
  try {
    const { month, year } = req.query;

    const { getRedisClient } = require('../utils/redisClient');
    const redis = getRedisClient();
    const cacheKey = `filled_late:${month || 'all'}:${year || 'all'}`;
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));
      } catch (e) { console.error('Redis filled-late get error:', e.message); }
    }

    const query = { status: 'filled_late' };
    if (month) query.expectedMonth = month;
    if (year) query.expectedYear = parseInt(year);

    const filledLateForms = await UnfilledForm.find(query)
      .populate('filledFormId', 'employeeName createdAt') // 🔥 Populate form details
      .sort({ filledAt: -1 })
      .lean();

    // 🔥 NEW: Get original dates from product collections
    const VerificationRule = require('../models/VerificationRule');
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;

    // Enhance each form with original date from product collection
    const enhancedForms = await Promise.all(filledLateForms.map(async (form) => {
      try {
        console.log(`\n🔍 Processing form: ${form.customerName} (${form.customerPhone}) - Product: ${form.product}, Month: ${form.expectedMonth} ${form.expectedYear}`);
        
        // Get collection name from VerificationRules (filter by product AND month)
        const monthLabel = `${form.expectedMonth} ${form.expectedYear}`;
        const rule = await VerificationRule.findOne({ 
          productTypes: new RegExp(form.product, 'i'),
          monthLabel: new RegExp(monthLabel, 'i')
        });
        
        console.log(`📋 VerificationRule found: ${rule ? 'YES' : 'NO'}`);
        if (rule) {
          console.log(`📦 Collection name: ${rule.collectionName}`);
        }

        if (rule && rule.collectionName) {
          // Query the product collection for original date
          const collection = db.collection(rule.collectionName);
          
          // Try to find by phone first (try multiple phone formats and columns)
          let originalRecord = null;
          if (form.customerPhone) {
            const phone = form.customerPhone.replace(/\D/g, '').slice(-10);
            const phoneWith91 = '91' + phone;
            
            console.log(`🔍 Searching for phone: ${phone} in collection: ${rule.collectionName}`);
            
            originalRecord = await collection.findOne({ 
              $or: [
                { phone: phone },
                { phone: parseInt(phone) },
                { phone: phoneWith91 },
                { mobile_number: phone },
                { mobile_number: phoneWith91 },
                { phone_number: phone },
                { phone_number: phoneWith91 },
                { Mobile_No_: phone },
                { Mobile_No_: phoneWith91 }
              ]
            });
            
            console.log(`📊 Phone search result: ${originalRecord ? 'FOUND' : 'NOT FOUND'}`);
          }

          // If not found by phone, try by name (try multiple name columns)
          if (!originalRecord && form.customerName) {
            console.log(`🔍 Phone search failed, trying name search: ${form.customerName}`);
            
            originalRecord = await collection.findOne({ 
              $or: [
                { lead: new RegExp(form.customerName, 'i') },
                { Lead: new RegExp(form.customerName, 'i') },
                { name: new RegExp(form.customerName, 'i') },
                { Name: new RegExp(form.customerName, 'i') },
                { member_name: new RegExp(form.customerName, 'i') },
                { Member_Name: new RegExp(form.customerName, 'i') }
              ]
            });
            
            console.log(`📊 Name search result: ${originalRecord ? 'FOUND' : 'NOT FOUND'}`);
          }

          // Use createdAt from product collection if found
          if (originalRecord && originalRecord.createdAt) {
            console.log(`✅ Using createdAt from product collection: ${originalRecord.createdAt}`);
            form.originalDate = originalRecord.createdAt;
            form.originalDateSource = 'product_collection';
          } else {
            console.log(`❌ No record found in product collection, using unfilled form date`);
            // Fallback to UnfilledForm createdAt
            form.originalDate = form.createdAt;
            form.originalDateSource = 'unfilled_form';
          }
        } else {
          // No verification rule found, use UnfilledForm createdAt
          form.originalDate = form.createdAt;
          form.originalDateSource = 'unfilled_form';
        }
      } catch (err) {
        console.error(`Error getting original date for form ${form._id}:`, err.message);
        // Fallback to UnfilledForm createdAt
        form.originalDate = form.createdAt;
        form.originalDateSource = 'error_fallback';
      }

      return form;
    }));

    const responsePayload = {
      success: true,
      filledLateForms: enhancedForms,
      total: enhancedForms.length
    };

    if (redis) {
      try { await redis.setex(cacheKey, 300, JSON.stringify(responsePayload)); }
      catch (e) { console.error('Redis filled-late set error:', e.message); }
    }

    res.json(responsePayload);
  } catch (error) {
    console.error('Error fetching filled late forms:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== GET UNFILLED FORMS STATS ==========

/**
 * GET /api/unfilled-forms/stats
 * Get statistics about unfilled forms
 */
router.get('/stats', async (req, res) => {
  try {
    const { month, year } = req.query;

    const query = {};
    if (month) query.expectedMonth = month;
    if (year) query.expectedYear = parseInt(year);

    // Count by status
    const statusCounts = await UnfilledForm.aggregate([
      { $match: query },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Count by product
    const productCounts = await UnfilledForm.aggregate([
      { $match: { ...query, status: { $in: ['unfilled', 'filled_late'] } } },
      { $group: { _id: '$product', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Count by assigned person
    const assignedCounts = await UnfilledForm.aggregate([
      { $match: { ...query, status: 'unfilled' } },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } }
    ]);

    // Total unfilled
    const totalUnfilled = await UnfilledForm.countDocuments({
      ...query,
      status: 'unfilled'
    });

    // Total filled late
    const totalFilledLate = await UnfilledForm.countDocuments({
      ...query,
      status: 'filled_late'
    });

    // 🔥 NEW: Total settled (resolved) forms
    const totalSettled = await UnfilledForm.countDocuments({
      ...query,
      status: 'resolved'
    });

    res.json({
      success: true,
      stats: {
        totalUnfilled,
        totalFilledLate,
        totalSettled,  // 🔥 NEW: Add settled count
        byStatus: statusCounts,
        byProduct: productCounts,
        byAssigned: assignedCounts
      }
    });
  } catch (error) {
    console.error('Error fetching unfilled forms stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== GET SINGLE UNFILLED FORM ==========

/**
 * GET /api/unfilled-forms/:id
 * Get single unfilled form details
 */
router.get('/:id', async (req, res) => {
  try {
    const unfilledForm = await UnfilledForm.findById(req.params.id)
      .populate('filledFormId')
      .lean();

    if (!unfilledForm) {
      return res.status(404).json({ error: 'Unfilled form not found' });
    }

    res.json({
      success: true,
      unfilledForm
    });
  } catch (error) {
    console.error('Error fetching unfilled form:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== SETTLE UNFILLED FORM (CREATE REAL FORM SUBMISSION) ==========

/**
 * POST /api/unfilled-forms/:id/settle
 * Settle an unfilled form by creating a real form submission
 * This creates a proper FormResponse/TLFormResponse/ManagerForm entry
 * with full verification, caching, and points calculation
 */
router.post('/:id/settle', async (req, res) => {
  try {
    const { employeeName, employeeRole, settledBy, notes } = req.body;

    if (!employeeName) {
      return res.status(400).json({ error: 'Employee name is required' });
    }

    const unfilledForm = await UnfilledForm.findById(req.params.id);

    if (!unfilledForm) {
      return res.status(404).json({ error: 'Unfilled form not found' });
    }

    if (unfilledForm.status === 'resolved') {
      return res.status(400).json({ error: 'Form already settled' });
    }

    // Determine which model to use based on employee role
    const role = employeeRole || 'FSE';
    let FormModel;
    let updateVerificationStatus;

    if (role === 'TL') {
      FormModel = require('../models/TLFormResponse');
      updateVerificationStatus = require('../utils/updateVerificationStatus').updateTLFormVerificationStatus;
    } else if (role === 'MANAGER') {
      FormModel = require('../models/ManagerForm');
      updateVerificationStatus = require('../utils/updateVerificationStatus').updateManagerFormVerificationStatus;
    } else {
      FormModel = require('../models/FormResponse');
      updateVerificationStatus = require('../utils/updateVerificationStatus').updateFormVerificationStatus;
    }

    // Create form submission data
    const formData = {
      employeeName: employeeName,
      customerName: unfilledForm.customerName,
      customerNumber: unfilledForm.customerPhone,
      location: 'Settled from unfilled',
      status: 'Ready for Onboarding',
      formFillingFor: unfilledForm.product,
      tideProduct: unfilledForm.product,
      brand: unfilledForm.product,
      
      // Mark as settled from unfilled
      settledFromUnfilled: true,
      unfilledFormId: unfilledForm._id,
      settledBy: settledBy || 'admin',
      settledAt: new Date(),
      
      // Use the expected month/year from unfilled form
      createdAt: new Date(`${unfilledForm.expectedMonth} 1, ${unfilledForm.expectedYear}`),
      updatedAt: new Date()
    };

    // Create the form submission
    const newForm = new FormModel(formData);
    await newForm.save();

    console.log(`✅ Created ${role} form submission from unfilled form:`, newForm._id);

    // Run verification immediately
    try {
      await updateVerificationStatus(newForm._id);
      console.log(`✅ Verification completed for settled form:`, newForm._id);
    } catch (verifyError) {
      console.error('⚠️ Verification failed for settled form:', verifyError.message);
      // Continue even if verification fails - form is still created
    }

    // Mark unfilled form as resolved
    unfilledForm.status = 'resolved';
    unfilledForm.resolvedAt = new Date();
    unfilledForm.resolvedBy = settledBy || 'admin';
    unfilledForm.filledFormId = newForm._id;
    unfilledForm.filledByEmployee = employeeName;
    unfilledForm.filledAt = new Date();
    if (notes) unfilledForm.notes = notes;
    await unfilledForm.save();

    console.log(`✅ Marked unfilled form as resolved:`, unfilledForm._id);

    res.json({
      success: true,
      message: 'Unfilled form settled successfully - form created with verification',
      unfilledForm,
      createdForm: newForm,
      formId: newForm._id
    });
  } catch (error) {
    console.error('Error settling unfilled form:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== MARK AS RESOLVED (OLD METHOD - KEPT FOR COMPATIBILITY) ==========

/**
 * PUT /api/unfilled-forms/:id/resolve
 * Mark an unfilled form as resolved WITHOUT creating a form submission
 * Use /settle endpoint instead for proper form creation
 */
router.put('/:id/resolve', async (req, res) => {
  try {
    console.log('📝 Resolve endpoint called for ID:', req.params.id);
    console.log('📝 Request body:', req.body);

    const { resolvedBy, notes } = req.body;

    const unfilledForm = await UnfilledForm.findById(req.params.id);

    if (!unfilledForm) {
      console.error('❌ Unfilled form not found:', req.params.id);
      return res.status(404).json({ 
        success: false,
        error: 'Unfilled form not found' 
      });
    }

    console.log('✅ Found unfilled form:', unfilledForm.customerName);

    // Call the markAsResolved method
    await unfilledForm.markAsResolved(resolvedBy || 'admin', notes);
    
    console.log('✅ Successfully marked as resolved');

    res.json({
      success: true,
      message: 'Unfilled form marked as resolved',
      unfilledForm
    });
  } catch (error) {
    console.error('❌ Error resolving unfilled form:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

// ========== MARK AS INVALID ==========

/**
 * PUT /api/unfilled-forms/:id/invalid
 * Mark an unfilled form as invalid (not a real merchant)
 */
router.put('/:id/invalid', async (req, res) => {
  try {
    const { notes } = req.body;

    const unfilledForm = await UnfilledForm.findById(req.params.id);

    if (!unfilledForm) {
      return res.status(404).json({ error: 'Unfilled form not found' });
    }

    unfilledForm.status = 'invalid';
    unfilledForm.resolvedAt = new Date();
    if (notes) unfilledForm.notes = notes;
    await unfilledForm.save();

    res.json({
      success: true,
      message: 'Unfilled form marked as invalid',
      unfilledForm
    });
  } catch (error) {
    console.error('Error marking unfilled form as invalid:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== BULK RESOLVE ==========

/**
 * POST /api/unfilled-forms/bulk-resolve
 * Mark multiple unfilled forms as resolved
 */
router.post('/bulk-resolve', async (req, res) => {
  try {
    const { ids, resolvedBy, notes } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No IDs provided' });
    }

    const result = await UnfilledForm.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: resolvedBy || 'admin',
          notes: notes || ''
        }
      }
    );

    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} forms as resolved`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Error bulk resolving unfilled forms:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== GET UNFILLED FORMS FOR MERCHANT FORMS PAGE ==========

/**
 * GET /api/unfilled-forms/for-merchant-forms
 * Get unfilled forms formatted for Merchant Forms page display
 * Groups by assigned person (Dheeraj Anand)
 */
router.get('/for-merchant-forms', async (req, res) => {
  try {
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }

    const unfilledForms = await UnfilledForm.find({
      expectedMonth: month,
      expectedYear: parseInt(year),
      status: { $in: ['unfilled', 'filled_late'] }
    })
      .populate('filledFormId', 'employeeName createdAt')
      .sort({ product: 1, customerName: 1 })
      .lean();

    // Group by assigned person
    const groupedByAssigned = {};
    unfilledForms.forEach(form => {
      const assignedTo = form.assignedTo || 'Dheeraj Anand';
      if (!groupedByAssigned[assignedTo]) {
        groupedByAssigned[assignedTo] = [];
      }
      groupedByAssigned[assignedTo].push(form);
    });

    // Count by product
    const productCounts = {};
    unfilledForms.forEach(form => {
      const product = form.product;
      productCounts[product] = (productCounts[product] || 0) + 1;
    });

    res.json({
      success: true,
      unfilledForms,
      groupedByAssigned,
      productCounts,
      total: unfilledForms.length
    });
  } catch (error) {
    console.error('Error fetching unfilled forms for merchant forms page:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
