const FormResponse = require('../models/FormResponse');
const TLFormResponse = require('../models/TLFormResponse');
const ManagerForm = require('../models/ManagerForm');

async function checkIfAlreadyVerified(form, currentFormId, currentFormCreatedAt) {
  // Try to find any other form with Fully Verified status for this phone+product
  // that was created BEFORE this form.
  if (!form || !form.customerNumber) return false;
  
  const query = {
    customerNumber: form.customerNumber,
    verificationStatus: 'Fully Verified',
    _id: { $ne: currentFormId }
  };

  const product = form.formFillingFor || form.tideProduct || form.brand || '';
  if (product) {
    const pRegex = new RegExp(`^${product.trim()}$`, 'i');
    query.$or = [
      { formFillingFor: pRegex },
      { 
        formFillingFor: { $in: [null, ''] },
        tideProduct: pRegex 
      },
      { 
        formFillingFor: { $in: [null, ''] },
        tideProduct: { $in: [null, ''] },
        brand: pRegex 
      }
    ];
  }

  // Exact sub-product matches
  if (form.tideIns_type) {
    query.tideIns_type = new RegExp(`^${form.tideIns_type.trim()}$`, 'i');
  } else if (product.toLowerCase() === 'tide insurance') {
    query.tideIns_type = { $in: [null, ''] };
  }

  if (form.ins_insuranceType) {
    query.ins_insuranceType = new RegExp(`^${form.ins_insuranceType.trim()}$`, 'i');
  } else if (product.toLowerCase() === '2w insurance' || product.toLowerCase() === '4w insurance') {
    query.ins_insuranceType = { $in: [null, ''] };
  }

  if (form.cc_cardName) {
    query.cc_cardName = new RegExp(`^${form.cc_cardName.trim()}$`, 'i');
  } else if (product.toLowerCase() === 'tide credit card' || product.toLowerCase() === 'credit card') {
    query.cc_cardName = { $in: [null, ''] };
  }
  
  if (currentFormCreatedAt) {
    query.createdAt = { $lte: new Date(currentFormCreatedAt) };
  }
  
  const fse = await FormResponse.findOne(query).select('_id').lean();
  if (fse) return true;
  
  const tl = await TLFormResponse.findOne(query).select('_id').lean();
  if (tl) return true;
  
  try {
    const mgr = await ManagerForm.findOne(query).select('_id').lean();
    if (mgr) return true;
  } catch (e) {
    // Model might not exist in some environments
  }
  
  return false;
}

module.exports = { checkIfAlreadyVerified };
