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
import mtnMomoService from "./mtnMomoService.js";

function normalizeGhanaPhoneNumber(phoneNumber) {
  if (!phoneNumber) return "";
  let cleaned = String(phoneNumber)
    .trim()
    .replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }

  if (cleaned.startsWith("00")) {
    cleaned = cleaned.slice(2);
  }

  if (cleaned.startsWith("233")) {
    return cleaned;
  }

  if (cleaned.startsWith("0")) {
    return `233${cleaned.slice(1)}`;
  }

  if (cleaned.length === 9) {
    return `233${cleaned}`;
  }

  return cleaned;
}

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
  async initiatePaystackTopUp(userId, amount) {
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

    const reference = `wallet_${userId}_${Date.now()}`;

    // Create a background retry task in case verification fails (network issues, Paystack hiccups)
    // so that the wallet top-up can be recovered automatically.
    try {
      await PaystackVerificationTask.create({
        reference,
        kind: "wallet",
        userId,
      });
    } catch (err) {
      logger.warn(
        "[WalletService] Could not create Paystack verification task",
        { error: err.message },
      );
    }

    // Ensure a Paystack customer record exists (best-effort)
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

    logger.info(
      `[WalletService] Paystack checkout prepared for user ${userId}, ref: ${reference}, chargeAmount: ${chargeAmount}, targetCredit: ${targetCreditAmount}`,
    );

    // NOTE: We do NOT call Paystack's /transaction/initialize here.
    // Server-side initialization pre-registers the reference with Paystack, which
    // causes a "Duplicate Transaction Reference" error when the inline popup also
    // tries to initialize client-side. Instead, the popup initializes the transaction
    // and carries the metadata (userId, targetCreditAmount) so the webhook can
    // credit the correct amount.
    return {
      reference,
      publicKey,
      amount, // original requested amount (wallet credit)
      chargeAmount, // what Paystack charges the agent (may include fee gross-up)
      amountPesewas, // chargeAmount in pesewas -> what goes into PaystackPop.setup
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

      // ── 3. Idempotency guard — never credit the same reference twice ─────────
      const alreadyProcessed = await WalletTransaction.findOne({
        reference,
        status: "completed",
      });
      if (alreadyProcessed) {
        logger.info(
          `[WalletService] Duplicate webhook ignored for ref: ${reference}`,
        );
        return { processed: false, duplicate: true };
      }

      // ── 4. Resolve user ──────────────────────────────────────────────────────
      const userId = metadata.userId;
      if (!userId) {
        throw new Error(
          `Paystack webhook missing userId in metadata for reference ${reference}`,
        );
      }

      // Credit the original requested amount if stored in metadata (fee gross-up case).
      // Fall back to data.amount / 100 for legacy transactions.
      // Cap at data.amount / 100 to prevent client-supplied metadata inflation.
      const grossAmountGhs = data.amount / 100;
      const amountGhs = metadata.targetCreditAmount
        ? Math.min(parseFloat(metadata.targetCreditAmount), grossAmountGhs)
        : grossAmountGhs;

      // ── 5. Credit the wallet (atomic increment — safe without a session) ─────
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $inc: { walletBalance: amountGhs } },
        { new: true, runValidators: false },
      );
      if (!updatedUser)
        throw new Error(
          `User ${userId} not found for Paystack top-up ref ${reference}`,
        );

      // ── 6. Record the completed transaction ──────────────────────────────────
      const transaction = new WalletTransaction({
        user: userId,
        type: "credit",
        amount: amountGhs,
        balanceAfter: updatedUser.walletBalance,
        description: `Wallet top-up via Paystack (${data.channel || "online"})`,
        status: "completed",
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
      await transaction.save();

      logger.info(
        `[WalletService] Paystack top-up complete: GH₵${amountGhs} for user ${userId}, ref: ${reference}`,
      );

      // ── 7. Notify user (non-critical — never let this break the response) ────
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
        `[WalletService] processPaystackWebhook error: ${err.message}`,
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

  async initiateMomoTopUp(userId, amount, phoneNumber) {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    if (amount <= 0) throw new Error("Amount must be greater than zero");

    // MTN top-ups use the exact requested amount; do not apply Paystack wallet fees or gross-up logic.
    // MTN sandbox sometimes rejects non-ASCII characters in message fields.
    const payerMessage = `Wallet top-up of ${amount} GHS`;

    const normalizedPhone = normalizeGhanaPhoneNumber(phoneNumber);
    if (!/^233\d{9}$/.test(normalizedPhone)) {
      throw new Error("Enter a valid Ghana MTN phone number.");
    }

    const referenceId = await mtnMomoService.requestToPay({
      amount,
      // currency removed — service auto-selects EUR/GHS based on environment
      partyId: normalizedPhone,
      externalId: userId.toString(),
      payerMessage,
      payeeNote: `Top-up for user ${userId}`,
    });

    // Store pending record so we can verify later
    await WalletTransaction.create({
      user: userId,
      type: "credit",
      amount,
      balanceAfter: user.walletBalance + amount, // projected
      description: `MoMo top-up GH₵${amount}`,
      status: "pending",
      reference: referenceId,
      metadata: {
        momoReferenceId: referenceId,
        phoneNumber: normalizedPhone,
        initiatedAt: new Date(),
      },
    });

    return { referenceId };
  }

  async verifyAndCreditMomoTopUp(userId, referenceId) {
    // Idempotency: already processed?
    const existing = await WalletTransaction.findOne({
      reference: referenceId,
      status: "completed",
    });
    if (existing) return existing;

    const pending = await WalletTransaction.findOne({
      reference: referenceId,
      user: userId,
      status: "pending",
    });
    if (!pending) throw new Error("No pending top-up found for this reference");

    // Check MTN transaction status
    let statusData;
    try {
      statusData = await mtnMomoService.getTransactionStatus(referenceId);
    } catch (err) {
      logger.error(
        `[WalletService] getTransactionStatus failed for ${referenceId}: ${err.message}`,
      );
      throw new Error(`Failed to verify MoMo transaction: ${err.message}`);
    }

    const status = (statusData?.status || "").toString().toUpperCase();

    // Successful -> credit wallet
    if (status === "SUCCESSFUL") {
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $inc: { walletBalance: pending.amount } },
        { new: true, runValidators: false },
      );
      if (!updatedUser) throw new Error(`User ${userId} not found`);

      pending.status = "completed";
      pending.balanceAfter = updatedUser.walletBalance;
      pending.description = "MoMo top-up confirmed";
      pending.metadata = {
        ...pending.metadata,
        momoReferenceId: referenceId,
        momoStatus: statusData,
        processedAt: new Date(),
      };
      await pending.save();

      logger.info(
        `[WalletService] MoMo top-up credited: GH₵${pending.amount} for user ${userId}, momoRef: ${referenceId}`,
      );

      // Notify the user (non-blocking for financial correctness)
      await this._notifyUser(
        userId,
        updatedUser.walletBalance,
        `Your wallet has been credited with GH₵${pending.amount}. New balance: GH₵${updatedUser.walletBalance}`,
      );

      return pending;
    }

    // Terminal failure statuses from provider — mark the DB record as rejected
    const terminalFailures = [
      "FAILED",
      "REJECTED",
      "CANCELLED",
      "EXPIRED",
      "ERROR",
      "TIMEOUT",
    ];
    if (terminalFailures.includes(status)) {
      pending.status = "rejected";
      pending.description = `${pending.description} - MoMo ${status}`;
      pending.metadata = {
        ...pending.metadata,
        momoReferenceId: referenceId,
        momoStatus: statusData,
        processedAt: new Date(),
        momoFailed: true,
      };
      await pending.save();

      logger.info(
        `[WalletService] MoMo top-up failed: ${status} for user ${userId}, momoRef: ${referenceId}`,
      );

      // Notify user of failure (best-effort)
      try {
        await notificationService.sendWalletTopUpRejectionNotification(
          pending.user.toString(),
          pending.amount,
          `Mobile Money ${status}`,
          "system",
        );
      } catch (notifyErr) {
        logger.warn(`[WalletService] notify failure: ${notifyErr.message}`);
      }

      throw new Error(`Payment failed. Status: ${statusData.status}`);
    }

    // Not yet successful -> allow caller to retry
    throw new Error(`Payment not yet successful. Status: ${statusData.status}`);
  }

  /**
   * Mark all existing pending MoMo top-ups as rejected.
   * This is a one-off cleanup utility used on startup to unblock users.
   * Returns an object { rejectedCount }
   */
  async markAllPendingMomoAsRejected({ limit = 2000 } = {}) {
    try {
      const query = {
        type: "credit",
        status: "pending",
        "metadata.momoReferenceId": { $exists: true },
      };

      const pending = await WalletTransaction.find(query).limit(limit);
      if (!pending || pending.length === 0) {
        logger.info(
          "markAllPendingMomoAsRejected: no pending MoMo top-ups found",
        );
        return { rejectedCount: 0 };
      }

      let rejectedCount = 0;
      for (const tx of pending) {
        try {
          tx.status = "rejected";
          tx.description = `${tx.description || "MoMo top-up"} - Auto-rejected (cleanup)`;
          tx.metadata = {
            ...(tx.metadata || {}),
            momoFailed: true,
            autoRejected: true,
            processedAt: new Date(),
          };
          await tx.save();
          rejectedCount += 1;

          try {
            await notificationService.sendWalletTopUpRejectionNotification(
              tx.user.toString(),
              tx.amount,
              "Auto-rejected: no payment verification",
              "system",
            );
          } catch (notifyErr) {
            logger.warn(
              `[WalletService] notify failure during auto-reject for tx ${tx._id}: ${notifyErr.message}`,
            );
          }
        } catch (err) {
          logger.error(
            `[WalletService] Failed to auto-reject tx ${tx._id}: ${err.message}`,
          );
        }
      }

      logger.info(
        `[WalletService] Auto-rejected ${rejectedCount} pending MoMo top-up(s)`,
      );
      return { rejectedCount };
    } catch (err) {
      logger.error(
        `[WalletService] markAllPendingMomoAsRejected failed: ${err.message}`,
      );
      return { rejectedCount: 0, error: err.message };
    }
  }
}

export default new WalletService();
