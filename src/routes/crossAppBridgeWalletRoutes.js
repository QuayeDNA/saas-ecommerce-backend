import express from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import * as crossAppBridgeWalletController from '../controllers/crossAppBridgeWalletController.js';

const router = express.Router();

router.use(authenticate);
router.use(authorize('super_admin'));

router.get('/wallet/app/:appId/transactions', crossAppBridgeWalletController.listConnectedAppTransactions);
router.get('/wallet/app/:appId/analytics', crossAppBridgeWalletController.getConnectedAppAnalytics);
router.get('/wallet/app/:appId/pending-requests', crossAppBridgeWalletController.getConnectedAppPendingRequests);
router.post('/wallet/app/:appId/top-up', crossAppBridgeWalletController.topUpConnectedAppWallet);
router.post('/wallet/app/:appId/debit', crossAppBridgeWalletController.debitConnectedAppWallet);
router.post('/wallet/app/:appId/requests/:transactionId/process', crossAppBridgeWalletController.processConnectedAppTopUpRequest);
router.get('/wallet/app/:appId/users', crossAppBridgeWalletController.getConnectedAppUsers);

export default router;
