// src/routes/orderRoutes.js
import express from 'express';
import orderController from '../controllers/orderController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { orderValidation } from '../validators/orderValidator.js';

const router = express.Router();

// Order CRUD operations - SPECIFIC ROUTES FIRST
router.post(
  '/single',
  authenticate,
  authorize('agent'),
  validate(orderValidation.createSingle),
  orderController.createSingleOrder
);

router.post(
  '/bulk',
  authenticate,
  authorize('agent'),
  validate(orderValidation.createBulk),
  orderController.createBulkOrder
);

// Analytics - SPECIFIC ROUTES FIRST
router.get(
  '/analytics/summary',
  authenticate,
  authorize('agent'),
  orderController.getAnalytics
);

// Order processing - RESTRICTED TO SUPER ADMIN ONLY
router.post(
  '/:orderId/items/:itemId/process',
  authenticate,
  authorize('super_admin'),
  orderController.processOrderItem
);

router.post(
  '/:id/process-bulk',
  authenticate,
  authorize('super_admin'),
  orderController.processBulkOrder
);

// Bulk order processing - NEW ENDPOINT FOR SUPER ADMIN
router.post(
  '/bulk-process',
  authenticate,
  authorize('super_admin'),
  orderController.bulkProcessOrders
);

router.post(
  '/:id/cancel',
  authenticate,
  authorize('agent'),
  validate(orderValidation.cancel),
  orderController.cancelOrder
);

router.patch(
  '/:id/status',
  authenticate,
  authorize('super_admin'),
  orderController.updateOrderStatus
);

// GENERIC ROUTES LAST
router.get(
  '/',
  authenticate,
  authorize('agent', 'super_admin'),
  orderController.getOrders
);

router.get(
  '/:id',
  authenticate,
  authorize('agent', 'super_admin'),
  orderController.getOrder
);

export default router;
