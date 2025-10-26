// src/routes/commissionRoutes.js
import express from "express";
import commissionController from "../controllers/commissionController.js";
import {
  authenticate,
  authorize,
  authorizeBusinessUser,
} from "../middlewares/auth.js";

const router = express.Router();

// Get commission settings (super admin only)
router.get(
  "/settings",
  authenticate,
  authorize("super_admin"),
  commissionController.getCommissionSettings
);

// Update commission settings (super admin only)
router.put(
  "/settings",
  authenticate,
  authorize("super_admin"),
  commissionController.updateCommissionSettings
);

// Get business user commissions
router.get(
  "/agent",
  authenticate,
  authorizeBusinessUser,
  commissionController.getAgentCommissions
);

// Get all commissions (super admin only)
router.get(
  "/",
  authenticate,
  authorize("super_admin"),
  commissionController.getAllCommissions
);

// Calculate commission
router.post(
  "/calculate",
  authenticate,
  authorize("super_admin"),
  commissionController.calculateCommission
);

// Create commission record
router.post(
  "/records",
  authenticate,
  authorize("super_admin"),
  commissionController.createCommissionRecord
);

// Pay commission
router.put(
  "/:commissionId/pay",
  authenticate,
  authorize("super_admin"),
  commissionController.payCommission
);

// Pay multiple commissions
router.put(
  "/pay-multiple",
  authenticate,
  authorize("super_admin"),
  commissionController.payMultipleCommissions
);

// Reject commission
router.put(
  "/:commissionId/reject",
  authenticate,
  authorize("super_admin"),
  commissionController.rejectCommission
);

// Reject multiple commissions
router.put(
  "/reject-multiple",
  authenticate,
  authorize("super_admin"),
  commissionController.rejectMultipleCommissions
);

// Generate monthly commissions
router.post(
  "/generate-monthly",
  authenticate,
  authorize("super_admin"),
  commissionController.generateMonthlyCommissions
);

// Generate daily commissions (manual trigger)
router.post(
  "/generate-daily",
  authenticate,
  authorize("super_admin"),
  commissionController.generateDailyCommissions
);

// Reset monthly commissions
router.post(
  "/reset-monthly",
  authenticate,
  authorize("super_admin"),
  commissionController.resetMonthlyCommissions
);

// Manual commission reset (for testing/admin)
router.post(
  "/manual-reset",
  authenticate,
  authorize("super_admin"),
  commissionController.manualCommissionReset
);

// Expire old commissions (manual trigger)
router.post(
  "/expire-old",
  authenticate,
  authorize("super_admin"),
  commissionController.expireOldCommissions
);

// Archive month commissions
router.post(
  "/archive-month",
  authenticate,
  authorize("super_admin"),
  commissionController.archiveMonthCommissions
);

// Get agent monthly summaries
router.get(
  "/monthly-summaries/agent",
  authenticate,
  authorizeBusinessUser,
  commissionController.getAgentMonthlySummaries
);

// Get all monthly summaries (super admin)
router.get(
  "/monthly-summaries",
  authenticate,
  authorize("super_admin"),
  commissionController.getAllMonthlySummaries
);

// Get current month statistics
router.get(
  "/current-month-stats",
  authenticate,
  authorizeBusinessUser,
  commissionController.getCurrentMonthStatistics
);

// Get commission statistics (legacy - keeping for backwards compatibility)
router.get(
  "/statistics",
  authenticate,
  authorizeBusinessUser,
  commissionController.getCommissionStatistics
);

export default router;
