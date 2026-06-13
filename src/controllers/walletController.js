// src/controllers/walletController.js
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import walletService from "../services/walletService.js";
import paystackService from "../services/paystackService.js";
import settingsService from "../services/settingsService.js";
import logger from "../utils/logger.js";
import PaystackVerificationTask from "../models/PaystackVerificationTask.js";
import { isBusinessUser } from "../utils/userTypeHelpers.js";
import { logAuditAction } from "../utils/auditLogger.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

// ─── Shared Helpers ───────────────────────────────────────────────────────────

/**
 * Safely populate a list of raw Mongoose documents, skipping broken references.
 * Returns the original doc unpopulated rather than throwing.
 */
async function safePopulate(docs, paths) {
  const results = [];
  for (const doc of docs) {
    try {
      results.push(await doc.populate(paths));
    } catch (err) {
      logger.warn(
        `[WalletController] Population failed for doc ${doc._id}: ${err.message}`,
      );
      results.push(doc);
    }
  }
  return results;
}

// ─── Controller ───────────────────────────────────────────────────────────────

class WalletController {
  // ── User-Facing ─────────────────────────────────────────────────────────────

  async getWalletInfo(req, res) {
    try {
      const { userId } = req.user;

      const user = await User.findById(userId).select("walletBalance");
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      const rawTxns = await WalletTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(10);
      const recentTransactions = await safePopulate(rawTxns, [
        { path: "approvedBy", select: "fullName" },
        { path: "relatedOrder", select: "orderNumber" },
      ]);

      res.json({
        success: true,
        wallet: { balance: user.walletBalance ?? 0, recentTransactions },
      });
    } catch (err) {
      logger.error(`[getWalletInfo] ${err.message}`, { stack: err.stack });
      res
        .status(500)
        .json({ success: false, message: "Failed to get wallet information" });
    }
  }

  async getTransactionHistory(req, res) {
    try {
      const { userId } = req.user;
      const { page = 1, limit = 20, type, startDate, endDate } = req.query;

      const filter = {};
      if (type && ["credit", "debit"].includes(type)) filter.type = type;
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const rawTxns = await WalletTransaction.find({ user: userId, ...filter })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const transactions = await safePopulate(rawTxns, [
        { path: "approvedBy", select: "fullName email" },
        { path: "relatedOrder", select: "orderNumber" },
      ]);

      const total = await WalletTransaction.countDocuments({
        user: userId,
        ...filter,
      }).catch(() => 0);

      res.json({
        success: true,
        transactions,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      logger.error(`[getTransactionHistory] ${err.message}`, {
        stack: err.stack,
      });
      res
        .status(500)
        .json({ success: false, message: "Failed to get transaction history" });
    }
  }

  async checkPendingTopUpRequest(req, res) {
    try {
      const { userId } = req.user;
      const pendingRequest = await WalletTransaction.findOne({
        user: userId,
        type: "credit",
        status: "pending",
      });
      res.json({ success: true, hasPendingRequest: Boolean(pendingRequest) });
    } catch (err) {
      logger.error(`[checkPendingTopUpRequest] ${err.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to check pending request status",
      });
    }
  }

  // ── Manual Top-Up ────────────────────────────────────────────────────────────

  async requestWalletTopUp(req, res) {
    try {
      const { userId } = req.user;
      const { amount, description } = req.body;

      const transaction = await walletService.createTopUpRequest(
        userId,
        parseFloat(amount),
        description,
      );

      await logAuditAction(req, {
        userId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.WALLET_TOPUP_REQUESTED,
        category: AUDIT_CATEGORIES.WALLET,
        resource: { transactionId: transaction?._id || null },
        metadata: {
          source: "walletController.requestWalletTopUp",
          amount: parseFloat(amount),
          description: description || null,
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      res.status(201).json({
        success: true,
        message: "Top-up request created successfully",
        transaction,
      });
    } catch (err) {
      logger.error(`[requestWalletTopUp] ${err.message}`);
      res
        .status(err.message.includes("not found") ? 404 : 400)
        .json({ success: false, message: err.message });
    }
  }

  // ── Paystack (Instant) Top-Up ─────────────────────────────────────────────────

  /**
   * Returns Paystack checkout config (reference, public key, etc.) without
   * creating any DB records. The transaction is only recorded after payment
   * is confirmed via webhook or manual verify.
   */
  async initiatePaystackTopUp(req, res) {
    try {
      const { userId } = req.user;
      const { amount, returnUrl } = req.body;

      if (!amount || Number(amount) <= 0) {
        return res
          .status(400)
          .json({ success: false, message: "A valid amount is required" });
      }

      // Guard: check admin toggles and wallet settings for Paystack
      try {
        const settingsSvc = (await import("../services/settingsService.js"))
          .default;
        const apiSettings = await settingsSvc.getApiSettings();
        if (!apiSettings.paystackWalletTopUpEnabled) {
          return res.status(403).json({
            success: false,
            message:
              "Paystack wallet top-up is currently disabled by the administrator.",
          });
        }

        const walletSettings = await settingsSvc.getWalletSettings();
        const min = walletSettings.paystackMinimumTopUpAmount || 0;
        if (min > 0 && parseFloat(amount) < min) {
          return res.status(400).json({
            success: false,
            message: `Minimum amount for Paystack top-ups is GH₵${min}`,
          });
        }
      } catch (settingsErr) {
        logger.warn(
          `[initiatePaystackTopUp] Could not verify Paystack settings: ${settingsErr.message}`,
        );
      }

      const result = await walletService.initiatePaystackTopUp(
        userId,
        parseFloat(amount),
        returnUrl || null,
      );

      await logAuditAction(req, {
        userId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.WALLET_PAYSTACK_INITIATED,
        category: AUDIT_CATEGORIES.WALLET,
        resource: { userId },
        metadata: {
          source: "walletController.initiatePaystackTopUp",
          amount: parseFloat(amount),
          reference: result?.reference || null,
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      res.json({
        success: true,
        message: "Paystack checkout ready",
        data: {
          reference: result.reference,
          accessCode: result.accessCode,
          authorizationUrl: result.authorizationUrl,
          publicKey: result.publicKey || null,
          amount: result.amount,
          chargeAmount: result.chargeAmount,
          amountPesewas: result.amountPesewas,
          targetCreditAmount: result.targetCreditAmount,
          paystackFee: result.paystackFee,
          platformFee: result.platformFee,
          totalFee: result.totalFee,
          feesDelegate: result.feesDelegate,
        },
      });
    } catch (err) {
      logger.error(`[initiatePaystackTopUp] ${err.message}`);

      if (err.response?.status === 401 || /401/.test(err.message)) {
        return res.status(502).json({
          success: false,
          message:
            "Paystack authentication failed — please configure Paystack keys in Admin → API settings.",
        });
      }

      res.status(400).json({ success: false, message: err.message });
    }
  }

  async verifyPaystackTransaction(req, res) {
    try {
      const reference = req.query.reference || req.body.reference;
      if (!reference)
        return res
          .status(400)
          .json({ success: false, message: "reference is required" });

      await paystackService
        .ensureKeys()
        .catch((e) =>
          logger.warn(
            `[verifyPaystackTransaction] ensureKeys failed: ${e.message}`,
          ),
        );

      // Ask Paystack whether this payment actually succeeded
      const paystackData = await paystackService.verifyTransaction(
        reference.toString(),
      );
      if (!paystackData || paystackData.status !== "success") {
        return res.status(400).json({
          success: false,
          message: "Paystack transaction not successful",
        });
      }

      // Check idempotency first — if already processed, return success immediately
      const existing = await WalletTransaction.findOne({
        reference: reference.toString(),
        status: "completed",
      });
      if (existing) {
        return res.json({
          success: true,
          message: "Payment already processed — wallet is up to date",
        });
      }

      // Process via webhook logic (credits wallet + records transaction)
      await walletService.processPaystackWebhook({
        event: "charge.success",
        data: paystackData,
      });

      const userId = req.user?.userId || null;

      await logAuditAction(req, {
        userId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.WALLET_PAYSTACK_VERIFIED,
        category: AUDIT_CATEGORIES.WALLET,
        resource: { userId, reference },
        metadata: {
          source: "walletController.verifyPaystackTransaction",
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      // Mark any background retry task as completed
      try {
        await PaystackVerificationTask.findOneAndUpdate(
          { reference },
          { status: "done", lastError: null },
          { new: true },
        );
      } catch {
        // ignore
      }

      res.json({
        success: true,
        message: "Payment verified and wallet credited",
      });
    } catch (err) {
      logger.error(`[verifyPaystackTransaction] ${err.message}`);
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getPaystackPublicKey(req, res) {
    try {
      await paystackService
        .ensureKeys()
        .catch((e) =>
          logger.warn(`[getPaystackPublicKey] ensureKeys failed: ${e.message}`),
        );

      let key = paystackService.getPublicKey();

      // Fallback: use env vars only (no DB storage for Paystack keys)
      if (!key) {
        key =
          process.env.NODE_ENV === "production"
            ? process.env.PAYSTACK_LIVE_PUBLIC_KEY
            : process.env.PAYSTACK_LIVE_PUBLIC_KEY ||
              process.env.PAYSTACK_TEST_PUBLIC_KEY;
      }

      const apiSettings = await settingsService.getApiSettings().catch((e) => {
        logger.warn(
          `[getPaystackPublicKey] getApiSettings failed: ${e.message}`,
        );
        return { paystackWalletTopUpEnabled: false, paystackEnabled: false };
      });

      res.set("Cache-Control", "no-store");
      res.json({
        success: true,
        publicKey: key || "",
        configured: Boolean(paystackService.isConfigured()),
        walletTopUpEnabled: Boolean(apiSettings?.paystackWalletTopUpEnabled),
        paystackEnabled: Boolean(apiSettings?.paystackEnabled),
      });
    } catch (err) {
      logger.error(`[getPaystackPublicKey] ${err.message}`);
      res
        .status(500)
        .json({ success: false, message: "Failed to get Paystack public key" });
    }
  }

  // ── Admin Actions ────────────────────────────────────────────────────────────

  async topUpWallet(req, res) {
    try {
      const adminId = req.user.userId;
      const { userId, amount, description } = req.body;

      const transaction = await walletService.creditWallet(
        userId,
        parseFloat(amount),
        description || "Wallet top-up by admin",
        adminId,
        { adminAction: true },
      );

      await logAuditAction(req, {
        userId: adminId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.WALLET_CREDITED,
        category: AUDIT_CATEGORIES.WALLET,
        resource: { userId },
        metadata: {
          source: "walletController.topUpWallet",
          amount: parseFloat(amount),
          description: description || "Wallet top-up by admin",
          approvedBy: adminId,
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      res.json({
        success: true,
        message: "Wallet topped up successfully",
        transaction,
      });
    } catch (err) {
      logger.error(`[topUpWallet] ${err.message}`);
      res
        .status(err.message.includes("not found") ? 404 : 400)
        .json({ success: false, message: err.message });
    }
  }

  async processTopUpRequest(req, res) {
    try {
      const adminId = req.user.userId;
      const { transactionId } = req.params;
      const { approve } = req.body;

      const transaction = await walletService.processTopUpRequest(
        transactionId,
        Boolean(approve),
        adminId,
      );

      await logAuditAction(req, {
        userId: adminId,
        userType: req.user?.userType,
        action: approve
          ? AUDIT_ACTIONS.WALLET_TOPUP_APPROVED
          : AUDIT_ACTIONS.WALLET_TOPUP_REJECTED,
        category: AUDIT_CATEGORIES.WALLET,
        resource: { transactionId },
        metadata: {
          source: "walletController.processTopUpRequest",
          approve: Boolean(approve),
        },
        severity: approve ? AUDIT_SEVERITIES.INFO : AUDIT_SEVERITIES.WARNING,
      });

      res.json({
        success: true,
        message: approve
          ? "Top-up request approved"
          : "Top-up request rejected",
        transaction,
      });
    } catch (err) {
      logger.error(`[processTopUpRequest] ${err.message}`);
      res
        .status(err.message.includes("not found") ? 404 : 400)
        .json({ success: false, message: err.message });
    }
  }

  async getPendingTopUpRequests(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const { userType, userId } = req.user;

      const filter = { status: "pending" };

      if (isBusinessUser(userType)) {
        const tenantUsers = await User.find({ tenantId: userId }).select("_id");
        filter.user = { $in: tenantUsers.map((u) => u._id) };
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [requests, total] = await Promise.all([
        WalletTransaction.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate("user", "fullName email phone userType agentCode"),
        WalletTransaction.countDocuments(filter),
      ]);

      res.json({
        success: true,
        requests,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      logger.error(`[getPendingTopUpRequests] ${err.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get pending top-up requests",
      });
    }
  }

  async adminDebitWallet(req, res) {
    try {
      const { userId, amount, description } = req.body;
      const adminId = req.user.userId;

      if (!userId || !amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "User ID and a positive amount are required",
        });
      }

      const transaction = await walletService.debitWallet(
        userId,
        amount,
        description || "Wallet debit by admin",
        null,
        { debitedBy: adminId },
      );

      await logAuditAction(req, {
        userId: adminId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.WALLET_DEBITED,
        category: AUDIT_CATEGORIES.WALLET,
        resource: { userId },
        metadata: {
          source: "walletController.adminDebitWallet",
          amount: Number(amount),
          description: description || "Wallet debit by admin",
          debitedBy: adminId,
        },
        severity: AUDIT_SEVERITIES.WARNING,
      });

      const updatedUser = await User.findById(userId).select(
        "walletBalance fullName email",
      );
      res.json({
        success: true,
        message: `Successfully debited GH₵${amount} from ${updatedUser.fullName}'s wallet`,
        transaction,
        user: updatedUser,
      });
    } catch (err) {
      logger.error(`[adminDebitWallet] ${err.message}`);
      const status = err.message.includes("not found")
        ? 404
        : err.message.includes("Insufficient")
          ? 400
          : 500;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async getWalletAnalytics(req, res) {
    try {
      const { userType, userId } = req.user;
      const tenantId = isBusinessUser(userType) ? userId : null;

      const filter = {};
      const { startDate, endDate } = req.query;
      if (startDate)
        filter.createdAt = { ...filter.createdAt, $gte: new Date(startDate) };
      if (endDate)
        filter.createdAt = { ...filter.createdAt, $lte: new Date(endDate) };

      const analytics = await walletService.getWalletAnalytics(
        tenantId,
        filter,
      );
      res.json({ success: true, analytics });
    } catch (err) {
      logger.error(`[getWalletAnalytics] ${err.message}`);
      res
        .status(500)
        .json({ success: false, message: "Failed to get wallet analytics" });
    }
  }

  async getAdminTransactions(req, res) {
    try {
      const adminId = req.user.userId;
      const {
        page = 1,
        limit = 20,
        type,
        startDate,
        endDate,
        userId,
      } = req.query;

      const filter = {
        $or: [
          { approvedBy: adminId },
          { "metadata.debitedBy": adminId },
          { "metadata.adminAction": true, approvedBy: adminId },
          { "metadata.paystack": { $exists: true } },
        ],
      };

      if (type && ["credit", "debit"].includes(type)) filter.type = type;
      if (userId) filter.user = userId;
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const rawTxns = await WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));
      const transactions = await safePopulate(rawTxns, [
        { path: "user", select: "fullName email phone userType agentCode" },
        { path: "approvedBy", select: "fullName email" },
        { path: "relatedOrder", select: "orderNumber" },
      ]);

      const total = await WalletTransaction.countDocuments(filter).catch(
        () => 0,
      );

      res.json({
        success: true,
        transactions,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      logger.error(`[getAdminTransactions] ${err.message}`, {
        stack: err.stack,
      });
      res
        .status(500)
        .json({ success: false, message: "Failed to get admin transactions" });
    }
  }

}

export default new WalletController();
