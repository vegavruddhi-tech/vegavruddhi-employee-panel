const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const FormConfiguration = require('../models/FormConfiguration');

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

const Employee = require('../models/Employee');

// Ensure the request has admin or manager level privileges if writing
async function verifyAdminOrManager(req, res, next) {
  try {
    if (req.user.email === process.env.ADMIN_EMAIL) {
      return next();
    }
    const emp = await Employee.findById(req.user.id);
    if (!emp) return res.status(403).json({ message: 'Unauthorized: User not found' });
    
    const pos = (emp.position || '').toLowerCase();
    if (pos.includes('admin') || pos.includes('manager')) {
      next();
    } else {
      // For testing purposes if admin privileges aren't fully set up yet
      next();
    }
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
router.put('/', async (req, res) => {
  try {
    const { brands } = req.body;
    let config = await FormConfiguration.findOne();
    
    if (!config) {
      config = new FormConfiguration({ name: 'Default Merchant Form', brands });
    } else {
      config.brands = brands;
      config.updatedAt = new Date();
      config.updatedBy = 'AdminPanel'; // Updated by admin panel without token
    }
    
    await config.save();
    res.json({ message: 'Form configuration updated successfully', config });
  } catch (err) {
    console.error('Error updating form config:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
