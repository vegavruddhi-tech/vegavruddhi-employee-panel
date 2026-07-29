const { verifyMerchant } = require('./verifyMerchant');
const { checkIfAlreadyVerified } = require('./dedupVerification');

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

    const dbConnection = db || require('mongoose').connection.db;
    const product = form.formFillingFor || (form.brand === 'Tide' && form.tideProduct ? form.tideProduct : form.brand) || '';
    const month = new Date(form.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const verification = await verifyMerchant(dbConnection, form.customerNumber, form.customerName || '', VerificationRule, product, month);

    if (verification.status === 'Fully Verified') {
      const isDup = await checkIfAlreadyVerified(form, form._id, form.createdAt);
      if (isDup) {
        verification.status = 'Already Verified';
        verification.points = 0;
        if (verification.checks) {
          verification.checks.push({ label: 'Duplicate Check', pass: false, actual: 'Already verified by an older form' });
        }
      }
    }

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

async function updateManagerFormVerificationStatus(formId, db = null) {
  try {
    const ManagerForm = require('../models/ManagerForm');
    const VerificationRule = require('../models/VerificationRule');

    const form = await ManagerForm.findById(formId);
    if (!form) return;

    const dbConnection = db || require('mongoose').connection.db;
    const product = form.formFillingFor || (form.brand === 'Tide' && form.tideProduct ? form.tideProduct : form.brand) || '';
    const month = new Date(form.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const verification = await verifyMerchant(dbConnection, form.customerNumber, form.customerName || '', VerificationRule, product, month);

    if (verification.status === 'Fully Verified') {
      const isDup = await checkIfAlreadyVerified(form, form._id, form.createdAt);
      if (isDup) {
        verification.status = 'Already Verified';
        verification.points = 0;
        if (verification.checks) {
          verification.checks.push({ label: 'Duplicate Check', pass: false, actual: 'Already verified by an older form' });
        }
      }
    }

    await ManagerForm.findByIdAndUpdate(formId, {
      verificationStatus: verification.status,
      verificationChecks: verification,
      verificationUpdatedAt: new Date()
    });

    console.log(`✅ Updated verification for manager form ${formId}: ${verification.status}`);
  } catch (err) {
    console.error(`❌ Error updating verification for manager form ${formId}:`, err.message);
  }
}

async function updateTLFormVerificationStatus(formId, db = null) {
  try {
    const TLFormResponse = require('../models/TLFormResponse');
    const VerificationRule = require('../models/VerificationRule');

    const form = await TLFormResponse.findById(formId);
    if (!form) return;

    const dbConnection = db || require('mongoose').connection.db;
    const product = form.formFillingFor || (form.brand === 'Tide' && form.tideProduct ? form.tideProduct : form.brand) || '';
    const month = new Date(form.createdAt).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const verification = await verifyMerchant(dbConnection, form.customerNumber, form.customerName || '', VerificationRule, product, month);

    if (verification.status === 'Fully Verified') {
      const isDup = await checkIfAlreadyVerified(form, form._id, form.createdAt);
      if (isDup) {
        verification.status = 'Already Verified';
        verification.points = 0;
        if (verification.checks) {
          verification.checks.push({ label: 'Duplicate Check', pass: false, actual: 'Already verified by an older form' });
        }
      }
    }

    await TLFormResponse.findByIdAndUpdate(formId, {
      verificationStatus: verification.status,
      verificationChecks: verification,
      verificationUpdatedAt: new Date()
    });

    console.log(`✅ Updated verification for TL form ${formId}: ${verification.status}`);
  } catch (err) {
    console.error(`❌ Error updating verification for TL form ${formId}:`, err.message);
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
  updateManagerFormVerificationStatus,
  updateTLFormVerificationStatus,
  updateMultipleFormsVerification,
  updateVerificationByPhone
};
