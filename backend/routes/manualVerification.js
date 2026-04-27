const express = require('express');
const router = express.Router();
const ManualVerification = require('../models/ManualVerification');
const { getRedisClient } = require('../utils/redisClient');

// ---------- CREATE MANUAL VERIFICATION ----------
router.post('/create', async (req, res) => {
  try {
    const { phone, product, month, status, verifiedBy, reason, formId } = req.body;

    // Validate required fields
    if (!phone || !product || !verifiedBy) {
      return res.status(400).json({ 
        message: 'Phone, product, and verifiedBy are required' 
      });
    }

    // Normalize phone number (remove non-digits)
    const normalizedPhone = String(phone).replace(/\D/g, '');
    const normalizedProduct = (product || '').toLowerCase().trim();
    const normalizedMonth = month ? (month || '').toLowerCase().trim() : null;

    // Check if manual verification already exists
    const existingVerification = await ManualVerification.findOne({
      phone: normalizedPhone,
      product: normalizedProduct,
      month: normalizedMonth
    });

    if (existingVerification) {
      // Update existing verification
      existingVerification.status = status || 'Fully Verified';
      existingVerification.verifiedBy = verifiedBy;
      existingVerification.reason = reason || 'Manual verification by admin';
      existingVerification.updatedAt = new Date();
      
      await existingVerification.save();
      
      // ✅ INVALIDATE CACHE: Delete Redis cache for this phone+product
      try {
        const redis = getRedisClient();
        if (redis) {
          const cacheKey = `verification:${normalizedPhone}:${normalizedProduct}`;
          await redis.del(cacheKey);
          console.log(`✅ Cache invalidated for ${cacheKey}`);
        }
      } catch (cacheError) {
        console.error('Cache invalidation error:', cacheError);
        // Don't fail the request if cache invalidation fails
      }
      
      return res.json({
        message: 'Manual verification updated successfully',
        verification: existingVerification
      });
    }

    // Create new manual verification
    const manualVerification = new ManualVerification({
      phone: normalizedPhone,
      product: normalizedProduct,
      month: normalizedMonth,
      status: status || 'Fully Verified',
      verifiedBy,
      reason: reason || 'Manual verification by admin',
      formId: formId || null
    });

    await manualVerification.save();

    // ✅ INVALIDATE CACHE: Delete Redis cache for this phone+product
    try {
      const redis = getRedisClient();
      if (redis) {
        const cacheKey = `verification:${normalizedPhone}:${normalizedProduct}`;
        await redis.del(cacheKey);
        console.log(`✅ Cache invalidated for ${cacheKey}`);
      }
    } catch (cacheError) {
      console.error('Cache invalidation error:', cacheError);
      // Don't fail the request if cache invalidation fails
    }

    res.status(201).json({
      message: 'Manual verification created successfully',
      verification: manualVerification
    });

  } catch (error) {
    console.error('Error creating manual verification:', error);
    res.status(500).json({ message: error.message });
  }
});

// ---------- GET MANUAL VERIFICATIONS ----------
router.get('/list', async (req, res) => {
  try {
    const { phone, product, month, verifiedBy, page = 1, limit = 50 } = req.query;

    // Build query
    const query = {};
    if (phone) query.phone = String(phone).replace(/\D/g, '');
    if (product) query.product = (product || '').toLowerCase().trim();
    if (month) query.month = (month || '').toLowerCase().trim();
    if (verifiedBy) query.verifiedBy = new RegExp(verifiedBy, 'i');

    // Get total count
    const total = await ManualVerification.countDocuments(query);

    // Get paginated results
    const verifications = await ManualVerification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    res.json({
      verifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching manual verifications:', error);
    res.status(500).json({ message: error.message });
  }
});

// ---------- GET SINGLE MANUAL VERIFICATION ----------
router.get('/check', async (req, res) => {
  try {
    const { phone, product, month } = req.query;

    if (!phone || !product) {
      return res.status(400).json({ 
        message: 'Phone and product are required' 
      });
    }

    const normalizedPhone = String(phone).replace(/\D/g, '');
    const normalizedProduct = (product || '').toLowerCase().trim();
    const normalizedMonth = month ? (month || '').toLowerCase().trim() : null;

    const query = {
      phone: normalizedPhone,
      product: normalizedProduct
    };

    if (normalizedMonth) {
      query.month = normalizedMonth;
    }

    const verification = await ManualVerification.findOne(query).sort({ createdAt: -1 });

    if (!verification) {
      return res.json({ exists: false, verification: null });
    }

    res.json({ exists: true, verification });

  } catch (error) {
    console.error('Error checking manual verification:', error);
    res.status(500).json({ message: error.message });
  }
});

// ---------- UPDATE MANUAL VERIFICATION ----------
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, verifiedBy, reason } = req.body;

    const verification = await ManualVerification.findById(id);
    if (!verification) {
      return res.status(404).json({ message: 'Manual verification not found' });
    }

    // Update fields
    if (status) verification.status = status;
    if (verifiedBy) verification.verifiedBy = verifiedBy;
    if (reason) verification.reason = reason;
    verification.updatedAt = new Date();

    await verification.save();

    // ✅ INVALIDATE CACHE: Delete Redis cache for this phone+product
    try {
      const redis = getRedisClient();
      if (redis) {
        const cacheKey = `verification:${verification.phone}:${verification.product}`;
        await redis.del(cacheKey);
        console.log(`✅ Cache invalidated for ${cacheKey}`);
      }
    } catch (cacheError) {
      console.error('Cache invalidation error:', cacheError);
    }

    res.json({
      message: 'Manual verification updated successfully',
      verification
    });

  } catch (error) {
    console.error('Error updating manual verification:', error);
    res.status(500).json({ message: error.message });
  }
});

// ---------- DELETE MANUAL VERIFICATION ----------
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const verification = await ManualVerification.findById(id);
    if (!verification) {
      return res.status(404).json({ message: 'Manual verification not found' });
    }

    // ✅ INVALIDATE CACHE: Delete Redis cache for this phone+product BEFORE deleting the record
    try {
      const redis = getRedisClient();
      if (redis) {
        const cacheKey = `verification:${verification.phone}:${verification.product}`;
        await redis.del(cacheKey);
        console.log(`✅ Cache invalidated for ${cacheKey}`);
      }
    } catch (cacheError) {
      console.error('Cache invalidation error:', cacheError);
    }

    await ManualVerification.findByIdAndDelete(id);

    res.json({ message: 'Manual verification deleted successfully' });

  } catch (error) {
    console.error('Error deleting manual verification:', error);
    res.status(500).json({ message: error.message });
  }
});

// ---------- BULK CREATE MANUAL VERIFICATIONS ----------
router.post('/bulk-create', async (req, res) => {
  try {
    const { verifications, verifiedBy } = req.body;

    if (!verifications || !Array.isArray(verifications) || !verifiedBy) {
      return res.status(400).json({ 
        message: 'Verifications array and verifiedBy are required' 
      });
    }

    const results = [];
    const errors = [];

    for (const item of verifications) {
      try {
        const { phone, product, month, status, reason, formId } = item;

        if (!phone || !product) {
          errors.push({ item, error: 'Phone and product are required' });
          continue;
        }

        const normalizedPhone = String(phone).replace(/\D/g, '');
        const normalizedProduct = (product || '').toLowerCase().trim();
        const normalizedMonth = month ? (month || '').toLowerCase().trim() : null;

        // Check if already exists
        const existing = await ManualVerification.findOne({
          phone: normalizedPhone,
          product: normalizedProduct,
          month: normalizedMonth
        });

        if (existing) {
          // Update existing
          existing.status = status || 'Fully Verified';
          existing.verifiedBy = verifiedBy;
          existing.reason = reason || 'Bulk manual verification by admin';
          existing.updatedAt = new Date();
          await existing.save();
          results.push({ action: 'updated', verification: existing });
        } else {
          // Create new
          const newVerification = new ManualVerification({
            phone: normalizedPhone,
            product: normalizedProduct,
            month: normalizedMonth,
            status: status || 'Fully Verified',
            verifiedBy,
            reason: reason || 'Bulk manual verification by admin',
            formId: formId || null
          });
          await newVerification.save();
          results.push({ action: 'created', verification: newVerification });
        }

      } catch (error) {
        errors.push({ item, error: error.message });
      }
    }

    res.json({
      message: `Processed ${results.length} verifications successfully`,
      results,
      errors,
      summary: {
        total: verifications.length,
        successful: results.length,
        failed: errors.length
      }
    });

  } catch (error) {
    console.error('Error bulk creating manual verifications:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;