// src/routes/orderRoutes.js
import express from "express";
import orderController from "../controllers/orderController.js";
import { BUSINESS_ROLES } from "../constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeBusinessUser,
} from "../middlewares/auth.js";
import { apiEndpointLimits } from "../middlewares/advancedRateLimit.js";
import validate from "../middlewares/validate.js";
import { orderValidation } from "../validators/orderValidator.js";
import { checkSiteStatusForOrders } from "../middlewares/siteStatus.js";

const router = express.Router();

// Order CRUD operations - SPECIFIC ROUTES FIRST
router.post(
  "/single",
  authenticate,
  authorizeBusinessUser,
  checkSiteStatusForOrders,
  apiEndpointLimits.highFrequency,
  validate(orderValidation.createSingle),
  orderController.createSingleOrder,
);

router.post(
  "/bulk",
  authenticate,
  authorizeBusinessUser,
  checkSiteStatusForOrders,
  apiEndpointLimits.highFrequency,
  validate(orderValidation.createBulk),
  orderController.createBulkOrder,
);

// Analytics - SPECIFIC ROUTES FIRST
router.get(
  "/analytics/summary",
  authenticate,
  authorize(...BUSINESS_ROLES, "super_admin"),
  orderController.getAnalytics,
);

// Business user analytics for dashboard
router.get(
  "/analytics/agent",
  authenticate,
  authorizeBusinessUser,
  orderController.getAgentAnalytics,
);

// Monthly revenue for business users and super admin
router.get(
  "/analytics/monthly-revenue",
  authenticate,
  authorize(...BUSINESS_ROLES, "super_admin"),
  orderController.getMonthlyRevenue,
);

// Daily spending for business users (today's completed orders)
router.get(
  "/analytics/daily-spending",
  authenticate,
  authorize(...BUSINESS_ROLES, "super_admin"),
  orderController.getDailySpending,
);

// Order processing - RESTRICTED TO SUPER ADMIN ONLY
router.post(
  "/:orderId/items/:itemId/process",
  authenticate,
  authorize("super_admin"),
  orderController.processOrderItem,
);

router.post(
  "/:id/process-bulk",
  authenticate,
  authorize("super_admin"),
  orderController.processBulkOrder,
);

// Bulk order processing - NEW ENDPOINT FOR SUPER ADMIN
router.post(
  "/bulk-process",
  authenticate,
  authorize("super_admin"),
  orderController.bulkProcessOrders,
);

// Bulk reception status update - NEW ENDPOINT FOR SUPER ADMIN
router.post(
  "/bulk-reception-status",
  authenticate,
  authorize("super_admin"),
  orderController.bulkUpdateReceptionStatus,
);

router.post(
  "/:id/cancel",
  authenticate,
  authorize(...BUSINESS_ROLES, "super_admin"),
  validate(orderValidation.cancel),
  orderController.cancelOrder,
);

router.post(
  "/:id/report",
  authenticate,
  authorize(...BUSINESS_ROLES),
  validate(orderValidation.report),
  orderController.reportOrder,
);

router.patch(
  "/:id/status",
  authenticate,
  authorize("super_admin"),
  orderController.updateOrderStatus,
);

// Update reception status - RESTRICTED TO SUPER ADMIN ONLY
router.patch(
  "/:id/reception-status",
  authenticate,
  authorize("super_admin"),
  orderController.updateReceptionStatus,
);

// Get reported orders - SPECIFIC ENDPOINT
router.get(
  "/reported",
  authenticate,
  authorize(...BUSINESS_ROLES, "super_admin"),
  orderController.getReportedOrders,
);

// GENERIC ROUTES LAST
router.get(
  "/",
  authenticate,
  authorize(...BUSINESS_ROLES, "super_admin"),
  orderController.getOrders,
);

router.get(
  "/:id",
  authenticate,
  authorize(...BUSINESS_ROLES, "super_admin"),
  orderController.getOrder,
);

export default router;
