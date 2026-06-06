const mongoose = require('mongoose');

const TierSchema = new mongoose.Schema({
  name: { type: String, required: true },        // "Standard", "Silver", "Gold", "Platinum"
  price: { type: Number },                        // 849, 1499, 2499, 4999
  points: { type: Number, required: true }        // 1, 2, 4, 8
}, { _id: false });

const PlanSchema = new mongoose.Schema({
  planName: { type: String, required: true },     // "OPD Wallet", "Health Plus"
  tiers: [TierSchema]                             // Array of tiers for this plan
}, { _id: false });

const PointsConfigurationSchema = new mongoose.Schema({
  productName: { 
    type: String, 
    required: true
  },
  productType: { 
    type: String, 
    enum: ['simple', 'complex', 'mapped'],         // Simple = flat points, Complex = has variants, Mapped = column-based
    default: 'simple' 
  },
  
  // 🔥 NEW: Value Mapping (for 'mapped' product type)
  valueMapping: [{
    value: { type: String },
    points: { type: Number, default: 0 }
  }],
  
  // 🔥 NEW: Month/Year filtering (like Verification Rules)
  month: { type: String },                         // "May", "June" - empty means applies to all months
  year: { type: Number },                          // 2026 - empty means applies to all years
  
  // 🔥 NEW: Collection/Sheet info (like Verification Rules)
  collectionName: { type: String },                // "TL_connect_May" - the sheet/collection to read from
  
  // 🔥 NEW: Field mapping (dynamic column names)
  fieldMapping: {
    productField: { type: String, default: 'formFillingFor' },  // Which column has product name
    planField: { type: String },                    // Which column has plan name (e.g., "planName", "Plan_Name")
    tierField: { type: String },                    // Which column has tier name (e.g., "tierName", "Variant")
    priceField: { type: String },                   // Which column has price (e.g., "price", "Amount", "Premium")
    mappedColumn: { type: String }                  // Which column contains the value to map points for
  },
  
  // For simple products (flat points)
  simplePoints: { 
    type: Number,
    default: 0
  },
  
  // For complex products (has plans and tiers)
  plans: [PlanSchema],
  
  // Metadata
  createdBy: { type: String },
  updatedBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  
  // History tracking
  changeHistory: [{
    changedBy: String,
    changedAt: { type: Date, default: Date.now },
    changes: String                                 // Description of what changed
  }]
});

// Update timestamp on save
PointsConfigurationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for fast lookups by product, month, year
PointsConfigurationSchema.index({ productName: 1, month: 1, year: 1 });

module.exports = mongoose.model('PointsConfiguration', PointsConfigurationSchema);
