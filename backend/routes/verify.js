const express          = require('express');
const jwt              = require('jsonwebtoken');
const VerificationRule = require('../models/VerificationRule');
const { verifyMerchant, crossCheckPhone } = require('../utils/verifyMerchant');

/**
 * Verification Routes with Enhanced Connection Management
 * 
 * This module provides verification endpoints using the ConnectionManager
 * for reliable database access with circuit breaker and health monitoring.
 */

module.exports = (connectionManager, connectDB) => {
  const router = express.Router();

  // ---------- AUTH ----------
  function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ message: 'Invalid token' });
    }
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
      console.error('🔴 Database connection error in verify routes:', error.message);
      
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

  // ---------- SINGLE CHECK (ADMIN — no token required) - OPTIMIZED ----------
  router.get('/check-admin', async (req, res) => {
    try {
      const { phone, name, product, month } = req.query;
      if (!phone) return res.status(400).json({ message: 'Phone required' });
      
      // Use connection from middleware
      const db = req.db;
      
      // ✅ OPTIMIZATION: Fetch rules once for admin check
      const allRules = await VerificationRule.find().lean();
      
      const [verification, phoneCheck] = await Promise.all([
        verifyMerchant(db, phone, name || '', VerificationRule, product || '', month || '', allRules),
        crossCheckPhone(db, phone, name || '', VerificationRule, product || '', month || '', allRules)
      ]);
      
      res.json({ verification, phoneCheck });
    } catch (err) {
      console.error('Check-admin error:', err);
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------- SINGLE CHECK - OPTIMIZED ----------
  router.get('/check', verifyToken, async (req, res) => {
    try {
      // Set no-cache headers to ensure fresh data
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
      });

      const { phone, name, product } = req.query;

      if (!phone) return res.status(400).json({ message: 'Phone required' });

      // Use connection from middleware
      const db = req.db;
      
      // ✅ OPTIMIZATION: Fetch rules once for single check
      const allRules = await VerificationRule.find().lean();

      const [verification, phoneCheck] = await Promise.all([
        verifyMerchant(db, phone, name || '', VerificationRule, product || '', '', allRules),
        crossCheckPhone(db, phone, name || '', VerificationRule, product || '', '', allRules)
      ]);

      res.json({ verification, phoneCheck });

    } catch (err) {
      console.error('Check error:', err);
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------- BULK (NORMAL) - OPTIMIZED ----------
  router.get('/bulk', verifyToken, async (req, res) => {
    try {
      const phones   = (req.query.phones   || '').split(',').map(p => p.trim()).filter(Boolean);
      const names    = (req.query.names    || '').split(',').map(n => n.trim());
      const products = (req.query.products || '').split(',').map(p => p.trim());
      const months   = (req.query.months   || '').split(',').map(m => decodeURIComponent(m.trim()));

      if (!phones.length) return res.json({});

      // Use connection from middleware
      const db = req.db;
      
      // ✅ OPTIMIZATION: Fetch all verification rules at once
      const allRules = await VerificationRule.find().lean();
      
      const result = {};

      // STEP 1: Get all collections used in rules
      const collections = [...new Set(allRules.map(r => r.collectionName))];

      // STEP 2: Fetch ALL data in bulk
      const collectionData = await Promise.all(
        collections.map(col =>
          db.collection(col)
            .find({ phone: { $in: phones } })
            .toArray()
        )
      );

      // STEP 3: Build HashMap
      const phoneMap = new Map();

      collectionData.forEach((records, index) => {
        const collectionName = collections[index];

        records.forEach(r => {
          if (!phoneMap.has(r.phone)) {
            phoneMap.set(r.phone, []);
          }
          phoneMap.get(r.phone).push({
            collection: collectionName,
            data: r
          });
        });
      });
      
      res.json(result);

    } catch (err) {
      console.error('Bulk error:', err);
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------- BULK ADMIN (OPTIMIZED WITH BATCH QUERIES) ----------
  router.get('/bulk-admin', async (req, res) => {
    
    try {
      // Set no-cache headers to ensure fresh data
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
      });

      const phones   = (req.query.phones   || '').split(',').map(p => p.trim()).filter(Boolean);
      const names    = (req.query.names    || '').split(',').map(n => n.trim());
      const products = (req.query.products || '').split(',').map(p => p.trim());
      const months   = (req.query.months   || '').split(',').map(m => decodeURIComponent(m.trim()));

      if (!phones.length) return res.json({});

      // Use connection from middleware
      const db = req.db;
      
      // ✅ OPTIMIZATION: Fetch all verification rules at once (as array, not Map)
      const allRules = await VerificationRule.find().lean();

      const result = {};

      // Process each phone (still need individual verification logic)
      await Promise.all(phones.map(async (phone, i) => {
        const name    = names[i]    || '';
        const product = products[i] || '';
        const month   = months[i]   || '';

        // Pass cached rules array instead of fetching each time
        const [v, pc] = await Promise.all([
          verifyMerchant(db, phone, name, VerificationRule, product, month, allRules),
          crossCheckPhone(db, phone, name, VerificationRule, product, month, allRules)
        ]);

        const key = product ? `${phone}__${product}` : phone;

        result[key] = {
          status:     v.status,
          verified:   v.verified,
          passed:     v.passed,
          total:      v.total,
          checks:     v.checks || [],
          collection: v.collection,
          matchType:  v.matchType,
          phoneMatch: pc.phoneMatch,
          inSheet:    pc.matched,
          monthLabel: month
        };
      }));

      res.json(result);

    } catch (err) {
      console.error('Bulk-admin error:', err);
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------- RULES ----------
  router.get('/rules', async (req, res) => {
    try {
      const rules = await VerificationRule.find().sort({ monthLabel: -1 });
      res.json(rules);
    } catch (err) {
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  router.put('/rules/:id', async (req, res) => {
    try {
      const rule = await VerificationRule.findByIdAndUpdate(
        req.params.id,
        { ...req.body, updatedAt: new Date() },
        { new: true }
      );
      res.json(rule);
    } catch (err) {
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/rules/new', async (req, res) => {
    try {
      const rule = await VerificationRule.create({
        ...req.body,
        updatedAt: new Date()
      });
      res.status(201).json(rule);
    } catch (err) {
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // DELETE /api/verify/rules/:id — delete a rule
  router.delete('/rules/:id', async (req, res) => {
    try {
      await VerificationRule.findByIdAndDelete(req.params.id);
      res.json({ 
        message: 'Rule deleted',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------- COLLECTIONS ----------
  router.get('/collections', verifyToken, async (req, res) => {
    try {
      // Use connection from middleware
      const db = req.db;
      const cols = await db.listCollections().toArray();
      res.json(cols.map(c => c.name).sort());
    } catch (err) {
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/collection-columns/:name', async (req, res) => {
    try {
      // Use connection from middleware
      const db = req.db;
      const docs = await db.collection(req.params.name).find({}).limit(10).toArray();

      const fields = new Set();
      docs.forEach(doc =>
        Object.keys(doc).forEach(k => {
          if (!k.startsWith('_')) fields.add(k);
        })
      );

      res.json([...fields].sort());
    } catch (err) {
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
};