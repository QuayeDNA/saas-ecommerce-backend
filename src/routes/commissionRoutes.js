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

// Get commission statistics
router.get(
  "/statistics",
  authenticate,
  authorizeBusinessUser,
  commissionController.getCommissionStatistics
);

export default router;
