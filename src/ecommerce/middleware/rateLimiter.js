/**
 * Rate limiter middleware
 * Uses Redis to track and limit API requests by IP or API key
 */
const redis = require('redis');
const { promisify } = require('util');
const { RateLimitError } = require('../utils/error');
const logger = require('../utils/logger');

// Create Redis client
const client = redis.createClient(process.env.REDIS_URL || 'redis://localhost:6379');
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
const incrAsync = promisify(client.incr).bind(client);
const expireAsync = promisify(client.expire).bind(client);

client.on('error', (err) => {
  logger.error('Redis error', { error: err });
});

/**
 * Rate limiter middleware
 * @param {Object} options - Rate limiter options
 * @param {number} options.maxRequests - Maximum number of requests allowed in the window (default: 100)
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 minutes)
 * @param {string} options.keyPrefix - Prefix for Redis keys (default: 'rl')
 * @param {Function} options.keyGenerator - Function to generate a key (default: uses IP)
 * @param {Function} options.handler - Custom handler function for rate limit exceeded (optional)
 */
function rateLimiter(options = {}) {
  const {
    maxRequests = 100,
    windowMs = 15 * 60 * 1000, // 15 minutes by default
    keyPrefix = 'rl',
    keyGenerator = (req) => {
      // Use API key if available, otherwise use IP
      return req.headers['x-api-key'] || req.ip;
    },
    handler
  } = options;

  const windowSeconds = Math.ceil(windowMs / 1000);

  return async (req, res, next) => {
    try {
      // Skip rate limiting in development if configured
      if (process.env.NODE_ENV === 'development' && process.env.SKIP_RATE_LIMIT === 'true') {
        return next();
      }

      const key = `${keyPrefix}:${keyGenerator(req)}`;

      // Get current count for this key
      let current = await getAsync(key);
      
      // If key doesn't exist, create it
      if (!current) {
        await setAsync(key, 1);
        await expireAsync(key, windowSeconds);
        
        // Set rate limit headers
        res.set('X-RateLimit-Limit', maxRequests);
        res.set('X-RateLimit-Remaining', maxRequests - 1);
        res.set('X-RateLimit-Reset', Date.now() + windowMs);
        
        return next();
      }
      
      // Increment the counter
      current = await incrAsync(key);
      
      // Set rate limit headers
      res.set('X-RateLimit-Limit', maxRequests);
      res.set('X-RateLimit-Remaining', Math.max(0, maxRequests - current));
      
      // Check if limit exceeded
      if (current > maxRequests) {
        if (handler) {
          return handler(req, res, next);
        }
        
        // Default rate limit exceeded handler
        const error = new RateLimitError('Too many requests, please try again later.');
        return next(error);
      }
      
      next();
    } catch (error) {
      logger.error('Rate limiter error', { error: error.message });
      // If rate limiter fails, allow the request to continue
      next();
    }
  };
}

module.exports = rateLimiter;