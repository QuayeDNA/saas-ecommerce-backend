import express from 'express';
import { authenticateCrossAppKey } from '../middlewares/authenticateCrossAppKey.js';
import * as internalOrderController from '../controllers/internalOrderController.js';

const router = express.Router();

router.get('/verify', authenticateCrossAppKey, (req, res) => {
  res.json({ verified: true, message: 'Integration key is valid' });
});

// Order endpoints — /orders/reported must come before /orders/:id
router.get('/orders', authenticateCrossAppKey, internalOrderController.listOrders);
router.get('/orders/reported', authenticateCrossAppKey, internalOrderController.getReportedOrders);
router.get('/orders/:id', authenticateCrossAppKey, internalOrderController.getOrder);
router.patch('/orders/:id/status', authenticateCrossAppKey, internalOrderController.updateOrderStatus);
router.patch('/orders/:id/reception-status', authenticateCrossAppKey, internalOrderController.updateReceptionStatus);
router.post('/orders/:id/cancel', authenticateCrossAppKey, internalOrderController.cancelOrder);
router.post('/orders/:id/report', authenticateCrossAppKey, internalOrderController.reportOrder);
router.post('/orders/:orderId/items/:itemId/process', authenticateCrossAppKey, internalOrderController.processOrderItem);
router.post('/orders/:id/process-bulk', authenticateCrossAppKey, internalOrderController.processBulkOrder);
router.post('/orders/bulk-process', authenticateCrossAppKey, internalOrderController.bulkProcessOrders);
router.post('/orders/bulk-reception-status', authenticateCrossAppKey, internalOrderController.bulkUpdateReceptionStatus);

export default router;
