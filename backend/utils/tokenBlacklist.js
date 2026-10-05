// File: vegavruddhi-employee-panel/backend/utils/tokenBlacklist.js

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getRedisClient } = require('./redisClient');

// In-memory blacklist store fallback
const inMemoryBlacklist = new Map();

// Periodic cleanup of expired tokens every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, expMs] of inMemoryBlacklist.entries()) {
    if (now > expMs) {
      inMemoryBlacklist.delete(key);
    }
  }
}, 5 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

function getTokenHash(token) {
  return crypto.createHash('sha256').update(String(token).trim()).digest('hex');
}

/**
 * Invalidate a JWT token until its natural expiration.
 * @param {string} token - The raw JWT token string
 * @returns {Promise<boolean>}
 */
async function blacklistToken(token) {
  if (!token) return false;

  try {
    const cleanToken = token.startsWith('Bearer ') ? token.split(' ')[1] : token;
    const hash = getTokenHash(cleanToken);
    let ttlSeconds = 8 * 3600; // Default 8 hours

    try {
      const decoded = jwt.decode(cleanToken);
      if (decoded && decoded.exp) {
        const remaining = decoded.exp - Math.floor(Date.now() / 1000);
        if (remaining > 0) {
          ttlSeconds = remaining;
        }
      }
    } catch {
      // Use default TTL if decoding fails
    }

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      try {
        await redis.set(`bl:token:${hash}`, '1', 'EX', ttlSeconds);
      } catch (redisErr) {
        // Fall back to in-memory store
      }
    }

    // Always record in in-memory store as well
    inMemoryBlacklist.set(hash, Date.now() + ttlSeconds * 1000);
    return true;
  } catch (err) {
    console.error('Error blacklisting token:', err.message);
    return false;
  }
}

/**
 * Check if a token has been blacklisted / invalidated.
 * @param {string} token - The raw JWT token string
 * @returns {Promise<boolean>}
 */
async function isTokenBlacklisted(token) {
  if (!token) return false;

  try {
    const cleanToken = token.startsWith('Bearer ') ? token.split(' ')[1] : token;
    const hash = getTokenHash(cleanToken);

    // 1. Check in-memory blacklist first (ultra-fast)
    const inMemExp = inMemoryBlacklist.get(hash);
    if (inMemExp) {
      if (Date.now() < inMemExp) {
        return true;
      } else {
        inMemoryBlacklist.delete(hash);
      }
    }

    // 2. Check Redis if available
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      try {
        const exists = await redis.exists(`bl:token:${hash}`);
        if (exists) {
          return true;
        }
      } catch (redisErr) {
        // Continue if Redis check fails
      }
    }

    return false;
  } catch (err) {
    console.error('Error checking token blacklist:', err.message);
    return false;
  }
}

module.exports = {
  blacklistToken,
  isTokenBlacklisted
};
