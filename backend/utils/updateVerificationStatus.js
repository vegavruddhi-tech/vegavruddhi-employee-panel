const mongoose = require('mongoose');
const { verifyMerchant } = require('./verifyMerchant');

/**
 * Update verification status for a form
 * @param {string} formId - Form ID
 * @returns {Promise<void>}
 */
async function updateFormVerificationStatus(formId) {
  try {
    const FormResponse = require('../models/FormResponse');
    const VerificationRule = require('../models/VerificationRule');
    
    const form = await FormResponse.findById(formId);
    if (!form) return;

    const db = mongoose.connection.db;
    const product = form.formFillingFor || (form.brand === 'Tide' && form.tideProduct ? form.tideProduct : form.brand) || '';
    const month = new Date(form.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const verification = await verifyMerchant(
      db,
      form.customerNumber,
      form.customerName || '',
      VerificationRule,
      product,
      month
    );

    await FormResponse.findByIdAndUpdate(formId, {
      verificationStatus: verification.status,
      verificationChecks: verification,
      verificationUpdatedAt: new Date()
    });

    console.log(`✅ Updated verification for form ${formId}: ${verification.status}`);
  } catch (err) {
    console.error(`❌ Error updating verification for form ${formId}:`, err.message);
  }
}

/**
 * Update verification status for multiple forms
 * @param {string[]} formIds - Array of form IDs
 * @returns {Promise<void>}
 */
async function updateMultipleFormsVerification(formIds) {
  await Promise.all(formIds.map(id => updateFormVerificationStatus(id)));
}

/**
 * Update verification for all forms matching a phone number
 * @param {string} phone - Phone number
 * @returns {Promise<void>}
 */
async function updateVerificationByPhone(phone) {
  try {
    const FormResponse = require('../models/FormResponse');
    const forms = await FormResponse.find({ customerNumber: phone }).select('_id');
    await updateMultipleFormsVerification(forms.map(f => f._id.toString()));
  } catch (err) {
    console.error(`❌ Error updating verification by phone ${phone}:`, err.message);
  }
}

module.exports = {
  updateFormVerificationStatus,
  updateMultipleFormsVerification,
  updateVerificationByPhone
};
