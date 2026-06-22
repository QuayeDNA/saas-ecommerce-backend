// src/routes/walletRoutes.js
import express from "express";
import walletController from "../controllers/walletController.js";
import payoutController from "../controllers/payoutController.js";
import momoBridgeController from "../controllers/momoBridgeController.js";
import {
  authenticate,
  authorize,
  authorizeWalletUser,
} from "../middlewares/auth.js";
import { apiEndpointLimits } from "../middlewares/advancedRateLimit.js";
import validate from "../middlewares/validate.js";
import { walletValidation } from "../validators/walletValidator.js";

const router = express.Router();

// ── Wallet-enabled users ──────────────────────────────────────────────────────
router.get("/info", authenticate, authorizeWalletUser, walletController.getWalletInfo);
router.get(
  "/transactions",
  authenticate,
  authorizeWalletUser,
  validate(walletValidation.transactionHistory),
  walletController.getTransactionHistory,
);

// ── Wallet-enabled users (agents etc.) ───────────────────────────────────────
router.get(
  "/check-pending-topup",
  authenticate,
  authorizeWalletUser,
  walletController.checkPendingTopUpRequest,
);
router.post(
  "/request-top-up",
  authenticate,
  authorizeWalletUser,
  validate(walletValidation.topUpRequest),
  walletController.requestWalletTopUp,
);

// Paystack: get public key for inline checkout (publicly accessible)
router.get("/paystack/public-key", walletController.getPaystackPublicKey);

// Paystack: generate checkout config (no DB write — safe to call and abandon)
router.post(
  "/paystack/initiate",
  authenticate,
  authorizeWalletUser,
  validate(walletValidation.paystackInitiate),
  walletController.initiatePaystackTopUp,
);

// Paystack: verify payment after inline modal callback
router.get(
  "/paystack/verify",
  authenticate,
  authorizeWalletUser,
  walletController.verifyPaystackTransaction,
);

// ── MoMo Bridge — Instant Claim (wallet credit via mobile money verification) ──
router.get(
  "/momo/config",
  authenticate,
  authorizeWalletUser,
  validate(walletValidation.momoConfig),
  momoBridgeController.getConfig,
);
router.post(
  "/momo/verify",
  authenticate,
  authorizeWalletUser,
  validate(walletValidation.momoVerify),
  momoBridgeController.verifyClaim,
);

// ── Earnings & payouts ────────────────────────────────────────────────────────
router.get(
  "/earnings/dashboard",
  authenticate,
  authorizeWalletUser,
  payoutController.getEarningsDashboard,
);
router.get("/payouts", authenticate, authorizeWalletUser, payoutController.getPayouts);
router.post("/payouts/request", authenticate, authorizeWalletUser, apiEndpointLimits.highFrequency, payoutController.requestPayout);
router.post(
  "/earnings/convert-to-wallet",
  authenticate,
  authorizeWalletUser,
  payoutController.convertEarningsToWallet,
);

// ── Admin / super_admin ───────────────────────────────────────────────────────
router.post(
  "/top-up",
  authenticate,
  authorize("super_admin"),
  validate(walletValidation.adminTopUp),
  walletController.topUpWallet,
);
router.post(
  "/debit",
  authenticate,
  authorize("super_admin"),
  validate(walletValidation.adminTopUp),
  walletController.adminDebitWallet,
);
router.get(
  "/pending-requests",
  authenticate,
  authorize("super_admin"),
  walletController.getPendingTopUpRequests,
);
router.post(
  "/requests/:transactionId/process",
  authenticate,
  authorize("super_admin"),
  validate(walletValidation.processTopUpRequest),
  walletController.processTopUpRequest,
);
router.get(
  "/analytics",
  authenticate,
  authorize("super_admin"),
  walletController.getWalletAnalytics,
);
router.get(
  "/admin-transactions",
  authenticate,
  authorize("super_admin"),
  walletController.getAdminTransactions,
);

// Admin payout queue
router.get(
  "/admin/payouts",
  authenticate,
  authorize("super_admin"),
  payoutController.getPendingPayouts,
);
router.get(
  "/admin/payouts/history",
  authenticate,
  authorize("super_admin"),
  payoutController.getPayoutHistory,
);
router.get(
  "/admin/payouts/summary",
  authenticate,
  authorize("super_admin"),
  payoutController.getAdminPayoutSummary,
);
router.put(
  "/admin/payouts/:id/approve",
  authenticate,
  authorize("super_admin"),
  payoutController.approvePayout,
);
router.put(
  "/admin/payouts/:id/reject",
  authenticate,
  authorize("super_admin"),
  payoutController.rejectPayout,
);
router.post(
  "/admin/payouts/:id/process",
  authenticate,
  authorize("super_admin"),
  payoutController.processPayout,
);
router.put(
  "/admin/payouts/:id/complete",
  authenticate,
  authorize("super_admin"),
  payoutController.markManuallyCompleted,
);
router.get(
  "/admin/payouts/availability",
  authenticate,
  authorize("super_admin"),
  payoutController.getAutoPayoutAvailability,
);

export default router;
