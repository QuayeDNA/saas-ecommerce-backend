// src/routes/orderRoutes.js
import express from "express";
import orderController from "../controllers/orderController.js";
import {
  authenticate,
  authorize,
  authorizeBusinessUser,
} from "../middlewares/auth.js";
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
  validate(orderValidation.createSingle),
  orderController.createSingleOrder
);

router.post(
  "/bulk",
  authenticate,
  authorizeBusinessUser,
  checkSiteStatusForOrders,
  validate(orderValidation.createBulk),
  orderController.createBulkOrder
);

// Analytics - SPECIFIC ROUTES FIRST
router.get(
  "/analytics/summary",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  orderController.getAnalytics
);

// Business user analytics for dashboard
router.get(
  "/analytics/agent",
  authenticate,
  authorizeBusinessUser,
  orderController.getAgentAnalytics
);

// Monthly revenue for business users and super admin
router.get(
  "/analytics/monthly-revenue",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  orderController.getMonthlyRevenue
);

// Daily spending for business users (today's completed orders)
router.get(
  "/analytics/daily-spending",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  orderController.getDailySpending
);

// Order processing - RESTRICTED TO SUPER ADMIN ONLY
router.post(
  "/:orderId/items/:itemId/process",
  authenticate,
  authorize("super_admin"),
  orderController.processOrderItem
);

router.post(
  "/:id/process-bulk",
  authenticate,
  authorize("super_admin"),
  orderController.processBulkOrder
);

// Bulk order processing - NEW ENDPOINT FOR SUPER ADMIN
router.post(
  "/bulk-process",
  authenticate,
  authorize("super_admin"),
  orderController.bulkProcessOrders
);

// Bulk reception status update - NEW ENDPOINT FOR SUPER ADMIN
router.post(
  "/bulk-reception-status",
  authenticate,
  authorize("super_admin"),
  orderController.bulkUpdateReceptionStatus
);

router.post(
  "/:id/cancel",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  validate(orderValidation.cancel),
  orderController.cancelOrder
);

router.post(
  "/:id/report",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer"),
  validate(orderValidation.report),
  orderController.reportOrder
);

router.patch(
  "/:id/status",
  authenticate,
  authorize("super_admin"),
  orderController.updateOrderStatus
);

// Process draft orders when wallet is topped up
router.post(
  "/process-drafts",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  orderController.processDraftOrders
);

// Process single draft order
router.post(
  "/process-draft/:orderId",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  orderController.processSingleDraftOrder
);

// Update reception status - RESTRICTED TO SUPER ADMIN ONLY
router.patch(
  "/:id/reception-status",
  authenticate,
  authorize("super_admin"),
  orderController.updateReceptionStatus
);

// Get reported orders - SPECIFIC ENDPOINT
router.get(
  "/reported",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  orderController.getReportedOrders
);

// GENERIC ROUTES LAST
router.get(
  "/",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  orderController.getOrders
);

router.get(
  "/:id",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  orderController.getOrder
);

export default router;
