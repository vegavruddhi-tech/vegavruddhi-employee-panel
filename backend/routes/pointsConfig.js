const express = require('express');
const router = express.Router();
const PointsConfiguration = require('../models/PointsConfiguration');

/**
 * GET /api/points-config/collections
 * Get list of all MongoDB collections (for dropdown in UI)
 */
router.get('/collections', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    // Filter out system collections and return sorted list
    const collectionNames = collections
      .map(c => c.name)
      .filter(name => !name.startsWith('system.'))
      .sort();
    
    res.json({
      success: true,
      collections: collectionNames
    });
  } catch (error) {
    console.error('Error fetching collections:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/points-config/collection-columns/:name
 * Get all column names from a specific collection (for field mapping dropdowns)
 */
router.get('/collection-columns/:name', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    // Get all unique field names from the collection
    const result = await db.collection(req.params.name).aggregate([
      { $project: { fields: { $objectToArray: "$$ROOT" } } },
      { $unwind: "$fields" },
      { $group: { _id: null, allFields: { $addToSet: "$fields.k" } } }
    ]).toArray();
    
    const fields = result[0]?.allFields || [];
    
    // Filter out internal fields and sort
    const filtered = fields.filter(f => !f.startsWith('_')).sort();
    
    res.json({
      success: true,
      columns: filtered
    });
  } catch (error) {
    console.error('Error fetching collection columns:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/points-config/distinct-values/:collection/:field
 * Get distinct unique values for a specific field in a collection (for Plan/Tier dropdowns)
 */
router.get('/distinct-values/:collection/:field', async (req, res) => {
  try {
    const { collection, field } = req.params;
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
    // Get distinct values, filter out null/empty, and sort
    let distinctValues = await db.collection(collection).distinct(field);
    distinctValues = distinctValues
      .filter(val => val !== null && val !== undefined && val !== '')
      .sort();
      
    res.json({
      success: true,
      values: distinctValues
    });
  } catch (error) {
    console.error(`Error fetching distinct values for ${req.params.field}:`, error);
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /api/points-config
 * Get all product points configurations
 * Query params: ?month=May&year=2026 (optional filtering)
 */
router.get('/', async (req, res) => {
  try {
    const { month, year } = req.query;
    
    // Build query filter
    const query = {};
    if (month) {
      // Match specific month OR configs that apply to all months (month field empty/null)
      query.$or = [
        { month: month },
        { month: { $exists: false } },
        { month: null },
        { month: '' }
      ];
    }
    if (year) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { year: parseInt(year) },
          { year: { $exists: false } },
          { year: null }
        ]
      });
    }
    
    const configs = await PointsConfiguration.find(query).sort({ productName: 1 });
    
    res.json({
      success: true,
      configs,
      filter: { month, year }
    });
  } catch (error) {
    console.error('Error fetching points configs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/points-config/:productName
 * Get configuration for a specific product
 */
router.get('/:productName', async (req, res) => {
  try {
    const { productName } = req.params;
    const config = await PointsConfiguration.findOne({ 
      productName: new RegExp(`^${productName}$`, 'i') 
    });
    
    if (!config) {
      return res.status(404).json({ error: 'Product configuration not found' });
    }
    
    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error fetching product config:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/points-config
 * Create or update product points configuration
 */
router.post('/', async (req, res) => {
  try {
    const { 
      productName, 
      productType, 
      simplePoints, 
      month,
      year,
      collectionName,
      fieldMapping,
      plans,
      valueMapping,
      updatedBy 
    } = req.body;

    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    // Check if config already exists for this exact product + month + year
    const searchQuery = { 
      productName: new RegExp(`^${productName}$`, 'i'),
      month: month || { $in: [null, ''] },
      year: year || { $in: [null, ''] }
    };

    let config = await PointsConfiguration.findOne(searchQuery);

    if (config) {
      // Update existing config
      config.productType = productType || config.productType;
      config.simplePoints = productType === 'simple' ? simplePoints : config.simplePoints;
      config.plans = productType === 'complex' ? plans : config.plans;
      
      if (valueMapping !== undefined) config.valueMapping = valueMapping;
      if (month !== undefined) config.month = month;
      if (year !== undefined) config.year = year;
      if (collectionName !== undefined) config.collectionName = collectionName;
      if (fieldMapping !== undefined) config.fieldMapping = fieldMapping;
      
      config.updatedBy = updatedBy;

      
      // Add to change history
      config.changeHistory.push({
        changedBy: updatedBy || 'admin',
        changes: `Updated ${productType === 'simple' ? 'simple points' : 'plans and tiers'} for ${month || 'all months'}`
      });
      
      await config.save();
      
      res.json({
        success: true,
        message: 'Product configuration updated',
        config
      });
    } else {
      // Create new config
      config = new PointsConfiguration({
        productName,
        productType: productType || 'simple',
        simplePoints: productType === 'simple' ? simplePoints : 0,
        month: month || '',
        year: year || null,
        collectionName: collectionName || '',
        fieldMapping: fieldMapping || {},
        plans: productType === 'complex' ? plans : [],
        valueMapping: productType === 'mapped' ? (valueMapping || []) : [],
        createdBy: updatedBy || 'admin',
        updatedBy: updatedBy || 'admin'
      });
      
      await config.save();
      
      res.json({
        success: true,
        message: 'Product configuration created',
        config
      });
    }
  } catch (error) {
    console.error('Error saving points config:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/points-config/:id
 * Delete product configuration
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const config = await PointsConfiguration.findByIdAndDelete(id);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    res.json({
      success: true,
      message: `Configuration for ${config.productName} deleted`
    });
  } catch (error) {
    console.error('Error deleting points config:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/points-config/calculate
 * Calculate points for a form based on product configuration
 * Body: { productName, planName?, tierName?, price? }
 */
router.post('/calculate', async (req, res) => {
  try {
    const { productName, planName, tierName, price } = req.body;

    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    const config = await PointsConfiguration.findOne({ 
      productName: new RegExp(`^${productName}$`, 'i') 
    });

    if (!config) {
      return res.json({
        success: true,
        points: 0,
        message: 'No configuration found for this product',
        fallbackUsed: true
      });
    }

    // Simple product - return flat points
    if (config.productType === 'simple') {
      return res.json({
        success: true,
        points: config.simplePoints,
        productType: 'simple'
      });
    }

    // Complex product - find plan and tier
    if (config.productType === 'complex') {
      const plan = config.plans.find(p => 
        p.planName.toLowerCase() === (planName || '').toLowerCase()
      );

      if (!plan) {
        return res.json({
          success: true,
          points: 0,
          message: 'Plan not found in configuration',
          availablePlans: config.plans.map(p => p.planName)
        });
      }

      // Find tier by name or price
      let tier;
      if (tierName) {
        tier = plan.tiers.find(t => 
          t.name.toLowerCase() === tierName.toLowerCase()
        );
      } else if (price) {
        // Find closest price tier
        tier = plan.tiers.reduce((closest, t) => {
          if (!t.price) return closest;
          if (!closest) return t;
          return Math.abs(t.price - price) < Math.abs(closest.price - price) ? t : closest;
        }, null);
      }

      if (!tier) {
        return res.json({
          success: true,
          points: 0,
          message: 'Tier not found in plan',
          availableTiers: plan.tiers.map(t => ({ name: t.name, price: t.price }))
        });
      }

      return res.json({
        success: true,
        points: tier.points,
        productType: 'complex',
        matchedPlan: plan.planName,
        matchedTier: tier.name,
        tierPrice: tier.price
      });
    }

  } catch (error) {
    console.error('Error calculating points:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/points-config/map/all
 * Get simplified points map for quick lookups (used by calculation functions)
 */
router.get('/map/all', async (req, res) => {
  try {
    const configs = await PointsConfiguration.find();
    
    const pointsMap = {};
    
    configs.forEach(config => {
      if (config.productType === 'simple') {
        pointsMap[config.productName.toLowerCase()] = config.simplePoints;
      } else {
        // For complex products, create nested structure
        pointsMap[config.productName.toLowerCase()] = {
          type: 'complex',
          plans: {}
        };
        
        config.plans.forEach(plan => {
          pointsMap[config.productName.toLowerCase()].plans[plan.planName.toLowerCase()] = {};
          
          plan.tiers.forEach(tier => {
            pointsMap[config.productName.toLowerCase()].plans[plan.planName.toLowerCase()][tier.name.toLowerCase()] = tier.points;
          });
        });
      }
    });
    
    res.json({
      success: true,
      pointsMap
    });
  } catch (error) {
    console.error('Error building points map:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
