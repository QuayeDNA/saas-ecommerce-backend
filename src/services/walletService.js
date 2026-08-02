// src/services/walletService.js
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import logger from "../utils/logger.js";
import notificationService from "./notificationService.js";
import websocketService from "./websocketService.js";
import PaystackVerificationTask from "../models/PaystackVerificationTask.js";
import { canHaveWallet } from "../utils/userTypeHelpers.js";
import {
  getWalletTopUpFeeConfig,
  calculateChargeWithFees,
} from "../utils/paystackHelpers.js";
import paystackService from "./paystackService.js";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { logAuditAction } from "../utils/auditLogger.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

class WalletService {
  // ─── Shared Helpers ──────────────────────────────────────────────────────────

  /**
   * Push a real-time wallet update to the user via WebSocket.
   * Fails silently — a WebSocket error must never break a financial operation.
   */
  async _notifyUser(userId, balance, message) {
    try {
      const recentTransactions = await WalletTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate([
          { path: "approvedBy", select: "fullName" },
          { path: "relatedOrder", select: "orderNumber" },
        ]);

      websocketService.sendToUser(userId.toString(), {
        type: "wallet_update",
        userId: userId.toString(),
        balance,
        recentTransactions,
        message,
      });
    } catch (err) {
      logger.warn(
        `[WalletService] WebSocket notify failed for user ${userId}: ${err.message}`,
      );
    }
  }

  /**
   * Persist a completed (credit or debit) transaction record.
   * Only called after the user's balance has already been updated successfully.
   */
  async _recordTransaction({
    userId,
    type,
    amount,
    balanceAfter,
    description,
    approvedBy = null,
    relatedOrder = null,
    reference,
    metadata = {},
    session = null,
  }) {
    // Always ensure a non-null reference so the unique index is never violated
    // with a null value.  Explicit references (e.g. Paystack refs) are kept;
    // missing/null ones get a generated fallback.
    const safeReference =
      reference != null && reference !== ""
        ? reference
        : `TXN${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const data = {
      user: userId,
      type,
      amount,
      balanceAfter,
      description,
      status: "completed",
      approvedBy,
      relatedOrder,
      metadata,
      reference: safeReference,
    };

    const transaction = new WalletTransaction(data);
    if (session) {
      await transaction.save({ session });
    } else {
      await transaction.save();
    }
    return transaction;
  }

  // ─── Core Wallet Operations ───────────────────────────────────────────────────

  /**
   * Credit a user's wallet and record the transaction.
   * Only call this once payment/approval is confirmed.
   */
  async creditWallet(
    userId,
    amount,
    description,
    approvedBy = null,
    metadata = {},
    session = null,
  ) {
    const query = User.findById(userId);
    if (session) query.session(session);
    const user = await query;
    if (!user) throw new Error("User not found");
    if (amount <= 0) throw new Error("Credit amount must be greater than zero");

    // ── Idempotency guard ────────────────────────────────────────────────────
    // Prevent double-credit on retry or fallback execution. Mirrors debitWallet:
    // a caller-generated metadata.idempotencyKey (e.g. the cross-app transfer
    // reference) is honored so a replayed credit never credits twice.
    const idempotencyKey = metadata?.idempotencyKey;
    if (idempotencyKey) {
      const idempotencyQuery = {
        user: userId,
        type: "credit",
        status: "completed",
        "metadata.idempotencyKey": idempotencyKey,
      };
      const existingTxn = session
        ? await WalletTransaction.findOne(idempotencyQuery).session(session)
        : await WalletTransaction.findOne(idempotencyQuery);

      if (existingTxn) {
        logger.warn(
          `[WalletService] creditWallet idempotency hit — credit already recorded (txn ${existingTxn._id}). Skipping double-credit.`,
        );
        return existingTxn;
      }
    }

    user.walletBalance += amount;
    await user.save({ validateBeforeSave: false, session });

    const transaction = await this._recordTransaction({
      userId,
      type: "credit",
      amount,
      balanceAfter: user.walletBalance,
      description,
      approvedBy,
      metadata,
      session,
    });

    logger.info(
      `[WalletService] Credited GH₵${amount} to user ${userId}. Balance: GH₵${user.walletBalance}`,
    );
    await logAuditAction(null, {
      userId,
      action: AUDIT_ACTIONS.WALLET_CREDITED,
      category: AUDIT_CATEGORIES.WALLET,
      resource: { userId },
      metadata: {
        source: "walletService.creditWallet",
        amount,
        approvedBy,
      },
      severity: AUDIT_SEVERITIES.INFO,
    });
    await this._notifyUser(
      userId,
      user.walletBalance,
      `Your wallet has been credited with GH₵${amount}. New balance: GH₵${user.walletBalance}`,
    );

    return transaction;
  }

  /**
   * Debit a user's wallet and record the transaction.
   * Only call this after verifying sufficient balance.
   */
  async debitWallet(
    userId,
    amount,
    description,
    relatedOrder = null,
    metadata = {},
    session = null,
  ) {
    const query = User.findById(userId);
    if (session) query.session(session);
    const user = await query;
    if (!user) throw new Error("User not found");
    if (amount <= 0) throw new Error("Debit amount must be greater than zero");
    if (user.walletBalance < amount) {
      throw new Error(
        `Insufficient wallet balance. Required: GH₵${amount}, Available: GH₵${user.walletBalance}`,
      );
    }

    // ── Idempotency guard ────────────────────────────────────────────────────
    // Prevent double-debit on retry or fallback execution.
    // Two strategies:
    //   1. relatedOrder: the most reliable key once an order ID is known.
    //   2. metadata.idempotencyKey: a caller-generated key for cases where
    //      the order has not been created yet (e.g. pre-order wallet debit).
    const idempotencyKey = metadata?.idempotencyKey;
    if (relatedOrder || idempotencyKey) {
      const idempotencyQuery = {
        user: userId,
        type: "debit",
        status: "completed",
        ...(relatedOrder
          ? { relatedOrder }
          : { "metadata.idempotencyKey": idempotencyKey }),
      };
      const existingTxn = session
        ? await WalletTransaction.findOne(idempotencyQuery).session(session)
        : await WalletTransaction.findOne(idempotencyQuery);

      if (existingTxn) {
        logger.warn(
          `[WalletService] debitWallet idempotency hit — debit already recorded (txn ${existingTxn._id}). Skipping double-debit.`,
        );
        return existingTxn;
      }
    }

    user.walletBalance -= amount;
    await user.save({ validateBeforeSave: false, session });

    const transaction = await this._recordTransaction({
      userId,
      type: "debit",
      amount,
      balanceAfter: user.walletBalance,
      description,
      relatedOrder,
      metadata,
      session,
    });

    logger.info(
      `[WalletService] Debited GH₵${amount} from user ${userId}. Balance: GH₵${user.walletBalance}`,
    );
    await logAuditAction(null, {
      userId,
      action: AUDIT_ACTIONS.WALLET_DEBITED,
      category: AUDIT_CATEGORIES.WALLET,
      resource: { userId, relatedOrder },
      metadata: {
        source: "walletService.debitWallet",
        amount,
        relatedOrder,
      },
      severity: AUDIT_SEVERITIES.WARNING,
    });
    await this._notifyUser(
      userId,
      user.walletBalance,
      `Your wallet has been debited by GH₵${amount}. New balance: GH₵${user.walletBalance}`,
    );

    return transaction;
  }

  // ─── Transaction History ─────────────────────────────────────────────────────

  async getTransactionHistory(userId, filter = {}) {
    try {
      const transactions = await WalletTransaction.find({
        user: userId,
        ...filter,
      })
        .sort({ createdAt: -1 })
        .populate("approvedBy", "fullName email")
        .populate("relatedOrder", "orderNumber");

      return Array.isArray(transactions) ? transactions : [];
    } catch (err) {
      logger.error(
        `[WalletService] getTransactionHistory error: ${err.message}`,
      );
      return [];
    }
  }

  // ─── Manual Top-Up (Admin Approval Flow) ─────────────────────────────────────

  /**
   * Create a pending top-up request for admin approval.
   * This creates a record immediately because the admin needs to see it.
   */
  async createTopUpRequest(userId, amount, description) {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    if (amount <= 0) throw new Error("Top-up amount must be greater than zero");

    const existingPending = await WalletTransaction.findOne({
      user: userId,
      type: "credit",
      status: "pending",
    });
    if (existingPending) {
      throw new Error(
        "You already have a pending top-up request. Please wait for it to be processed.",
      );
    }

    const transaction = new WalletTransaction({
      user: userId,
      type: "credit",
      amount,
      balanceAfter: user.walletBalance + amount, // projected, not yet applied
      description,
      status: "pending",
      metadata: { requestedAt: new Date() },
    });

    await transaction.save();
    logger.info(
      `[WalletService] Top-up request created: GH₵${amount} for user ${userId}`,
    );
    return transaction;
  }

  /**
   * Approve or reject a manual top-up request.
   * The wallet is only credited here — not during request creation.
   */
  async processTopUpRequest(transactionId, approve, adminId) {
    const transaction = await WalletTransaction.findById(transactionId);
    if (!transaction) throw new Error("Transaction not found");
    if (transaction.status !== "pending") {
      throw new Error(
        `Transaction is already ${transaction.status}. Only pending transactions can be processed.`,
      );
    }

    if (approve) {
      const user = await User.findById(transaction.user);
      if (!user) throw new Error("User not found");

      user.walletBalance += transaction.amount;
      await user.save({ validateBeforeSave: false });

      transaction.status = "completed";
      transaction.approvedBy = adminId;
      transaction.balanceAfter = user.walletBalance;
      transaction.description = `${transaction.description} - Approved by admin`;

      logger.info(
        `[WalletService] Top-up approved: GH₵${transaction.amount} for user ${transaction.user}. Balance: GH₵${user.walletBalance}`,
      );
      await this._notifyUser(
        transaction.user,
        user.walletBalance,
        `Your top-up request for GH₵${transaction.amount} has been approved. New balance: GH₵${user.walletBalance}`,
      );
      await notificationService.sendWalletTopUpApprovalNotification(
        transaction.user.toString(),
        transaction.amount,
        adminId,
      );
    } else {
      transaction.status = "rejected";
      transaction.approvedBy = adminId;
      transaction.description = `${transaction.description} - Rejected by admin`;

      logger.info(
        `[WalletService] Top-up rejected: GH₵${transaction.amount} for user ${transaction.user}`,
      );

      const user = await User.findById(transaction.user);
      if (user) {
        await this._notifyUser(
          transaction.user,
          user.walletBalance,
          `Your top-up request for GH₵${transaction.amount} has been rejected.`,
        );
      }
      await notificationService.sendWalletTopUpRejectionNotification(
        transaction.user.toString(),
        transaction.amount,
        "Request rejected by administrator",
        adminId,
      );
    }

    await transaction.save();
    return transaction;
  }

  // ─── Instant Top-Up (Paystack Flow) ──────────────────────────────────────────

  /**
   * Generate Paystack checkout config WITHOUT writing anything to the database.
   *
   * Why: If the user closes the Paystack modal before paying, there is nothing
   * stuck in the DB to block their next attempt. The transaction is only
   * recorded inside processPaystackWebhook once payment is confirmed.
   */
  async initiatePaystackTopUp(userId, amount, returnUrl) {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    if (amount <= 0) throw new Error("Amount must be greater than zero");

    await paystackService.ensureKeys().catch(() => {});
    const publicKey = paystackService.getPublicKey();

    // ── Fee gross-up ────────────────────────────────────────────────────────
    // Use wallet-specific fee config (independent from storefront collection fees)
    const feeConfig = await getWalletTopUpFeeConfig();
    const { chargeAmount, paystackFee, platformFee, totalFee } =
      calculateChargeWithFees(amount, feeConfig);
    const targetCreditAmount = amount; // what gets credited to wallet
    const amountPesewas = paystackService.convertToPesewas(chargeAmount);

    const reference = `wallet_${userId}_${crypto.randomUUID().replace(/-/g, "").substring(0, 12)}`;

    // Ensure a Paystack customer record exists (best-effort)
    const customerEmail = user.email || `user-${userId}@wallet.paystack`;
    if (user.email && user.fullName) {
      const [first_name, ...rest] = user.fullName.trim().split(/\s+/);
      await paystackService
        .createCustomer({
          email: user.email,
          first_name,
          last_name: rest.join(" ") || undefined,
        })
        .catch((err) =>
          logger.warn(
            `[WalletService] createCustomer failed for user ${userId}: ${err.message}`,
          ),
        );
    }

    // ── Server-side initialization ──────────────────────────────────────────
    // Pre-register the transaction with Paystack so the reference is known
    // server-side before the popup opens. This enables:
    //   1. Paystack-side idempotency (rejects duplicate references)
    //   2. Consistent callback URL (controlled server-side)
    //   3. Early validation of amount and configuration
    // The frontend will use the returned access_code to resume this transaction.
    const frontendBase = (
      process.env.FRONTEND_URL || "http://localhost:5173"
    ).replace(/\/$/, "");
    const callbackUrl = returnUrl || `${frontendBase}/wallet/topup/callback`;

    const metadata = {
      type: "wallet_topup",
      userId: userId.toString(),
      targetCreditAmount,
      chargeAmount,
      paystackFee,
      platformFee,
      totalFee,
      feesDelegate: feeConfig.delegateFeesToCustomer,
    };

    let accessCode = null;
    let authorizationUrl = null;
    try {
      const initResult = await paystackService.initializeTransaction({
        email: customerEmail,
        amount: amountPesewas,
        reference,
        currency: "GHS",
        callback_url: callbackUrl,
        metadata,
      });
      accessCode = initResult.access_code;
      authorizationUrl = initResult.authorization_url;
    } catch (initErr) {
      logger.error(
        `[WalletService] Paystack initialize failed for user ${userId}: ${initErr.message}`,
      );
      // If initialization fails, throw — the frontend will show a clear error
      throw new Error(
        `Paystack checkout could not be initialized: ${initErr.message}`,
      );
    }

    // Create a background retry task ONLY after successful server-side init.
    // This is intentionally after the /transaction/initialize call so we only
    // track references that Paystack actually knows about.
    try {
      await PaystackVerificationTask.create({
        reference,
        kind: "wallet",
        userId,
        metadata: { expectedAmountPesewas: amountPesewas },
      });
    } catch (err) {
      logger.warn(
        "[WalletService] Could not create Paystack verification task",
        { error: err.message },
      );
    }

    logger.info(
      `[WalletService] Paystack checkout initialized for user ${userId}, ref: ${reference}, chargeAmount: ${chargeAmount}, targetCredit: ${targetCreditAmount}`,
    );

    return {
      reference,
      accessCode,
      authorizationUrl,
      publicKey,
      amount, // original requested amount (wallet credit)
      chargeAmount, // what Paystack charges the agent (may include fee gross-up)
      amountPesewas, // chargeAmount in pesewas -> what goes into PaystackPop.resumeTransaction
      targetCreditAmount,
      paystackFee,
      platformFee,
      totalFee,
      feesDelegate: feeConfig.delegateFeesToCustomer,
    };
  }

  /**
   * Process a confirmed Paystack payment (called from webhook or manual verify).
   * This is the ONLY place a Paystack top-up transaction is written to the DB.
   *
   * We intentionally avoid MongoDB sessions/transactions here so this works on
   * standalone MongoDB instances (no replica set required). Safety is provided by:
   *   1. The idempotency guard (findOne by reference + status:'completed') which
   *      prevents double-crediting the same payment reference.
   *   2. The atomic $inc on walletBalance which is safe without a session.
   * In the rare event the process crashes after the $inc but before the transaction
   * record is saved, re-running (webhook retry or manual verify) will find no
   * 'completed' record and credit the wallet again — so err on the side of crediting.
   */
  async processPaystackWebhook(webhookEvent) {
    const { data } = webhookEvent;
    const reference = data.reference;

    try {
      // ── 1. Parse metadata ────────────────────────────────────────────────────
      let metadata = data.metadata || {};
      if (typeof metadata === "string") {
        try {
          metadata = JSON.parse(metadata);
        } catch {
          logger.warn(
            `[WalletService] Could not parse Paystack metadata for ref ${reference}`,
          );
        }
      }

      // ── 2. Route guards ──────────────────────────────────────────────────────
      if (metadata.type !== "wallet_topup") {
        return { processed: false, reason: "not_wallet_topup" };
      }

      if (data.currency && data.currency !== "GHS") {
        logger.error(
          `[WalletService] Webhook rejected — non-GHS currency: ${data.currency}, ref: ${reference}`,
        );
        return { processed: false, reason: "currency_mismatch" };
      }

      // ── 3. Resolve user ──────────────────────────────────────────────────────
      const userId = metadata.userId;
      if (!userId) {
        throw new Error(
          `Paystack webhook missing userId in metadata for reference ${reference}`,
        );
      }

      // ── 4. Amount validation ─────────────────────────────────────────────────
      // Determine the expected amount. When available from the Paystack API use it;
      // otherwise fall back to the metadata value, checking against the background
      // task record for the server-initiated amount.
      const grossAmountGhs = data.amount / 100;
      const amountGhs = metadata.targetCreditAmount
        ? Math.min(parseFloat(metadata.targetCreditAmount), grossAmountGhs)
        : grossAmountGhs;

      // Verify against initiated amount from PaystackVerificationTask if available
      try {
        const task = await PaystackVerificationTask.findOne({ reference }).lean();
        if (task?.metadata?.expectedAmountPesewas) {
          const expectedGhs = task.metadata.expectedAmountPesewas / 100;
          const ghsDiff = Math.abs(grossAmountGhs - expectedGhs);
          const pctDiff = expectedGhs > 0 ? (ghsDiff / expectedGhs) * 100 : 0;
          if (ghsDiff > 1 && pctDiff > 1) {
            logger.error(
              `[WalletService] Amount mismatch for ref ${reference}: expected GH₵${expectedGhs}, received GH₵${grossAmountGhs}`,
            );
            return { processed: false, reason: "amount_mismatch" };
          }
        }
      } catch {
        // If the task lookup fails, proceed with caution but don't block
        logger.warn(
          `[WalletService] Could not verify expected amount for ref ${reference}`,
        );
      }

      // ── 5. Atomic idempotency guard — uses the unique compound index ────────
      // Instead of findOne-then-save (which has a race window), we attempt to
      // insert the WalletTransaction record directly. If the reference has
      // already been processed (status=completed), the unique compound index on
      // { reference, status } will throw a duplicate key error, and we can
      // safely return without crediting the wallet twice.
      //
      // We create the transaction record FIRST with status "processing", credit
      // the wallet, then update to "completed". If the process crashes between
      // steps, the "processing" record blocks double-credit and will be picked
      // up by the reconciliation job.

      // Check if any record (processing or completed) already exists for this ref
      const existingRecord = await WalletTransaction.findOne({
        reference,
        status: { $in: ["processing", "completed"] },
      }).lean();
      if (existingRecord) {
        logger.info(
          `[WalletService] Duplicate webhook ignored for ref: ${reference} (status: ${existingRecord.status})`,
        );
        return { processed: false, duplicate: true, status: existingRecord.status };
      }

      // Create the transaction record in "processing" state first (atomic insert)
      let transaction;
      try {
        transaction = await WalletTransaction.create({
          user: userId,
          type: "credit",
          amount: amountGhs,
          balanceAfter: 0, // will be updated after wallet credit
          description: `Wallet top-up via Paystack (${data.channel || "online"})`,
          status: "processing",
          reference,
          approvedBy: null,
          metadata: {
            paystack: {
              reference,
              transactionId: data.id,
              channel: data.channel,
              currency: data.currency,
              paidAt: data.paid_at || new Date(),
              processedAt: new Date(),
            },
            userId,
          },
        });
      } catch (insertErr) {
        // Duplicate key error — another process already recorded this reference
        if (insertErr.code === 11000) {
          logger.info(
            `[WalletService] Duplicate webhook (atomic guard) for ref: ${reference}`,
          );
          return { processed: false, duplicate: true };
        }
        throw insertErr;
      }

      // ── 6. Credit the wallet (atomic increment) ──────────────────────────────
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $inc: { walletBalance: amountGhs } },
        { new: true, runValidators: false },
      );
      if (!updatedUser) {
        // User deleted between steps — mark transaction as failed
        transaction.status = "failed";
        transaction.metadata.failureReason = "User not found during credit";
        await transaction.save();
        throw new Error(
          `User ${userId} not found for Paystack top-up ref ${reference}`,
        );
      }

      // ── 7. Mark transaction as completed ─────────────────────────────────────
      transaction.status = "completed";
      transaction.balanceAfter = updatedUser.walletBalance;
      await transaction.save();

      logger.info(
        `[WalletService] Paystack top-up complete: GH₵${amountGhs} for user ${userId}, ref: ${reference}`,
      );
      await logAuditAction(null, {
        userId,
        action: AUDIT_ACTIONS.WALLET_PAYSTACK_VERIFIED,
        category: AUDIT_CATEGORIES.WALLET,
        resource: { userId, reference },
        metadata: {
          source: "walletService.processPaystackWebhook",
          transactionId: data.id,
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      // ── 8. Notify user (non-critical — never let this break the response) ────
      await this._notifyUser(
        userId,
        updatedUser.walletBalance,
        `Your wallet has been credited with GH₵${amountGhs}. New balance: GH₵${updatedUser.walletBalance}`,
      );

      // Mark background retry task as completed (if one exists)
      try {
        await PaystackVerificationTask.findOneAndUpdate(
          { reference },
          { status: "done", lastError: null },
          { new: true },
        );
      } catch {
        // ignore
      }

      return { processed: true, transaction, user: updatedUser };
    } catch (err) {
      logger.error(
        `[WalletService] processPaystackWebhook error for ref ${reference}: ${err.message}`,
      );
      throw err;
    }
  }

  // ─── Agent Wallet Initialization ─────────────────────────────────────────────

  async initializeAgentWallet(userId) {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    if (!canHaveWallet(user.userType))
      throw new Error("Only business user wallets can be initialized");
    if (user.walletBalance > 0) throw new Error("Wallet already initialized");

    user.walletBalance = 0;
    await user.save({ validateBeforeSave: false });

    const transaction = await this._recordTransaction({
      userId,
      type: "credit",
      amount: 0,
      balanceAfter: 0,
      description: "Initial wallet balance for new agent",
    });

    logger.info(`[WalletService] Agent wallet initialized for user ${userId}`);
    return transaction;
  }

  // ─── Analytics ───────────────────────────────────────────────────────────────

  async getWalletAnalytics(tenantId = null, filter = {}) {
    const userQuery = tenantId ? { tenantId } : {};

    const [totalUsers, usersWithBalance, walletAggregation] = await Promise.all(
      [
        User.countDocuments(userQuery),
        User.countDocuments({ ...userQuery, walletBalance: { $gt: 0 } }),
        User.aggregate([
          { $match: userQuery },
          {
            $group: {
              _id: null,
              totalBalance: { $sum: "$walletBalance" },
              avgBalance: { $avg: "$walletBalance" },
              maxBalance: { $max: "$walletBalance" },
            },
          },
        ]),
      ],
    );

    let txnQuery = {};
    if (tenantId) {
      const tenantUsers = await User.find(userQuery).select("_id");
      txnQuery = { user: { $in: tenantUsers.map((u) => u._id) } };
    }

    const [txnStats, pendingRequests] = await Promise.all([
      WalletTransaction.aggregate([
        { $match: { ...txnQuery, ...filter } },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            total: { $sum: "$amount" },
          },
        },
      ]),
      WalletTransaction.countDocuments({ ...txnQuery, status: "pending" }),
    ]);

    const txnStatsFormatted = {
      credit: { count: 0, total: 0 },
      debit: { count: 0, total: 0 },
    };
    txnStats.forEach(({ _id, count, total }) => {
      if (_id) txnStatsFormatted[_id] = { count, total };
    });

    const agg = walletAggregation[0];
    return {
      users: {
        total: totalUsers,
        withBalance: usersWithBalance,
        withoutBalance: totalUsers - usersWithBalance,
      },
      balance: {
        total: agg?.totalBalance ?? 0,
        average: agg?.avgBalance ?? 0,
        highest: agg?.maxBalance ?? 0,
      },
      transactions: {
        credits: txnStatsFormatted.credit,
        debits: txnStatsFormatted.debit,
        pendingRequests,
      },
    };
  }

}

export default new WalletService();
