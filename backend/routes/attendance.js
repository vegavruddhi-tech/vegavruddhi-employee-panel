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
