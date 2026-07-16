const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const TeamLead = require('../models/TeamLead');
const Manager  = require('../models/Manager');

// Middleware to verify JWT
function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    const jwt = require('jsonwebtoken');
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}

// GET /api/attendance/admin/all - Get all attendance records (no auth for admin panel)
router.get('/admin/all', async (req, res) => {
  try {
    const { date, userType, status } = req.query;
    
    const filter = {};
    if (date) filter.date = date;
    if (userType) filter.userType = userType;
    if (status) filter.status = status;
    
    const attendance = await Attendance.find(filter)
      .populate('userId', 'newJoinerName email position')
      .sort({ date: -1, firstLoginTime: 1 });
    
    res.json(attendance);
    
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/attendance/admin/full - Get present + absent employees for a date
router.get('/admin/full', async (req, res) => {
  try {
    const { date } = req.query;
    const today = date || (() => {
      const now = new Date();
      const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      return ist.toISOString().split('T')[0];
    })();

    // 1. Fetch all active+approved users from all three collections in parallel
    const [allEmployees, allTLs, allManagers] = await Promise.all([
      Employee.find({ approvalStatus: 'approved', status: 'Active' })
        .select('_id newJoinerName email newJoinerEmailId newJoinerPhone position location reportingManager'),
      TeamLead.find({ approvalStatus: 'approved', status: 'Active' })
        .select('_id name email phone position location reportingManager'),
      Manager.find({ approvalStatus: 'approved', status: 'Active' })
        .select('_id name email phone location'),
    ]);

    // 2. Present attendance records for this date
    const presentRecords = await Attendance.find({ date: today });
    const presentUserIds = new Set(presentRecords.map(r => r.userId?.toString()));

    // Build lookup maps for fallback (in case attendance was created before position/location fields were added)
    const empMap = {};
    allEmployees.forEach(e => { empMap[e._id.toString()] = e; });
    const tlMap = {};
    allTLs.forEach(t => { tlMap[t._id.toString()] = t; });
    const managerMap = {};
    allManagers.forEach(m => { managerMap[m._id.toString()] = m; });

    // 3. Format present records — use stored fields, fallback to DB lookup if empty
    const presentFormatted = presentRecords.map(r => {
      const uid = r.userId?.toString();
      let position = r.position || '';
      let location = r.location || '';
      let reportingManager = r.reportingManager || '';
      let phone = r.phone || '';

      // Fallback to DB if fields are missing (old records before schema update)
      if (!position || !location || !phone) {
        if (r.userType === 'employee' && empMap[uid]) {
          position = position || empMap[uid].position || 'FSE';
          location = location || empMap[uid].location || '';
          reportingManager = reportingManager || empMap[uid].reportingManager || '';
          phone = phone || empMap[uid].newJoinerPhone || '';
        } else if (r.userType === 'teamlead' && tlMap[uid]) {
          position = position || tlMap[uid].position || 'Team Lead';
          location = location || tlMap[uid].location || '';
          reportingManager = reportingManager || tlMap[uid].reportingManager || '';
          phone = phone || tlMap[uid].phone || '';
        } else if (r.userType === 'manager' && managerMap[uid]) {
          position = position || 'Manager';
          location = location || managerMap[uid].location || '';
          phone = phone || managerMap[uid].phone || '';
        }
      }

      return {
        _id: r._id,
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        userType: r.userType,
        position,
        location,
        phone,
        reportingManager,
        date: r.date,
        status: r.status,
        firstLoginTime: r.firstLoginTime,
        lastActivityTime: r.lastActivityTime,
        lastLogoutTime: r.lastLogoutTime,
        duration: r.duration,
        reloginCount: r.reloginCount,
        attendanceMarked: r.attendanceMarked,
        autoCheckOut: r.autoCheckOut,
      };
    });

    // 4. Build absent list — employees not in present set
    const absentEmployees = allEmployees
      .filter(emp => !presentUserIds.has(emp._id.toString()))
      .map(emp => ({
        _id: null,
        userId: emp._id,
        userName: emp.newJoinerName,
        userEmail: emp.email || emp.newJoinerEmailId,
        userType: 'employee',
        position: emp.position || 'FSE',
        location: emp.location || '',
        phone: emp.newJoinerPhone || '',
        reportingManager: emp.reportingManager || '',
        date: today,
        status: 'absent',
        firstLoginTime: null, lastActivityTime: null,
        lastLogoutTime: null, duration: null,
        reloginCount: 0, attendanceMarked: false,
      }));

    const absentTLs = allTLs
      .filter(tl => !presentUserIds.has(tl._id.toString()))
      .map(tl => ({
        _id: null,
        userId: tl._id,
        userName: tl.name,
        userEmail: tl.email,
        userType: 'teamlead',
        position: tl.position || 'Team Lead',
        location: tl.location || '',
        phone: tl.phone || '',
        reportingManager: tl.reportingManager || '',
        date: today,
        status: 'absent',
        firstLoginTime: null, lastActivityTime: null,
        lastLogoutTime: null, duration: null,
        reloginCount: 0, attendanceMarked: false,
      }));

    const absentManagers = allManagers
      .filter(m => !presentUserIds.has(m._id.toString()))
      .map(m => ({
        _id: null,
        userId: m._id,
        userName: m.name,
        userEmail: m.email,
        userType: 'manager',
        position: 'Manager',
        location: m.location || '',
        phone: m.phone || '',
        reportingManager: '',
        date: today,
        status: 'absent',
        firstLoginTime: null, lastActivityTime: null,
        lastLogoutTime: null, duration: null,
        reloginCount: 0, attendanceMarked: false,
      }));

    // 5. Merge: present first (sorted by name), then absent (sorted by name)
    const allAbsent = [...absentEmployees, ...absentTLs, ...absentManagers]
      .sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));

    const result = [
      ...presentFormatted.sort((a, b) => (a.userName || '').localeCompare(b.userName || '')),
      ...allAbsent,
    ];

    res.json(result);

  } catch (error) {
    console.error('Error fetching full attendance:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/attendance/admin/summary - Get attendance summary (no auth for admin panel)
router.get('/admin/summary', async (req, res) => {
  try {
    const { date } = req.query;
    const today = date || (() => {
      const now = new Date();
      const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      return ist.toISOString().split('T')[0];
    })();

    const totalPresent  = await Attendance.countDocuments({ date: today, status: 'present' });
    const totalRelogins = await Attendance.countDocuments({ date: today, reloginCount: { $gt: 0 } });

    // Absent = all active approved users across all collections minus those who logged in
    const [totalActiveEmp, totalActiveTL, totalActiveManager] = await Promise.all([
      Employee.countDocuments({ approvalStatus: 'approved', status: 'Active' }),
      TeamLead.countDocuments({ approvalStatus: 'approved', status: 'Active' }),
      Manager.countDocuments({ approvalStatus: 'approved', status: 'Active' }),
    ]);
    const totalActive = totalActiveEmp + totalActiveTL + totalActiveManager;
    const totalAbsent = Math.max(0, totalActive - totalPresent);

    res.json({ date: today, totalPresent, totalAbsent, totalRelogins });

  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/attendance/admin/monthly - Get monthly attendance summary & days breakdown for all users
router.get('/admin/monthly', async (req, res) => {
  try {
    const now = new Date();
    const monthNum = parseInt(req.query.month, 10) || (now.getMonth() + 1);
    const yearNum  = parseInt(req.query.year, 10) || now.getFullYear();

    const totalDaysInMonth = new Date(yearNum, monthNum, 0).getDate();

    let workingDays = 0;
    if (yearNum === now.getFullYear() && monthNum === now.getMonth() + 1) {
      workingDays = Math.min(totalDaysInMonth, now.getDate());
    } else if ((yearNum < now.getFullYear()) || (yearNum === now.getFullYear() && monthNum < now.getMonth() + 1)) {
      workingDays = totalDaysInMonth;
    }

    // 1. Fetch all active+approved users from all three collections
    const [allEmployees, allTLs, allManagers] = await Promise.all([
      Employee.find({ approvalStatus: 'approved', status: 'Active' })
        .select('_id newJoinerName email newJoinerEmailId newJoinerPhone position location reportingManager'),
      TeamLead.find({ approvalStatus: 'approved', status: 'Active' })
        .select('_id name email phone position location reportingManager'),
      Manager.find({ approvalStatus: 'approved', status: 'Active' })
        .select('_id name email phone location'),
    ]);

    // 2. Fetch all present records for the selected month
    const monthPrefix = `${yearNum}-${String(monthNum).padStart(2, '0')}`;
    const monthAttendance = await Attendance.find({
      date: { $gte: `${monthPrefix}-01`, $lte: `${monthPrefix}-31` },
      status: 'present'
    });

    // 3. Build a map of userId -> Set of present day numbers
    const userPresentMap = {};
    monthAttendance.forEach(r => {
      const uid = r.userId?.toString();
      if (!uid || !r.date) return;
      const dayStr = r.date.split('-')[2];
      const day = parseInt(dayStr, 10);
      if (!userPresentMap[uid]) userPresentMap[uid] = new Set();
      if (!isNaN(day)) userPresentMap[uid].add(day);
    });

    // 4. Build user records list
    const formatUser = (u, type, defaultRole) => {
      const uid = u._id.toString();
      const presentDaysSet = userPresentMap[uid] || new Set();
      const daysPresent = presentDaysSet.size;
      const daysAbsent = Math.max(0, workingDays - daysPresent);
      const attendancePercent = workingDays > 0 ? Math.round((daysPresent / workingDays) * 100) : 0;

      const daysBar = [];
      for (let d = 1; d <= totalDaysInMonth; d++) {
        if (presentDaysSet.has(d)) {
          daysBar.push({ day: d, status: 'present' });
        } else if (d <= workingDays) {
          daysBar.push({ day: d, status: 'absent' });
        } else {
          daysBar.push({ day: d, status: 'future' });
        }
      }

      const userName = u.newJoinerName || u.name || 'Unknown';
      const userEmail = u.email || u.newJoinerEmailId || '';
      const phone = u.newJoinerPhone || u.phone || '';
      const position = u.position || defaultRole;
      const reportingManager = u.reportingManager || '';

      return {
        _id: u._id,
        userId: u._id,
        userName,
        userEmail,
        phone,
        userType: type,
        position,
        reportingManager,
        daysPresent,
        daysAbsent,
        attendancePercent,
        daysBar
      };
    };

    const empRecords = allEmployees.map(e => formatUser(e, 'employee', 'FSE'));
    const tlRecords  = allTLs.map(t => formatUser(t, 'teamlead', 'Team Lead'));
    const mgrRecords = allManagers.map(m => formatUser(m, 'manager', 'Manager'));

    const allRecords = [...empRecords, ...tlRecords, ...mgrRecords]
      .sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));

    // 5. Calculate summary statistics
    const totalPeople = allRecords.length;
    const fullAttendance = allRecords.filter(r => r.daysPresent >= workingDays && workingDays > 0).length;
    const neverPresent = allRecords.filter(r => r.daysPresent === 0).length;
    const totalPresentSum = allRecords.reduce((sum, r) => sum + r.daysPresent, 0);
    const avgPresentDays = totalPeople > 0 ? Math.round((totalPresentSum / totalPeople) * 10) / 10 : 0;

    res.json({
      month: monthNum,
      year: yearNum,
      workingDays,
      totalDaysInMonth,
      totalPeople,
      fullAttendance,
      neverPresent,
      avgPresentDays,
      records: allRecords
    });

  } catch (error) {
    console.error('Error fetching monthly attendance:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/attendance/my-attendance - Get employee's own attendance
router.get('/my-attendance', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const filter = { userId: req.user.id };
    if (startDate && endDate) {
      filter.date = { $gte: startDate, $lte: endDate };
    }
    
    const attendance = await Attendance.find(filter).sort({ date: -1 });
    
    res.json(attendance);
    
  } catch (error) {
    console.error('Error fetching my attendance:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/attendance/today - Get today's attendance status
router.get('/today', verifyToken, async (req, res) => {
  try {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const today = istTime.toISOString().split('T')[0];
    
    const attendance = await Attendance.findOne({
      userId: req.user.id,
      date: today
    });
    
    res.json({
      hasAttendance: !!attendance,
      attendance: attendance || null
    });
    
  } catch (error) {
    console.error('Error fetching today attendance:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
