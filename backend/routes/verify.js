const express          = require('express');
const jwt              = require('jsonwebtoken');
const crypto           = require('crypto');
const VerificationRule = require('../models/VerificationRule');
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
    return String(product).toLowerCase().trim();
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
        if (!productCounts[product]) {
          productCounts[product] = 0;
        }
        productCounts[product]++;
      });
      
      // Sort by count
      const sorted = Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([product, count]) => ({ product, count }));
      
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
      console.log('🚀 Starting smart verification pre-computation...');
      const startTime = Date.now();
      
      // Check if force refresh is requested
      const forceRefresh = req.query.force === 'true';
      if (forceRefresh) {
        console.log('⚡ FORCE REFRESH requested - will process ALL forms');
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
      console.log(`📅 Last sync: ${lastSyncTime || 'Never'}`);

      // Get all forms or only new/updated forms
      const FormResponse = require('../models/FormResponse');
      let forms;
      
      if (lastSyncTime && !forceRefresh) {
        // Incremental: Only get new/updated forms
        const lastSync = new Date(lastSyncTime);
        forms = await FormResponse.find({
          $or: [
            { createdAt: { $gt: lastSync } },
            { updatedAt: { $gt: lastSync } }
          ]
        }).lean();
        console.log(`📊 Found ${forms.length} new/updated forms since last sync`);
      } else {
        // First time OR force refresh: Get all forms
        forms = await FormResponse.find({}).lean();
        console.log(`📊 ${forceRefresh ? 'Force refresh' : 'First sync'}: Found ${forms.length} total forms`);
      }

      if (forms.length === 0) {
        console.log('✅ No forms to verify');
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

      // Process forms in batches
      const batchSize = 50;
      for (let i = 0; i < forms.length; i += batchSize) {
        const batch = forms.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (form) => {
          try {
            const phone = form.customerNumber;
            // ✅ USE CONSISTENT PRODUCT EXTRACTION
            const product = getProductField(form);
            const cacheKey = `verification:${phone}:${product}`;
            
            // 🔍 DEBUG: Log product extraction for this specific phone
            if (phone === '9939234435') {
              console.log(`🔍 DEBUG Form ${phone}:`, {
                formFillingFor: form.formFillingFor,
                tideProduct: form.tideProduct,
                brand: form.brand,
                extractedProduct: product,
                cacheKey
              });
            }
            
            // Calculate current form hash
            const currentHash = calculateFormHash(form);
            
            // Check if already cached (only if NOT force refresh)
            if (!forceRefresh) {
              const cachedData = await redis.get(cacheKey);
              
              if (cachedData) {
                const parsed = JSON.parse(cachedData);
                if (parsed.hash === currentHash) {
                  // Data unchanged, skip verification
                  skipped++;
                  processed++;
                  return;
                }
              }
            }
            
            // New or changed form - run verification
            const month = form.createdAt 
              ? new Date(form.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' })
              : '';

            const result = await verifyMerchant(
              db, 
              phone, 
              form.customerName || '', 
              VerificationRule, 
              product, 
              month, 
              allRules
            );

            // 🔍 DEBUG: Log verification result for this specific phone
            if (phone === '9939234435') {
              console.log(`🔍 DEBUG Verification ${phone}:`, {
                product,
                month,
                status: result.status,
                verified: result.verified
              });
            }

            // ✅ ALWAYS store in Redis, even if "Not Found"
            // This ensures all forms are cached, not just verified ones
            const cacheValue = {
              ...result,
              hash: currentHash,
              lastVerified: new Date().toISOString()
            };
            
            await redis.setex(cacheKey, 86400, JSON.stringify(cacheValue));
            
            // Only count as "cached" if verification succeeded
            if (result.status !== 'Not Found') {
              cached++;
            }
            
          } catch (err) {
            console.error(`❌ Error verifying ${form.customerNumber}:`, err.message);
          }
          
          processed++;
        }));

        // Log progress
        const progress = Math.min(i + batchSize, forms.length);
        console.log(`⏳ Progress: ${progress}/${forms.length} forms processed`);
      }

      // Update last sync time
      await redis.set('last_sync_time', new Date().toISOString());

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Pre-computation complete in ${elapsed}s`);
      console.log(`   Total: ${forms.length} | Verified: ${cached} | Skipped: ${skipped}`);
      console.log(`   📊 Breakdown:`);
      console.log(`      - Cached (verified): ${cached}`);
      console.log(`      - Skipped (unchanged): ${skipped}`);
      console.log(`      - Not Found: ${forms.length - cached - skipped}`);
      
      res.json({ 
        success: true, 
        total: forms.length, 
        cached,
        skipped,
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
      
      res.json(result);

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
        return `verification:${phone}:${product}`;
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
            result[key] = {
              status:     cachedData.status,
              verified:   cachedData.verified,
              passed:     cachedData.passed,
              total:      cachedData.total,
              checks:     cachedData.checks || [],
              collection: cachedData.collection,
              matchType:  cachedData.matchType,
              phoneMatch: cachedData.phoneMatch || false,
              inSheet:    cachedData.matched || false,
              monthLabel: month
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

      console.log(`📊 Employee cache stats: ${cacheHits} hits, ${cacheMisses} misses (${phones.length} forms)`);
      res.json(result);

    } catch (err) {
      console.error('Bulk-cached error:', err);
      res.status(500).json({ 
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ---------- BULK ADMIN (REDIS CACHED VERSION WITH MGET OPTIMIZATION) ----------
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
        return `verification:${phone}:${product}`;
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
        const cached = cachedValues[i];

        if (cached) {
          // Cache hit - use cached data
          try {
            const cachedData = JSON.parse(cached);
            result[key] = {
              status:     cachedData.status,
              verified:   cachedData.verified,
              passed:     cachedData.passed,
              total:      cachedData.total,
              checks:     cachedData.checks || [],
              collection: cachedData.collection,
              matchType:  cachedData.matchType,
              phoneMatch: cachedData.phoneMatch || false,
              inSheet:    cachedData.matched || false,
              monthLabel: month
            };
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

          try {
            const [v, pc] = await Promise.all([
              verifyMerchant(db, phone, name, VerificationRule, product, month, allRules),
              crossCheckPhone(db, phone, name, VerificationRule, product, month, allRules)
            ]);

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

      console.log(`📊 Cache stats: ${cacheHits} hits, ${cacheMisses} misses (MGET optimization: 1 Redis call for ${phones.length} forms)`);
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