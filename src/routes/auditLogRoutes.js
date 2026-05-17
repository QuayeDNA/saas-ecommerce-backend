import express from "express";
import auditLogController from "../controllers/auditLogController.js";
import { authenticate, authorize } from "../middlewares/auth.js";

const router = express.Router();

router.get(
  "/recent",
  authenticate,
  authorize("super_admin"),
  auditLogController.getRecentActivity,
);
router.get(
  "/stats",
  authenticate,
  authorize("super_admin"),
  auditLogController.getAuditStats,
);
router.get(
  "/export",
  authenticate,
  authorize("super_admin"),
  auditLogController.exportAuditLogs,
);
router.get(
  "/user/:userId",
  authenticate,
  auditLogController.getUserActivityTimeline,
);
router.get(
  "/",
  authenticate,
  authorize("super_admin"),
  auditLogController.getAuditLogs,
);

export default router;
