const Redis = require('ioredis');

let redis = null;

/**
 * Get Redis client instance (singleton)
 * @returns {Redis|null} Redis client or null if not available
 */
function getRedisClient() {
  if (!redis && process.env.REDIS_URL) {
    try {
      redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        // Removed lazyConnect to allow immediate connection
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      });

      redis.on('error', (err) => {
        console.error('❌ Redis connection error:', err.message);
      });

      redis.on('connect', () => {
        console.log('✅ Redis connected successfully');
      });

      redis.on('ready', () => {
        console.log('✅ Redis ready to accept commands');
      });

      redis.on('close', () => {
        console.warn('⚠️ Redis connection closed');
      });

      redis.on('reconnecting', () => {
        console.log('🔄 Redis reconnecting...');
      });
    } catch (err) {
      console.error('❌ Redis client creation failed:', err.message);
      return null;
    }
  }
  return redis;
}

module.exports = { getRedisClient };
