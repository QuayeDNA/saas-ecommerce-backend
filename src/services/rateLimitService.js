import redisService from "./redisService.js";
import logger from "../utils/logger.js";

/**
 * Redis-based Rate Limiting Service
 * Provides distributed rate limiting with Redis backend
 */
class RateLimitService {
  constructor() {
    this.defaultLimits = {
      // General API limits
      general: { windowMs: 15 * 60 * 1000, max: 1000 }, // 1000 requests per 15 minutes

      // Authentication endpoints
      auth: { windowMs: 15 * 60 * 1000, max: 10 }, // 10 requests per 15 minutes

      // High-frequency endpoints (orders, wallet)
      highFrequency: { windowMs: 1 * 60 * 1000, max: 60 }, // 60 requests per minute

      // Medium-frequency endpoints (user management, analytics)
      mediumFrequency: { windowMs: 1 * 60 * 1000, max: 120 }, // 120 requests per minute

      // Low-frequency endpoints (settings, admin operations)
      lowFrequency: { windowMs: 15 * 60 * 1000, max: 30 }, // 30 requests per 15 minutes

      // Burst protection
      burst: { windowMs: 1000, max: 5 }, // 5 requests per second
    };
  }

  /**
   * Check if request should be rate limited
   * @param {string} key - Unique identifier (user ID, IP, etc.)
   * @param {string} limitType - Type of limit to apply
   * @returns {Promise<Object>} Rate limit result
   */
  async checkLimit(key, limitType = "general") {
    try {
      const limit = this.defaultLimits[limitType] || this.defaultLimits.general;
      const cacheKey = `ratelimit:${limitType}:${key}`;

      // Get current request count
      const currentCount = (await redisService.get(cacheKey)) || 0;

      // Check if limit exceeded
      if (parseInt(currentCount) >= limit.max) {
        const ttl = await redisService.ttl(cacheKey);
        return {
          limited: true,
          remaining: 0,
          resetTime: Date.now() + ttl * 1000,
          retryAfter: Math.ceil(ttl / 60) + " minutes",
        };
      }

      // Increment counter
      const newCount = await redisService.incr(cacheKey);

      // Set expiration if this is the first request in the window
      if (newCount === 1) {
        await redisService.expire(cacheKey, Math.ceil(limit.windowMs / 1000));
      }

      const remaining = Math.max(0, limit.max - newCount);
      const ttl = await redisService.ttl(cacheKey);

      return {
        limited: false,
        remaining,
        resetTime: Date.now() + ttl * 1000,
        retryAfter: null,
      };
    } catch (error) {
      logger.error(`Rate limit check error: ${error.message}`);
      // Allow request on error to avoid blocking legitimate traffic
      return {
        limited: false,
        remaining: 999,
        resetTime: Date.now() + 15 * 60 * 1000,
        retryAfter: null,
      };
    }
  }

  /**
   * Check rate limit for user-based requests
   * @param {string} userId - User ID
   * @param {string} endpoint - API endpoint
   * @returns {Promise<Object>} Rate limit result
   */
  async checkUserLimit(userId, endpoint = "general") {
    const key = `user:${userId}`;
    return this.checkLimit(key, this.getEndpointLimitType(endpoint));
  }

  /**
   * Check rate limit for IP-based requests
   * @param {string} ip - IP address
   * @param {string} endpoint - API endpoint
   * @returns {Promise<Object>} Rate limit result
   */
  async checkIPLimit(ip, endpoint = "general") {
    const key = `ip:${ip}`;
    return this.checkLimit(key, this.getEndpointLimitType(endpoint));
  }

  /**
   * Check rate limit for combined user and IP
   * @param {string} userId - User ID
   * @param {string} ip - IP address
   * @param {string} endpoint - API endpoint
   * @returns {Promise<Object>} Rate limit result
   */
  async checkCombinedLimit(userId, ip, endpoint = "general") {
    const userKey = `user:${userId}`;
    const ipKey = `ip:${ip}`;

    const [userResult, ipResult] = await Promise.all([
      this.checkLimit(userKey, this.getEndpointLimitType(endpoint)),
      this.checkLimit(ipKey, this.getEndpointLimitType(endpoint)),
    ]);

    // Return the more restrictive limit
    if (userResult.limited || ipResult.limited) {
      return userResult.limited ? userResult : ipResult;
    }

    return {
      limited: false,
      remaining: Math.min(userResult.remaining, ipResult.remaining),
      resetTime: Math.min(userResult.resetTime, ipResult.resetTime),
      retryAfter: null,
    };
  }

  /**
   * Get endpoint limit type based on endpoint pattern
   * @param {string} endpoint - API endpoint
   * @returns {string} Limit type
   */
  getEndpointLimitType(endpoint) {
    // Authentication endpoints
    if (
      endpoint.includes("/auth/") ||
      endpoint.includes("/login") ||
      endpoint.includes("/register")
    ) {
      return "auth";
    }

    // High-frequency endpoints
    if (endpoint.includes("/orders") && !endpoint.includes("/analytics")) {
      return "highFrequency";
    }

    // Wallet operations
    if (endpoint.includes("/wallet/") || endpoint.includes("/payment/")) {
      return "highFrequency";
    }

    // Analytics endpoints
    if (endpoint.includes("/analytics")) {
      return "mediumFrequency";
    }

    // Admin/settings endpoints
    if (endpoint.includes("/admin/") || endpoint.includes("/settings/")) {
      return "lowFrequency";
    }

    // User management
    if (
      endpoint.includes("/users/") &&
      (endpoint.includes("/update") || endpoint.includes("/delete"))
    ) {
      return "lowFrequency";
    }

    return "general";
  }

  /**
   * Reset rate limit for a specific key
   * @param {string} key - Rate limit key
   * @param {string} limitType - Type of limit
   */
  async resetLimit(key, limitType = "general") {
    try {
      const cacheKey = `ratelimit:${limitType}:${key}`;
      await redisService.del([cacheKey]);
      logger.debug(`Rate limit reset for key: ${key}, type: ${limitType}`);
    } catch (error) {
      logger.error(`Failed to reset rate limit: ${error.message}`);
    }
  }

  /**
   * Get rate limit status for a key
   * @param {string} key - Rate limit key
   * @param {string} limitType - Type of limit
   * @returns {Promise<Object>} Current rate limit status
   */
  async getLimitStatus(key, limitType = "general") {
    try {
      const limit = this.defaultLimits[limitType] || this.defaultLimits.general;
      const cacheKey = `ratelimit:${limitType}:${key}`;

      const currentCount = (await redisService.get(cacheKey)) || 0;
      const ttl = await redisService.ttl(cacheKey);

      return {
        current: parseInt(currentCount),
        max: limit.max,
        remaining: Math.max(0, limit.max - parseInt(currentCount)),
        resetTime: Date.now() + ttl * 1000,
        windowMs: limit.windowMs,
      };
    } catch (error) {
      logger.error(`Failed to get rate limit status: ${error.message}`);
      return null;
    }
  }

  /**
   * Clean up expired rate limit keys
   * Note: Redis automatically expires keys, but this can be used for manual cleanup
   */
  async cleanupExpiredKeys() {
    try {
      // Get all rate limit keys
      const keys = await redisService.keys("ratelimit:*");

      if (keys.length === 0) {
        return;
      }

      // Check TTL for each key and delete if expired
      const expiredKeys = [];
      for (const key of keys) {
        const ttl = await redisService.ttl(key);
        if (ttl === -2) {
          // Key doesn't exist
          expiredKeys.push(key);
        }
      }

      if (expiredKeys.length > 0) {
        await redisService.del(expiredKeys);
        logger.debug(
          `Cleaned up ${expiredKeys.length} expired rate limit keys`
        );
      }
    } catch (error) {
      logger.error(
        `Failed to cleanup expired rate limit keys: ${error.message}`
      );
    }
  }
}

export default new RateLimitService();
