const Employee = require('../models/Employee');

/**
 * Generate next employee ID in format VV0001, VV0002, etc.
 */
async function generateNextEmployeeId() {
  // Find the highest existing employeeId
  const lastEmployee = await Employee.findOne(
    { employeeId: { $regex: /^VV\d+$/ } },
    { employeeId: 1 }
  ).sort({ employeeId: -1 });

  if (!lastEmployee || !lastEmployee.employeeId) {
    return 'VV0001';
  }

  // Extract number and increment
  const lastNum = parseInt(lastEmployee.employeeId.replace('VV', ''), 10);
  const nextNum = lastNum + 1;
  return `VV${String(nextNum).padStart(4, '0')}`;
}

/**
 * Assign employee IDs to all existing employees who don't have one
 * Called once on server startup
 */
async function assignMissingEmployeeIds() {
  try {
    const employees = await Employee.find({
      $or: [
        { employeeId: { $exists: false } },
        { employeeId: null },
        { employeeId: '' }
      ]
    }).sort({ createdAt: 1 }); // Oldest first

    if (employees.length === 0) {
      console.log('✅ All employees already have IDs');
      return;
    }

    console.log(`📋 Assigning IDs to ${employees.length} employees...`);

    // Find the current highest ID
    const lastEmployee = await Employee.findOne(
      { employeeId: { $regex: /^VV\d+$/ } },
      { employeeId: 1 }
    ).sort({ employeeId: -1 });

    let counter = lastEmployee
      ? parseInt(lastEmployee.employeeId.replace('VV', ''), 10) + 1
      : 1;

    for (const emp of employees) {
      const newId = `VV${String(counter).padStart(4, '0')}`;
      await Employee.findByIdAndUpdate(emp._id, { employeeId: newId });
      console.log(`  ✅ ${emp.newJoinerName} → ${newId}`);
      counter++;
    }

    console.log(`✅ Assigned IDs to ${employees.length} employees`);
  } catch (err) {
    console.error('❌ Error assigning employee IDs:', err.message);
  }
}

module.exports = { generateNextEmployeeId, assignMissingEmployeeIds };
