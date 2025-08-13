// src/routes/walletRoutes.js
import express from 'express';
import walletController from '../controllers/walletController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { walletValidation } from '../validators/walletValidator.js';
import { apiEndpointLimits } from '../middlewares/advancedRateLimit.js';

const router = express.Router();

// Routes for all authenticated users
router.get('/info', authenticate, walletController.getWalletInfo);
router.get('/transactions', authenticate, validate(walletValidation.transactionHistory), walletController.getTransactionHistory);

// Routes for agents (can request top-up)
router.post('/request-top-up', apiEndpointLimits.lowFrequency, authenticate, authorize('agent'), validate(walletValidation.topUpRequest), walletController.requestWalletTopUp);

// Routes for admins/super_admins
router.post('/top-up', apiEndpointLimits.lowFrequency, authenticate, authorize('super_admin'), validate(walletValidation.adminTopUp), walletController.topUpWallet);
router.post('/debit', apiEndpointLimits.lowFrequency, authenticate, authorize('super_admin'), validate(walletValidation.adminTopUp), walletController.adminDebitWallet);
router.get('/pending-requests', authenticate, authorize('super_admin'), walletController.getPendingTopUpRequests);
router.post('/requests/:transactionId/process', apiEndpointLimits.lowFrequency, authenticate, authorize('super_admin'), validate(walletValidation.processTopUpRequest), walletController.processTopUpRequest);
router.get('/analytics', authenticate, authorize('super_admin'), walletController.getWalletAnalytics);

export default router;
