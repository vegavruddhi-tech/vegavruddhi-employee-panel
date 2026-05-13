const express = require('express');
const router = express.Router();
const SalarySlip = require('../models/SalarySlip');
const EmployeeMonthlyPoints = require('../models/EmployeeMonthlyPoints');
const { generateSalarySlipPDF } = require('../utils/pdfGenerator');

// ========== SYNC POINTS ENDPOINT ==========

/**
 * POST /api/salary/sync-points
 * Called from Merchant Forms page to save pre-calculated points
 * This is the KEY endpoint that makes Salary Slips fast and accurate
 */
router.post('/sync-points', async (req, res) => {
  try {
    const { employees, month, year } = req.body;

    if (!employees || !Array.isArray(employees) || !month || !year) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`📊 Syncing points for ${employees.length} employees - ${month} ${year}`);

    const { getRedisClient } = require('../utils/redisClient');
    const redis = getRedisClient();

    let saved = 0;
    let errors = 0;

    for (const emp of employees) {
      try {
        const basePoints  = Math.round((emp.basePoints || emp.autoPoints || 0) * 10) / 10;
        const slabPoints  = Math.round((emp.slabPoints || 0) * 10) / 10;
        const totalPoints = Math.round((basePoints + slabPoints) * 10) / 10;

        // Upsert into MongoDB
        await EmployeeMonthlyPoints.findOneAndUpdate(
          {
            employeeName: { $regex: new RegExp(`^${emp.employeeName.trim()}$`, 'i') },
            month,
            year: parseInt(year)
          },
          {
            employeeName: emp.employeeName,
            employeeEmail: emp.employeeEmail || '',
            month,
            year: parseInt(year),
            basePoints,
            slabPoints,
            totalPoints,
            updatedAt: new Date()
          },
          { upsert: true, new: true }
        );

        // Also save to Redis cache (expires in 25 hours)
        if (redis) {
          const cacheKey = `monthly_points:${emp.employeeName.toLowerCase().trim()}:${month}:${year}`;
          await redis.setex(cacheKey, 90000, JSON.stringify({
            employeeName: emp.employeeName,
            employeeEmail: emp.employeeEmail || '',
            basePoints,
            slabPoints,
            totalPoints
          }));
        }

        saved++;
      } catch (err) {
        console.error(`Error saving points for ${emp.employeeName}:`, err.message);
        errors++;
      }
    }

    console.log(`✅ Synced ${saved} employees, ${errors} errors`);
    res.json({ success: true, saved, errors });

  } catch (error) {
    console.error('❌ Sync points error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== ADMIN ENDPOINTS ==========

/**
 * GET /api/salary/employees
 * 3-LAYER APPROACH:
 * Layer 1: Redis cache (fastest)
 * Layer 2: EmployeeMonthlyPoints MongoDB (fast, pre-saved from Merchant Forms)
 * Layer 3: Fallback - calculate from verify API (slow but always works)
 */
router.get('/employees', async (req, res) => {
  try {
    const { month, year, pointValue = 250 } = req.query;

    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }

    console.log(`📋 GET /api/salary/employees - Month: ${month}, Year: ${year}`);

    const Employee = require('../models/Employee');
    const { getRedisClient } = require('../utils/redisClient');
    const redis = getRedisClient();
    const pv = parseInt(pointValue);

    // ✅ LAYER 2: Try MongoDB EmployeeMonthlyPoints first (pre-saved from Merchant Forms)
    const savedPoints = await EmployeeMonthlyPoints.find({
      month,
      year: parseInt(year)
    }).lean();

    if (savedPoints && savedPoints.length > 0) {
      console.log(`✅ LAYER 2: Found ${savedPoints.length} employees in EmployeeMonthlyPoints`);

      // Get employee details for email/phone/role
      const allEmployees = await Employee.find({ status: 'Active' }).lean();
      const empDbMap = {};
      allEmployees.forEach(emp => {
        const key = (emp.newJoinerName || '').trim().toLowerCase();
        empDbMap[key] = emp;
      });

      // Check existing slips
      const existingSlips = await SalarySlip.find({ month, year: parseInt(year) }).lean();
      const slipMap = {};
      existingSlips.forEach(slip => { slipMap[slip.employeeEmail] = slip; });

      const employeeList = savedPoints.map(emp => {
        const empKey = emp.employeeName.trim().toLowerCase();
        const empDb  = empDbMap[empKey];
        const email  = emp.employeeEmail || empDb?.newJoinerEmailId || empDb?.email || '';
        const totalPts = emp.totalPoints || emp.basePoints || 0;

        return {
          employeeId:    empDb?.employeeId || null,  // VV0001 format
          employeeName:  emp.employeeName,
          employeeEmail: email,
          employeePhone: empDb?.newJoinerPhone || empDb?.phone || '',
          role:          empDb?.role || 'FSE',
          pointsEarned:  emp.basePoints || 0,
          slabPoints:    emp.slabPoints || 0,
          totalPoints:   totalPts,
          pointValue:    pv,
          totalSalary:   Math.round(totalPts * pv * 10) / 10,
          hasSlip:       !!slipMap[email],
          slipId:        slipMap[email]?._id || null,
          slipStatus:    slipMap[email]?.status || null,
          dataSource:    'mongodb'
        };
      });

      // Sort by totalPoints descending
      employeeList.sort((a, b) => b.totalPoints - a.totalPoints);

      return res.json({
        success: true,
        employees: employeeList,
        total: employeeList.length,
        dataSource: 'mongodb',
        message: 'Data from pre-saved EmployeeMonthlyPoints. Open Merchant Forms to refresh.'
      });
    }

    // ✅ LAYER 3: Fallback - calculate from verify API (slow)
    console.log(`⚠️ LAYER 3: No pre-saved data found. Calculating from verify API...`);
    console.log(`⚠️ TIP: Open Merchant Forms page first to pre-save points for faster loading.`);

    const FormResponse = require('../models/FormResponse');

    const getMonthIndex = (monthName) => {
      const months = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
      return months.indexOf(monthName);
    };

    const monthIndex = getMonthIndex(month);
    const targetYear = parseInt(year);
    const startDate  = new Date(targetYear, monthIndex, 1);
    const endDate    = new Date(targetYear, monthIndex + 1, 1);

    const allFormsRaw = await FormResponse.find({
      createdAt: { $gte: startDate, $lt: endDate }
    }).lean();

    const allForms = allFormsRaw.filter(f => {
      const d = new Date(f.createdAt);
      return d.getFullYear() === targetYear &&
             d.toLocaleString('en-US', { month: 'long' }) === month;
    });

    console.log(`📊 Found ${allForms.length} forms in ${month} ${year}`);

    const allEmployees = await Employee.find({ status: 'Active' }).lean();
    const empDbMap = {};
    allEmployees.forEach(emp => {
      const key = (emp.newJoinerName || '').trim().toLowerCase();
      empDbMap[key] = emp;
    });

    // Call verify API in batches
    const http = require('http');
    const verifyMap = {};
    const BATCH = 50;
    const getFormProduct = (f) => (f.formFillingFor || f.tideProduct || f.brand || '').toLowerCase().trim();

    for (let i = 0; i < allForms.length; i += BATCH) {
      const batch    = allForms.slice(i, i + BATCH);
      const phones   = batch.map(f => encodeURIComponent(f.customerNumber)).join(',');
      const names    = batch.map(f => encodeURIComponent(f.customerName || '')).join(',');
      const products = batch.map(f => encodeURIComponent(getFormProduct(f))).join(',');
      const months   = batch.map(f => encodeURIComponent(new Date(f.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' }))).join(',');

      try {
        const PORT = process.env.PORT || 4000;
        const url  = `http://localhost:${PORT}/api/verify/bulk-admin?phones=${phones}&names=${names}&products=${products}&months=${months}`;
        const result = await new Promise((resolve, reject) => {
          http.get(url, (r) => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({}); } });
          }).on('error', reject);
        });
        Object.assign(verifyMap, result);
      } catch (err) {
        console.error(`Verify batch error:`, err.message);
      }
    }

    const POINTS_MAP = { 'Tide': 2, 'Tide MSME': 0.3, 'Tide Insurance': 1, 'Tide Credit Card': 1, 'Tide BT': 1 };
    const employeeMap = {};

    allForms.forEach(form => {
      const empName    = (form.employeeName || '').trim().replace(/\s+/g, ' ');
      if (!empName) return;
      const empKey     = empName.toLowerCase();
      if (!employeeMap[empKey]) {
        employeeMap[empKey] = { displayName: empName, points: 0, counted: new Set() };
      }
      const product    = getFormProduct(form);
      const vKey       = `${form.customerNumber}__${product}`;
      if (verifyMap[vKey]?.status === 'Fully Verified' && !employeeMap[empKey].counted.has(vKey)) {
        employeeMap[empKey].counted.add(vKey);
        const pk = Object.keys(POINTS_MAP).find(k => k.toLowerCase() === product);
        employeeMap[empKey].points += pk ? POINTS_MAP[pk] : 0;
      }
    });

    // Fetch slab points
    const EmployeePoints = require('../models/EmployeePoints');
    const employeeList = [];

    for (const [empKey, data] of Object.entries(employeeMap)) {
      const empDb     = empDbMap[empKey];
      const basePoints = Math.round(data.points * 10) / 10;
      let slabPoints   = 0;

      try {
        const empPts = await EmployeePoints.findOne({
          newJoinerName: { $regex: new RegExp(`^${data.displayName.trim()}$`, 'i') }
        }).lean();
        if (empPts?.productSlabs) {
          Object.values(empPts.productSlabs).forEach(ps => {
            const tiers = ps?.slabTiers || (Array.isArray(ps) ? ps : []);
            tiers.forEach(t => { slabPoints += (parseFloat(t.forms) || 0) * (parseFloat(t.multiplier) || 0); });
          });
          slabPoints = Math.round(slabPoints * 10) / 10;
        }
      } catch (e) {}

      const totalPoints = Math.round((basePoints + slabPoints) * 10) / 10;
      const email       = empDb?.newJoinerEmailId || empDb?.email || '';

      employeeList.push({
        employeeId:    empDb?.employeeId || null,  // VV0001 format
        employeeName:  data.displayName,
        employeeEmail: email,
        employeePhone: empDb?.newJoinerPhone || empDb?.phone || '',
        role:          empDb?.role || 'FSE',
        pointsEarned:  basePoints,
        slabPoints,
        totalPoints,
        pointValue:    pv,
        totalSalary:   Math.round(totalPoints * pv * 10) / 10,
        hasSlip:       false,
        slipId:        null,
        slipStatus:    null,
        dataSource:    'api'
      });
    }

    // Check existing slips
    const existingSlips = await SalarySlip.find({ month, year: parseInt(year) }).lean();
    const slipMap = {};
    existingSlips.forEach(slip => { slipMap[slip.employeeEmail] = slip; });

    const finalList = employeeList.map(emp => ({
      ...emp,
      hasSlip:   !!slipMap[emp.employeeEmail],
      slipId:    slipMap[emp.employeeEmail]?._id || null,
      slipStatus: slipMap[emp.employeeEmail]?.status || null
    }));

    finalList.sort((a, b) => b.totalPoints - a.totalPoints);

    res.json({
      success: true,
      employees: finalList,
      total: finalList.length,
      dataSource: 'api',
      message: 'Calculated from verify API (slow). Open Merchant Forms to pre-save for faster loading.'
    });

  } catch (error) {
    console.error('❌ Error fetching employees:', error);
    res.status(500).json({ error: error.message });
  }
});
/**
 * POST /api/salary/generate
 * Generate salary slip for an employee
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      employeeId,
      employeeName,
      employeeEmail,
      employeePhone,
      role,
      month,
      year,
      pointsEarned,
      slabPoints = 0,
      pointValue = 250,
      generatedBy,
      pctBasic = 50,
      pctHRA = 25,
      pctConv = 5,
      pctSpec = 20,
      deductionPF = 0,
      deductionPT = 0,
      deductionESIC = 0,
      deductionTDS = 0,
      remarks = ''
    } = req.body;

    // Validation
    if (!employeeEmail || !month || !year) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if slip already exists
    const existing = await SalarySlip.findOne({
      employeeEmail,
      month,
      year: parseInt(year)
    });

    if (existing) {
      return res.status(400).json({ 
        error: 'Salary slip already exists for this employee and period',
        slipId: existing._id
      });
    }

    // Calculate total points and salary
    const totalPoints = (parseFloat(pointsEarned) || 0) + (parseFloat(slabPoints) || 0);
    const totalSalary = totalPoints * pointValue;

    // Create salary slip
    const salarySlip = new SalarySlip({
      employeeId,
      employeeName,
      employeeEmail,
      employeePhone,
      role: role || 'FSE',
      month,
      year: parseInt(year),
      pointsEarned: parseFloat(pointsEarned) || 0,
      slabPoints: parseFloat(slabPoints) || 0,
      totalPoints,
      pointValue,
      totalSalary,
      status: 'generated',
      generatedBy: generatedBy || 'admin',
      generatedAt: new Date(),
      remarks,
      pctBasic, pctHRA, pctConv, pctSpec,
      deductionPF, deductionPT, deductionESIC, deductionTDS
    });

    await salarySlip.save();

    // Generate PDF
    try {
      console.log('📄 Generating PDF for salary slip...');
      const result = await generateSalarySlipPDF(salarySlip);
      salarySlip.pdfUrl = result.url;
      await salarySlip.save();
      console.log('✅ PDF generated and saved:', result.url);
    } catch (pdfError) {
      console.error('⚠️ PDF generation failed (slip saved without PDF):', pdfError.message);
    }

    res.json({
      success: true,
      message: 'Salary slip generated successfully',
      slip: salarySlip
    });
  } catch (error) {
    console.error('Error generating salary slip:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/salary/list
 * Get all salary slips (with filters)
 */
router.get('/list', async (req, res) => {
  try {
    const { month, year, role, status, search } = req.query;

    const query = {};
    if (month) query.month = month;
    if (year) query.year = parseInt(year);
    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { employeeName: { $regex: search, $options: 'i' } },
        { employeeEmail: { $regex: search, $options: 'i' } }
      ];
    }

    const slips = await SalarySlip.find(query)
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      slips,
      total: slips.length
    });
  } catch (error) {
    console.error('Error fetching salary slips:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/salary/:id/view-pdf
 * Generate and stream PDF directly to browser
 * Pass ?admin=true to show % column (admin view)
 */
router.get('/:id/view-pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = req.query.admin === 'true';
    const slip = await SalarySlip.findById(id);

    if (!slip) {
      return res.status(404).json({ error: 'Salary slip not found' });
    }

    console.log(`📄 Streaming PDF for ${slip.employeeName} (isAdmin: ${isAdmin})...`);

    const { generateSalarySlipPDF } = require('../utils/pdfGenerator');
    const pdfBuffer = await generateSalarySlipPDF(slip.toObject(), isAdmin);

    // Stream PDF directly to browser
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="salary_${slip.employeeName}_${slip.month}_${slip.year}.pdf"`,
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(pdfBuffer, 'binary');
    console.log(`✅ PDF streamed successfully for ${slip.employeeName}`);

  } catch (error) {
    console.error('❌ PDF stream error:', error.message);
    res.status(500).json({ error: 'PDF generation failed: ' + error.message });
  }
});

/**
 * POST /api/salary/:id/generate-pdf
 * Generate PDF for existing salary slip
 */
router.post('/:id/generate-pdf', async (req, res) => {
  try {
    const { id } = req.params;
    
    const slip = await SalarySlip.findById(id);
    
    if (!slip) {
      return res.status(404).json({ error: 'Salary slip not found' });
    }
    
    // Validate slip has required fields
    if (!slip.employeeName || !slip.employeeEmail || !slip.month || !slip.year) {
      return res.status(400).json({ error: 'Salary slip missing required fields' });
    }
    
    // Generate PDF
    try {
      console.log('📄 Generating PDF for slip:', {
        id: slip._id,
        name: slip.employeeName,
        email: slip.employeeEmail,
        month: slip.month,
        year: slip.year
      });
      
      const { generateSalarySlipPDF } = require('../utils/pdfGenerator');
      const pdfUrl = await generateSalarySlipPDF(slip.toObject());
      
      slip.pdfUrl = pdfUrl;
      await slip.save();
      
      console.log('✅ PDF generated and saved:', pdfUrl);
      
      res.json({
        success: true,
        message: 'PDF generated successfully',
        slip,
        pdfUrl
      });
    } catch (pdfError) {
      console.error('⚠️ PDF generation failed:', pdfError);
      res.status(500).json({ 
        error: 'PDF generation failed: ' + (pdfError.message || 'Unknown error'),
        details: pdfError.stack
      });
    }
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/salary/:id
 * Get single salary slip details
 */
router.get('/:id', async (req, res) => {
  try {
    const slip = await SalarySlip.findById(req.params.id);

    if (!slip) {
      return res.status(404).json({ error: 'Salary slip not found' });
    }

    res.json({
      success: true,
      slip
    });
  } catch (error) {
    console.error('Error fetching salary slip:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/salary/:id
 * Update/Edit salary slip
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      pointsEarned,
      pointValue,
      totalSalary,
      paymentDate,
      paymentMode,
      status,
      remarks,
      editedBy
    } = req.body;

    const slip = await SalarySlip.findById(id);

    if (!slip) {
      return res.status(404).json({ error: 'Salary slip not found' });
    }

    // Track changes in edit history
    const changes = [];

    if (pointsEarned !== undefined && pointsEarned !== slip.pointsEarned) {
      changes.push({
        field: 'pointsEarned',
        oldValue: slip.pointsEarned,
        newValue: pointsEarned,
        editedBy: editedBy || 'admin'
      });
      slip.pointsEarned = pointsEarned;
    }

    if (pointValue !== undefined && pointValue !== slip.pointValue) {
      changes.push({
        field: 'pointValue',
        oldValue: slip.pointValue,
        newValue: pointValue,
        editedBy: editedBy || 'admin'
      });
      slip.pointValue = pointValue;
    }

    if (totalSalary !== undefined && totalSalary !== slip.totalSalary) {
      changes.push({
        field: 'totalSalary',
        oldValue: slip.totalSalary,
        newValue: totalSalary,
        editedBy: editedBy || 'admin'
      });
      slip.totalSalary = totalSalary;
    }

    if (paymentDate !== undefined) slip.paymentDate = paymentDate;
    if (paymentMode !== undefined) slip.paymentMode = paymentMode;
    if (status !== undefined) slip.status = status;
    if (remarks !== undefined) slip.remarks = remarks;

    // Update audit fields
    slip.lastEditedBy = editedBy || 'admin';
    slip.lastEditedAt = new Date();

    // Add changes to edit history
    if (changes.length > 0) {
      slip.editHistory.push(...changes);
    }

    await slip.save();

    // Regenerate PDF if points/value/salary changed
    if (changes.some(c => ['pointsEarned', 'pointValue', 'totalSalary'].includes(c.field))) {
      try {
        console.log('📄 Regenerating PDF after edit...');
        const pdfUrl = await generateSalarySlipPDF(slip);
        slip.pdfUrl = pdfUrl;
        await slip.save();
        console.log('✅ PDF regenerated:', pdfUrl);
      } catch (pdfError) {
        console.error('⚠️ PDF regeneration failed:', pdfError.message);
        // Continue without PDF update
      }
    }

    res.json({
      success: true,
      message: 'Salary slip updated successfully',
      slip
    });
  } catch (error) {
    console.error('Error updating salary slip:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/salary/:id
 * Delete salary slip
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const slip = await SalarySlip.findById(id);

    if (!slip) {
      return res.status(404).json({ error: 'Salary slip not found' });
    }

    // TODO: Delete PDF from Cloudinary if exists
    // if (slip.pdfUrl) {
    //   await deleteFromCloudinary(slip.pdfUrl);
    // }

    await SalarySlip.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Salary slip deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting salary slip:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/salary/bulk-generate
 * Generate salary slips for multiple employees
 */
router.post('/bulk-generate', async (req, res) => {
  try {
    const { employees, month, year, pointValue = 250, generatedBy } = req.body;

    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ error: 'No employees provided' });
    }

    const results = {
      success: [],
      failed: [],
      skipped: []
    };

    for (const emp of employees) {
      try {
        // Check if slip already exists
        const existing = await SalarySlip.findOne({
          employeeEmail: emp.employeeEmail,
          month,
          year: parseInt(year)
        });

        if (existing) {
          results.skipped.push({
            email: emp.employeeEmail,
            reason: 'Slip already exists'
          });
          continue;
        }

        // Create salary slip
        const salarySlip = new SalarySlip({
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          employeeEmail: emp.employeeEmail,
          employeePhone: emp.employeePhone,
          role: emp.role || 'FSE',
          month,
          year: parseInt(year),
          pointsEarned: emp.pointsEarned,
          pointValue,
          totalSalary: emp.pointsEarned * pointValue,
          status: 'generated',
          generatedBy: generatedBy || 'admin'
        });

        await salarySlip.save();

        // Generate PDF (don't fail bulk operation if PDF fails)
        try {
          const pdfUrl = await generateSalarySlipPDF(salarySlip);
          salarySlip.pdfUrl = pdfUrl;
          await salarySlip.save();
        } catch (pdfError) {
          console.error(`⚠️ PDF generation failed for ${emp.employeeEmail}:`, pdfError.message);
        }

        results.success.push({
          email: emp.employeeEmail,
          slipId: salarySlip._id
        });
      } catch (error) {
        results.failed.push({
          email: emp.employeeEmail,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Generated ${results.success.length} slips, skipped ${results.skipped.length}, failed ${results.failed.length}`,
      results
    });
  } catch (error) {
    console.error('Error bulk generating salary slips:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== EMPLOYEE ENDPOINTS ==========

/**
 * GET /api/salary/employee/:email
 * Get salary slips for a specific employee
 */
router.get('/employee/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { year } = req.query;

    const query = { employeeEmail: email };
    if (year) query.year = parseInt(year);

    const slips = await SalarySlip.find(query)
      .sort({ year: -1, month: -1 })
      .lean();

    res.json({
      success: true,
      slips,
      total: slips.length
    });
  } catch (error) {
    console.error('Error fetching employee salary slips:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
