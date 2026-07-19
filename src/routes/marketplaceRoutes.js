// src/routes/marketplaceRoutes.js
import express from "express";
import { body, param } from "express-validator";
import controller from "../controllers/marketplaceController.js";
import { authenticateApiKey, requirePermission } from "../middlewares/apiKeyAuth.js";
import { authenticate, authorizeBusinessUser } from "../middlewares/auth.js";
import ApiKey from "../models/ApiKey.js";

const router = express.Router();

const API_KEY_PREFIXES = [ApiKey.API_KEY_PREFIX, "bl_live_"];

/**
 * Accepts either an API key (sk_live_* or legacy bl_live_*) or a session JWT.
 * - API key → authenticateApiKey (sets req.agentId, req.apiKey)
 * - Session JWT → authenticate + authorizeBusinessUser + maps req.user.userId to req.agentId
 */
const authenticateMarketplaceUser = (req, res, next) => {
  const header = req.header("Authorization");

  if (header && header.startsWith("Bearer ")) {
    const token = header.replace("Bearer ", "").trim();
    if (API_KEY_PREFIXES.some((p) => token.startsWith(p))) {
      return authenticateApiKey(req, res, next);
    }
  }

  authenticate(req, res, (err) => {
    if (err) return next(err);
    if (res.headersSent) return;
    req.agentId = req.user.userId;
    authorizeBusinessUser(req, res, next);
  });
};

/**
 * Checks permissions only when an API key is in use.
 * Session-authenticated requests (dashboard) skip permission checks
 * since the user is already authorized as a business user.
 */
const requirePermissionIfApiKey = (...scopes) => (req, res, next) => {
  if (!req.apiKey) return next();
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

// ─── API Metadata (no auth — describes the API) ─────────────────────────────

router.get("/", controller.getApiMetadata);

// ─── Consumer API Endpoints (API key or session JWT) ────────────────────────

router.post(
  "/orders",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("orders:write"),
  controller.createOrder,
);

router.get(
  "/orders",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("orders:read"),
  controller.getOrders,
);

router.get(
  "/orders/:id",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("orders:read"),
  controller.getOrderById,
);

router.get(
  "/packages",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("packages:read"),
  controller.getPackages,
);

router.get(
  "/packages/:id",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("packages:read"),
  controller.getPackageById,
);

router.get(
  "/bundles",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("bundles:read"),
  controller.getBundles,
);

router.get(
  "/bundles/:id",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("bundles:read"),
  controller.getBundleById,
);

router.get(
  "/storefront",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("storefront:read"),
  controller.getStorefront,
);

// ─── API Key Management (API key or session auth) ────────────────────────────

router.post("/keys", authenticateMarketplaceUser, controller.createKey);
router.get("/keys", authenticateMarketplaceUser, controller.listKeys);
router.get("/keys/:id", authenticateMarketplaceUser, controller.getKey);
router.patch("/keys/:id", authenticateMarketplaceUser, controller.updateKeyLabel);
router.post("/keys/:id/revoke", authenticateMarketplaceUser, controller.revokeKey);
router.post("/keys/:id/suspend", authenticateMarketplaceUser, controller.suspendKey);
router.post("/keys/:id/activate", authenticateMarketplaceUser, controller.activateKey);
router.post("/keys/:id/regenerate", authenticateMarketplaceUser, controller.regenerateKey);
router.patch("/keys/:id/expiry", authenticateMarketplaceUser, controller.setKeyExpiration);
router.patch("/keys/:id/permissions", authenticateMarketplaceUser, controller.updateKeyPermissions);

// ─── Usage Analytics (API key or session auth) ───────────────────────────────

router.get("/usage/stats", authenticateMarketplaceUser, controller.getUsageStats);
router.get("/usage/logs", authenticateMarketplaceUser, controller.getUsageLogs);
router.get("/usage/daily-counts", authenticateMarketplaceUser, controller.getAgentDailyCounts);
router.get("/usage/per-key", authenticateMarketplaceUser, controller.getPerKeyStats);

// ─── Wallet Endpoints (API key or session JWT) ───────────────────────────────

router.get(
  "/wallet/balance",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("wallet:read"),
  controller.getWalletBalance,
);

router.post(
  "/wallet/topup",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("wallet:topup"),
  controller.initiateTopup,
);

router.get(
  "/wallet/topup/:reference",
  authenticateMarketplaceUser,
  requirePermissionIfApiKey("wallet:read"),
  controller.getTopupStatus,
);

export default router;
