// src/middlewares/apiKeyAuth.js
import apiKeyService from "../services/apiKeyService.js";
import apiRateLimiter from "../services/apiRateLimiter.js";
import apiUsageService from "../services/apiUsageService.js";
import logger from "../utils/logger.js";

const RATE_LIMIT = 2000;

/**
 * Middleware to authenticate requests using an API key.
 *
 * Expects: `Authorization: Bearer sk_live_xxxxx`
 * Attaches: `req.apiKey` (ApiKey document), `req.agentId` (ObjectId string)
 */
export const authenticateApiKey = async (req, res, next) => {
  const start = Date.now();

  try {
    const header = req.header("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: "MISSING_AUTH",
        message: "Missing or invalid Authorization header. Use: Bearer sk_live_...",
        hint: "Include your API key in the Authorization header: Authorization: Bearer sk_live_YOUR_KEY",
      });
    }

    const rawKey = header.replace("Bearer ", "").trim();
    if (!rawKey) {
      return res.status(401).json({
        success: false,
        code: "MISSING_AUTH",
        message: "Missing API key",
        hint: "The Authorization header must contain a valid API key after 'Bearer '",
      });
    }

    const apiKey = await apiKeyService.validateKey(rawKey);
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        code: "INVALID_KEY",
        message: "Invalid or expired API key",
        hint: "Generate a new API key from your dashboard",
      });
    }

    if (apiKey.status === "revoked") {
      return res.status(401).json({
        success: false,
        code: "KEY_REVOKED",
        message: "API key has been revoked",
        hint: "Create a new API key in your dashboard",
      });
    }

    if (apiKey.status === "suspended") {
      return res.status(401).json({
        success: false,
        code: "KEY_SUSPENDED",
        message: "API key has been suspended",
        hint: "Contact support to resolve this issue",
      });
    }

    if (apiKey.status !== "active") {
      return res.status(401).json({
        success: false,
        code: "INVALID_KEY",
        message: `API key status is '${apiKey.status}'`,
        hint: "Check your API key status in the dashboard",
      });
    }

    // Check IP whitelist if configured
    if (apiKey.allowedIps && apiKey.allowedIps.length > 0) {
      const clientIp = req.ip || req.connection?.remoteAddress || "";
      const isAllowed = apiKey.allowedIps.some(
        (allowedIp) => clientIp === allowedIp || clientIp.startsWith(allowedIp),
      );
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          code: "IP_NOT_ALLOWED",
          message: "Request from this IP address is not allowed for this API key",
          hint: "The API key has IP restrictions configured. Contact support to update the allowed IPs.",
        });
      }
    }

    const effectiveLimit = apiKey.rateLimitOverride || RATE_LIMIT;

    const rateLimitResult = await apiRateLimiter.checkRateLimit(
      apiKey._id.toString(),
      effectiveLimit,
    );

    if (!rateLimitResult.allowed) {
      logger.warn(`Rate limit exceeded for key ${apiKey.keyPrefix}...`);
      const retryAfter = Math.ceil((rateLimitResult.resetAt - new Date()) / 1000);
      res.set("Retry-After", retryAfter.toString());
      return res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        message: "Rate limit exceeded. Try again later.",
        hint: `Wait ${retryAfter} seconds before making another request`,
        retryAfter: rateLimitResult.resetAt,
      });
    }

    res.set("X-RateLimit-Limit", effectiveLimit.toString());
    res.set("X-RateLimit-Remaining", rateLimitResult.remaining.toString());
    res.set("X-RateLimit-Reset", Math.floor(rateLimitResult.resetAt.getTime() / 1000).toString());

    req.apiKey = apiKey;
    req.agentId = apiKey.agentId.toString();

    apiKeyService.touchKey(apiKey._id).catch((err) => {
      logger.warn(`Failed to touch key ${apiKey.keyPrefix}: ${err.message}`);
    });

    const responseTimeMs = Date.now() - start;
    // Defer logging until after response is sent so statusCode is correct
    const log = () => {
      apiUsageService.logRequest({
        apiKeyId: apiKey._id,
        agentId: apiKey.agentId,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        responseTimeMs,
        ip: req.ip || req.connection?.remoteAddress || "",
        userAgent: req.headers?.["user-agent"] || "",
      }).catch((err) => {
        logger.warn(`Failed to log API usage: ${err.message}`);
      });
    };
    if (typeof res.on === "function") {
      res.on("finish", log);
    } else {
      // Fallback: log immediately (statusCode may be default 200)
      log();
    }

    next();
  } catch (err) {
    logger.error(`[apiKeyAuth] Unexpected error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: "Internal server error during API key authentication",
    });
  }
};

/**
 * Middleware to check that the authenticated API key has a specific permission scope.
 */
export const requirePermission = (...scopes) => {
  return (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({
        success: false,
        code: "MISSING_AUTH",
        message: "Authentication required",
      });
    }

    const hasAll = scopes.every((scope) => req.apiKey.permissions.includes(scope));
    if (!hasAll) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN_SCOPE",
        message: `API key does not have required permission: ${scopes.join(", ")}`,
        hint: `This endpoint requires: ${scopes.join(", ")}`,
      });
    }

    next();
  };
};
