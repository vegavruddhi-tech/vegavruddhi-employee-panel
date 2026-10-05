const express = require('express');
const router = express.Router();
const FormConfiguration = require('../models/FormConfiguration');
const Employee = require('../models/Employee');
const { verifyToken, getAllowedAdmins } = require('../middleware/auth');

// Ensure the request has admin or manager level privileges if writing
async function verifyAdminOrManager(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Explicitly reject impersonated sessions from modifying configurations
    if (req.user.impersonating === true || req.user.adminImpersonating === true) {
      return res.status(403).json({ message: 'Access denied: Administrative actions are disabled during impersonated sessions' });
    }

    const allowedAdmins = getAllowedAdmins();
    const userEmail = (req.user.email || '').toLowerCase().trim();

    // Check if user is an admin in JWT or in allowed admin emails list
    if (req.user.isAdmin === true || req.user.role === 'admin' || (userEmail && allowedAdmins.includes(userEmail))) {
      return next();
    }

    // Check if user is an employee with admin or manager position
    if (req.user.id) {
      const emp = await Employee.findById(req.user.id);
      if (emp) {
        const pos = (emp.position || '').toLowerCase();
        if (pos.includes('admin') || pos.includes('manager')) {
          return next();
        }
      }
    }

    // Block unauthorized users properly
    return res.status(403).json({ message: 'Access denied: Admin or Manager privileges required' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// Default layout for initialization
const DEFAULT_CONFIG = {
  name: 'Default Merchant Form',
  brands: [
    {
      name: 'Tide',
      hasSubProducts: true,
      products: [
        {
          name: 'Tide',
          fields: [
            { name: 'tide_qrPosted', label: 'QR Posted', type: 'radio', options: ['Yes', 'No'] },
            { name: 'tide_upiTxnDone', label: 'Rs 10/30 UPI Txn Done', type: 'radio', options: ['Yes', 'No'] }
          ]
        },
        {
          name: 'Tide Insurance',
          fields: [
            { name: 'tideIns_type', label: 'Type of Insurance', type: 'radio', options: ['Cyber Security', 'Accidental'] }
          ]
        },
        {
          name: 'Tide MSME',
          fields: []
        },
        {
          name: 'Tide Credit Card',
          fields: [
            { name: 'cc_cardName', label: 'Name of the Credit Card', type: 'text', options: [] }
          ]
        }
      ],
      fields: []
    },
    {
      name: 'Tide BT',
      hasSubProducts: false,
      products: [],
      fields: [
        { name: 'tideBt_txnDone', label: 'Rs 10 Txn Done', type: 'radio', options: ['Yes', 'No'] }
      ]
    },
    {
      name: 'Insurance 2W/4W',
      hasSubProducts: false,
      products: [],
      fields: [
        { name: 'ins_vehicleNumber', label: 'Vehicle Number', type: 'text', options: [] },
        { name: 'ins_vehicleType', label: 'Vehicle Type', type: 'radio', options: ['2 Wheeler', '4 Wheeler', 'Commercial'] },
        { name: 'ins_insuranceType', label: 'Insurance Type', type: 'radio', options: ['3rd Party', 'Only OD', 'OD + 3rd Party'] }
      ]
    },
    {
      name: 'PineLab',
      hasSubProducts: false,
      products: [],
      fields: [
        { name: 'pine_cardTxn', label: 'Card Txn done of Rs 100', type: 'radio', options: ['Yes', 'No'] },
        { name: 'pine_wifiConnected', label: 'Machine connected with Wi-Fi', type: 'radio', options: ['Yes', 'No'] }
      ]
    }
  ]
};

// GET /api/form-config
router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    let config = await FormConfiguration.findOne();
    if (!config) {
      config = await FormConfiguration.create(DEFAULT_CONFIG);
    }
    res.json(config);
  } catch (err) {
    console.error('Error fetching form config:', err);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/form-config
router.put('/', verifyToken, verifyAdminOrManager, async (req, res) => {
  try {
    const { brands } = req.body;
    let config = await FormConfiguration.findOne();
    const updatedBy = req.user?.email || 'Admin';
    
    if (!config) {
      config = new FormConfiguration({ name: 'Default Merchant Form', brands, updatedBy });
    } else {
      config.brands = brands;
      config.updatedAt = new Date();
      config.updatedBy = updatedBy;
    }
    
    await config.save();
    res.json({ message: 'Form configuration updated successfully', config });
  } catch (err) {
    console.error('Error updating form config:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
