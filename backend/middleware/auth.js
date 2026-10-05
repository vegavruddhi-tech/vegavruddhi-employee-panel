// File: vegavruddhi-employee-panel/backend/middleware/auth.js

const jwt = require('jsonwebtoken');
const { isTokenBlacklisted } = require('../utils/tokenBlacklist');

function getAllowedAdmins() {
  const envAdmins = `${process.env.ADMIN_EMAILS || ''},${process.env.ADMIN_EMAIL || ''}`;
  return envAdmins
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

async function verifyToken(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : (authHeader?.includes(' ') ? authHeader.split(' ')[1] : authHeader);
  
  if (!token) {
    return res.status(401).json({ message: 'Authentication required: No token provided' });
  }

  try {
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      return res.status(401).json({ message: 'Session has been invalidated. Please log in again.' });
    }

    req.user = jwt.verify(token, process.env.JWT_SECRET);
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

async function verifyAdmin(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : (authHeader?.includes(' ') ? authHeader.split(' ')[1] : authHeader);

  if (!token) {
    return res.status(401).json({ message: 'Admin authentication required: No token provided' });
  }

  try {
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      return res.status(401).json({ message: 'Admin session has been invalidated. Please log in again.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Explicitly reject impersonated sessions from performing admin actions
    if (decoded.impersonating === true || decoded.adminImpersonating === true) {
      return res.status(403).json({ message: 'Access denied: Administrative actions are disabled during impersonated sessions' });
    }

    const allowedAdmins = getAllowedAdmins();
    const isExplicitAdmin = decoded.isAdmin === true || decoded.role === 'admin';
    const isEmailAdmin = decoded.email && allowedAdmins.includes(decoded.email.toLowerCase());

    if (!isExplicitAdmin && !isEmailAdmin) {
      return res.status(403).json({ message: 'Access denied: Admin privileges required' });
    }

    req.user = decoded;
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired admin token' });
  }
}

module.exports = {
  verifyToken,
  verifyAdmin,
  getAllowedAdmins
};
