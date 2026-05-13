const EmployeePoints = require('../models/EmployeePoints');
const Employee = require('../models/Employee');
const FormResponse = require('../models/FormResponse');

/**
 * Calculate salary for an employee based on points earned
 * @param {String} employeeEmail - Employee email
 * @param {String} month - Month name (e.g., "May")
 * @param {Number} year - Year (e.g., 2026)
 * @param {Number} pointValue - Value per point (default: ₹100)
 * @returns {Object} - Salary calculation result
 */
async function calculateSalary(employeeEmail, month, year, pointValue = 100) {
  try {
    // Get employee to find their name
    const employee = await Employee.findOne({ email: employeeEmail });
    if (!employee) {
      return {
        success: false,
        error: 'Employee not found',
        pointsEarned: 0,
        pointValue,
        totalSalary: 0
      };
    }

    // Get points from EmployeePoints collection (uses newJoinerName, not email)
    const pointsRecord = await EmployeePoints.findOne({
      newJoinerName: employee.newJoinerName
    });

    const pointsEarned = pointsRecord ? (pointsRecord.verifiedPoints || 0) : 0;
    const totalSalary = pointsEarned * pointValue;

    return {
      success: true,
      pointsEarned,
      pointValue,
      totalSalary,
      breakdown: {
        tide: pointsRecord?.tidePoints || 0,
        tideMSME: pointsRecord?.tideMSMEPoints || 0,
        tideInsurance: pointsRecord?.tideInsurancePoints || 0,
        tideCreditCard: pointsRecord?.tideCreditCardPoints || 0
      }
    };
  } catch (error) {
    console.error('Error calculating salary:', error);
    return {
      success: false,
      error: error.message,
      pointsEarned: 0,
      pointValue,
      totalSalary: 0
    };
  }
}

/**
 * Get all employees with their points for a given month
 * @param {String} month - Month name
 * @param {Number} year - Year
 * @param {Number} pointValue - Value per point
 * @returns {Array} - List of employees with calculated salaries
 */
async function getAllEmployeeSalaries(month, year, pointValue = 100) {
  try {
    const SalarySlip = require('../models/SalarySlip');
    
    // Points map - EXACT same as Merchant Forms page
    const POINTS_MAP = {
      'Tide': 2,
      'Tide MSME': 0.3,
      'Tide Insurance': 1,
      'Tide Credit Card': 1,
      'Tide BT': 1,
    };
    
    // Helper to get month index
    const getMonthIndex = (monthName) => {
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
      return months.indexOf(monthName);
    };
    
    // Get ALL employees
    const employees = await Employee.find({
      status: 'Active'
    }).lean();

    console.log(`📊 Found ${employees.length} active employees`);
    console.log(`📅 Calculating points for: ${month} ${year}`);

    const results = [];
    const monthIndex = getMonthIndex(month);
    const startDate = new Date(year, monthIndex, 1);
    const endDate = new Date(year, monthIndex + 1, 1);

    // Get ALL forms for the month first (more efficient)
    const allForms = await FormResponse.find({
      createdAt: {
        $gte: startDate,
        $lt: endDate
      }
    }).lean();

    console.log(`📋 Found ${allForms.length} total forms in ${month} ${year}`);

    // Group forms by employee name (case-insensitive)
    const formsByEmployee = {};
    allForms.forEach(form => {
      const empName = (form.employeeName || '').trim();
      if (!empName) return;
      
      // Use lowercase key for case-insensitive matching
      const key = empName.toLowerCase();
      if (!formsByEmployee[key]) {
        formsByEmployee[key] = {
          originalName: empName,
          forms: []
        };
      }
      formsByEmployee[key].forms.push(form);
    });

    for (const emp of employees) {
      const empNameLower = (emp.newJoinerName || '').trim().toLowerCase();
      const employeeForms = formsByEmployee[empNameLower]?.forms || [];

      // Calculate points - EXACT same logic as Merchant Forms
      let monthPoints = 0;
      const counted = new Set(); // Deduplicate by phone+product

      employeeForms.forEach(form => {
        const verificationStatus = form.verificationStatus;
        
        // Only count Fully Verified forms (same as Merchant Forms)
        if (verificationStatus === 'Fully Verified') {
          const product = (form.formFillingFor || form.tideProduct || '').toLowerCase().trim();
          const phone = form.customerNumber;
          
          // Deduplicate - same merchant+product only counts once
          const dedupKey = `${phone}__${product}`;
          if (counted.has(dedupKey)) return;
          
          counted.add(dedupKey);
          
          // Case-insensitive product matching (same as Merchant Forms)
          const pointsKey = Object.keys(POINTS_MAP).find(k => k.toLowerCase().trim() === product);
          const points = pointsKey ? POINTS_MAP[pointsKey] : 0;
          monthPoints += points;
        }
      });

      monthPoints = Math.round(monthPoints * 10) / 10;

      // Check if salary slip already exists
      const existingSlip = await SalarySlip.findOne({
        employeeEmail: emp.email,
        month: month,
        year: parseInt(year)
      });

      results.push({
        employeeId: emp._id,
        employeeName: emp.newJoinerName,
        employeeEmail: emp.email,
        employeePhone: emp.phone,
        role: emp.role || 'FSE',
        pointsEarned: monthPoints,  // Month-specific points
        pointValue,
        totalSalary: monthPoints * pointValue,
        hasSlip: !!existingSlip,
        slipStatus: existingSlip?.status || null,
        slipId: existingSlip?._id || null,
        formsCount: employeeForms.length,
        verifiedCount: counted.size
      });
    }

    console.log(`✅ Returning ${results.length} employees with month-specific points`);
    return results;
  } catch (error) {
    console.error('❌ Error getting all employee salaries:', error);
    return [];
  }
}

module.exports = {
  calculateSalary,
  getAllEmployeeSalaries
};
