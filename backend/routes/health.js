/**
 * Health Check Routes
 * 
 * Provides comprehensive health monitoring for the application and database
 * 
 * Endpoints:
 * - GET /health - Basic health check
 * - GET /health/detailed - Detailed health information
 * - GET /health/metrics - Connection metrics
 * - POST /health/reset-metrics - Reset metrics (development only)
 */

const express = require('express');
const router = express.Router();

module.exports = (connectionManager) => {
  /**
   * Basic health check endpoint
   * Returns simple status for load balancers
   */
  router.get('/', async (req, res) => {
    try {
      const isHealthy = connectionManager.isConnected();
      const status = connectionManager.getStatus();
      
      if (isHealthy) {
        res.status(200).json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: status.uptime,
          database: 'connected'
        });
      } else {
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          uptime: status.uptime,
          database: 'disconnected',
          reason: status.circuitOpen ? 'Circuit breaker open' : 'Database not ready'
        });
      }
    } catch (error) {
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      });
    }
  });

  /**
   * Detailed health check endpoint
   * Returns comprehensive health information
   */
  router.get('/detailed', async (req, res) => {
    try {
      // Perform active health check
      const healthCheck = await connectionManager.performHealthCheck();
      const status = connectionManager.getStatus();
      const metrics = connectionManager.getMetrics();
      
      const response = {
        timestamp: new Date().toISOString(),
        
        // Overall status
        status: status.status,
        healthy: healthCheck.healthy,
        
        // Database information
        database: {
          connected: status.ready,
          healthy: healthCheck.healthy,
          responseTime: healthCheck.responseTime || null,
          lastHealthCheck: metrics.lastHealthCheck,
          error: healthCheck.error || null
        },
        
        // Connection manager status
        connectionManager: {
          initialized: status.initialized,
          ready: status.ready,
          circuitOpen: status.circuitOpen,
          failureCount: status.failureCount,
          lastFailure: status.lastFailure
        },
        
        // Performance metrics
        performance: {
          totalRequests: metrics.totalRequests,
          successfulRequests: metrics.successfulRequests,
          failedRequests: metrics.failedRequests,
          successRate: metrics.successRate,
          averageResponseTime: metrics.averageResponseTime
        },
        
        // System information
        system: {
          uptime: status.uptime,
          environment: metrics.environment,
          nodeVersion: process.version,
          platform: process.platform,
          memoryUsage: process.memoryUsage(),
          pid: process.pid
        }
      };
      
      // Set appropriate status code
      const statusCode = healthCheck.healthy ? 200 : 503;
      res.status(statusCode).json(response);
      
    } catch (error) {
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  /**
   * Connection metrics endpoint
   * Returns detailed connection and performance metrics
   */
  router.get('/metrics', (req, res) => {
    try {
      const metrics = connectionManager.getMetrics();
      const status = connectionManager.getStatus();
      
      res.json({
        timestamp: new Date().toISOString(),
        
        // Connection metrics
        connection: {
          status: status.status,
          ready: status.ready,
          initialized: status.initialized,
          uptime: metrics.uptimeFormatted,
          connectionAttempts: metrics.connectionAttempts
        },
        
        // Request metrics
        requests: {
          total: metrics.totalRequests,
          successful: metrics.successfulRequests,
          failed: metrics.failedRequests,
          successRate: `${metrics.successRate}%`,
          averageResponseTime: `${metrics.averageResponseTime}ms`,
          lastRequest: metrics.lastRequestTime
        },
        
        // Circuit breaker metrics
        circuitBreaker: {
          open: status.circuitOpen,
          failureCount: status.failureCount,
          lastFailure: status.lastFailure,
          timeout: `${metrics.circuitTimeout / 1000}s`
        },
        
        // Health monitoring
        health: {
          lastCheck: metrics.lastHealthCheck,
          checkInterval: `${connectionManager.options.healthCheckInterval / 1000}s`
        },
        
        // Environment info
        environment: {
          nodeEnv: metrics.environment,
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid
        }
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      });
    }
  });

  /**
   * Reset metrics endpoint (development only)
   * Resets all performance metrics
   */
  router.post('/reset-metrics', (req, res) => {
    try {
      // Only allow in development environment
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          error: 'Metrics reset not allowed in production',
          timestamp: new Date().toISOString()
        });
      }
      
      connectionManager.resetMetrics();
      
      res.json({
        status: 'success',
        message: 'Metrics reset successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * Database ping endpoint
   * Performs a direct database ping test
   */
  router.get('/ping', async (req, res) => {
    try {
      const startTime = Date.now();
      const healthCheck = await connectionManager.performHealthCheck();
      const responseTime = Date.now() - startTime;
      
      if (healthCheck.healthy) {
        res.json({
          status: 'success',
          message: 'Database ping successful',
          responseTime: `${responseTime}ms`,
          dbResponseTime: `${healthCheck.responseTime}ms`,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(503).json({
          status: 'failed',
          message: 'Database ping failed',
          error: healthCheck.error,
          responseTime: `${responseTime}ms`,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: 'Ping test failed',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
};