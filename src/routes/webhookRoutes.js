// src/routes/webhookRoutes.js
import express from "express";
import { body, param, query } from "express-validator";
import controller from "../controllers/webhookController.js";
import { authenticateApiKey, requirePermission } from "../middlewares/apiKeyAuth.js";
import { authenticate, authorizeBusinessUser } from "../middlewares/auth.js";
import ApiKey from "../models/ApiKey.js";

const router = express.Router();

const API_KEY_PREFIXES = [ApiKey.API_KEY_PREFIX, "bl_live_"];

/**
 * Accepts either an API key (sk_live_* or legacy bl_live_*) or a session JWT.
 * - API key → authenticateApiKey (sets req.agentId, req.apiKey) — implicitly authorized
 * - Session JWT → authenticate + authorizeBusinessUser + maps req.user.userId to req.agentId
 */
const authenticateWebhookUser = (req, res, next) => {
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

// ─── Webhook Management ────────────────────────────────────────────────────────────

router.post(
  "/",
  authenticateWebhookUser,
  [
    body("url").isURL().withMessage("Invalid webhook URL"),
    body("events").optional().isArray().withMessage("Events must be an array"),
    body("description").optional().isString().isLength({ max: 200 }).withMessage("Description must be 200 characters or less"),
  ],
  controller.createWebhook,
);

router.get("/", authenticateWebhookUser, controller.getWebhooks);

router.get(
  "/:id",
  authenticateWebhookUser,
  [param("id").isMongoId().withMessage("Invalid webhook ID")],
  controller.getWebhook,
);

router.patch(
  "/:id",
  authenticateWebhookUser,
  [
    param("id").isMongoId().withMessage("Invalid webhook ID"),
    body("url").optional().isURL().withMessage("Invalid webhook URL"),
    body("events").optional().isArray().withMessage("Events must be an array"),
    body("active").optional().isBoolean().withMessage("Active must be a boolean"),
    body("description").optional().isString().isLength({ max: 200 }).withMessage("Description must be 200 characters or less"),
  ],
  controller.updateWebhook,
);

router.delete(
  "/:id",
  authenticateWebhookUser,
  [param("id").isMongoId().withMessage("Invalid webhook ID")],
  controller.deleteWebhook,
);

router.post(
  "/:id/test",
  authenticateWebhookUser,
  [param("id").isMongoId().withMessage("Invalid webhook ID")],
  controller.testWebhook,
);

// ─── Webhook Delivery Logs ─────────────────────────────────────────────────────────

router.get(
  "/logs",
  authenticateWebhookUser,
  [
    query("webhookId").optional().isMongoId().withMessage("Invalid webhook ID"),
    query("event").optional().isIn(["order.placed", "order.processing", "order.completed", "order.failed", "order.refunded", "bundle.delivered"]).withMessage("Invalid event"),
    query("limit").optional().isInt({ min: 1, max: 200 }).withMessage("Limit must be between 1 and 200"),
    query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
  ],
  controller.getDeliveryLogs,
);

export default router;
