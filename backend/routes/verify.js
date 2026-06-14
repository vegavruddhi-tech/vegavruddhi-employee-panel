const express          = require('express');
const jwt              = require('jsonwebtoken');
const crypto           = require('crypto');
const VerificationRule = require('../models/VerificationRule');
const PointsConfiguration = require('../models/PointsConfiguration');
const { verifyMerchant, crossCheckPhone } = require('../utils/verifyMerchant');
const { getRedisClient } = require('../utils/redisClient');

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

  // ---------- HELPER FUNCTIONS ----------
  /**
   * Normalize product name for consistent cache keys
   */
  function normalizeProduct(product) {
    if (!product || product === 'undefined' || product === 'null') return '';
    let val = String(product).toLowerCase().trim();
    if (val === 'msme') val = 'tide msme';
    return val;
  }

  /**
   * Get product field from form using consistent priority order
   * This ensures pre-computation and bulk-admin use the SAME product value
   */
  function getProductField(form) {
    // Priority order: try each field until we find a non-empty value
    const product = form.formFillingFor || 
                    form.tideProduct || 
                    form.brand || 
                    (Array.isArray(form.attemptedProducts) && form.attemptedProducts.length > 0 ? form.attemptedProducts[0] : '') ||
                    '';
    
    return normalizeProduct(product);
  }

  /**
   * Calculate hash of form data for change detection
   */
  function calculateFormHash(form) {
    const data = `${form.customerNumber}|${form.formFillingFor || ''}|${form.customerName || ''}|${form.createdAt}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  
function getFallbackPointsMap() {
  return { 'tide': 2, 'tide msme': 0.3, 'msme': 0.3, 'tide insurance': 1, 'tide credit card': 1, 'tide bt': 1 };
}

function calculateRecordPointsSync(form, monthLabel, pointsMap) {
  let formMonth = monthLabel || form._month || form.month;
  const fallbackProductName = (form.formFillingFor || form.tideProduct || form.brand || '').toLowerCase().trim();
  const fallbackMap = getFallbackPointsMap();

  if (formMonth) {
    const parts = formMonth.split(' ');
    if (parts.length >= 1) {
      const m = parts[0];
      const y = parts.length > 1 ? parseInt(parts[1]) : new Date().getFullYear();
      const mIdx = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(m);
      if ((y === 2026 && mIdx <= 4) || y < 2026 || !pointsMap) {
        return fallbackMap[fallbackProductName] || 0;
      }
    }
  }

  if (!pointsMap) return fallbackMap[fallbackProductName] || 0;


  for (const [configProductName, config] of Object.entries(pointsMap)) {
    const productField = config.fieldMapping?.productField || 'formFillingFor';
    const actualProductName = String(form[productField] || form.tideProduct || form.brand || '').toLowerCase().trim();

    if (actualProductName === configProductName) {
      if (config.type === 'simple') return config.points || 0;
      if (config.type === 'mapped') {
        const mappedColumn = config.fieldMapping?.mappedColumn;
        if (!mappedColumn) return 0;
        const actualValue = String(form[mappedColumn] || '').toLowerCase().trim();
        const mapping = config.valueMapping?.find(m => String(m.value).toLowerCase().trim() === actualValue);
        if (mapping) return mapping.points;
        return 0;
      }
      if (config.type === 'complex') {
        // ... (not modified for brevity, just copying)
        const planField = config.fieldMapping?.planField || 'planName';
        const actualPlanName = String(form[planField] || '').toLowerCase().trim();
        if (!actualPlanName || !config.plans[actualPlanName]) continue;
        const plan = config.plans[actualPlanName];
        const tierField = config.fieldMapping?.tierField || 'tierName';
        const priceField = config.fieldMapping?.priceField || 'price';
        const actualTierName = String(form[tierField] || form.variant || '').toLowerCase().trim();
        const actualPrice = parseFloat(form[priceField] || form.amount || 0);
        if (actualTierName && plan[actualTierName]) return plan[actualTierName].points;
        if (actualPrice > 0) {
          let closestTier = null; let minDiff = Infinity;
          Object.values(plan).forEach(tier => {
            if (tier.price) { const diff = Math.abs(tier.price - actualPrice); if (diff < minDiff) { minDiff = diff; closestTier = tier; } }
          });
          if (closestTier) return closestTier.points;
        }
        return 0;
      }
    }
  }
  return fallbackMap[fallbackProductName] || 0;
}

async function attachPoints(result) {
  try {
    const allConfigs = await PointsConfiguration.find().lean();
    const pointsMap = {};
    allConfigs.forEach(config => {
      const productKey = config.productName.toLowerCase();
      const configData = { type: config.productType, fieldMapping: config.fieldMapping || {} };
      if (config.productType === 'simple') configData.points = config.simplePoints;
      else if (config.productType === 'complex') {
        configData.plans = {};
        (config.plans || []).forEach(plan => {
          const planKey = plan.planName.toLowerCase();
          configData.plans[planKey] = {};
          (plan.tiers || []).forEach(t => configData.plans[planKey][t.name.toLowerCase()] = { points: t.points, price: t.price });
        });
      }
      else if (config.productType === 'mapped') configData.valueMapping = config.valueMapping || [];
      pointsMap[productKey] = configData;
    });

    Object.keys(result).forEach(key => {
      if (result[key] && result[key].status === 'Fully Verified') {
        const productParts = key.split('__');
        const product = productParts.length > 1 ? productParts[1] : key;
        const mockForm = {
          ...(result[key].record || {}),
          formFillingFor: product,
          _month: result[key].monthLabel || ''
        };
        result[key].points = calculateRecordPointsSync(mockForm, result[key].monthLabel, pointsMap);
      } else if (result[key]) {
        result[key].points = 0;
      }
    });
  } catch(err) {
    console.error("Error attaching points:", err);
  }
  return result;
}

// ---------- DEBUG ENDPOINTS ----------
  /**
   * GET /api/verify/debug-cache/:phone
   * Debug endpoint to check what's in cache for a phone number
   */
  router.get('/debug-cache/:phone', async (req, res) => {
    try {
      const { phone } = req.params;
      const redis = getRedisClient();
      
      if (!redis) {
        return res.status(503).json({ error: 'Redis not available' });
      }
      
      // Search for all keys with this phone
      const pattern = `verification:${phone}*`;
      const keys = await redis.keys(pattern);
      
      const results = {};
      for (const key of keys) {
        const value = await redis.get(key);
        results[key] = value ? JSON.parse(value) : null;
      }
      
      res.json({
        phone,
        pattern,
        keysFound: keys.length,
        keys,
        data: results
      });
    } catch (err) {
      console.error('Debug cache error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/verify/debug-products
   * Debug endpoint to see all unique products in forms
   */
  router.get('/debug-products', async (req, res) => {
    try {
      await connectDB();
      const FormResponse = require('../models/FormResponse');
      
      const forms = await FormResponse.find({}).lean();
      
      const productCounts = {};
      forms.forEach(form => {
        const product = getProductField(form);
        // Normalize product name: trim whitespace and convert to lowercase for grouping
        const normalizedProduct = product.trim().toLowerCase();
        if (!productCounts[normalizedProduct]) {
          productCounts[normalizedProduct] = 0;
        }
        productCounts[normalizedProduct]++;
      });
      
      // Sort by count and capitalize product names for display
      const sorted = Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([product, count]) => ({ 
          product: product.charAt(0).toUpperCase() + product.slice(1), // Capitalize first letter
          count 
        }));
      
      res.json({
        totalForms: forms.length,
        uniqueProducts: sorted.length,
        products: sorted
      });
    } catch (err) {
      console.error('Debug products error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ---------- PRE-COMPUTATION ENDPOINT ----------
  /**
   * POST /api/verify/precompute-all
   * Pre-computes verification for all forms (called by sync script)
   * Uses smart incremental caching to only verify new/changed forms
   * Query param: ?force=true to force full refresh (ignore last sync time)
   */
  router.post('/precompute-all', async (req, res) => {
    try {
      const startTime = Date.now();
      
      // Check if force refresh is requested
      const forceRefresh = req.query.force === 'true';
      if (forceRefresh) {
      }
      
      // Wait for MongoDB connection
      const mongooseConn = await connectDB();
      if (!mongooseConn) {
        return res.status(503).json({ error: 'Database connection unavailable' });
      }

      await connectionManager.ensureInitialized();
      const db = connectionManager.getConnection();
      
      const redis = getRedisClient();
      if (!redis) {
        return res.status(503).json({ error: 'Redis not available' });
      }

      // Get last sync time (ignore if force refresh)
      const lastSyncTime = forceRefresh ? null : await redis.get('last_sync_time');

      // Get all forms from FSE, TL, and Manager collections
      const FormResponse = require('../models/FormResponse');
      const TLFormResponse = require('../models/TLFormResponse');
      const ManagerForm = require('../models/ManagerForm');
      
      let fseForms, tlForms, managerForms;
      
      if (lastSyncTime && !forceRefresh) {
        // Incremental: Only get new/updated forms
        const lastSync = new Date(lastSyncTime);
        const query = {
          $or: [
            { createdAt: { $gt: lastSync } },
            { updatedAt: { $gt: lastSync } }
          ]
        };
        
        [fseForms, tlForms, managerForms] = await Promise.all([
          FormResponse.find(query).lean(),
          TLFormResponse.find(query).lean(),
          ManagerForm.find(query).lean()
        ]);
        
      } else {
        // First time OR force refresh: Get all forms
        [fseForms, tlForms, managerForms] = await Promise.all([
          FormResponse.find({}).lean(),
          TLFormResponse.find({}).lean(),
          ManagerForm.find({}).lean()
        ]);
        
      }
      
      // Combine all forms and track which collection each belongs to
      const forms = [...fseForms, ...tlForms, ...managerForms];
      
      // 🔥 NEW: Create a map to track which collection each form belongs to
      const formCollectionMap = new Map();
      fseForms.forEach(f => formCollectionMap.set(f._id.toString(), 'FSE'));
      tlForms.forEach(f => formCollectionMap.set(f._id.toString(), 'TL'));
      managerForms.forEach(f => formCollectionMap.set(f._id.toString(), 'MANAGER'));

      if (forms.length === 0) {
        await redis.set('last_sync_time', new Date().toISOString());
        return res.json({ 
          success: true, 
          total: 0, 
          cached: 0, 
          skipped: 0,
          message: 'No forms to verify' 
        });
      }

      // Fetch verification rules once
      const allRules = await VerificationRule.find().lean();

      let processed = 0;
      let cached = 0;
      let skipped = 0;
      let redisSaved = 0; // Track successful Redis saves

      // Process forms in batches
      const batchSize = 200;
      for (let i = 0; i < forms.length; i += batchSize) {
        const batch = forms.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (form) => {
          try {
            const phone = form.customerNumber;
            // ✅ USE CONSISTENT PRODUCT EXTRACTION
            const product = getProductField(form);
            const month = form.createdAt 
              ? new Date(form.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' })
              : '';
            const cacheKey = `verification:${phone}:${product}`;
            const monthCacheKey = `verification:${phone}:${product}:${month}`;
            
            // Calculate current form hash
            const currentHash = calculateFormHash(form);
            
            // Check if already cached (only if NOT force refresh)
            if (!forceRefresh) {
              const cachedData = await redis.get(cacheKey);
              
              if (cachedData) {
                const parsed = JSON.parse(cachedData);
                if (parsed.hash === currentHash) {
                  // ✅ Copy to the month-specific cache key if missing
                  try {
                    await redis.setex(monthCacheKey, 86400, cachedData);
                  } catch (e) {
                    console.warn(`Failed to copy cached data to month key: ${e.message}`);
                  }
                  // Data unchanged, skip verification
                  skipped++;
                  processed++;
                  return;
                }
              }
            }
            
            // New or changed form - run verification
            // ✅ SMART VERIFICATION: Try with calculated month first
            let result = await verifyMerchant(
              db, 
              phone, 
              form.customerName || '', 
              VerificationRule, 
              product, 
              month, 
              allRules
            );

            // ✅ If not found with specific month, try ALL months (handles backdated forms)
            if (result.status === 'Not Found' && month) {
              result = await verifyMerchant(
                db, 
                phone, 
                form.customerName || '', 
                VerificationRule, 
                product, 
                '',  // Empty month = search all months
                allRules
              );
            }

            // ✅ ATTACH POINTS BEFORE STRIPPING RECORD
            result.monthLabel = month; // Attach month so dynamic config logic knows it's June
            const attachKey = `${phone}__${product}`;
            const tempResultObj = { [attachKey]: result };
            const attachedObj = await attachPoints(tempResultObj);
            const finalResult = attachedObj[attachKey];

            // ✅ STRIP RAW RECORD TO PREVENT PAYLOAD/DB BLOAT
            const lightweightResult = { ...finalResult };
            delete lightweightResult.record;

            // ✅ SAVE VERIFICATION RESULTS TO REDIS
            const cacheValue = {
              ...lightweightResult,
              hash: currentHash,
              lastVerified: new Date().toISOString(),
              phoneMatch: result.status !== 'Not Found' ? true : false,
              matched: result.status !== 'Not Found' ? true : false
            };
            
            // Save to Redis with 24-hour TTL
            try {
              await redis.setex(cacheKey, 86400, JSON.stringify(cacheValue));
              await redis.setex(monthCacheKey, 86400, JSON.stringify(cacheValue));
              redisSaved += 2; // Track successful save
              
              // Only count as "cached" if verification succeeded
              if (result.status !== 'Not Found') {
                cached++;
              }
            } catch (redisErr) {
              console.error(`❌ Redis save error for ${phone}:`, redisErr.message);
              // Continue processing even if Redis fails
            }
            
            // 🔥 NEW: ALSO UPDATE MONGODB FORM DOCUMENT
            // This ensures the form document itself has the latest verification status
            try {
              const updateData = {
                verificationStatus: lightweightResult.status,
                verificationChecks: lightweightResult,
                verificationUpdatedAt: new Date()
              };
              
              // Determine which collection this form belongs to using the map
              const formIdStr = form._id.toString();
              const collectionType = formCollectionMap.get(formIdStr);
              
              if (collectionType === 'FSE') {
                await FormResponse.updateOne({ _id: form._id }, { $set: updateData });
              } else if (collectionType === 'TL') {
                await TLFormResponse.updateOne({ _id: form._id }, { $set: updateData });
              } else if (collectionType === 'MANAGER') {
                await ManagerForm.updateOne({ _id: form._id }, { $set: updateData });
              }
            } catch (mongoErr) {
              console.error(`❌ MongoDB update error for ${phone}:`, mongoErr.message);
              // Continue processing even if MongoDB update fails
            }
            
          } catch (err) {
            console.error(`❌ Error verifying ${form.customerNumber}:`, err.message);
          }
          
          processed++;
        }));

        // Log progress
        const progress = Math.min(i + batchSize, forms.length);
      }

      // Update last sync time
      await redis.set('last_sync_time', new Date().toISOString());

      // ✅ UPDATE TIMESTAMP TO TRIGGER FRONTEND CACHE REFRESH
      // This ensures all users get fresh data after pre-compute
      const timestamp = Date.now();
      await redis.set('verification_rules_updated_at', timestamp.toString());

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      res.json({ 
        success: true, 
        total: forms.length, 
        cached,
        skipped,
        redisSaved,
        notFound: forms.length - cached - skipped,
        elapsed: `${elapsed}s`,
        message: 'Verification pre-computed successfully' 
      });

    } catch (err) {
      console.error('❌ Pre-computation error:', err);
      res.status(500).json({ error: err.message });
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
      
      
      const finalResult = await attachPoints(result);
      Object.keys(finalResult).forEach(k => {
      });
      res.json(finalResult);


    } catch (err) {
      console.error('Bulk error:', err);
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------- BULK CACHED (REDIS CACHED VERSION FOR EMPLOYEES) ----------
  router.get('/bulk-cached', verifyToken, async (req, res) => {
    try {
      const phones   = (req.query.phones   || '').split(',').map(p => p.trim()).filter(Boolean);
      const names    = (req.query.names    || '').split(',').map(n => n.trim());
      const products = (req.query.products || '').split(',').map(p => normalizeProduct(p));
      const months   = (req.query.months   || '').split(',').map(m => decodeURIComponent(m.trim()));

      if (!phones.length) return res.json({});

      const redis = getRedisClient();
      const result = {};
      let cacheHits = 0;
      let cacheMisses = 0;

      // Build all cache keys
      const cacheKeys = phones.map((phone, i) => {
        const product = products[i] || '';
        return `verification:${phone}:${product}:${months[i] || ''}`;
      });

      // Get ALL cached values in ONE Redis call
      let cachedValues = [];
      if (redis) {
        try {
          cachedValues = await redis.mget(...cacheKeys);
        } catch (err) {
          console.error('Redis MGET error:', err.message);
          cachedValues = new Array(cacheKeys.length).fill(null);
        }
      } else {
        cachedValues = new Array(cacheKeys.length).fill(null);
      }

      // Process results: separate cache hits from misses
      const missedIndices = [];
      
      phones.forEach((phone, i) => {
        const name    = names[i]    || '';
        const product = products[i] || '';
        const month   = months[i]   || '';
        const key = product ? `${phone}__${product}` : phone;
        const cached = cachedValues[i];

        if (cached) {
          try {
            const cachedData = JSON.parse(cached);
            
            // ✅ If merchant was found (status is NOT "Not Found"), phone MUST have matched
            const phoneMatch = cachedData.status !== 'Not Found' ? true : (cachedData.phoneMatch || false);
            const inSheet = cachedData.status !== 'Not Found' ? true : (cachedData.matched || false);
            
            result[key] = {
              status:     cachedData.status,
              verified:   cachedData.verified,
              passed:     cachedData.passed,
              total:      cachedData.total,
              checks:     cachedData.checks || [],
              collection: cachedData.collection,
              matchType:  cachedData.matchType,
              phoneMatch: phoneMatch,
              inSheet:    inSheet,
              monthLabel: month,
              record: (typeof cachedData !== 'undefined' ? cachedData.record : (typeof d !== 'undefined' ? d.record : (typeof v !== 'undefined' ? v.record : null)))
            };
            cacheHits++;
          } catch (parseErr) {
            console.error(`Error parsing cached data for ${phone}:`, parseErr.message);
            missedIndices.push(i);
            cacheMisses++;
          }
        } else {
          missedIndices.push(i);
          cacheMisses++;
        }
      });

      // For cache misses, fetch from database
      if (missedIndices.length > 0) {
        const db = req.db;
        const allRules = await VerificationRule.find().lean();

        await Promise.all(missedIndices.map(async (i) => {
          const phone   = phones[i];
          const name    = names[i]    || '';
          const product = products[i] || '';
          const month   = months[i]   || '';
          const key = product ? `${phone}__${product}` : phone;

          try {
            const [v, pc] = await Promise.all([
              verifyMerchant(db, phone, name, VerificationRule, product, month, allRules),
              crossCheckPhone(db, phone, name, VerificationRule, product, month, allRules)
            ]);

            // ✅ If merchant was found (status is NOT "Not Found"), phone MUST have matched
            const phoneMatch = v.status !== 'Not Found' ? true : pc.phoneMatch;
            const inSheet = v.status !== 'Not Found' ? true : pc.matched;

            result[key] = {
              status:     v.status,
              verified:   v.verified,
              passed:     v.passed,
              total:      v.total,
              checks:     v.checks || [],
              collection: v.collection,
              matchType:  v.matchType,
              phoneMatch: phoneMatch,
              inSheet:    inSheet,
              monthLabel: month,
              record: (typeof cachedData !== 'undefined' ? cachedData.record : (typeof d !== 'undefined' ? d.record : (typeof v !== 'undefined' ? v.record : null)))
            };
            
          } catch (err) {
            console.error(`Error verifying ${phone}:`, err.message);
            result[key] = {
              status: 'Error',
              verified: false,
              passed: 0,
              total: 0,
              checks: [],
              error: err.message
            };
          }
        }));
      }

      
      const finalResult = await attachPoints(result);
      Object.keys(finalResult).forEach(k => {
      });
      res.json(finalResult);


    } catch (err) {
      console.error('Bulk-cached error:', err);
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------- BULK CACHED POST (avoids URL length limit) ----------
  router.post('/bulk-cached', verifyToken, async (req, res) => {
    try {
      const { phones: phonesArr, names: namesArr, products: productsArr, months: monthsArr } = req.body;
      const phones   = (Array.isArray(phonesArr) ? phonesArr : (phonesArr || '').split(',')).map(p => String(p).trim()).filter(Boolean);
      const names    = (Array.isArray(namesArr) ? namesArr : (namesArr || '').split(',')).map(n => String(n).trim());
      const products = (Array.isArray(productsArr) ? productsArr : (productsArr || '').split(',')).map(p => normalizeProduct(p));
      const months   = (Array.isArray(monthsArr) ? monthsArr : (monthsArr || '').split(',')).map(m => String(m).trim());

      if (!phones.length) return res.json({});

      const redis = getRedisClient();
      const result = {};
      const cacheKeys = phones.map((phone, i) => `verification:${phone}:${products[i] || ''}`);

      let cachedValues = [];
      if (redis) {
        try { cachedValues = await redis.mget(...cacheKeys); }
        catch { cachedValues = new Array(cacheKeys.length).fill(null); }
      } else { cachedValues = new Array(cacheKeys.length).fill(null); }

      const missedIndices = [];
      phones.forEach((phone, i) => {
        const product = products[i] || '';
        const month = months[i] || '';
        const key = product ? `${phone}__${product}` : phone;
        const cached = cachedValues[i];
        if (cached) {
          try {
            const d = JSON.parse(cached);
            result[key] = { status: d.status, verified: d.verified, passed: d.passed, total: d.total, checks: d.checks || [], collection: d.collection, matchType: d.matchType, phoneMatch: d.status !== 'Not Found' ? true : (d.phoneMatch || false), inSheet: d.status !== 'Not Found' ? true : (d.matched || false), monthLabel: month, record: (typeof cachedData !== 'undefined' ? cachedData.record : (typeof d !== 'undefined' ? d.record : (typeof v !== 'undefined' ? v.record : null))) };
          } catch { missedIndices.push(i); }
        } else { missedIndices.push(i); }
      });

      if (missedIndices.length > 0) {
        const db = req.db;
        const allRules = await VerificationRule.find().lean();
        await Promise.all(missedIndices.map(async (i) => {
          const phone = phones[i], name = names[i] || '', product = products[i] || '', month = months[i] || '';
          const key = product ? `${phone}__${product}` : phone;
          try {
            const [v, pc] = await Promise.all([
              verifyMerchant(db, phone, name, VerificationRule, product, month, allRules),
              crossCheckPhone(db, phone, name, VerificationRule, product, month, allRules)
            ]);
            result[key] = { status: v.status, verified: v.verified, passed: v.passed, total: v.total, checks: v.checks || [], collection: v.collection, matchType: v.matchType, phoneMatch: v.status !== 'Not Found' ? true : pc.phoneMatch, inSheet: v.status !== 'Not Found' ? true : pc.matched, monthLabel: month, record: (typeof cachedData !== 'undefined' ? cachedData.record : (typeof d !== 'undefined' ? d.record : (typeof v !== 'undefined' ? v.record : null))) };
          } catch (err) { result[key] = { status: 'Error', verified: false, passed: 0, total: 0, checks: [], error: err.message }; }
        }));
      }
      
      const finalResult = await attachPoints(result);
      Object.keys(finalResult).forEach(k => {
      });
      res.json(finalResult);

    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ---------- BULK ADMIN (REDIS CACHED VERSION WITH MGET OPTIMIZATION) ----------
  router.get('/bulk-admin', async (req, res) => {
    
    try {
      // Set no-cache headers to ensure fresh data
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');

      const phones   = (req.query.phones   || '').split(',').map(p => p.trim()).filter(Boolean);
      const names    = (req.query.names    || '').split(',').map(n => n.trim());
      // ✅ NORMALIZE: Convert all products to lowercase, trim, handle empty/null/undefined
      const products = (req.query.products || '').split(',').map(p => normalizeProduct(p));
      const months   = (req.query.months   || '').split(',').map(m => decodeURIComponent(m.trim()));

      if (!phones.length) return res.json({});

      const redis = getRedisClient();
      const result = {};
      let cacheHits = 0;
      let cacheMisses = 0;

      // ✅ MGET OPTIMIZATION: Build all cache keys first
      const cacheKeys = phones.map((phone, i) => {
        const product = products[i] || '';
        return `verification:${phone}:${product}:${months[i] || ''}`;
      });

      // ✅ MGET OPTIMIZATION: Get ALL cached values in ONE Redis call (instead of 813 calls)
      let cachedValues = [];
      if (redis) {
        try {
          cachedValues = await redis.mget(...cacheKeys);
        } catch (err) {
          console.error('Redis MGET error:', err.message);
          cachedValues = new Array(cacheKeys.length).fill(null);
        }
      } else {
        cachedValues = new Array(cacheKeys.length).fill(null);
      }

      // ✅ Process results: separate cache hits from misses
      const missedIndices = [];
      
      phones.forEach((phone, i) => {
        const name    = names[i]    || '';
        const product = products[i] || '';
        const month   = months[i]   || '';
        const key = product ? `${phone}__${product}` : phone;
        const monthKey = product ? `${phone}__${product}__${month}` : `${phone}__${month}`;
        const cached = cachedValues[i];

        if (cached) {
          // Cache hit - use cached data
          try {
            const cachedData = JSON.parse(cached);
            
            // ✅ If merchant was found (status is NOT "Not Found"), phone MUST have matched
            const phoneMatch = cachedData.status !== 'Not Found' ? true : (cachedData.phoneMatch || false);
            const inSheet = cachedData.status !== 'Not Found' ? true : (cachedData.matched || false);
            
            const data = {
              status:     cachedData.status,
              verified:   cachedData.verified,
              passed:     cachedData.passed,
              total:      cachedData.total,
              checks:     cachedData.checks || [],
              collection: cachedData.collection,
              matchType:  cachedData.matchType,
              phoneMatch: phoneMatch,
              inSheet:    inSheet,
              monthLabel: month,
              record: cachedData.record
            };
            result[key] = data;
            result[monthKey] = data;
            cacheHits++;
          } catch (parseErr) {
            console.error(`Error parsing cached data for ${phone}:`, parseErr.message);
            missedIndices.push(i);
            cacheMisses++;
          }
        } else {
          // Cache miss - need to verify from database
          missedIndices.push(i);
          cacheMisses++;
        }
      });

      // ✅ For cache misses, fetch from database (only if needed)
      if (missedIndices.length > 0) {
        const db = req.db;
        const allRules = await VerificationRule.find().lean();

        await Promise.all(missedIndices.map(async (i) => {
          const phone   = phones[i];
          const name    = names[i]    || '';
          const product = products[i] || '';
          const month   = months[i]   || '';
          const key = product ? `${phone}__${product}` : phone;
          const monthKey = product ? `${phone}__${product}__${month}` : `${phone}__${month}`;

          try {
            const [v, pc] = await Promise.all([
              verifyMerchant(db, phone, name, VerificationRule, product, month, allRules),
              crossCheckPhone(db, phone, name, VerificationRule, product, month, allRules)
            ]);

            // ✅ If merchant was found (status is NOT "Not Found"), phone MUST have matched
            const phoneMatch = v.status !== 'Not Found' ? true : pc.phoneMatch;
            const inSheet = v.status !== 'Not Found' ? true : pc.matched;

            const data = {
              status:     v.status,
              verified:   v.verified,
              passed:     v.passed,
              total:      v.total,
              checks:     v.checks || [],
              collection: v.collection,
              matchType:  v.matchType,
              phoneMatch: phoneMatch,
              inSheet:    inSheet,
              monthLabel: month,
              record: v.record
            };
            result[key] = data;
            result[monthKey] = data;
            
          } catch (err) {
            console.error(`Error verifying ${phone}:`, err.message);
            const errorData = {
              status: 'Error',
              verified: false,
              passed: 0,
              total: 0,
              checks: [],
              error: err.message
            };
            result[key] = errorData;
            result[monthKey] = errorData;
          }
        }));
      }

      
      const finalResult = await attachPoints(result);
      Object.keys(finalResult).forEach(k => {
      });
      res.json(finalResult);


    } catch (err) {
      console.error('Bulk-admin error:', err);
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------- DETAILS API ----------
  // Used by "View Details" popup to fetch the full raw record
  router.get('/details', async (req, res) => {
    try {
      const { phone, product, name, month } = req.query;
      if (!phone) return res.status(400).json({ error: 'Phone is required' });

      const db = req.db;
      const allRules = await VerificationRule.find().lean();
      
      const v = await verifyMerchant(db, phone, name || '', VerificationRule, product || '', month || '', allRules);
      
      res.json({
        success: true,
        record: v.record || null,
        checks: v.checks || [],
        status: v.status
      });
    } catch (err) {
      console.error('Details fetch error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ---------- BULK ADMIN POST (avoids 431 for large payloads) ----------
  router.post('/bulk-admin', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');

      const { phones: phonesArr, names: namesArr, products: productsArr, months: monthsArr } = req.body;

      const phones   = (Array.isArray(phonesArr)   ? phonesArr   : (phonesArr   || '').split(',')).map(p => String(p).trim()).filter(Boolean);
      const names    = (Array.isArray(namesArr)    ? namesArr    : (namesArr    || '').split(',')).map(n => String(n).trim());
      const products = (Array.isArray(productsArr) ? productsArr : (productsArr || '').split(',')).map(p => normalizeProduct(p));
      const months   = (Array.isArray(monthsArr)   ? monthsArr   : (monthsArr   || '').split(',')).map(m => String(m).trim());

      console.log('📥 INCOMING BULK-ADMIN POST:', { phones, products, months });

      if (!phones.length) return res.json({});

      const redis = getRedisClient();
      const result = {};

      const cacheKeys = phones.map((phone, i) => {
        const product = products[i] || '';
        return `verification:${phone}:${product}:${months[i] || ''}`;
      });

      let cachedValues = [];
      if (redis) {
        try {
          cachedValues = await redis.mget(...cacheKeys);
        } catch (err) {
          cachedValues = new Array(cacheKeys.length).fill(null);
        }
      } else {
        cachedValues = new Array(cacheKeys.length).fill(null);
      }

      const missedIndices = [];

      phones.forEach((phone, i) => {
        const product = products[i] || '';
        const month   = months[i]   || '';
        const key     = product ? `${phone}__${product}` : phone;
        const monthKey = product ? `${phone}__${product}__${month}` : `${phone}__${month}`;
        const cached  = cachedValues[i];

        if (cached) {
          try {
            const cachedData = JSON.parse(cached);
            const phoneMatch = cachedData.status !== 'Not Found' ? true : (cachedData.phoneMatch || false);
            const inSheet    = cachedData.status !== 'Not Found' ? true : (cachedData.matched    || false);
            const data = { status: cachedData.status, verified: cachedData.verified, passed: cachedData.passed, total: cachedData.total, checks: cachedData.checks || [], collection: cachedData.collection, matchType: cachedData.matchType, phoneMatch, inSheet, monthLabel: month, record: cachedData.record };
            result[key] = data;
            result[monthKey] = data;
          } catch {
            missedIndices.push(i);
          }
        } else {
          missedIndices.push(i);
        }
      });

      if (missedIndices.length > 0) {
        const db = req.db;
        const allRules = await VerificationRule.find().lean();

        await Promise.all(missedIndices.map(async (i) => {
          const phone   = phones[i];
          const name    = names[i]    || '';
          const product = products[i] || '';
          const month   = months[i]   || '';
          const key     = product ? `${phone}__${product}` : phone;
          const monthKey = product ? `${phone}__${product}__${month}` : `${phone}__${month}`;

          try {
            const [v, pc] = await Promise.all([
              verifyMerchant(db, phone, name, VerificationRule, product, month, allRules),
              crossCheckPhone(db, phone, name, VerificationRule, product, month, allRules)
            ]);
            const phoneMatch = v.status !== 'Not Found' ? true : pc.phoneMatch;
            const inSheet    = v.status !== 'Not Found' ? true : pc.matched;
            const data = { status: v.status, verified: v.verified, passed: v.passed, total: v.total, checks: v.checks || [], collection: v.collection, matchType: v.matchType, phoneMatch, inSheet, monthLabel: month, record: v.record };
            result[key] = data;
            result[monthKey] = data;
          } catch (err) {
            const errorData = { status: 'Error', verified: false, passed: 0, total: 0, checks: [], error: err.message };
            result[key] = errorData;
            result[monthKey] = errorData;
          }
        }));
      }

      
      const finalResult = await attachPoints(result);
      console.log('📤 OUTGOING BULK-ADMIN RESPONSE:', JSON.stringify(finalResult, null, 2));
      Object.keys(finalResult).forEach(k => {
      });
      res.json(finalResult);

    } catch (err) {
      console.error('Bulk-admin POST error:', err);
      res.status(500).json({ message: err.message });
    }
  });
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

  // GET /api/verify/rules-timestamp - Get last update timestamp for cache invalidation
  router.get('/rules-timestamp', async (req, res) => {
    try {
      const redis = getRedisClient();
      if (!redis) {
        return res.json({ timestamp: Date.now() }); // Fallback to current time
      }
      
      const timestamp = await redis.get('verification_rules_updated_at');
      res.json({ timestamp: timestamp || Date.now() });
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
      
      // Update timestamp in Redis to invalidate frontend cache
      const redis = getRedisClient();
      if (redis) {
        await redis.set('verification_rules_updated_at', Date.now().toString());
        
        // ✅ CLEAR ALL REDIS VERIFICATION CACHES
        const pattern = 'verification:*';
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        
      }
      
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
      
      // Update timestamp in Redis to invalidate frontend cache
      const redis = getRedisClient();
      if (redis) {
        await redis.set('verification_rules_updated_at', Date.now().toString());
        
        // ✅ CLEAR ALL REDIS VERIFICATION CACHES
        const pattern = 'verification:*';
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        
      }
      
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
      
      // Update timestamp in Redis to invalidate frontend cache
      const redis = getRedisClient();
      if (redis) {
        await redis.set('verification_rules_updated_at', Date.now().toString());
        
        // ✅ CLEAR ALL REDIS VERIFICATION CACHES
        const pattern = 'verification:*';
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        
      }
      
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
      
      // Use aggregation to get ALL unique field names across ALL documents
      // This ensures new columns are always visible in the verification rules dropdown
      const result = await db.collection(req.params.name).aggregate([
        { $project: { fields: { $objectToArray: "$$ROOT" } } },
        { $unwind: "$fields" },
        { $group: { _id: null, allFields: { $addToSet: "$fields.k" } } }
      ]).toArray();
      
      const fields = result[0]?.allFields || [];
      
      // Filter out internal fields (starting with _) and sort alphabetically
      const filtered = fields.filter(f => !f.startsWith('_')).sort();
      
      res.json(filtered);
    } catch (err) {
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
};