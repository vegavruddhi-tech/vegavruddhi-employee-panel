const express = require('express');
const router = express.Router();
const SalarySlip = require('../models/SalarySlip');
const { generateSalarySlipPDF } = require('../utils/pdfGenerator');

// ========== IN-MEMORY POINTS CACHE ==========
// Stores latest synced points from Merchant Forms
const pointsCache = new Map(); // Key: "employeeName__month__year", Value: { autoPoints, slabPoints, totalPoints }

/**
 * POST /api/salary/sync-points
 * Called by Merchant Forms to sync calculated points
 */
router.post('/sync-points', async (req, res) => {
  try {
    const { employees, month, year } = req.body;

    if (!employees || !Array.isArray(employees) || !month || !year) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`📊 [sync-points] Syncing ${employees.length} employees for ${month} ${year}`);

    let saved = 0;
    
    employees.forEach(emp => {
      const basePoints  = Math.round((emp.basePoints || emp.autoPoints || 0) * 10) / 10;
      const slabPoints  = Math.round((emp.slabPoints || 0) * 10) / 10;
      const totalPoints = Math.round((basePoints + slabPoints) * 10) / 10;
      
      const normalizedName = (emp.employeeName || '').trim();
      if (!normalizedName) return;
      
      const cacheKey = `${normalizedName.toLowerCase()}__${month}__${year}`;
      pointsCache.set(cacheKey, {
        employeeName: normalizedName,
        employeeEmail: emp.employeeEmail || '',
        autoPoints: basePoints,
        slabPoints,
        totalPoints,
        syncedAt: new Date()
      });
      
      saved++;
    });

    console.log(`✅ [sync-points] Synced ${saved} employees to cache`);
    console.log(`🔍 Cache sample:`, Array.from(pointsCache.entries()).slice(0, 3).map(([k, v]) => ({
      key: k,
      points: v.totalPoints
    })));
    
    res.json({ success: true, saved, message: `Synced ${saved} employees for ${month} ${year}` });

  } catch (error) {
    console.error('❌ [sync-points] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== ADMIN ENDPOINTS ==========

/**
 * GET /api/salary/employees
 * Reads points from in-memory cache (synced from Merchant Forms)
 */
router.get('/employees', async (req, res) => {
  try {
    const { month, year, pointValue = 250, roleFilter } = req.query;

    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }

    console.log(`📋 GET /api/salary/employees - Month: ${month}, Year: ${year}`);
    console.log(`📦 Cache has ${pointsCache.size} entries`);

    const Employee = require('../models/Employee');
    const TeamLead = require('../models/TeamLead');
    const Manager = require('../models/Manager');
    const pv = parseInt(pointValue);

    // Get all employees from database
    const allEmployees = await Employee.find({ status: 'Active' }).lean();
    const allTeamLeads = await TeamLead.find({ status: 'Active' }).lean();
    const allManagers = await Manager.find({ status: 'Active' }).lean();

    const employeeList = [];

    // Build employee list from cache
    allEmployees.forEach(emp => {
      const empName = (emp.newJoinerName || '').trim();
      if (!empName) return;
      
      const cacheKey = `${empName.toLowerCase()}__${month}__${year}`;
      const cached = pointsCache.get(cacheKey);
      
      if (cached) {
        // Found in cache - use synced points
        const totalSalary = Math.round(cached.totalPoints * pv * 10) / 10;
        
        employeeList.push({
          employeeId: emp.employeeId || null,
          employeeName: empName,
          employeeEmail: emp.newJoinerEmailId || emp.email || '',
          employeePhone: emp.newJoinerPhone || emp.phone || '',
          role: 'FSE',
          pointsEarned: cached.autoPoints,
          slabPoints: cached.slabPoints,
          totalPoints: cached.totalPoints,
          pointValue: pv,
          totalSalary: totalSalary,
          hasSlip: false,
          slipId: null,
          slipStatus: null,
          dataSource: 'synced-from-merchant-forms'
        });
      }
    });

    // Add TLs with fixed salary
    allTeamLeads.forEach(tl => {
      employeeList.push({
        employeeId: tl.employeeId || null,
        employeeName: tl.name,
        employeeEmail: tl.email || tl.emailId || '',
        employeePhone: tl.phone || '',
        role: 'TL',
        pointsEarned: 0,
        slabPoints: 0,
        totalPoints: 0,
        pointValue: pv,
        totalSalary: 35000,
        hasSlip: false,
        slipId: null,
        slipStatus: null,
        dataSource: 'fixed-salary'
      });
    });

    // Add Managers with fixed salary
    allManagers.forEach(mgr => {
      employeeList.push({
        employeeId: mgr.employeeId || null,
        employeeName: mgr.name,
        employeeEmail: mgr.email || mgr.emailId || '',
        employeePhone: mgr.phone || '',
        role: 'Manager',
        pointsEarned: 0,
        slabPoints: 0,
        totalPoints: 0,
        pointValue: pv,
        totalSalary: 60000,
        hasSlip: false,
        slipId: null,
        slipStatus: null,
        dataSource: 'fixed-salary'
      });
    });

    // Check existing slips
    const existingSlips = await SalarySlip.find({ month, year: parseInt(year) }).lean();
    const slipMap = {};
    existingSlips.forEach(slip => {
      slipMap[slip.employeeEmail] = slip;
    });

    const finalList = employeeList.map(emp => ({
      ...emp,
      hasSlip: !!slipMap[emp.employeeEmail],
      slipId: slipMap[emp.employeeEmail]?._id || null,
      slipStatus: slipMap[emp.employeeEmail]?.status || null
    }));

    // Sort by totalPoints descending
    finalList.sort((a, b) => b.totalPoints - a.totalPoints);

    // Filter by role if requested
    let filteredList = finalList;
    if (roleFilter && roleFilter !== 'All') {
      filteredList = finalList.filter(emp => emp.role === roleFilter);
    }
    
    console.log(`✅ Returning ${filteredList.length} employees (${finalList.length - filteredList.length} filtered out)`);
    console.log(`🔍 Sample:`, filteredList.slice(0, 3).map(e => ({
      name: e.employeeName,
      points: e.pointsEarned,
      slab: e.slabPoints,
      total: e.totalPoints
    })));

    res.json({
      success: true,
      employees: filteredList,
      total: filteredList.length,
      dataSource: 'synced-from-merchant-forms',
      message: `✅ Using points synced from Merchant Forms`
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
      incentiveAmount = 0,  // 🔥 NEW: For TL/Manager
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

    // 🔥 DEBUG: Log what we received
    console.log('📋 Generate Salary Slip Request:');
    console.log('   Employee ID:', employeeId);
    console.log('   Employee Name:', employeeName);
    console.log('   Role:', role);

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

    // Calculate total points and salary based on role
    const empRole = role || 'FSE';
    let totalPoints, totalSalary, baseSalary;
    
    if (empRole === 'TL') {
      // TL: Fixed ₹35,000 base + incentive
      baseSalary = 35000;
      totalPoints = 0;
      totalSalary = baseSalary + (parseFloat(incentiveAmount) || 0);
    } else if (empRole === 'Manager') {
      // Manager: Fixed ₹60,000 base + incentive
      baseSalary = 60000;
      totalPoints = 0;
      totalSalary = baseSalary + (parseFloat(incentiveAmount) || 0);
    } else {
      // FSE: Points-based (existing logic)
      baseSalary = 0;
      totalPoints = (parseFloat(pointsEarned) || 0) + (parseFloat(slabPoints) || 0);
      totalSalary = totalPoints * pointValue;
    }

    // Create salary slip
    const salarySlip = new SalarySlip({
      employeeId,
      employeeName,
      employeeEmail,
      employeePhone,
      role: empRole,
      month,
      year: parseInt(year),
      pointsEarned: empRole === 'FSE' ? (parseFloat(pointsEarned) || 0) : 0,
      slabPoints: empRole === 'FSE' ? (parseFloat(slabPoints) || 0) : 0,
      totalPoints,
      pointValue,
      incentiveAmount: (empRole === 'TL' || empRole === 'Manager') ? (parseFloat(incentiveAmount) || 0) : 0,
      baseSalary,
      totalSalary,
      status: 'generated',
      generatedBy: generatedBy || 'admin',
      generatedAt: new Date(),
      remarks,
      pctBasic, pctHRA, pctConv, pctSpec,
      deductionPF, deductionPT, deductionESIC, deductionTDS
    });

    console.log('💾 Saving salary slip with employeeId:', salarySlip.employeeId);

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

        // Calculate salary based on role
        const empRole = emp.role || 'FSE';
        let totalSalary;
        
        if (empRole === 'TL') {
          totalSalary = 35000;
        } else if (empRole === 'Manager') {
          totalSalary = 60000;
        } else {
          totalSalary = emp.pointsEarned * pointValue;
        }

        // Create salary slip
        const salarySlip = new SalarySlip({
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          employeeEmail: emp.employeeEmail,
          employeePhone: emp.employeePhone,
          role: empRole,
          month,
          year: parseInt(year),
          pointsEarned: empRole === 'FSE' ? emp.pointsEarned : 0,
          slabPoints: empRole === 'FSE' ? (emp.slabPoints || 0) : 0,
          totalPoints: empRole === 'FSE' ? (emp.pointsEarned + (emp.slabPoints || 0)) : 0,
          pointValue,
          totalSalary,
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
