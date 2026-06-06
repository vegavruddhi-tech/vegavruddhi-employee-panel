const mongoose = require('mongoose');

const fieldSchema = new mongoose.Schema({
  name: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, required: true, enum: ['text', 'radio', 'checkbox', 'select'] },
  options: [{ type: String }],
  required: { type: Boolean, default: false }
});

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  fields: [fieldSchema]
});

const brandSchema = new mongoose.Schema({
  name: { type: String, required: true },
  hasSubProducts: { type: Boolean, default: false },
  products: [productSchema],
  fields: [fieldSchema] // Fields that belong directly to the brand
});

const formConfigurationSchema = new mongoose.Schema({
  name: { type: String, default: 'Default Merchant Form' },
  brands: [brandSchema],
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String }
}, { collection: 'form_configurations' });

// Ensure there is only ever one active config (or we just use findOne)
module.exports = mongoose.model('FormConfiguration', formConfigurationSchema);
