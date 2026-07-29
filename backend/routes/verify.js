const express          = require('express');
const jwt              = require('jsonwebtoken');
const crypto           = require('crypto');
const VerificationRule = require('../models/VerificationRule');
const PointsConfiguration = require('../models/PointsConfiguration');
const { verifyMerchant, crossCheckPhone } = require('../utils/verifyMerchant');
const { checkIfAlreadyVerified } = require('../utils/dedupVerification');
const { getRedisClient } = require('../utils/redisClient');
const { sendManagerDailyReport } = require('../utils/managerReportService');

/**
 * Verification Routes with Enhanced Connection Management
 * 
 * This module provides verification endpoints using the ConnectionManager
 * for reliable database access with circuit breaker and health monitoring.
 */

// Helper to get all keys using SCAN to avoid Upstash "too many keys" error
async function getKeysByPattern(redis, pattern) {
  return new Promise((resolve, reject) => {
    const keys = [];
    const stream = redis.scanStream({ match: pattern, count: 1000 });
    stream.on('data', (resultKeys) => {
      for (let i = 0; i < resultKeys.length; i++) {
        keys.push(resultKeys[i]);
      }
    });
    stream.on('end', () => resolve(keys));
    stream.on('error', (err) => reject(err));
  });
}

module.exports = (connectionManager, connectDB) => {
  const router = express.Router();

  // ---------- AUTH ----------
  function verifyToken(req, res, next) {
    if (req.method === 'OPTIONS') return next();
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
  const fallbackProductNameRaw = (form.formFillingFor || form.tideProduct || form.brand || '').toLowerCase().trim();
  let fallbackProductName = fallbackProductNameRaw;
  if (fallbackProductNameRaw.includes('tide insurance')) {
    fallbackProductName = 'tide insurance';
  } else if (fallbackProductNameRaw.includes('tide msme')) {
    fallbackProductName = 'tide msme';
  } else if (fallbackProductNameRaw.includes('tide credit card')) {
    fallbackProductName = 'tide credit card';
  } else if (fallbackProductNameRaw.includes('tide bt')) {
    fallbackProductName = 'tide bt';
  } else if (fallbackProductNameRaw.includes('tide')) {
    fallbackProductName = 'tide';
  }
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
    const actualProductNameRaw = String(form[productField] || form.tideProduct || form.brand || '').toLowerCase().trim();
    
    // 🔥 FIX: Strip sub-product suffixes to match base products in points config
    let actualProductName = actualProductNameRaw;
    if (actualProductNameRaw.includes('tide insurance')) {
      actualProductName = 'tide insurance';
    } else if (actualProductNameRaw.includes('tide msme')) {
      actualProductName = 'tide msme';
    } else if (actualProductNameRaw.includes('tide credit card')) {
      actualProductName = 'tide credit card';
    } else if (actualProductNameRaw.includes('tide bt')) {
      actualProductName = 'tide bt';
    } else if (actualProductNameRaw.includes('tide')) {
      actualProductName = 'tide';
    }

    const cleanConfigName = String(configProductName).toLowerCase().trim();

    if (actualProductName === cleanConfigName) {
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

async function attachPoints(result, cachedPointsMap = null) {
  try {
    let pointsMap = cachedPointsMap;
    if (!pointsMap) {
      const allConfigs = await PointsConfiguration.find().lean();
      pointsMap = {};
      allConfigs.forEach(config => {
        const productKey = String(config.productName).toLowerCase().trim();
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
    }

    Object.keys(result).forEach(key => {
      if (result[key] && (result[key].status === 'Fully Verified' || result[key].status === 'Approved' || result[key].verified === true)) {
        const productParts = key.split('__');
        const product = productParts.length > 1 ? productParts[1] : key;
        const mockForm = {
          ...(result[key].record || {}),
          formFillingFor: product,
          tideProduct: product,
          brand: product,
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
      const keys = await getKeysByPattern(redis, pattern);
      
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
      
      const forms = await FormResponse.find({}).select('formFillingFor tideProduct brand').lean();
      
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

  // ---------- BACKGROUND PRECOMPUTATION STATUS ENDPOINT ----------
  /**
   * GET /api/verify/status
   * Returns current background pre-computation status (for frontend toaster)
   */
  router.get('/status', async (req, res) => {
    try {
      const redis = getRedisClient();
      if (!redis) {
        return res.json({ isCalculating: false, message: 'Redis unavailable' });
      }
      const statusStr = await redis.get('precompute_status');
      if (!statusStr) {
        return res.json({ isCalculating: false, message: 'Idle' });
      }
      return res.json(JSON.parse(statusStr));
    } catch (err) {
      return res.json({ isCalculating: false, error: err.message });
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

      // 🔥 OPTION 1 QUICK FIX: Send response immediately so Python/cron script never times out!
      res.status(200).json({ 
        success: true, 
        message: 'Pre-computation started in background...',
        total: 'Calculating in background...',
        cached: 'Calculating...',
        skipped: 0
      });
      console.log('🚀 Pre-computation started in background (response sent immediately to avoid timeout)...');

      // ✅ Store calculating status in Redis for frontend toaster
      try {
        await redis.setex('precompute_status', 3600, JSON.stringify({ 
          isCalculating: true, 
          startedAt: new Date().toISOString(), 
          message: 'Re-calculating all employee verifications...' 
        }));
      } catch (e) {
        console.warn('Could not set precompute_status:', e.message);
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
          FormResponse.find(query).select('-verificationChecks.record').lean(),
          TLFormResponse.find(query).select('-verificationChecks.record').lean(),
          ManagerForm.find(query).select('-verificationChecks.record').lean()
        ]);
        
      } else {
        // First time OR force refresh: Get all forms
        [fseForms, tlForms, managerForms] = await Promise.all([
          FormResponse.find({}).select('-verificationChecks.record').lean(),
          TLFormResponse.find({}).select('-verificationChecks.record').lean(),
          ManagerForm.find({}).select('-verificationChecks.record').lean()
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
        console.log('✅ Pre-computation complete: No forms to verify');
        if (!res.headersSent) {
          return res.json({ 
            success: true, 
            total: 0, 
            cached: 0, 
            skipped: 0,
            message: 'No forms to verify' 
          });
        }
        return;
      }

      // Fetch verification rules once
      const allRules = await VerificationRule.find().lean();

      // 🔥 SOLUTION 3 PART 2: TRUE IN-MEMORY MATCHING (Pre-fetch all merchants & configs in 1 query!)
      console.log('⚡ Pre-loading merchant records and points configurations into RAM for True In-Memory Matching...');
      const merchantMap = new Map();
      for (const rule of allRules) {
        try {
          const col = db.collection(rule.collectionName);
          const records = await col.find({}).toArray();
          for (const rec of records) {
            // Check all phone columns
            for (const colName of ['Mobile_No_', 'Mobile_Number', 'Phone_Number', 'Number', 'phone', 'Phone', 'Mobile', 'mobile', 'Contact', 'Customer_Number', 'Merchant_Number', 'Mobile_No', 'mobile_no_', 'mobile_number', 'phone_number', 'number', 'contact', 'customer_number', 'merchant_number', 'mobile_no']) {
              if (rec[colName] !== undefined && rec[colName] !== null && rec[colName] !== '') {
                const raw = String(rec[colName]).trim();
                merchantMap.set(`${rule.collectionName}__${raw}`, rec);
                const digits = raw.replace(/\D/g, '');
                if (digits) merchantMap.set(`${rule.collectionName}__${digits}`, rec);
                if (digits.startsWith('91') && digits.length === 12) {
                  merchantMap.set(`${rule.collectionName}__${digits.slice(2)}`, rec);
                }
              }
            }
          }
        } catch (colErr) {
          console.warn(`Could not preload collection ${rule.collectionName}:`, colErr.message);
        }
      }
      console.log(`📦 Preloaded ${merchantMap.size} merchant phone entries into RAM!`);

      // 🔥 PRE-LOAD MANUAL VERIFICATIONS ONCE INTO RAM TO PREVENT MONGODB CONNECTION DROPS!
      const ManualVerification = require('../models/ManualVerification');
      const allManuals = await ManualVerification.find().lean();
      const manualVerificationsMap = new Map();
      allManuals.forEach(mv => {
        const p = String(mv.phone || '').replace(/\D/g, '');
        const pr = normalizeProduct(mv.product || '');
        if (p) {
          const keyAny = `${p}__${pr}`;
          manualVerificationsMap.set(keyAny, mv);
          if (mv.month) {
            const m = normalize(mv.month);
            manualVerificationsMap.set(`${p}__${pr}__${m}`, mv);
          }
        }
      });
      console.log(`📦 Preloaded ${manualVerificationsMap.size} manual verification overrides into RAM!`);

      // Pre-load PointsConfiguration once!
      const allPointsConfigs = await PointsConfiguration.find().lean();
      const cachedPointsMap = {};
      allPointsConfigs.forEach(config => {
        const productKey = String(config.productName).toLowerCase().trim();
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
        cachedPointsMap[productKey] = configData;
      });

      // Sort forms by createdAt ascending so the oldest gets 'Fully Verified' first
      forms.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

      let processed = 0;
      let cached = 0;
      let skipped = 0;
      let redisSaved = 0; // Track successful Redis saves
      
      // In-memory set to track newly verified forms in this batch run
      const newlyVerified = new Set();

      // Process forms in safe batches with Bulk Writes and Redis Pipeline (Solution 3)
      const batchSize = 100; // Increased to 100 since we eliminated sequential network calls!
      for (let i = 0; i < forms.length; i += batchSize) {
        const batch = forms.slice(i, i + batchSize);
        
        // Prepare bulk update arrays and Redis pipeline for this batch
        const fseBulkOps = [];
        const tlBulkOps = [];
        const managerBulkOps = [];
        const redisPipeline = redis.pipeline();
        let commandsInPipeline = 0;

        // 🔥 REDIS MGET OPTIMIZATION: Fetch all cache keys for this batch in 1 single network call!
        const batchCacheMap = new Map();
        if (!forceRefresh) {
          try {
            const cacheKeys = batch.map(f => `verification:${f.customerNumber}:${getProductField(f)}`);
            const cachedValues = await redis.mget(...cacheKeys);
            cacheKeys.forEach((key, idx) => {
              if (cachedValues[idx]) batchCacheMap.set(key, cachedValues[idx]);
            });
          } catch (mgetErr) {
            console.warn(`Redis mget failed, falling back: ${mgetErr.message}`);
          }
        }

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
              const cachedData = batchCacheMap.get(cacheKey);
              
              if (cachedData) {
                const parsed = JSON.parse(cachedData);
                if (parsed.hash === currentHash) {
                  // ✅ Copy to the month-specific cache key via pipeline
                  try {
                    redisPipeline.setex(monthCacheKey, 86400, cachedData);
                    commandsInPipeline++;
                  } catch (e) {}
                  // Data unchanged, skip verification
                  skipped++;
                  processed++;
                  return;
                }
              }
            }
            
            // New or changed form - run verification in memory
            // ✅ SMART VERIFICATION: Try with calculated month first
            let result = await verifyMerchant(
              db, 
              phone, 
              form.customerName || '', 
              VerificationRule, 
              product, 
              month, 
              allRules,
              merchantMap, // 🔥 PASS IN-MEMORY MAP!
              manualVerificationsMap // 🔥 PASS MANUAL MAP!
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
                allRules,
                merchantMap, // 🔥 PASS IN-MEMORY MAP!
                manualVerificationsMap // 🔥 PASS MANUAL MAP!
              );
            }

            // ✅ ATTACH POINTS BEFORE STRIPPING RECORD
            result.monthLabel = month; // Attach month so dynamic config logic knows it's June
            const attachKey = `${phone}__${product}`;
            const tempResultObj = { [attachKey]: result };
            const attachedObj = await attachPoints(tempResultObj, cachedPointsMap); // 🔥 PASS CACHED POINTS MAP!
            const finalResult = attachedObj[attachKey];

            // ✅ STRIP RAW RECORD TO PREVENT PAYLOAD/DB BLOAT
            const lightweightResult = { ...finalResult };
            delete lightweightResult.record;

            // ✅ DUPLICATE VERIFICATION CHECK
            if (lightweightResult.status === 'Fully Verified') {
               // Ensure phone and product are strings
               const dedupPhone = String(phone || '').trim();
               const dedupProduct = String(product || '').toLowerCase().trim();
               let dedupKey = `${dedupPhone}__${dedupProduct}`;
               if (form.tideIns_type) dedupKey += `__${String(form.tideIns_type).toLowerCase().trim()}`;
               if (form.ins_insuranceType) dedupKey += `__${String(form.ins_insuranceType).toLowerCase().trim()}`;
               if (form.cc_cardName) dedupKey += `__${String(form.cc_cardName).toLowerCase().trim()}`;
               
               // Did we just verify an older one in this batch?
               if (newlyVerified.has(dedupKey)) {
                  lightweightResult.status = 'Already Verified';
                  lightweightResult.points = 0;
                  if (!lightweightResult.checks) lightweightResult.checks = [];
                  lightweightResult.checks.push({ label: 'Duplicate Check', pass: false, actual: 'Already verified by an older form in this batch' });
               } else {
                  // Also check the database just in case it was verified previously
                  const alreadyInDb = await checkIfAlreadyVerified(form, form._id, form.createdAt);
                  if (alreadyInDb) {
                     lightweightResult.status = 'Already Verified';
                     lightweightResult.points = 0;
                     if (!lightweightResult.checks) lightweightResult.checks = [];
                     lightweightResult.checks.push({ label: 'Duplicate Check', pass: false, actual: 'Already verified by an older form' });
                  } else {
                     newlyVerified.add(dedupKey);
                  }
               }
            }

            // ✅ SAVE VERIFICATION RESULTS TO REDIS PIPELINE (0 network calls in loop!)
            const cacheValue = {
              ...lightweightResult,
              hash: currentHash,
              lastVerified: new Date().toISOString(),
              phoneMatch: result.status !== 'Not Found' ? true : false,
              matched: result.status !== 'Not Found' ? true : false
            };
            
            try {
              const stringified = JSON.stringify(cacheValue);
              redisPipeline.setex(cacheKey, 86400, stringified);
              redisPipeline.setex(monthCacheKey, 86400, stringified);
              commandsInPipeline += 2;
              redisSaved += 2; // Track successful save
              
              // Only count as "cached" if verification succeeded
              if (result.status !== 'Not Found') {
                cached++;
              }
            } catch (redisErr) {
              console.error(`❌ Redis pipeline build error for ${phone}:`, redisErr.message);
            }
            
            // 🔥 SOLUTION 3: Add to bulk write arrays instead of calling updateOne inside the loop!
            try {
              const updateOp = {
                updateOne: {
                  filter: { _id: form._id },
                  update: { 
                    $set: { 
                      verificationStatus: lightweightResult.status,
                      verificationChecks: lightweightResult,
                      verificationUpdatedAt: new Date()
                    } 
                  }
                }
              };
              
              const formIdStr = form._id.toString();
              const collectionType = formCollectionMap.get(formIdStr);
              
              if (collectionType === 'FSE') {
                fseBulkOps.push(updateOp);
              } else if (collectionType === 'TL') {
                tlBulkOps.push(updateOp);
              } else if (collectionType === 'MANAGER') {
                managerBulkOps.push(updateOp);
              }
            } catch (mongoErr) {
              console.error(`❌ Bulk op build error for ${phone}:`, mongoErr.message);
            }
            
          } catch (err) {
            console.error(`❌ Error verifying ${form.customerNumber}:`, err.message);
          }
          
          processed++;
        }));

        // 🔥 Execute all Redis setex commands for this batch in 1 single pipeline packet!
        try {
          if (commandsInPipeline > 0) {
            await redisPipeline.exec();
          }
        } catch (pipeErr) {
          console.error('❌ Redis pipeline exec error:', pipeErr.message);
        }

        // 🔥 SOLUTION 3: Execute bulk writes for this batch (1 network request per collection instead of 50 individual updates!)
        try {
          if (fseBulkOps.length > 0) {
            await FormResponse.bulkWrite(fseBulkOps, { ordered: false });
          }
          if (tlBulkOps.length > 0) {
            await TLFormResponse.bulkWrite(tlBulkOps, { ordered: false });
          }
          if (managerBulkOps.length > 0) {
            await ManagerForm.bulkWrite(managerBulkOps, { ordered: false });
          }
        } catch (bulkErr) {
          console.error('❌ MongoDB bulkWrite error:', bulkErr.message);
        }

        // Log progress
        const progress = Math.min(i + batchSize, forms.length);
      }

      // Update last sync time and frontend refresh timestamp safely
      try {
        await redis.set('last_sync_time', new Date().toISOString());
        const timestamp = Date.now();
        await redis.set('verification_rules_updated_at', timestamp.toString());
      } catch (redisSetErr) {
        console.warn('Could not update Redis sync timestamps (likely Upstash quota limit):', redisSetErr.message);
      }

      // 🔥 Clear the infinite admin cache so the dashboard fetches the newly computed data
      try {
        const keys = await getKeysByPattern(redis, 'admin_forms_all*');
        if (keys.length > 0) {
          await redis.del(...keys);
          console.log(`🧹 Cleared ${keys.length} admin dashboard caches`);
        }
      } catch (err) {
        console.error('❌ Failed to clear admin cache:', err.message);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      
      console.log(`✅ Pre-computation finished in ${elapsed}s! Total: ${forms.length}, Cached: ${cached}, Skipped: ${skipped}, RedisSaved: ${redisSaved}`);
      
      // ✅ Update calculating status in Redis for frontend toaster
      try {
        await redis.setex('precompute_status', 3600, JSON.stringify({ 
          isCalculating: false, 
          finishedAt: new Date().toISOString(), 
          total: forms.length, 
          cached, 
          skipped, 
          message: 'All employee verifications re-calculated & Daily Report email sent!' 
        }));
      } catch (e) {
        console.warn('Could not update precompute_status:', e.message);
      }

      // 🔥 Trigger automatic Manager Daily Report email (runs in background so response/sync finishes cleanly)
      sendManagerDailyReport().catch(err => {
        console.error('❌ Failed to trigger automatic manager daily report:', err.message);
      });

      if (!res.headersSent) {
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
      }
    } catch (err) {
      console.error('❌ Pre-computation error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  /**
   * GET/POST /api/verify/test-manager-report
   * Direct test endpoint to run and verify the Manager Daily Report on localhost
   */
  router.all('/test-manager-report', async (req, res) => {
    try {
      console.log('🧪 Testing Manager Daily Report generation...');
      const result = await sendManagerDailyReport();
      
      // ✅ Update Redis precompute_status so GlobalSyncMonitor on Admin Panel displays the green toaster!
      try {
        const redis = getRedisClient();
        if (redis) {
          await redis.setex('precompute_status', 3600, JSON.stringify({
            isCalculating: false,
            finishedAt: new Date().toISOString(),
            message: 'Daily Manager Report email sent!'
          }));
        }
      } catch (e) {
        console.warn('Could not update precompute_status:', e.message);
      }

      res.json({
        success: result.success,
        details: result
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
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
      
      const verification = await verifyMerchant(db, phone, name || '', VerificationRule, product || '', month || '', allRules);
      const phoneCheck = { matched: verification.status !== 'Not Found', phoneMatch: verification.status !== 'Not Found' };
      
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

      const verification = await verifyMerchant(db, phone, name || '', VerificationRule, product || '', '', allRules);
      const phoneCheck = { matched: verification.status !== 'Not Found', phoneMatch: verification.status !== 'Not Found' };

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
      const phones   = (req.query.phones   || '').split(',').map(p => p.trim());
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
      const phones   = (req.query.phones   || '').split(',').map(p => p.trim());
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
            const v = await verifyMerchant(db, phone, name, VerificationRule, product, month, allRules);
            const phoneMatch = v.status !== 'Not Found';
            const inSheet = v.status !== 'Not Found';

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
      const phones   = (Array.isArray(phonesArr) ? phonesArr : (phonesArr || '').split(',')).map(p => String(p).trim());
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
        if (!phone) return;
        const product = products[i] || '';
        const month = months[i] || '';
        const key = product ? `${phone}__${product}` : phone;
        const monthKey = product ? `${phone}__${product}__${month}` : `${phone}__${month}`;
        const cached = cachedValues[i];
        if (cached) {
          try {
            const d = JSON.parse(cached);
            const dataObj = { status: d.status, verified: d.verified, passed: d.passed, total: d.total, checks: d.checks || [], collection: d.collection, matchType: d.matchType, phoneMatch: d.status !== 'Not Found' ? true : (d.phoneMatch || false), inSheet: d.status !== 'Not Found' ? true : (d.matched || false), monthLabel: month, record: (typeof cachedData !== 'undefined' ? cachedData.record : (typeof d !== 'undefined' ? d.record : (typeof v !== 'undefined' ? v.record : null))) };
            result[key] = dataObj;
            result[monthKey] = dataObj;
          } catch { missedIndices.push(i); }
        } else { missedIndices.push(i); }
      });

      if (missedIndices.length > 0) {
        const db = req.db;
        const allRules = await VerificationRule.find().lean();
        const chunkSize = 100;
        for (let idx = 0; idx < missedIndices.length; idx += chunkSize) {
          const chunk = missedIndices.slice(idx, idx + chunkSize);
          await Promise.all(chunk.map(async (i) => {
            const phone = phones[i], name = names[i] || '', product = products[i] || '', month = months[i] || '';
            if (!phone) return;
            const key = product ? `${phone}__${product}` : phone;
            const monthKey = product ? `${phone}__${product}__${month}` : `${phone}__${month}`;
            try {
              const v = await verifyMerchant(db, phone, name, VerificationRule, product, month, allRules);
              const dataObj = { status: v.status, verified: v.verified, passed: v.passed, total: v.total, checks: v.checks || [], collection: v.collection, matchType: v.matchType, phoneMatch: v.status !== 'Not Found', inSheet: v.status !== 'Not Found', monthLabel: month, record: (typeof cachedData !== 'undefined' ? cachedData.record : (typeof d !== 'undefined' ? d.record : (typeof v !== 'undefined' ? v.record : null))) };
              result[key] = dataObj;
              result[monthKey] = dataObj;
            } catch (err) {
              const errObj = { status: 'Error', verified: false, passed: 0, total: 0, checks: [], error: err.message };
              result[key] = errObj;
              result[monthKey] = errObj;
            }
          }));
        }
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

      const phones   = (req.query.phones   || '').split(',').map(p => p.trim());
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

        const chunkSize = 100;
        for (let idx = 0; idx < missedIndices.length; idx += chunkSize) {
          const chunk = missedIndices.slice(idx, idx + chunkSize);
          await Promise.all(chunk.map(async (i) => {
            const phone   = phones[i];
            const name    = names[i]    || '';
            const product = products[i] || '';
            const month   = months[i]   || '';
            const key = product ? `${phone}__${product}` : phone;
            const monthKey = product ? `${phone}__${product}__${month}` : `${phone}__${month}`;

            try {
              const v = await verifyMerchant(db, phone, name, VerificationRule, product, month, allRules);
              const phoneMatch = v.status !== 'Not Found';
              const inSheet = v.status !== 'Not Found';

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
      }

      
      const finalResult = await attachPoints(result);
      Object.keys(finalResult).forEach(k => {
        if (finalResult[k]) delete finalResult[k].record;
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

      const phones   = (Array.isArray(phonesArr)   ? phonesArr   : (phonesArr   || '').split(',')).map(p => String(p).trim());
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
        if (!phone) return;
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

        const chunkSize = 100;
        for (let idx = 0; idx < missedIndices.length; idx += chunkSize) {
          const chunk = missedIndices.slice(idx, idx + chunkSize);
          await Promise.all(chunk.map(async (i) => {
            const phone   = phones[i];
            if (!phone) return;
            const name    = names[i]    || '';
            const product = products[i] || '';
            const month   = months[i]   || '';
            const key     = product ? `${phone}__${product}` : phone;
            const monthKey = product ? `${phone}__${product}__${month}` : `${phone}__${month}`;

            try {
              const v = await verifyMerchant(db, phone, name, VerificationRule, product, month, allRules);
              const phoneMatch = v.status !== 'Not Found';
              const inSheet    = v.status !== 'Not Found';
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
      }

      
      const finalResult = await attachPoints(result);
      // Strip heavy raw records before sending to frontend to prevent payload cutoff
      Object.keys(finalResult).forEach(k => {
        if (finalResult[k]) delete finalResult[k].record;
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
        const keys = await getKeysByPattern(redis, pattern);
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
        const keys = await getKeysByPattern(redis, pattern);
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
        const keys = await getKeysByPattern(redis, pattern);
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