require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');

// Import the enhanced connection manager
const ConnectionManager = require('./utils/ConnectionManager');

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

app.use(cors());
app.use(express.json());
// app.use('/uploads', express.static(uploadsDir));

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
  
  console.log('🔄 Connecting to MongoDB...');
  console.log('📍 URI:', process.env.MONGO_URI ? 'Set' : 'Not Set');

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(process.env.MONGO_URI, {
        dbName: 'CompanyDB',
        
        // AGGRESSIVE connection pool settings for Vercel serverless
        maxPoolSize: 2,           // REDUCED: Only 2 connections per instance (was 10)
        minPoolSize: 1,           // REDUCED: Keep 1 connection alive (was 2)
        maxIdleTimeMS: 10000,     // REDUCED: Close idle connections after 10s (was 30s)
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
        console.log('✅ MongoDB connected successfully');
        console.log(`📊 Database: ${mongoose.connection.name}`);
        console.log(`🔗 Host: ${mongoose.connection.host}`);
        
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

/**
 * Register all application routes
 */
function registerRoutes() {
  console.log('📝 Registering routes...');
  
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
  
  console.log('✅ Routes registered successfully');
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

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  console.log(`\n� Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Shutdown connection manager
    await connectionManager.shutdown();
    
    // Close database connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('✅ Database connection closed');
    }
    
    console.log('✅ Graceful shutdown completed');
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
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 4000;

  app.listen(PORT, () => {
    console.log(`🚀 Server running locally on http://localhost:${PORT}`);
    console.log(`💓 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📊 Detailed health: http://localhost:${PORT}/api/health/detailed`);
    console.log(`📈 Metrics: http://localhost:${PORT}/api/health/metrics`);
  });
}

// Export app for Vercel (must be default export)
module.exports = app;
