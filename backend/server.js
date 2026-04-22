require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');

const app = express();

// uploads temp directory for Vercel
const uploadsDir = '/tmp/uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
// app.use('/uploads', express.static(uploadsDir));

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/tl',      require('./routes/tl'));
app.use('/api/manager', require('./routes/manager'));
app.use('/api/forms', require('./routes/forms'));
app.use('/api/verify', require('./routes/verify'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/manual-verification', require('./routes/manualVerification'));


app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend running on Vercel' });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// MongoDB cached connection for Vercel
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;
  console.log(process.env.MONGO_URI);

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(process.env.MONGO_URI, {
        dbName: 'CompanyDB',
        useNewUrlParser: true,
        useUnifiedTopology: true,
        tlsAllowInvalidCertificates: true,
      })
      .then((mongoose) => {
        console.log('✅ MongoDB connected');
        return mongoose;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

connectDB();

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;

  app.listen(PORT, () => {
    console.log(`🚀 Server running locally on http://localhost:${PORT}`);
  });
}

module.exports = app;
