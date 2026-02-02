// src/middlewares/storefrontRateLimit.js
import mongoose from 'mongoose';

// In-memory store for rate limiting (in production, use Redis)
const rateLimitStore = new Map();

class StorefrontRateLimiter {
  constructor() {
    // Clean up expired entries every 5 minutes
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Check if request should be rate limited
   * @param {string} identifier - IP address or identifier
   * @param {string} storefrontId - Storefront ID
   * @param {number} windowMs - Time window in milliseconds
   * @param {number} maxRequests - Maximum requests per window
   * @returns {boolean} - True if rate limited
   */
  isRateLimited(identifier, storefrontId, windowMs = 60 * 1000, maxRequests = 10) {
    const key = `${storefrontId}:${identifier}`;
    const now = Date.now();

    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, {
        requests: [],
        windowMs,
        maxRequests
      });
    }

    const limitData = rateLimitStore.get(key);

    // Remove expired requests
    limitData.requests = limitData.requests.filter(
      timestamp => now - timestamp < windowMs
    );

    // Check if limit exceeded
    if (limitData.requests.length >= maxRequests) {
      return true;
    }

    // Add current request
    limitData.requests.push(now);
    return false;
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, data] of rateLimitStore.entries()) {
      data.requests = data.requests.filter(
        timestamp => now - timestamp < data.windowMs
      );

      // Remove empty entries
      if (data.requests.length === 0) {
        rateLimitStore.delete(key);
      }
    }
  }

  /**
   * Get remaining requests for an identifier
   */
  getRemainingRequests(identifier, storefrontId, windowMs = 60 * 1000, maxRequests = 10) {
    const key = `${storefrontId}:${identifier}`;
    const limitData = rateLimitStore.get(key);

    if (!limitData) {
      return maxRequests;
    }

    const now = Date.now();
    const validRequests = limitData.requests.filter(
      timestamp => now - timestamp < windowMs
    );

    return Math.max(0, maxRequests - validRequests.length);
  }
}

const rateLimiter = new StorefrontRateLimiter();

/**
 * Rate limiting middleware for storefront endpoints
 */
export const storefrontRateLimit = (options = {}) => {
  const {
    windowMs = 60 * 1000, // 1 minute
    maxRequests = 10, // 10 requests per minute
    message = 'Too many requests, please try again later.',
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return async (req, res, next) => {
    try {
      // Get storefront ID from params or body
      let storefrontId = req.params.storefrontId || req.params.businessName;

      // If business name, resolve to storefront ID
      if (storefrontId && !mongoose.Types.ObjectId.isValid(storefrontId)) {
        try {
          const storefront = await mongoose.model('AgentStorefront').findOne({
            businessName: storefrontId.toLowerCase(),
            isActive: true
          });
          storefrontId = storefront?._id?.toString();
        } catch (error) {
          // Continue without storefront-specific limiting
        }
      }

      // Get client identifier (IP address)
      const identifier = req.ip || req.connection.remoteAddress || 'unknown';

      // Check rate limit
      const isLimited = rateLimiter.isRateLimited(
        identifier,
        storefrontId || 'global',
        windowMs,
        maxRequests
      );

      if (isLimited) {
        const remaining = rateLimiter.getRemainingRequests(
          identifier,
          storefrontId || 'global',
          windowMs,
          maxRequests
        );

        return res.status(429).json({
          success: false,
          message,
          data: {
            retryAfter: Math.ceil(windowMs / 1000),
            remainingRequests: remaining
          }
        });
      }

      // Add rate limit info to response headers
      const remaining = rateLimiter.getRemainingRequests(
        identifier,
        storefrontId || 'global',
        windowMs,
        maxRequests
      );

      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': remaining,
        'X-RateLimit-Reset': new Date(Date.now() + windowMs).toISOString()
      });

      // Continue to next middleware
      next();

    } catch (error) {
      console.error('Rate limiting error:', error);
      // Don't block requests due to rate limiting errors
      next();
    }
  };
};

/**
 * Stricter rate limiting for order creation
 */
export const storefrontOrderRateLimit = storefrontRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 3, // 3 orders per 15 minutes
  message: 'Order creation limit exceeded. Please try again later.'
});

/**
 * Rate limiting for file uploads
 */
export const storefrontUploadRateLimit = storefrontRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 5, // 5 uploads per hour
  message: 'Upload limit exceeded. Please try again later.'
});

export default rateLimiter;