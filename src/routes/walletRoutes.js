// src/routes/walletRoutes.js
import express from 'express';
import walletController from '../controllers/walletController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { walletValidation } from '../validators/walletValidator.js';

const router = express.Router();

// Routes for all authenticated users
router.get('/info', authenticate, walletController.getWalletInfo);
router.get('/transactions', authenticate, validate(walletValidation.transactionHistory), walletController.getTransactionHistory);

// Routes for agents (can request top-up)
router.post('/request-top-up', authenticate, authorize('agent'), validate(walletValidation.topUpRequest), walletController.requestWalletTopUp);

// Routes for admins/super_admins
router.post('/top-up', authenticate, authorize('agent', 'super_admin'), validate(walletValidation.adminTopUp), walletController.topUpWallet);
router.get('/pending-requests', authenticate, authorize('agent', 'super_admin'), walletController.getPendingTopUpRequests);
router.post('/requests/:transactionId/process', authenticate, authorize('agent', 'super_admin'), validate(walletValidation.processTopUpRequest), walletController.processTopUpRequest);
router.get('/analytics', authenticate, authorize('agent', 'super_admin'), walletController.getWalletAnalytics);

export default router;
