import rateLimit from 'express-rate-limit';

// User-based rate limiting (requires authentication)
export const createUserRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 1000, // requests per window
    message = 'Too many requests for this user',
    skipSuccessfulRequests = false
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      retryAfter: Math.ceil(windowMs / 1000 / 60) + ' minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise fall back to IP
      return req.user?.id || req.ip;
    },
    skip: (req) => {
      // Skip rate limiting for super admins
      return req.user?.userType === 'super_admin';
    }
  });
};

// API endpoint specific rate limiting
export const apiEndpointLimits = {
  // High-frequency endpoints (like order creation, wallet operations)
  highFrequency: rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: {
      error: 'Too many requests to this endpoint',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    skip: (req) => req.user?.userType === 'super_admin'
  }),

  // Medium-frequency endpoints (like fetching orders, user management)
  mediumFrequency: rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 120, // 120 requests per minute
    message: {
      error: 'Too many requests to this endpoint',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    skip: (req) => req.user?.userType === 'super_admin'
  }),

  // Low-frequency endpoints (like authentication, sensitive operations)
  lowFrequency: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per 15 minutes
    message: {
      error: 'Too many requests to this sensitive endpoint',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip
  })
};

// Burst protection for very sensitive endpoints
export const burstProtection = rateLimit({
  windowMs: 1000, // 1 second
  max: 5, // 5 requests per second
  message: {
    error: 'Request rate too high, please slow down',
    retryAfter: '1 second'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  skip: (req) => req.user?.userType === 'super_admin'
});
