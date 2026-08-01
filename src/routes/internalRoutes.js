import express from 'express';
import { authenticateCrossAppKey } from '../middlewares/authenticateCrossAppKey.js';
import * as internalOrderController from '../controllers/internalOrderController.js';
import * as internalWalletController from '../controllers/internalWalletController.js';
import * as internalWalletTransferController from '../controllers/internalWalletTransferController.js';

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
router.get('/orders/analytics/summary', authenticateCrossAppKey, internalOrderController.getAnalytics);

router.get('/wallet/transactions', authenticateCrossAppKey, internalWalletController.getAdminTransactions);
router.get('/wallet/analytics', authenticateCrossAppKey, internalWalletController.getAnalytics);
router.get('/wallet/pending-requests', authenticateCrossAppKey, internalWalletController.getPendingRequests);
router.post('/wallet/top-up', authenticateCrossAppKey, internalWalletController.topUpWallet);
router.post('/wallet/debit', authenticateCrossAppKey, internalWalletController.debitWallet);
router.post('/wallet/requests/:transactionId/process', authenticateCrossAppKey, internalWalletController.processTopUpRequest);
router.get('/wallet/users', authenticateCrossAppKey, internalWalletController.getUsers);
router.post('/wallet/verify-destination', authenticateCrossAppKey, internalWalletTransferController.verifyDestination);
router.post('/wallet/transfer-credit', authenticateCrossAppKey, internalWalletTransferController.creditTransfer);
router.get('/wallet/transfers/:reference', authenticateCrossAppKey, internalWalletTransferController.getTransferStatus);

export default router;
