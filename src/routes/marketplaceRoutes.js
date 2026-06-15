// src/routes/marketplaceRoutes.js
import express from "express";
import { body, param } from "express-validator";
import controller from "../controllers/marketplaceController.js";
import { authenticateApiKey, requirePermission } from "../middlewares/apiKeyAuth.js";
import { authenticate, authorizeBusinessUser } from "../middlewares/auth.js";

const router = express.Router();

/**
 * Accepts either an API key (bl_live_*) or a session JWT.
 * - API key → authenticateApiKey (sets req.agentId, req.apiKey) — implicitly authorized
 * - Session JWT → authenticate + authorizeBusinessUser + maps req.user.userId to req.agentId
 */
const authenticateMarketplaceUser = (req, res, next) => {
  const header = req.header("Authorization");

  if (header && header.startsWith("Bearer ")) {
    const token = header.replace("Bearer ", "").trim();
    if (token.startsWith("bl_live_")) {
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

// ─── API Metadata (no auth — describes the API) ─────────────────────────────

router.get("/", controller.getApiMetadata);

// ─── Order Placement (API key auth with orders:write permission) ────────────

router.post(
  "/orders",
  authenticateApiKey,
  requirePermission("orders:write"),
  controller.createOrder,
);

// ─── Data Endpoints (API key auth only — for external consumers) ────────────

router.get(
  "/packages",
  authenticateApiKey,
  requirePermission("packages:read"),
  controller.getPackages,
);

router.get(
  "/packages/:id",
  authenticateApiKey,
  requirePermission("packages:read"),
  controller.getPackageById,
);

router.get(
  "/bundles",
  authenticateApiKey,
  requirePermission("bundles:read"),
  controller.getBundles,
);

router.get(
  "/bundles/:id",
  authenticateApiKey,
  requirePermission("bundles:read"),
  controller.getBundleById,
);

router.get(
  "/storefront",
  authenticateApiKey,
  requirePermission("storefront:read"),
  controller.getStorefront,
);

// ─── API Key Management (API key or session auth) ────────────────────────────

router.post("/keys", authenticateMarketplaceUser, controller.createKey);
router.get("/keys", authenticateMarketplaceUser, controller.listKeys);
router.post("/keys/:id/revoke", authenticateMarketplaceUser, controller.revokeKey);

// ─── Usage Analytics (API key or session auth) ───────────────────────────────

router.get("/usage/stats", authenticateMarketplaceUser, controller.getUsageStats);
router.get("/usage/logs", authenticateMarketplaceUser, controller.getUsageLogs);
router.get("/usage/daily-counts", authenticateMarketplaceUser, controller.getAgentDailyCounts);

export default router;
