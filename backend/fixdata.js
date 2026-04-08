require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('./models/Employee');

mongoose.connect(process.env.MONGO_URI, { dbName: 'CompanyDB' }).then(async () => {

  // Fix trailing spaces in all employee names and reportingManager fields
  const emps = await Employee.find({});
  for (const emp of emps) {
    await Employee.findByIdAndUpdate(emp._id, {
      $set: {
        newJoinerName:    emp.newJoinerName?.trim(),
        reportingManager: emp.reportingManager?.trim(),
        location:         emp.location?.trim(),
      }
    });
    console.log(`Fixed: "${emp.newJoinerName}" -> reportingManager: "${emp.reportingManager?.trim()}"`);
  }

  console.log('\n✅ All employee data cleaned up');
  process.exit(0);
});
