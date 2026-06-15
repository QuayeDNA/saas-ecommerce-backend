import express from "express";
import controller from "../controllers/adminMarketplaceController.js";
import { authenticate, authorize } from "../middlewares/auth.js";

const router = express.Router();

router.use(authenticate);

// ─── Key Management ─────────────────────────────────────────────────────────

router.get(
  "/keys",
  authorize("super_admin"),
  controller.listAllKeys,
);

router.get(
  "/keys/:id",
  authorize("super_admin"),
  controller.getKeyById,
);

router.post(
  "/keys/:id/revoke",
  authorize("super_admin"),
  controller.revokeKey,
);

router.post(
  "/keys/:id/suspend",
  authorize("super_admin"),
  controller.suspendKey,
);

router.post(
  "/keys/:id/activate",
  authorize("super_admin"),
  controller.activateKey,
);

// ─── Usage Analytics ─────────────────────────────────────────────────────────

router.get(
  "/usage/stats",
  authorize("super_admin"),
  controller.getAggregateStats,
);

router.get(
  "/usage/logs",
  authorize("super_admin"),
  controller.getUsageLogs,
);

router.get(
  "/usage/agent-summary",
  authorize("super_admin"),
  controller.getAgentUsageSummary,
);

router.get(
  "/usage/daily-counts",
  authorize("super_admin"),
  controller.getDailyCounts,
);

// ─── Rate Limit Config ───────────────────────────────────────────────────────

router.get(
  "/settings/rate-limit",
  authorize("super_admin"),
  controller.getRateLimitConfig,
);

router.put(
  "/settings/rate-limit",
  authorize("super_admin"),
  controller.updateRateLimitConfig,
);

// ─── Agent-wide Key Actions ────────────────────────────────────────────────

router.post(
  "/keys/revoke-by-agent/:agentId",
  authorize("super_admin"),
  controller.revokeAllAgentKeys,
);

export default router;
