/**
 * Enhanced MongoDB Connection Manager
 * 
 * This class provides intelligent connection management with:
 * - Health monitoring
 * - Circuit breaker pattern
 * - Automatic recovery
 * - Performance metrics
 * - Error handling
 * 
 * @class ConnectionManager
 */

class ConnectionManager {
  constructor(options = {}) {
    // Connection state
    this.connection = null;
    this.isReady = false;
    this.isInitialized = false;
    
    // Circuit breaker state
    this.failureCount = 0;
    this.lastFailure = null;
    this.circuitOpen = false;
    this.circuitTimeout = options.circuitTimeout || 60000; // 1 minute
    this.maxFailures = options.maxFailures || 5;
    
    // Environment configuration
    this.isDevelopment = process.env.NODE_ENV !== 'production';
    
    // Configuration options
    this.options = {
      retryAttempts: this.isDevelopment ? 3 : 10,
      retryDelay: this.isDevelopment ? 1000 : 5000,
      healthCheckInterval: options.healthCheckInterval || 30000, // 30 seconds
      connectionTimeout: options.connectionTimeout || 10000, // 10 seconds
      ...options
    };
    
    // Performance metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      lastRequestTime: null,
      startTime: Date.now(),
      connectionAttempts: 0,
      lastHealthCheck: null,
      responseTimes: []
    };
    
    // Health monitoring
    this.healthCheckTimer = null;
    
    console.log('🔧 ConnectionManager initialized');
  }

  /**
   * Initialize the connection manager with a mongoose connection
   * @param {mongoose.Connection} mongooseConnection - The mongoose connection object
   */
  async initialize(mongooseConnection) {
    try {
      console.log('🔄 Initializing ConnectionManager...');
      
      if (!mongooseConnection) {
        throw new Error('Mongoose connection is required');
      }
      
      // Wait for connection to be ready
      await this.waitForMongooseConnection(mongooseConnection);
      
      // Set up the connection
      this.connection = mongooseConnection.db;
      this.isReady = true;
      this.isInitialized = true;
      this.metrics.connectionAttempts++;
      
      // Set up event listeners for connection state changes
      this.setupConnectionListeners(mongooseConnection);
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      console.log('✅ ConnectionManager initialized successfully');
      console.log(`📊 Database: ${mongooseConnection.name}`);
      console.log(`🔗 Host: ${mongooseConnection.host}`);
      
      return true;
    } catch (error) {
      console.error('❌ ConnectionManager initialization failed:', error.message);
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Wait for mongoose connection to be ready
   * @param {mongoose.Connection} mongooseConnection 
   */
  async waitForMongooseConnection(mongooseConnection, timeout = this.options.connectionTimeout) {
    const start = Date.now();
    
    while (mongooseConnection.readyState !== 1 && (Date.now() - start) < timeout) {
      console.log(`⏳ Waiting for MongoDB connection... (${mongooseConnection.readyState})`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (mongooseConnection.readyState !== 1) {
      throw new Error(`MongoDB connection timeout after ${timeout}ms. ReadyState: ${mongooseConnection.readyState}`);
    }
  }

  /**
   * Set up connection event listeners
   * @param {mongoose.Connection} mongooseConnection 
   */
  setupConnectionListeners(mongooseConnection) {
    mongooseConnection.on('connected', () => {
      console.log('✅ MongoDB connected');
      this.isReady = true;
      this.resetCircuitBreaker();
    });

    mongooseConnection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected');
      this.isReady = false;
    });

    mongooseConnection.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected');
      this.isReady = true;
      this.resetCircuitBreaker();
    });

    mongooseConnection.on('error', (error) => {
      console.error('🔴 MongoDB connection error:', error.message);
      this.isReady = false;
      this.recordFailure();
    });

    mongooseConnection.on('close', () => {
      console.log('🔒 MongoDB connection closed');
      this.isReady = false;
    });
  }

  /**
   * Get database connection with safety checks
   * @returns {Db} MongoDB native driver database instance
   */
  getConnection() {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      // Check if manager is initialized
      if (!this.isInitialized) {
        throw new Error('ConnectionManager not initialized. Call initialize() first.');
      }

      // Check circuit breaker
      if (this.circuitOpen) {
        if (Date.now() - this.lastFailure > this.circuitTimeout) {
          console.log('🔄 Circuit breaker reset - attempting reconnection');
          this.resetCircuitBreaker();
        } else {
          const timeLeft = Math.ceil((this.circuitTimeout - (Date.now() - this.lastFailure)) / 1000);
          throw new Error(`Circuit breaker open. Database unavailable for ${timeLeft} more seconds.`);
        }
      }

      // Check connection readiness
      if (!this.isReady || !this.connection) {
        this.recordFailure();
        throw new Error('Database connection not ready. Please try again in a moment.');
      }

      // Record successful request
      this.metrics.successfulRequests++;
      this.updateResponseTime(Date.now() - startTime);
      
      return this.connection;
    } catch (error) {
      this.metrics.failedRequests++;
      throw error;
    }
  }

  /**
   * Get a specific MongoDB collection
   * @param {string} collectionName - Name of the collection
   * @returns {Collection} MongoDB collection object
   */
  getCollection(collectionName) {
    if (!collectionName) {
      throw new Error('Collection name is required');
    }
    
    const db = this.getConnection();
    return db.collection(collectionName);
  }

  /**
   * Check if database is connected and healthy
   * @returns {boolean} True if connected and healthy
   */
  isConnected() {
    return this.isReady && this.connection && !this.circuitOpen;
  }

  /**
   * Perform a health check on the database
   * @returns {Promise<Object>} Health check result
   */
  async performHealthCheck() {
    try {
      if (!this.connection) {
        return { healthy: false, error: 'No connection available' };
      }

      // Perform a simple ping to test connection
      const startTime = Date.now();
      await this.connection.admin().ping();
      const responseTime = Date.now() - startTime;

      this.metrics.lastHealthCheck = Date.now();

      return {
        healthy: true,
        responseTime,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('🔴 Health check failed:', error.message);
      this.recordFailure();
      
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Start periodic health monitoring
   */
  startHealthMonitoring() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      const health = await this.performHealthCheck();
      if (!health.healthy) {
        console.log(`⚠️ Health check failed: ${health.error}`);
        this.isReady = false;
      }
    }, this.options.healthCheckInterval);

    console.log(`💓 Health monitoring started (every ${this.options.healthCheckInterval / 1000}s)`);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('💓 Health monitoring stopped');
    }
  }

  /**
   * Record a failure and potentially open circuit breaker
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailure = Date.now();
    
    if (this.failureCount >= this.maxFailures && !this.circuitOpen) {
      this.circuitOpen = true;
      console.log(`🔴 Circuit breaker opened after ${this.failureCount} failures`);
      console.log(`⏰ Will retry in ${this.circuitTimeout / 1000} seconds`);
    }
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker() {
    if (this.circuitOpen || this.failureCount > 0) {
      console.log('✅ Circuit breaker reset - connection restored');
    }
    this.failureCount = 0;
    this.lastFailure = null;
    this.circuitOpen = false;
  }

  /**
   * Update response time metrics
   * @param {number} responseTime - Response time in milliseconds
   */
  updateResponseTime(responseTime) {
    this.metrics.responseTimes.push(responseTime);
    
    // Keep only last 100 response times for average calculation
    if (this.metrics.responseTimes.length > 100) {
      this.metrics.responseTimes.shift();
    }
    
    // Calculate average response time
    this.metrics.averageResponseTime = 
      this.metrics.responseTimes.reduce((sum, time) => sum + time, 0) / 
      this.metrics.responseTimes.length;
  }

  /**
   * Get comprehensive metrics
   * @returns {Object} Metrics object
   */
  getMetrics() {
    const uptime = Date.now() - this.metrics.startTime;
    const successRate = this.metrics.totalRequests > 0 
      ? (this.metrics.successfulRequests / this.metrics.totalRequests) * 100 
      : 0;

    return {
      // Connection state
      isReady: this.isReady,
      isInitialized: this.isInitialized,
      circuitOpen: this.circuitOpen,
      
      // Performance metrics
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      successRate: Math.round(successRate * 100) / 100,
      averageResponseTime: Math.round(this.metrics.averageResponseTime * 100) / 100,
      
      // Timing
      uptime,
      uptimeFormatted: this.formatUptime(uptime),
      lastRequestTime: this.metrics.lastRequestTime,
      lastHealthCheck: this.metrics.lastHealthCheck,
      
      // Circuit breaker
      failureCount: this.failureCount,
      lastFailure: this.lastFailure,
      circuitTimeout: this.circuitTimeout,
      
      // Environment
      environment: process.env.NODE_ENV || 'development',
      connectionAttempts: this.metrics.connectionAttempts
    };
  }

  /**
   * Format uptime in human-readable format
   * @param {number} ms - Uptime in milliseconds
   * @returns {string} Formatted uptime
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      lastRequestTime: null,
      startTime: Date.now(),
      connectionAttempts: this.metrics.connectionAttempts,
      lastHealthCheck: null,
      responseTimes: []
    };
    console.log('📊 Metrics reset');
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('🛑 ConnectionManager shutting down...');
    
    // Stop health monitoring
    this.stopHealthMonitoring();
    
    // Reset state
    this.isReady = false;
    this.isInitialized = false;
    this.connection = null;
    
    console.log('✅ ConnectionManager shutdown complete');
  }

  /**
   * Get connection status for health checks
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      status: this.isConnected() ? 'healthy' : 'unhealthy',
      ready: this.isReady,
      initialized: this.isInitialized,
      circuitOpen: this.circuitOpen,
      failureCount: this.failureCount,
      lastFailure: this.lastFailure,
      uptime: this.formatUptime(Date.now() - this.metrics.startTime),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ConnectionManager;