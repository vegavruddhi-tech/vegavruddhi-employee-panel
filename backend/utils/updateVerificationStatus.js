const { verifyMerchant } = require('./verifyMerchant');

/**
 * Update verification status for a form
 * @param {string} formId - Form ID
 * @param {Db} [db] - Database connection (optional, will use mongoose if not provided)
 * @returns {Promise<void>}
 */
async function updateFormVerificationStatus(formId, db = null) {
  try {
    const FormResponse = require('../models/FormResponse');
    const VerificationRule = require('../models/VerificationRule');
    
    const form = await FormResponse.findById(formId);
    if (!form) return;

    // Use provided db connection or fallback to mongoose (for backward compatibility)
    const dbConnection = db || require('mongoose').connection.db;
    const product = form.formFillingFor || (form.brand === 'Tide' && form.tideProduct ? form.tideProduct : form.brand) || '';
    const month = new Date(form.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const verification = await verifyMerchant(
      dbConnection,
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
 * @param {Db} [db] - Database connection (optional)
 * @returns {Promise<void>}
 */
async function updateMultipleFormsVerification(formIds, db = null) {
  await Promise.all(formIds.map(id => updateFormVerificationStatus(id, db)));
}

/**
 * Update verification for all forms matching a phone number
 * @param {string} phone - Phone number
 * @param {Db} [db] - Database connection (optional)
 * @returns {Promise<void>}
 */
async function updateVerificationByPhone(phone, db = null) {
  try {
    const FormResponse = require('../models/FormResponse');
    const forms = await FormResponse.find({ customerNumber: phone }).select('_id');
    await updateMultipleFormsVerification(forms.map(f => f._id.toString()), db);
  } catch (err) {
    console.error(`❌ Error updating verification by phone ${phone}:`, err.message);
  }
}

module.exports = {
  updateFormVerificationStatus,
  updateMultipleFormsVerification,
  updateVerificationByPhone
};
