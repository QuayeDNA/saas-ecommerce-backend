// src/routes/orderRoutes.js
import express from 'express';
import orderController from '../controllers/orderController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { orderValidation } from '../validators/orderValidator.js';

const router = express.Router();

// Order CRUD operations
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

router.get(
  '/',
  authenticate,
  authorize('agent'),
  orderController.getOrders
);

router.get(
  '/:id',
  authenticate,
  authorize('agent'),
  orderController.getOrder
);

// Order processing
router.post(
  '/:orderId/items/:itemId/process',
  authenticate,
  authorize('agent'),
  orderController.processOrderItem
);

router.post(
  '/:id/process-bulk',
  authenticate,
  authorize('agent'),
  orderController.processBulkOrder
);

router.post(
  '/:id/cancel',
  authenticate,
  authorize('agent'),
  validate(orderValidation.cancel),
  orderController.cancelOrder
);

// Analytics
router.get(
  '/analytics/summary',
  authenticate,
  authorize('agent'),
  orderController.getAnalytics
);

export default router;
