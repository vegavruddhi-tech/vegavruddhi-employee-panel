require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');

// Import the enhanced connection manager
const ConnectionManager = require('./utils/ConnectionManager');
const meetingsRoutes = require('./routes/meetings');


const app = express();

// Get singleton instance of connection manager
const connectionManager = ConnectionManager.getInstance({
  healthCheckInterval: 30000,  // 30 seconds
  circuitTimeout: 60000,       // 1 minute
  maxFailures: 5,              // Open circuit after 5 failures
  connectionTimeout: 10000     // 10 seconds connection timeout
});

// uploads temp directory for Vercel
const uploadsDir = '/tmp/uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
  'http://localhost:3005',
  'http://localhost:4000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003',
  'http://127.0.0.1:3004',
  'http://127.0.0.1:3005',
  'http://127.0.0.1:4000',
  'https://team-leader-gamma.vercel.app',
  'https://vegavruddhi-admin-panel-tq8t.vercel.app',
  'https://vegavruddhi-employee-panel-ke56.vercel.app',
  'https://vegavruddhi-manager-panel.vercel.app'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, origin);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// 🔥 NEW: Add compression middleware to reduce response sizes by 70-80%
const compression = require('compression');
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6 // Compression level (0-9, 6 is default balance of speed/size)
}));

app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// MongoDB cached connection for Vercel
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    // If already connected, register with ConnectionManager
    if (!connectionManager.mongooseConnection) {
      connectionManager.setMongooseConnection(cached.conn.connection);
    }
    return cached.conn;
  }
  

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(process.env.MONGO_URI, {
        dbName: 'CompanyDB',
        
        // AGGRESSIVE connection pool settings for Vercel serverless
        maxPoolSize: 2,           // REDUCED: Only 2 connections per instance (was 10)
        minPoolSize: 1,           // REDUCED: Keep 1 connection alive (was 2)
        maxIdleTimeMS: 60000,     // INCREASED: Close idle connections after 60s (was 10s)
        serverSelectionTimeoutMS: 10000,  // 10 seconds for Vercel
        socketTimeoutMS: 45000,   // Socket timeout
        
        // Reliability settings
        retryWrites: true,
        retryReads: true,
        readPreference: 'primary',
        
        // Basic settings
        useNewUrlParser: true,
        useUnifiedTopology: true,
        tlsAllowInvalidCertificates: true,
      })
      .then((mongoose) => {
        
        // Register with ConnectionManager immediately after connection
        connectionManager.setMongooseConnection(mongoose.connection);
        
        return mongoose;
      })
      .catch((error) => {
        console.error('❌ MongoDB connection failed:', error.message);
        // Don't throw - let requests retry
        cached.promise = null; // Reset so next request can retry
        return null;
      });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    console.error('❌ Error awaiting MongoDB connection:', error.message);
    cached.promise = null; // Reset for retry
    return null;
  }
}

// Start MongoDB connection immediately
connectDB();

// Assign employee IDs to existing employees (runs once, skips already assigned)
connectDB().then(() => {
  const { assignMissingEmployeeIds } = require('./utils/employeeIdGenerator');
  assignMissingEmployeeIds().catch(console.error);
});

/**
 * Register all application routes
 */
function registerRoutes() {
  
  // Health check routes (enhanced)
  app.use('/api/health', require('./routes/health')(connectionManager));
  
  // Application routes (converted to use connectionManager with connectDB)
  app.use('/api/verify', require('./routes/verify')(connectionManager, connectDB));
  app.use('/api/forms', require('./routes/forms')(connectionManager, connectDB));
  app.use('/api/tl', require('./routes/tl')(connectionManager, connectDB));
  
  // Application routes (will be converted to use connectionManager)
  app.use('/api/auth',    require('./routes/auth'));
  app.use('/api/manager', require('./routes/manager'));
  app.use('/api/requests', require('./routes/requests'));
  app.use('/api/tasks', require('./routes/tasks'));
  app.use('/api/manual-verification', require('./routes/manualVerification'));
  app.use('/api/points-activity', require('./routes/pointsActivity'));
  app.use('/api/meetings', meetingsRoutes);
  app.use('/api/salary', require('./routes/salary'));
  app.use('/api/points-config', require('./routes/pointsConfig'));
  app.use('/api/form-config', require('./routes/formConfig'));
  app.use('/api/tide', require('./routes/tide')(connectionManager, connectDB));
  app.use('/api/attendance', require('./routes/attendance'));
  app.use('/api/unfilled-forms', require('./routes/unfilledForms'));

}

/**
 * Set up error handlers and middleware
 */
function setupErrorHandlers() {
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ 
      message: 'Route not found',
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  });

  // Global error handler
  app.use((error, req, res, next) => {
    console.error('🔴 Unhandled error:', error.message);
    
    res.status(500).json({
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
      timestamp: new Date().toISOString()
    });
  });
}

// Register routes and error handlers immediately (synchronously)
registerRoutes();
setupErrorHandlers();

const cron = require('node-cron');
const Attendance = require('./models/Attendance');

// Set timezone to IST
process.env.TZ = 'Asia/Kolkata';

// Auto logout cron job - runs at 11:59 PM IST every day
cron.schedule('59 23 * * *', async () => {
  
  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const today = istTime.toISOString().split('T')[0];
  
  
  try {
    const pendingAttendance = await Attendance.find({
      date: today,
      lastLogoutTime: null
    });
    
    
    if (pendingAttendance.length === 0) {
      return;
    }
    
    for (const attendance of pendingAttendance) {
      const durationMs = now - attendance.firstLoginTime;
      const durationHours = durationMs / (1000 * 60 * 60);
      
      attendance.lastLogoutTime = now;
      attendance.lastActivityTime = now;
      attendance.duration = parseFloat(durationHours.toFixed(2));
      attendance.autoCheckOut = true;
      await attendance.save();
      
    }
    
    
  } catch (error) {
    console.error('❌ Cron job error:', error);
  }
}, {
  timezone: "Asia/Kolkata"
});


/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  
  try {
    // Shutdown connection manager
    await connectionManager.shutdown();
    
    // Close database connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('🔴 Uncaught Exception:', error.message);
  console.error(error.stack);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Start server for local development

  const PORT = process.env.PORT || 4000;

  app.listen(PORT, () => {
  });


// Export app for Vercel (must be default export)
module.exports = app;