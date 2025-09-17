import rateLimitService from "../services/rateLimitService.js";
import logger from "../utils/logger.js";

/**
 * Redis-based Rate Limiting Middleware
 * Provides distributed rate limiting using Redis backend
 */

/**
 * General rate limiting middleware
 * @param {string} limitType - Type of rate limit to apply
 * @returns {Function} Express middleware function
 */
export const redisRateLimit = (limitType = "general") => {
  return async (req, res, next) => {
    try {
      // Skip rate limiting for super admins
      if (req.user?.userType === "super_admin") {
        return next();
      }

      // Determine the key for rate limiting
      const key = req.user?.id || req.ip || "anonymous";
      const endpoint = req.originalUrl || req.url;

      // Check rate limit
      const result = await rateLimitService.checkCombinedLimit(
        req.user?.id,
        req.ip,
        endpoint
      );

      // Set rate limit headers
      res.set({
        "X-RateLimit-Limit": result.remaining + (result.limited ? 0 : 1),
        "X-RateLimit-Remaining": Math.max(0, result.remaining - 1),
        "X-RateLimit-Reset": new Date(result.resetTime).toISOString(),
        "X-RateLimit-Window": Math.ceil((result.resetTime - Date.now()) / 1000),
      });

      if (result.limited) {
        logger.warn(`Rate limit exceeded for ${key} on ${endpoint}`);

        return res.status(429).json({
          error: "Too many requests",
          message: "You have exceeded the rate limit. Please try again later.",
          retryAfter: result.retryAfter,
          resetTime: new Date(result.resetTime).toISOString(),
        });
      }

      // Add rate limit info to request for logging/debugging
      req.rateLimit = {
        remaining: result.remaining,
        resetTime: result.resetTime,
        limited: false,
      };

      next();
    } catch (error) {
      logger.error(`Rate limiting middleware error: ${error.message}`);
      // Allow request to proceed on error to avoid blocking legitimate traffic
      next();
    }
  };
};

/**
 * User-specific rate limiting middleware
 * @param {Object} options - Rate limiting options
 * @returns {Function} Express middleware function
 */
export const userRateLimit = (options = {}) => {
  const { skipSuccessful = false } = options;

  return async (req, res, next) => {
    try {
      // Skip if no user is authenticated
      if (!req.user?.id) {
        return next();
      }

      // Skip rate limiting for super admins
      if (req.user.userType === "super_admin") {
        return next();
      }

      const endpoint = req.originalUrl || req.url;
      const result = await rateLimitService.checkUserLimit(
        req.user.id,
        endpoint
      );

      // Set rate limit headers
      res.set({
        "X-RateLimit-Limit": result.remaining + (result.limited ? 0 : 1),
        "X-RateLimit-Remaining": Math.max(0, result.remaining - 1),
        "X-RateLimit-Reset": new Date(result.resetTime).toISOString(),
      });

      if (result.limited) {
        logger.warn(
          `User rate limit exceeded for user ${req.user.id} on ${endpoint}`
        );

        return res.status(429).json({
          error: "Too many requests",
          message:
            "You have exceeded the user rate limit. Please try again later.",
          retryAfter: result.retryAfter,
          resetTime: new Date(result.resetTime).toISOString(),
        });
      }

      // Skip successful requests if configured
      if (skipSuccessful) {
        res.on("finish", () => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            // Request was successful, we could potentially refund the rate limit here
            // For now, just log it
            logger.debug(
              `Successful request for user ${req.user.id}, could refund rate limit`
            );
          }
        });
      }

      req.rateLimit = {
        remaining: result.remaining,
        resetTime: result.resetTime,
        limited: false,
      };

      next();
    } catch (error) {
      logger.error(`User rate limiting middleware error: ${error.message}`);
      next();
    }
  };
};

/**
 * IP-based rate limiting middleware
 * @param {Object} options - Rate limiting options
 * @returns {Function} Express middleware function
 */
export const ipRateLimit = (options = {}) => {
  // Options available for future extension
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.connection.remoteAddress || "unknown";
      const endpoint = req.originalUrl || req.url;

      const result = await rateLimitService.checkIPLimit(ip, endpoint);

      // Set rate limit headers
      res.set({
        "X-RateLimit-Limit": result.remaining + (result.limited ? 0 : 1),
        "X-RateLimit-Remaining": Math.max(0, result.remaining - 1),
        "X-RateLimit-Reset": new Date(result.resetTime).toISOString(),
      });

      if (result.limited) {
        logger.warn(`IP rate limit exceeded for ${ip} on ${endpoint}`);

        return res.status(429).json({
          error: "Too many requests",
          message:
            "Too many requests from this IP address. Please try again later.",
          retryAfter: result.retryAfter,
          resetTime: new Date(result.resetTime).toISOString(),
        });
      }

      req.rateLimit = {
        remaining: result.remaining,
        resetTime: result.resetTime,
        limited: false,
      };

      next();
    } catch (error) {
      logger.error(`IP rate limiting middleware error: ${error.message}`);
      next();
    }
  };
};

/**
 * Burst protection middleware for sensitive endpoints
 * @returns {Function} Express middleware function
 */
export const burstProtection = () => {
  return async (req, res, next) => {
    try {
      // Skip for super admins
      if (req.user?.userType === "super_admin") {
        return next();
      }

      const key = req.user?.id || req.ip || "anonymous";
      const result = await rateLimitService.checkLimit(key, "burst");

      if (result.limited) {
        logger.warn(`Burst protection triggered for ${key}`);

        return res.status(429).json({
          error: "Request rate too high",
          message: "Please slow down your requests.",
          retryAfter: "1 second",
        });
      }

      next();
    } catch (error) {
      logger.error(`Burst protection middleware error: ${error.message}`);
      next();
    }
  };
};

/**
 * Get rate limit status for current request
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} Rate limit status
 */
export const getRateLimitStatus = async (req) => {
  try {
    const key = req.user?.id || req.ip || "anonymous";
    const endpoint = req.originalUrl || req.url;
    const limitType = rateLimitService.getEndpointLimitType(endpoint);

    return await rateLimitService.getLimitStatus(key, limitType);
  } catch (error) {
    logger.error(`Failed to get rate limit status: ${error.message}`);
    return null;
  }
};

export default {
  redisRateLimit,
  userRateLimit,
  ipRateLimit,
  burstProtection,
  getRateLimitStatus,
};
