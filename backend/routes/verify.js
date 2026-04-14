const express          = require('express');
const router           = express.Router();
const jwt              = require('jsonwebtoken');
const mongoose         = require('mongoose');
const VerificationRule = require('../models/VerificationRule');
const { verifyMerchant, crossCheckPhone } = require('../utils/verifyMerchant');

// ---------- AUTH ----------
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

// ---------- SINGLE CHECK ----------
router.get('/check', verifyToken, async (req, res) => {
  try {
    const { phone, name, product } = req.query;

    if (!phone) return res.status(400).json({ message: 'Phone required' });

    const db = mongoose.connection.db;

    const [verification, phoneCheck] = await Promise.all([
      verifyMerchant(db, phone, name || '', VerificationRule, product || ''),
      crossCheckPhone(db, phone, name || '', VerificationRule, product || '')
    ]);

    res.json({ verification, phoneCheck });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------- BULK (NORMAL) ----------
router.get('/bulk', verifyToken, async (req, res) => {
  try {
    const phones   = (req.query.phones   || '').split(',').map(p => p.trim()).filter(Boolean);
    const names    = (req.query.names    || '').split(',').map(n => n.trim());
    const products = (req.query.products || '').split(',').map(p => p.trim());
    const months   = (req.query.months   || '').split(',').map(m => decodeURIComponent(m.trim()));

    if (!phones.length) return res.json({});

    const db     = mongoose.connection.db;
    const result = {};

    await Promise.all(phones.map(async (phone, i) => {
      const name    = names[i]    || '';
      const product = products[i] || '';
      const month   = months[i]   || '';

      const [v, pc] = await Promise.all([
        verifyMerchant(db, phone, name, VerificationRule, product, month),
        crossCheckPhone(db, phone, name, VerificationRule, product, month)
      ]);

      // ✅ KEY FIX
      const key = product ? `${phone}__${product}` : phone;

      result[key] = {
        status:     v.status,
        matchType:  v.matchType,
        phoneMatch: pc.phoneMatch,
        sheetName:  pc.sheetName,
        sheetPhone: pc.sheetPhone,
        inSheet:    pc.matched
      };
    }));

    res.json(result);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------- BULK ADMIN (FIXED) ----------
router.get('/bulk-admin', async (req, res) => {
  console.log("🔥 BULK ADMIN API CALLED");
  try {
    const phones   = (req.query.phones   || '').split(',').map(p => p.trim()).filter(Boolean);
    const names    = (req.query.names    || '').split(',').map(n => n.trim());
    const products = (req.query.products || '').split(',').map(p => p.trim());
    const months   = (req.query.months   || '').split(',').map(m => decodeURIComponent(m.trim()));

    if (!phones.length) return res.json({});

    const db     = mongoose.connection.db;
    const result = {};

    await Promise.all(phones.map(async (phone, i) => {
      const name    = names[i]    || '';
      const product = products[i] || '';
      const month   = months[i]   || '';

      const [v, pc] = await Promise.all([
        verifyMerchant(db, phone, name, VerificationRule, product, month),
        crossCheckPhone(db, phone, name, VerificationRule, product, month)
      ]);

      // 🔥 MAIN FIX HERE
      const key = product ? `${phone}__${product}` : phone;

      result[key] = {
        status:     v.status,
        matchType:  v.matchType,
        phoneMatch: pc.phoneMatch,
        inSheet:    pc.matched
      };
    }));

    res.json(result);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------- RULES ----------
router.get('/rules', async (req, res) => {
  try {
    const rules = await VerificationRule.find().sort({ monthLabel: -1 });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/rules/:id', async (req, res) => {
  try {
    const rule = await VerificationRule.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    res.json(rule);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/rules/new', async (req, res) => {
  try {
    const rule = await VerificationRule.create({
      ...req.body,
      updatedAt: new Date()
    });
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// POST /api/verify/rules/new — create a new rule
router.post('/rules/new', async (req, res) => {
  try {
    const rule = await VerificationRule.create({ ...req.body, updatedAt: new Date() });
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/verify/rules/:id — delete a rule
router.delete('/rules/:id', async (req, res) => {
  try {
    await VerificationRule.findByIdAndDelete(req.params.id);
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------- COLLECTIONS ----------
router.get('/collections', verifyToken, async (req, res) => {
  try {
    const cols = await mongoose.connection.db.listCollections().toArray();
    res.json(cols.map(c => c.name).sort());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/collection-columns/:name', async (req, res) => {
  try {
    const db   = mongoose.connection.db;
    const docs = await db.collection(req.params.name).find({}).limit(10).toArray();

    const fields = new Set();
    docs.forEach(doc =>
      Object.keys(doc).forEach(k => {
        if (!k.startsWith('_')) fields.add(k);
      })
    );

    res.json([...fields].sort());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;