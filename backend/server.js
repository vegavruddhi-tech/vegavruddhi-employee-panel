require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');

const app = express();

// Ensure uploads folder exists
const uploadsDir = '/tmp/uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/forms', require('./routes/forms'));
app.use('/api/verify', require('./routes/verify'));
app.use('/api/requests', require('./routes/requests'));

app.get('*', (req, res) => {
  res.status(404).json({ message: 'Not found' });
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected to CompanyDB');
    // Only listen when running locally (not on Vercel)
    if (process.env.VERCEL !== '1') {
      app.listen(process.env.PORT || 5000, () => {
        console.log(`🚀 Server running on http://localhost:${process.env.PORT || 5000}`);
      });
    }
  })
  .catch(err => console.error('❌ MongoDB error:', err));

module.exports = app;
