const express = require('express');
const jwt = require('jsonwebtoken');
const FormResponse = require('../models/FormResponse');
const TLFormResponse = require('../models/TLFormResponse');
const Employee = require('../models/Employee');
const TeamLead = require('../models/TeamLead');

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

  // Helper to clear admin forms cache
  async function clearAdminCache() {
    try {
      const { getRedisClient } = require('../utils/redisClient');
      const redis = getRedisClient();
      if (redis) {
        let cursor = '0';
        const keys = [];
        do {
          const [newCursor, currentKeys] = await redis.scan(cursor, 'MATCH', 'admin_forms_all*', 'COUNT', '100');
          cursor = newCursor;
          keys.push(...currentKeys);
        } while (cursor !== '0');

        if (keys.length > 0) {
          await redis.del(...keys);
          console.log(`🧹 Cleared ${keys.length} admin dashboard caches on form update`);
        }
      }
    } catch (err) {
      console.error('Failed to clear admin cache:', err.message);
    }
  }

  // POST /api/forms/submit
  router.post('/submit', verifyToken, async (req, res) => {
    try {
      const isTL = req.user.role === 'tl';
      const isManager = req.user.role === 'manager';
      const ManagerForm = require('../models/ManagerForm');
      const Model = isTL ? TLFormResponse : isManager ? ManagerForm : FormResponse;

      let employeeName = '';
      if (isTL) {
        const tl = await TeamLead.findById(req.user.id).select('name');
        employeeName = tl?.name || '';
      } else if (isManager) {
        const Manager = require('../models/Manager');
        const mgr = await Manager.findById(req.user.id).select('name');
        employeeName = mgr?.name || '';
      } else {
        const emp = await Employee.findById(req.user.id).select('newJoinerName');
        employeeName = emp?.newJoinerName || '';
      }

      // Duplicate check: only when a product is selected (onboarding only)
      // Allow same merchant + same brand if sub-type is different (e.g. Tide Insurance Accidental vs Life)
      if (req.body.formFillingFor) {
        const query = {
          submittedBy: req.user.id,
          customerNumber: req.body.customerNumber,
          formFillingFor: req.body.formFillingFor,
        };
        // Add sub-type fields to the check so different sub-types are NOT blocked
        if (req.body.tideIns_type) query.tideIns_type = req.body.tideIns_type;
        if (req.body.ins_insuranceType) query.ins_insuranceType = req.body.ins_insuranceType;
        if (req.body.tideProduct) query.tideProduct = req.body.tideProduct;

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
      const form = await Model.create(data);

      // ========== CHECK FOR UNFILLED FORM (LATE SUBMISSION DETECTION) ==========
      // Check for ALL form types (FSE, TL, Manager)
      if (req.body.customerNumber) {
        try {
          const UnfilledForm = require('../models/UnfilledForm');

          // Get product from form (priority: formFillingFor > tideProduct > brand)
          const product = req.body.formFillingFor || req.body.tideProduct || req.body.brand;

          if (product) {
            // Get month and year from form creation date
            const formDate = new Date(form.createdAt);
            const month = formDate.toLocaleString('en-US', { month: 'long' });
            const year = formDate.getFullYear();

            // Try multiple matching strategies (flexible matching)
            // Strategy 1: Exact match with uniqueKey (phone + name + product + month + year)
            const uniqueKey = UnfilledForm.createUniqueKey(
              req.body.customerNumber,
              req.body.customerName || '',
              product,
              month,
              year,
              { matchFields: ['phone', 'name'] }
            );

            let unfilledForm = await UnfilledForm.findOne({
              uniqueKey,
              status: 'unfilled'
            });

            // Strategy 2: If not found, try phone + product only (ignore name and exact month)
            if (!unfilledForm) {
              unfilledForm = await UnfilledForm.findOne({
                customerPhone: req.body.customerNumber,
                product: { $regex: new RegExp(`^${product.trim()}$`, 'i') }, // Case-insensitive
                status: 'unfilled',
                expectedYear: year // Same year
              });
            }

            // Strategy 3: If still not found, try phone only (same year, any product)
            if (!unfilledForm) {
              unfilledForm = await UnfilledForm.findOne({
                customerPhone: req.body.customerNumber,
                status: 'unfilled',
                expectedYear: year
              });
            }

            if (unfilledForm) {
              // Mark as filled late
              await unfilledForm.markAsFilledLate(form._id, employeeName);
            }
          }
        } catch (unfilledError) {
          // Don't fail form submission if unfilled check fails
          console.error('Error checking unfilled forms:', unfilledError);
        }
      }

      // Update verification status after form creation (async, don't wait)
      if (!isTL && !isManager) {
        const { updateFormVerificationStatus } = require('../utils/updateVerificationStatus');
        updateFormVerificationStatus(form._id.toString(), req.db).catch(console.error);
      } else if (isTL) {
        // ✅ Verify TL forms too!
        const { updateTLFormVerificationStatus } = require('../utils/updateVerificationStatus');
        updateTLFormVerificationStatus(form._id.toString(), req.db).catch(console.error);
      } else if (isManager) {
        const { updateManagerFormVerificationStatus } = require('../utils/updateVerificationStatus');
        updateManagerFormVerificationStatus(form._id.toString(), req.db).catch(console.error);
      }

      // Clear admin cache so live forms show immediately
      clearAdminCache();

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

      // ✅ Wait for MongoDB connection and verify it succeeded
      const conn = await connectDB();
      if (!conn) {
        console.error('❌ MongoDB connection failed');
        return res.status(503).json({ message: 'Database connection unavailable' });
      }


      const { reason, ...updateData } = req.body;

      // 🔥 NEW: Try to update in all three collections (FSE, TL, Manager)
      const TLFormResponse = require('../models/TLFormResponse');
      const ManagerForm = require('../models/ManagerForm');

      // Try FSE forms first
      let form = await FormResponse.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { new: true }
      );
      let formType = 'FSE';

      // If not found in FSE, try TL forms
      if (!form) {
        form = await TLFormResponse.findByIdAndUpdate(
          req.params.id,
          { $set: updateData },
          { new: true }
        );
        formType = 'TL';
      }

      // If not found in TL, try Manager forms
      if (!form) {
        form = await ManagerForm.findByIdAndUpdate(
          req.params.id,
          { $set: updateData },
          { new: true }
        );
        formType = 'Manager';
      }

      if (!form) {
        console.error(`❌ Form not found with ID: ${req.params.id}`);
        return res.status(404).json({ message: 'Form not found' });
      }


      // Update verification status after form update
      const {
        updateFormVerificationStatus,
        updateTLFormVerificationStatus,
        updateManagerFormVerificationStatus
      } = require('../utils/updateVerificationStatus');

      if (formType === 'FSE') {
        updateFormVerificationStatus(req.params.id, req.db).catch(console.error);
      } else if (formType === 'TL') {
        updateTLFormVerificationStatus(req.params.id, req.db).catch(console.error);
      } else if (formType === 'Manager') {
        updateManagerFormVerificationStatus(req.params.id, req.db).catch(console.error);
      }

      // Clear admin cache so live forms show immediately
      clearAdminCache();

      res.json({ message: 'Form updated successfully', form });
    } catch (err) {
      console.error('❌ Edit form error:', err);
      console.error('Stack trace:', err.stack);
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/forms/admin/delete/:id — admin can delete any form (FSE, TL, or Manager)
  router.delete('/admin/delete/:id', async (req, res) => {
    try {

      // ✅ Wait for MongoDB connection and verify it succeeded
      const conn = await connectDB();
      if (!conn) {
        console.error('❌ MongoDB connection failed');
        return res.status(503).json({ message: 'Database connection unavailable' });
      }


      // 🔥 NEW: Try to delete from all three collections (FSE, TL, Manager)
      const TLFormResponse = require('../models/TLFormResponse');
      const ManagerForm = require('../models/ManagerForm');

      // Try FSE forms first
      let form = await FormResponse.findByIdAndDelete(req.params.id);
      let formType = 'FSE';

      // If not found in FSE, try TL forms
      if (!form) {
        form = await TLFormResponse.findByIdAndDelete(req.params.id);
        formType = 'TL';
      }

      // If not found in TL, try Manager forms
      if (!form) {
        form = await ManagerForm.findByIdAndDelete(req.params.id);
        formType = 'Manager';
      }

      // If still not found, return error
      if (!form) {
        console.error(`❌ Form not found with ID: ${req.params.id} in any collection (FSE, TL, Manager)`);
        return res.status(404).json({ message: 'Form not found' });
      }

      // Clear admin cache so live forms show immediately
      clearAdminCache();

      res.json({ message: `${formType} form deleted successfully`, formType });
    } catch (err) {
      console.error('❌ Delete form error:', err);
      console.error('Stack trace:', err.stack);
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
      let form = await FormResponse.findOne(query);
      // If not found in FSE collection, check TLFormResponse (TL's own forms)
      if (!form && isTL) {
        form = await TLFormResponse.findOne({ _id: req.params.id });
      }
      if (!form) return res.status(404).json({ message: 'Not found' });
      res.json(form);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // PUT /api/forms/update/:id — employee can update their own form (FSE, TL, or Manager)
  router.put('/update/:id', verifyToken, async (req, res) => {
    try {
      // 🔥 NEW: Try to update in all three collections (FSE, TL, Manager)
      const TLFormResponse = require('../models/TLFormResponse');
      const ManagerForm = require('../models/ManagerForm');

      // Try FSE forms first
      let form = await FormResponse.findOneAndUpdate(
        { _id: req.params.id, submittedBy: req.user.id },
        { $set: req.body },
        { new: true }
      );
      let formType = 'FSE';

      // If not found in FSE, try TL forms
      if (!form) {
        form = await TLFormResponse.findOneAndUpdate(
          { _id: req.params.id, submittedBy: req.user.id },
          { $set: req.body },
          { new: true }
        );
        formType = 'TL';
      }

      // If not found in TL, try Manager forms
      if (!form) {
        form = await ManagerForm.findOneAndUpdate(
          { _id: req.params.id, submittedBy: req.user.id },
          { $set: req.body },
          { new: true }
        );
        formType = 'Manager';
      }

      if (!form) return res.status(404).json({ message: 'Not found or not authorized' });

      // Update verification status after form update
      const {
        updateFormVerificationStatus,
        updateTLFormVerificationStatus,
        updateManagerFormVerificationStatus
      } = require('../utils/updateVerificationStatus');

      if (formType === 'FSE') {
        updateFormVerificationStatus(req.params.id, req.db).catch(console.error);
      } else if (formType === 'TL') {
        updateTLFormVerificationStatus(req.params.id, req.db).catch(console.error);
      } else if (formType === 'Manager') {
        updateManagerFormVerificationStatus(req.params.id, req.db).catch(console.error);
      }

      // Clear admin cache so live forms show immediately
      clearAdminCache();

      res.json({ message: 'Updated successfully', form });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/forms/delete/:id — employee can delete their own form (FSE, TL, or Manager)
  router.delete('/delete/:id', verifyToken, async (req, res) => {
    try {
      // 🔥 NEW: Try to delete from all three collections (FSE, TL, Manager)
      const TLFormResponse = require('../models/TLFormResponse');
      const ManagerForm = require('../models/ManagerForm');

      // Try FSE forms first
      let form = await FormResponse.findOneAndDelete({ _id: req.params.id, submittedBy: req.user.id });

      // If not found in FSE, try TL forms
      if (!form) {
        form = await TLFormResponse.findOneAndDelete({ _id: req.params.id, submittedBy: req.user.id });
      }

      // If not found in TL, try Manager forms
      if (!form) {
        form = await ManagerForm.findOneAndDelete({ _id: req.params.id, submittedBy: req.user.id });
      }

      if (!form) return res.status(404).json({ message: 'Not found or not authorized' });

      // Clear admin cache so live forms show immediately
      clearAdminCache();

      res.json({ message: 'Deleted successfully' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── ADMIN ROUTES (no auth required for admin panel access) ──────────────

  // GET /api/forms/admin/all — all forms grouped by employee (with role filter and caching)
  router.get('/admin/all', async (req, res) => {
    try {
      const { role = 'FSE', limit, skip, page, month, year } = req.query; // Pagination & Date params
      const { getRedisClient } = require('../utils/redisClient');
      const redis = getRedisClient();

      // 🔥 NEW: Pagination support
      const pageSize = limit ? parseInt(limit) : null; // null = no pagination (backward compat)
      const pageNum = page ? parseInt(page) : 1;
      const skipCount = skip ? parseInt(skip) : (pageNum - 1) * (pageSize || 0);

      // Build date filter query
      const queryFilter = {};
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      if (month && year && month !== 'All') {
        const monthIdx = monthNames.indexOf(month);
        if (monthIdx !== -1) {
          const startDate = new Date(parseInt(year), monthIdx, 1);
          const endDate = new Date(parseInt(year), monthIdx + 1, 0, 23, 59, 59, 999);
          queryFilter.createdAt = { $gte: startDate, $lte: endDate };
        }
      } else if (year && (!month || month === 'All')) {
        const startDate = new Date(parseInt(year), 0, 1);
        const endDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
        queryFilter.createdAt = { $gte: startDate, $lte: endDate };
      }

      // 🔥 Cache key includes pagination and date params
      const cacheKey = `admin_forms_all:${role}:${year || 'all'}:${month || 'all'}:page${pageNum}:limit${pageSize || 'all'}`;

      // Try Redis cache first (expires in 5 minutes)
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) {
            return res.json(JSON.parse(cached));
          }
        } catch (cacheErr) {
          console.error('Redis get error:', cacheErr.message);
        }
      }

      // 🔥 Fetch from appropriate collection based on role
      const ManagerForm = require('../models/ManagerForm');
      const Model = role === 'TL' ? TLFormResponse : role === 'MANAGER' ? ManagerForm : FormResponse;

      // Exclude raw records and heavy detailed logs from list query to prevent Vercel payload/timeout limits
      let query = Model.find(queryFilter)
        .select('-verificationChecks.record -verificationChecks.checks')
        .sort({ createdAt: -1 });
        
      if (pageSize) {
        query = query.skip(skipCount).limit(pageSize);
      }
      
      const forms = await query.lean();
      
      // Calculate totalCount without blocking connection pool
      let totalCount = forms.length;
      if (pageSize && (forms.length === pageSize || skipCount > 0)) {
        totalCount = await Model.countDocuments(queryFilter);
      } else if (skipCount > 0) {
        totalCount = skipCount + forms.length;
      }

      // 🔥 Response includes pagination metadata
      const response = pageSize ? {
        forms,
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: pageSize,
          pages: Math.ceil(totalCount / pageSize),
          hasMore: skipCount + forms.length < totalCount
        }
      } : forms; // Backward compat: return array if no pagination

      // Cache the result in Redis
      if (redis) {
        try {
          await redis.setex(cacheKey, 2592000, JSON.stringify(response));
        } catch (cacheErr) {
          console.error('Redis set error:', cacheErr.message);
        }
      }

      res.json(response);
      // console.log("*************************************************")
      // console.log("*************************************************")
      // console.log(response.length);
      // console.log("*************************************************")
      // console.log("*************************************************")
    } catch (err) {
      console.error(`Error fetching ${req.query.role || 'FSE'} forms:`, err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/forms/admin/duplicates — merchants submitted by multiple employees (cross-employee duplicates)
  router.get('/admin/duplicates', async (req, res) => {
    try {
      const { getRedisClient } = require('../utils/redisClient');
      const redis = getRedisClient();
      const cacheKey = 'admin_duplicates_list';
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) return res.json(JSON.parse(cached));
        } catch (e) { console.error('Redis duplicates get error:', e.message); }
      }

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
            count: { $sum: 1 },
            employees: { $addToSet: '$employeeName' },
            employeeIds: { $addToSet: '$submittedBy' },
            customerNames: { $addToSet: '$customerName' },
            records: { $push: '$$ROOT' },
          }
        },
        { $match: { 'employeeIds.1': { $exists: true } } },
        { $sort: { count: -1 } }
      ]);

      // Attach settlement info to each group
      const result = groups.map(g => {
        const key = `${g._id.customerNumber}__${g._id.formFillingFor}`;
        const settlement = settledMap[key] || null;
        return { ...g, settled: !!settlement, settlementInfo: settlement };
      });

      if (redis) {
        try { await redis.setex(cacheKey, 300, JSON.stringify(result)); }
        catch (e) { console.error('Redis duplicates set error:', e.message); }
      }

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

      const { getRedisClient } = require('../utils/redisClient');
      const redis = getRedisClient();
      if (redis) {
        try { await redis.del('admin_duplicates_list'); }
        catch (e) { console.error('Redis duplicates del error:', e.message); }
      }

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
    'Tide': 2,
    'MSME': 0.3,
    'Tide Insurance': 1,
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
      req._empDoc = doc;
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
        const beforeTotal = Math.round((verifiedPts + empDoc.pointsAdjustment + delta) * 10) / 10;
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
        FormResponse.find({}).select('-verificationChecks.record').sort({ createdAt: -1 }).lean(),
      ]);

      // Also get FSEs from TeamLeads collection (role=fse)
      const tlFSEs = tls.filter(t => t.role === 'fse');

      const result = tls
        .filter(t => t.role !== 'fse') // only actual TLs
        .map(tl => {
          const tlName = (tl.name || '').trim();
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
          const fseNamesFromTL = fsesFromTL.map(f => f.email || f.name).filter(Boolean); // email field has actual name

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
      const ManagerForm = require('../models/ManagerForm');

      // ✅ Fetch ALL forms: FSE + TL + Manager (consistent with Merchant Forms page)
      const [fseForms, tlForms, mgrForms, employees, tls] = await Promise.all([
        FormResponse.find({}).select('-verificationChecks.record').sort({ createdAt: -1 }).lean(),
        TLFormResponse.find({}).select('-verificationChecks.record').sort({ createdAt: -1 }).lean(),
        ManagerForm.find({}).select('-verificationChecks.record').sort({ createdAt: -1 }).lean(),
        Employee.find({ approvalStatus: 'approved' }).select('newJoinerName newJoinerPhone newJoinerEmailId reportingManager position location status').lean(),
        TeamLead.find({ $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }] }).select('name email phone location reportingManager status').lean(),
      ]);

      // ✅ Combine all forms from all 3 collections
      const forms = [...fseForms, ...tlForms, ...mgrForms];

      res.json({ forms, employees, tls });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PUT /api/forms/save-verified-points ────────────────────────
  // Employee or TL saves their auto-calculated verified points
  router.put('/save-verified-points', verifyToken, async (req, res) => {
    try {
      const EmployeePoints = require('../models/EmployeePoints');
      const Employee = require('../models/Employee');
      const { verifiedPoints } = req.body;

      // Try Employee first, then TeamLead
      let name = null;
      const emp = await Employee.findById(req.user.id).select('newJoinerName');
      if (emp) {
        name = emp.newJoinerName;
      } else {
        const tl = await TeamLead.findById(req.user.id).select('name');
        if (tl) name = tl.name;
      }

      if (!name) return res.status(404).json({ message: 'User not found' });

      await EmployeePoints.findOneAndUpdate(
        { newJoinerName: name },
        { $set: { newJoinerName: name, employeeId: req.user.id, verifiedPoints: verifiedPoints || 0, updatedAt: new Date() } },
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

      if (points.length > 0) {
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


      doc.pointsAdjustment += delta;

      // ✅ Save product slabs as plain object
      if (productSlabs !== undefined) {
        // Notifications handled by frontend via /points-activity/bulk-create
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

      // Fetch fresh data directly from database to confirm save
      const freshDoc = await EmployeePoints.findById(req.params.id).lean();


      res.json({ message: 'Points updated', doc: freshDoc });

      // ── Notify FSE + TL for manual adjustment ────────────────────────────
      if (delta !== 0) {
        try {
          const ChangeRequest = require('../models/ChangeRequest');
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
          const newTotal = Math.round((verifiedPts + slabBonus + freshDoc.pointsAdjustment) * 100) / 100;
          const beforeTotal = Math.round((newTotal - delta) * 100) / 100;
          const adjReason = reason || (delta >= 0 ? 'Manual points added by admin' : 'Manual points deducted by admin');

          if (emp) {
            await ChangeRequest.create({
              type: 'points_adjustment',
              employeeId: emp._id,
              employeeName: freshDoc.newJoinerName,
              profileChanges: {
                product: 'Manual Adjustment',
                slabDetails: { forms: 1, multiplier: Math.abs(delta), points: Math.abs(delta) },
                reason: adjReason,
                actionType: delta >= 0 ? 'added' : 'removed',
                beforeTotal,
                newTotal
              },
              status: 'approved',
              reason: adjReason,
              acknowledged: false,
              createdAt: new Date()
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
                  tlId: tl._id,
                  tlName: tl.name,
                  type: 'fse_points_update',
                  fseName: freshDoc.newJoinerName,
                  adjustment: delta,
                  beforeTotal,
                  newTotal,
                  reason: adjReason,
                  acknowledged: false,
                  createdAt: new Date()
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
  // Employee or TL views their own points (supports impersonation)
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
      } else {
        // Try Employee first, then TeamLead
        const emp = await Employee.findById(req.user.id).select('newJoinerName');
        if (emp) {
          empName = emp.newJoinerName;
        } else {
          const tl = await TeamLead.findById(req.user.id).select('name');
          if (tl) empName = tl.name;
        }
        if (!empName) return res.status(404).json({ message: 'User not found' });
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

      const verifiedPoints = doc?.verifiedPoints || 0;
      const pointsAdjustment = doc?.pointsAdjustment || 0;
      const totalPoints = Math.round((verifiedPoints + slabBonus + pointsAdjustment) * 10) / 10;

      res.json({
        newJoinerName: empName,
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
      const EmployeePoints = require('../models/EmployeePoints');
      const VerificationRule = require('../models/VerificationRule');
      const { verifyMerchant } = require('../utils/verifyMerchant');

      // Must match exactly what the frontend Dashboard.js uses
      const POINTS_MAP = {
        'Tide': 2,
        'Tide MSME': 0.3,
        'Tide Insurance': 1,
        'Tide Credit Card': 1,
        'Tide BT': 1,
      };

      // Use connection from middleware
      const db = req.db;

      // Get all forms from FSE, TL, and Manager
      const allFSEForms = await FormResponse.find({}).select('-verificationChecks.record').lean();
      const allTLForms = await TLFormResponse.find({}).select('-verificationChecks.record').lean();

      let allForms;
      try {
        const ManagerForm = require('../models/ManagerForm');
        const allManagerForms = await ManagerForm.find({}).select('-verificationChecks.record').lean();
        allForms = [...allFSEForms, ...allTLForms, ...allManagerForms];
      } catch (e) {
        allForms = [...allFSEForms, ...allTLForms];
      }

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
            const month = f.createdAt
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

      res.json({ message: `Points recalculated for ${updatedCount} employees (FSE + TL + Manager forms)` });

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
      const ChangeRequest = require('../models/ChangeRequest');
      const TLNotification = require('../models/TLNotification');
      const { empPointsId, product, tierIdx, deleteReason } = req.body;

      if (!empPointsId || !product || tierIdx === undefined) {
        return res.status(400).json({ message: 'empPointsId, product and tierIdx required' });
      }

      // Find the record — prefer the one that actually has slabs for this product
      let doc = await EmployeePoints.findById(empPointsId);
      if (!doc) return res.status(404).json({ message: 'Employee points record not found' });


      // If this doc has no slabs for the product, find the correct one by name
      if (!doc.productSlabs?.[product]) {
        const better = await EmployeePoints.findOne({
          newJoinerName: { $regex: new RegExp(`^${doc.newJoinerName.trim()}\\s*$`, 'i') },
          [`productSlabs.${product}`]: { $exists: true }
        });
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

  // ========== MONTHLY POINTS CALCULATION ENDPOINT ==========
  /**
   * GET /api/forms/admin/monthly-points?month=May&year=2026
   * Calculates points for all employees for a specific month
   * Uses SAME logic as Merchant Forms frontend to ensure accuracy
   * Returns: { employees: [{ employeeName, employeeEmail, autoPoints, slabPoints, totalPoints }] }
   */
  router.get('/admin/monthly-points', async (req, res) => {
    try {
      const { month, year } = req.query;

      if (!month || !year) {
        return res.status(400).json({ error: 'Month and year are required' });
      }


      const targetYear = parseInt(year);

      // ✅ Fetch ALL forms (we'll filter by month in JavaScript like frontend does)
      const allFormsRaw = await FormResponse.find({}).select('-verificationChecks.record').lean();

      // ✅ EXACT SAME FILTER AS MERCHANT FORMS FRONTEND
      const allForms = allFormsRaw.filter(f => {
        if (!f.createdAt) return false;

        const formDate = new Date(f.createdAt);  // Local timezone (matches frontend)
        const formYear = formDate.getFullYear();
        const formMonth = formDate.toLocaleString('en-US', { month: 'long' });

        return formYear === targetYear && formMonth === month;
      });


      // ✅ Get verification status using verify API (same as backend does)
      const http = require('http');
      const verifyMap = {};
      const BATCH = 50;
      const getFormProduct = (f) => (f.formFillingFor || f.tideProduct || f.brand || '').toLowerCase().trim();

      for (let i = 0; i < allForms.length; i += BATCH) {
        const batch = allForms.slice(i, i + BATCH);
        const phones = batch.map(f => encodeURIComponent(f.customerNumber)).join(',');
        const names = batch.map(f => encodeURIComponent(f.customerName || '')).join(',');
        const products = batch.map(f => encodeURIComponent(getFormProduct(f))).join(',');
        const months = batch.map(f => encodeURIComponent(new Date(f.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' }))).join(',');

        try {
          const PORT = process.env.PORT || 4000;
          const url = `http://localhost:${PORT}/api/verify/bulk-admin?phones=${phones}&names=${names}&products=${products}&months=${months}`;
          const result = await new Promise((resolve, reject) => {
            http.get(url, (response) => {
              let data = '';
              response.on('data', chunk => data += chunk);
              response.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  resolve({});
                }
              });
            }).on('error', reject);
          });
          Object.assign(verifyMap, result);
        } catch (err) {
          console.error(`⚠️ [monthly-points] Verify batch error:`, err.message);
        }
      }


      // ✅ Points calculation (same as frontend)
      const POINTS_MAP = {
        'Tide': 2,
        'Tide MSME': 0.3,
        'MSME': 0.3,
        'Tide Insurance': 1,
        'Tide Credit Card': 1,
        'Tide BT': 1
      };

      // Group by employee and calculate auto points
      const employeeMap = {};

      allForms.forEach(form => {
        const empName = (form.employeeName || '').trim().replace(/\s+/g, ' ');
        if (!empName) return;

        const empKey = empName.toLowerCase();
        if (!employeeMap[empKey]) {
          employeeMap[empKey] = {
            displayName: empName,
            autoPoints: 0,
            verifiedForms: new Set()
          };
        }

        const product = getFormProduct(form);
        const vKey = product ? `${form.customerNumber}__${product}` : form.customerNumber;

        if (verifyMap[vKey]?.status === 'Fully Verified' && !employeeMap[empKey].verifiedForms.has(vKey)) {
          employeeMap[empKey].verifiedForms.add(vKey);
          const productKey = Object.keys(POINTS_MAP).find(k => k.toLowerCase() === product);
          employeeMap[empKey].autoPoints += productKey ? POINTS_MAP[productKey] : 0;
        }
      });

      // ✅ Get slab bonuses from EmployeePoints collection
      const EmployeePoints = require('../models/EmployeePoints');
      const employeeList = [];

      for (const [empKey, data] of Object.entries(employeeMap)) {
        const autoPoints = Math.round(data.autoPoints * 10) / 10;
        let slabPoints = 0;

        try {
          const empPts = await EmployeePoints.findOne({
            newJoinerName: { $regex: new RegExp(`^${data.displayName.trim()}$`, 'i') }
          }).lean();

          if (empPts?.productSlabs) {
            Object.values(empPts.productSlabs).forEach(ps => {
              const tiers = ps?.slabTiers || (Array.isArray(ps) ? ps : []);
              tiers.forEach(t => {
                slabPoints += (parseFloat(t.forms) || 0) * (parseFloat(t.multiplier) || 0);
              });
            });
            slabPoints = Math.round(slabPoints * 10) / 10;
          }
        } catch (e) {
        }

        const totalPoints = Math.round((autoPoints + slabPoints) * 10) / 10;

        employeeList.push({
          employeeName: data.displayName,
          autoPoints,
          slabPoints,
          totalPoints
        });
      }


      res.json({
        success: true,
        month,
        year: targetYear,
        employees: employeeList,
        totalForms: allForms.length
      });

    } catch (error) {
      console.error('❌ [monthly-points] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
