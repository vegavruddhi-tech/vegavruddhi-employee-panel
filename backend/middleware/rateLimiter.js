// File: vegavruddhi-employee-panel/backend/middleware/rateLimiter.js

const { getRedisClient } = require('../utils/redisClient');

/**
 * Creates a rate-limiting Express middleware.
 * Supports Redis when available, with automatic in-memory fallback.
 */
function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 10,
  message = 'Too many requests from this IP. Please try again after 15 minutes.',
  keyPrefix = 'rl'
}) {
  const inMemoryStore = new Map();

  // Periodic cleanup of expired records every 5 minutes
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of inMemoryStore.entries()) {
      if (now > data.resetTime) {
        inMemoryStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  return async function rateLimiter(req, res, next) {
    if (req.method === 'OPTIONS') return next();

    // Determine client IP safely
    const clientIp = (
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      req.ip ||
      '127.0.0.1'
    );

    const key = `${keyPrefix}:${clientIp}`;
    const redis = getRedisClient();

    // Attempt Redis rate limiting if client is connected and ready
    if (redis && redis.status === 'ready') {
      try {
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.pexpire(key, windowMs);
        }

        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

        if (count > max) {
          const ttl = await redis.pttl(key);
          const retryAfterSec = Math.max(1, Math.ceil(ttl / 1000));
          res.setHeader('Retry-After', retryAfterSec);
          return res.status(429).json({
            success: false,
            message,
            retryAfterSeconds: retryAfterSec
          });
        }

        return next();
      } catch (redisErr) {
        // Silently fall back to in-memory store if Redis fails
      }
    }

    // In-memory fallback
    const now = Date.now();
    let record = inMemoryStore.get(key);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      inMemoryStore.set(key, record);
    } else {
      record.count += 1;
    }

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));

    if (record.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        success: false,
        message,
        retryAfterSeconds: retryAfterSec
      });
    }

    next();
  };
}

// 10 login attempts per 15 minutes
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
  keyPrefix: 'rl:login'
});

// 5 registration requests per 15 minutes (protects database & Cloudinary storage from spam)
const registerLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many registration requests from this IP. Please try again after 15 minutes.',
  keyPrefix: 'rl:register'
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  registerLimiter
};
