import express from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import * as crossAppBridgeController from '../controllers/crossAppBridgeController.js';

const router = express.Router();

router.use(authenticate);
router.use(authorize('super_admin'));

router.get('/orders/app/:appId', crossAppBridgeController.listConnectedAppOrders);
router.get('/orders/app/:appId/reported', crossAppBridgeController.getConnectedAppReportedOrders);
router.get('/orders/app/:appId/analytics', crossAppBridgeController.getConnectedAppAnalytics);
router.get('/orders/app/:appId/:id', crossAppBridgeController.getConnectedAppOrder);
router.patch('/orders/app/:appId/:id/status', crossAppBridgeController.updateConnectedAppOrderStatus);
router.patch('/orders/app/:appId/:id/reception-status', crossAppBridgeController.updateConnectedAppReceptionStatus);
router.post('/orders/app/:appId/:id/cancel', crossAppBridgeController.cancelConnectedAppOrder);
router.post('/orders/app/:appId/:id/report', crossAppBridgeController.reportConnectedAppOrder);
router.post('/orders/app/:appId/:orderId/items/:itemId/process', crossAppBridgeController.processConnectedAppOrderItem);
router.post('/orders/app/:appId/:id/process-bulk', crossAppBridgeController.processConnectedAppBulkOrder);
router.post('/orders/app/:appId/bulk-process', crossAppBridgeController.bulkProcessConnectedAppOrders);
router.post('/orders/app/:appId/bulk-reception-status', crossAppBridgeController.bulkUpdateConnectedAppReceptionStatus);
export default router;
