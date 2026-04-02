// src/services/payoutService.js
//
// Payout modes:
//   AUTO       — agent requests → balance deducted → Paystack transfer initiated immediately (no admin)
//   SEMI-AUTO  — agent requests → admin approves → Paystack transfer initiated by admin action
//   MANUAL     — agent requests → admin approves → admin sends money outside platform → marks complete
//
// Transfer webhook (transfer.success / transfer.failed) handles async confirmation for AUTO + SEMI-AUTO.

import mongoose from "mongoose";
import PayoutRequest from "../models/PayoutRequest.js";
import EarningsTransaction from "../models/EarningsTransaction.js";
import User from "../models/User.js";
import AgentStorefront from "../models/AgentStorefront.js";
import Order from "../models/Order.js";
import paystackService from "./paystackService.js";
import notificationService from "./notificationService.js";
import settingsService from "./settingsService.js";
import logger from "../utils/logger.js";
import { getFeeConfig } from "../utils/paystackHelpers.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Run `operation(session)` inside a MongoDB transaction when the server
 * supports it (replica set / Atlas). Gracefully falls back to running without
 * a session on standalone instances (Render free tier, local dev).
 *
 * The fallback triggers on ANY error from startSession/startTransaction —
 * standalone MongoDB throws "Transaction numbers are only allowed on a replica
 * set member or mongos" from startTransaction().
 */
async function withTransaction(operation) {
  // Hard bypass — set FORCE_NO_TRANSACTIONS=true in env on standalone MongoDB
  // to skip the session attempt entirely and avoid the error log noise.
  if (process.env.FORCE_NO_TRANSACTIONS === "true") {
    return operation(null);
  }

  let session = null;

  try {
    session = await mongoose.startSession();
  } catch {
    // startSession itself failed — run without session
    return operation(null);
  }

  try {
    session.startTransaction();
  } catch {
    // startTransaction failed — standalone MongoDB
    // End the session cleanly before falling back
    try {
      session.endSession();
    } catch {
      /* ignore */
    }
    return operation(null);
  }

  // Session + transaction started successfully — run the operation
  try {
    const result = await operation(session);
    try {
      await session.commitTransaction();
    } catch (commitErr) {
      // Some standalone builds accept startTransaction but reject commit.
      // If the error is a topology error, the writes already applied — continue.
      if (!isTopologyError(commitErr)) throw commitErr;
      logger.warn(
        "[Payout] withTransaction: commit not supported, writes already applied",
        {
          message: commitErr.message,
        },
      );
    }
    return result;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      /* ignore — standalone */
    }
    throw err;
  } finally {
    try {
      session.endSession();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Returns true when the error is a MongoDB topology/replica-set error that
 * means transactions are unsupported — NOT a business logic or validation error.
 * Only these errors should trigger the no-session fallback.
 */
function isTopologyError(err) {
  if (!err) return false;
  const msg = (err.message || "").toLowerCase();
  const code = err.code;
  // MongoServerError codes for "transactions not supported on this topology"
  if ([20, 61, 263].includes(code)) return true;
  return (
    msg.includes("transaction numbers are only allowed") ||
    msg.includes("replica set") ||
    msg.includes("transactions are not") ||
    msg.includes("does not support transactions") ||
    msg.includes("cannot use a session that is not in a transaction")
  );
}

/**
 * Deduct `amount` from the agent's earningsBalance and write an EarningsTransaction.
 * Works with or without a Mongoose session.
 */
async function deductEarnings(userId, amount, payoutId, description, session) {
  const opts = session ? { session, new: true } : { new: true };
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { earningsBalance: -amount } },
    opts,
  );
  if (!user) throw new Error("User not found");
  if (user.earningsBalance < 0) {
    // Roll back — we over-deducted. Restore and throw.
    await User.findByIdAndUpdate(
      userId,
      { $inc: { earningsBalance: amount } },
      opts,
    );
    throw new Error("Insufficient earnings balance");
  }

  const txData = {
    user: userId,
    type: "payout",
    amount: -amount,
    balanceAfter: user.earningsBalance,
    description,
    relatedPayout: payoutId,
    metadata: { auto: true },
  };
  if (session) {
    await EarningsTransaction.create([txData], { session });
  } else {
    await EarningsTransaction.create(txData);
  }
  return user;
}

/**
 * Restore `amount` to the agent's earningsBalance and write a credit EarningsTransaction.
 * Called on transfer failure or payout rejection after deduction already occurred.
 */
async function refundEarnings(
  userId,
  amount,
  payoutId,
  reason = "transfer_failed",
) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { earningsBalance: amount } },
    { new: true },
  );
  if (!user) {
    logger.error("[Payout] refundEarnings — user not found", {
      userId,
      amount,
      payoutId,
    });
    return;
  }
  await EarningsTransaction.create({
    user: userId,
    type: "credit",
    amount,
    balanceAfter: user.earningsBalance,
    description: `Refund for failed payout #${payoutId}`,
    relatedPayout: payoutId,
    metadata: { reason },
  });
  logger.info("[Payout] Earnings refunded", { userId, amount, payoutId });
}

/**
 * Notify agent of a payout status change. Never throws.
 */
async function notifyAgent(userId, title, message, type, extra = {}) {
  try {
    await notificationService.createInAppNotification(
      userId.toString(),
      title,
      message,
      type,
      { type: `payout_${type}`, ...extra },
    );
  } catch (err) {
    logger.warn("[Payout] Notification failed", {
      userId,
      title,
      message: err.message,
    });
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

class PayoutService {
  _normalizeDestination(destination = {}) {
    const type = destination.type;
    if (!type) return null;

    if (type === "mobile_money") {
      return {
        type,
        mobileProvider: destination.mobileProvider,
        phoneNumber: String(destination.phoneNumber || "").replace(/\s+/g, ""),
        accountName: destination.accountName
          ? String(destination.accountName).trim()
          : undefined,
        recipientName: destination.recipientName,
        recipientCode: destination.recipientCode,
      };
    }

    if (type === "bank_account") {
      return {
        type,
        bankCode: String(destination.bankCode || "").trim(),
        accountNumber: String(destination.accountNumber || "").trim(),
        accountName: destination.accountName
          ? String(destination.accountName).trim()
          : undefined,
        recipientName: destination.recipientName,
        recipientCode: destination.recipientCode,
      };
    }

    return null;
  }

  // ── Fee Calculation ──────────────────────────────────────────────────────────

  /**
   * Returns fee breakdown for a payout:
   *   paystackFee   — Paystack's flat transfer fee (GHS)
   *   platformFee   — Platform's % cut of the gross amount (GHS)
   *   transferFee   — total fee (paystackFee + platformFee)
   *   netAmount     — what the agent actually receives
   *   feeBearer     — 'agent' | 'platform'
   */
  async calculateTransferFee(amount, destinationType) {
    const cfg = await getFeeConfig();
    const fees = cfg.paystackTransferFees || {};

    const paystackFee =
      destinationType === "bank_account"
        ? (fees.bank_account ?? 8.0)
        : (fees.mobile_money ?? 1.0);

    const platformFeePercent = cfg.platformPayoutFeePercent ?? 0;
    const platformFee = Math.round(amount * platformFeePercent) / 100;
    const transferFee = Math.round((paystackFee + platformFee) * 100) / 100;
    const feeBearer = cfg.payoutFeeBearer ?? "agent";
    const netAmount =
      feeBearer === "agent"
        ? Math.max(0, Math.round((amount - transferFee) * 100) / 100)
        : amount;

    return { paystackFee, platformFee, transferFee, netAmount, feeBearer };
  }

  // ── Destination Validation ───────────────────────────────────────────────────

  async validateDestination(destination) {
    if (destination.type === "mobile_money") {
      if (!destination.accountName || !String(destination.accountName).trim()) {
        throw new Error("Mobile money account name is required");
      }
      if (!this._isValidGhanaPhone(destination.phoneNumber)) {
        throw new Error("Invalid Ghana phone number format");
      }
      const network = this._detectNetwork(destination.phoneNumber);
      if (network !== destination.mobileProvider) {
        throw new Error(
          `Phone number does not match ${destination.mobileProvider} network`,
        );
      }
      destination.accountName = String(destination.accountName).trim();
      destination.recipientName = destination.accountName;
    } else if (destination.type === "bank_account") {
      try {
        const resolved = await paystackService.resolveAccountNumber(
          destination.accountNumber,
          destination.bankCode,
        );
        destination.recipientName = resolved.account_name;
      } catch {
        throw new Error(
          "Could not verify bank account. Please check account number and bank.",
        );
      }
    }
  }

  _isValidGhanaPhone(phone) {
    const c = String(phone).replace(/[\s\-()]/g, "");
    return /^0?[2-5]\d{8,9}$/.test(c) || /^233[2-5]\d{8}$/.test(c);
  }

  _detectNetwork(phone) {
    const last9 = String(phone).replace(/\D/g, "").slice(-9);
    const prefix = last9.slice(0, 2);
    if (["24", "54", "55", "59"].includes(prefix)) return "MTN";
    if (["20", "50"].includes(prefix)) return "TELECEL";
    if (["27", "57", "26", "56"].includes(prefix)) return "AT";
    return null;
  }

  // ── Paystack Recipient ───────────────────────────────────────────────────────

  async _ensurePaystackRecipient(payout) {
    if (payout.destination?.recipientCode)
      return payout.destination.recipientCode;

    const dest = payout.destination;
    const name = dest.recipientName || payout.user?.fullName || "Recipient";

    const payload = {
      name,
      currency: "GHS",
      type: dest.type === "mobile_money" ? "mobile_money" : "nuban",
      account_number:
        dest.type === "mobile_money" ? dest.phoneNumber : dest.accountNumber,
      bank_code:
        dest.type === "mobile_money" ? dest.mobileProvider : dest.bankCode,
    };

    const recipient = await paystackService.createTransferRecipient(payload);
    payout.destination.recipientCode = recipient.recipient_code;
    await payout.save();
    return recipient.recipient_code;
  }

  // ── Initiate Paystack Transfer ───────────────────────────────────────────────

  /**
   * Calls Paystack /transfer and updates the payout document to 'processing'.
   * Throws a clean, structured error if Paystack rejects the transfer.
   * Does NOT deduct earnings — caller must deduct before calling this.
   *
   * On Paystack Starter plan, the transfer API returns 400 "Transfer feature
   * is not available on your account". We surface this clearly so the admin
   * can fall back to manual completion.
   */
  async _initiatePaystackTransfer(payout) {
    await paystackService.ensureKeys();
    if (!paystackService.isConfigured()) {
      throw Object.assign(
        new Error("Paystack is not configured for transfers"),
        {
          code: "PAYSTACK_NOT_CONFIGURED",
        },
      );
    }

    // Recalculate fees if not set (handles legacy payouts)
    if (!payout.netAmount || !payout.transferFee) {
      const fees = await this.calculateTransferFee(
        payout.amount,
        payout.destination?.type,
      );
      payout.transferFee = fees.transferFee;
      payout.netAmount = fees.netAmount;
      await payout.save();
    }

    if (payout.netAmount <= 0) {
      throw Object.assign(
        new Error(
          "Net payout amount is zero or negative after fees. Adjust amount or fee settings.",
        ),
        { code: "ZERO_NET_AMOUNT" },
      );
    }

    const recipientCode = await this._ensurePaystackRecipient(payout);
    const transferRef = `payout_${payout._id}_${Date.now()}`;

    let transfer;
    try {
      transfer = await paystackService.initiateTransfer({
        source: "balance",
        amount: paystackService.convertToPesewas(payout.netAmount),
        recipient: recipientCode,
        reference: transferRef,
        reason: `Payout for ${payout.user?.fullName || payout.user}`,
      });
    } catch (err) {
      // Extract the cleanest possible message from Paystack
      const psData = err?.response?.data;
      const psMessage = psData?.message || err.message;
      const psCode = psData?.code || "TRANSFER_FAILED";

      // Save the failure reason without changing status — admin can retry or mark manual
      payout.paystackTransfer = {
        ...(payout.paystackTransfer || {}),
        failureReason: psMessage,
      };
      await payout.save().catch(() => {});

      logger.error("[Payout] Paystack transfer rejected", {
        payoutId: payout._id,
        code: psCode,
        message: psMessage,
      });

      throw Object.assign(new Error(psMessage), {
        code: psCode,
        paystackData: psData,
      });
    }

    payout.status = "processing";
    payout.paystackTransfer = {
      transferCode: transfer.transfer_code || transfer.id,
      transferReference: transferRef,
      recipientCode,
      status: transfer.status || "pending",
      transferredAt: new Date(),
    };
    await payout.save();

    logger.info("[Payout] Transfer initiated", {
      payoutId: payout._id,
      transferCode: payout.paystackTransfer.transferCode,
    });

    return payout;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API — Agent Actions
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Agent submits a payout request.
   * Returns { payout, mode: 'auto' | 'semi_auto' | 'manual' }
   *
   * If autoPayoutEnabled is true, the caller should immediately invoke
   * processAutoRequestedPayout(payout._id) in the background.
   */
  async requestPayout(userId, amount, destination) {
    return withTransaction(async (session) => {
      const opts = session ? { session } : {};
      const user = await User.findById(userId, null, opts);
      if (!user) throw new Error("User not found");

      const hasProvidedDestination = Boolean(destination?.type);
      const destinationInput = hasProvidedDestination
        ? destination
        : user.payoutAccount;
      if (!destinationInput?.type) {
        throw new Error(
          "No saved payout account found. Please add payout account details.",
        );
      }
      const normalizedDestination =
        this._normalizeDestination(destinationInput);
      if (!normalizedDestination?.type) {
        throw new Error("Invalid payout destination.");
      }

      const balance = Number(user.earningsBalance) || 0;
      if (balance < amount) {
        throw new Error(
          `Insufficient earnings. Available: GHS ${balance.toFixed(2)}`,
        );
      }

      const { minimumPayoutAmounts, autoPayoutEnabled } =
        await settingsService.getPayoutSettings();

      const minPayout =
        normalizedDestination.type === "bank_account"
          ? minimumPayoutAmounts.bank_account
          : minimumPayoutAmounts.mobile_money;

      if (amount < minPayout) {
        throw new Error(`Minimum payout is GHS ${minPayout}`);
      }

      const existing = await PayoutRequest.findOne(
        {
          user: userId,
          status: { $in: ["pending", "approved", "processing"] },
        },
        null,
        opts,
      );
      if (existing) {
        throw new Error(
          "You have a pending payout request. Please wait for it to be processed.",
        );
      }

      await this.validateDestination(normalizedDestination);

      // Persist as user's default payout account for subsequent quick withdrawals.
      if (hasProvidedDestination) {
        user.payoutAccount = {
          ...normalizedDestination,
          updatedAt: new Date(),
        };
        if (session) await user.save({ session });
        else await user.save();
      }

      const fees = await this.calculateTransferFee(
        amount,
        normalizedDestination.type,
      );

      const payout = new PayoutRequest({
        user: userId,
        amount,
        transferFee: fees.transferFee,
        netAmount: fees.netAmount,
        destination: normalizedDestination,
        requestedAt: new Date(),
        metadata: {
          feeBearer: fees.feeBearer,
          paystackFee: fees.paystackFee,
          platformFee: fees.platformFee,
        },
      });

      if (session) await payout.save({ session });
      else await payout.save();

      logger.info("[Payout] Request created", {
        userId,
        amount,
        payoutId: payout._id,
        autoPayoutEnabled,
      });

      // Notify admins only when they need to take action (semi-auto / manual)
      if (!autoPayoutEnabled) {
        const admins = await User.find({
          userType: "super_admin",
          isActive: true,
        }).select("_id");
        for (const admin of admins) {
          await notifyAgent(
            admin._id,
            "New Payout Request",
            `${user.fullName} requested a payout of GHS ${amount.toFixed(2)}`,
            "info",
            { payoutId: payout._id },
          );
        }
      }

      const mode = autoPayoutEnabled ? "auto" : "semi_auto";
      return { payout, mode, autoPayoutEnabled: Boolean(autoPayoutEnabled) };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Mode: AUTO
  // Agent request → immediate Paystack transfer (no admin step)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Deduct earnings atomically, then fire the Paystack transfer.
   * If the transfer fails (e.g. Starter plan restriction), earnings are
   * refunded and the payout is set back to 'pending' so it appears in the
   * admin queue for manual resolution.
   */
  async processAutoRequestedPayout(payoutId) {
    const payout = await PayoutRequest.findById(payoutId).populate("user");
    if (!payout) throw new Error("Payout not found");
    if (payout.status !== "pending") {
      throw new Error(
        `Cannot auto-process payout with status: ${payout.status}`,
      );
    }

    // ── Step 1: Deduct earnings atomically ────────────────────────────────────
    await withTransaction(async (session) => {
      const user = payout.user;
      const balance = Number(user.earningsBalance) || 0;
      if (balance < payout.amount)
        throw new Error("Insufficient earnings balance");

      const updated = await User.findByIdAndUpdate(
        user._id,
        { $inc: { earningsBalance: -payout.amount } },
        session ? { session, new: true } : { new: true },
      );

      const txData = {
        user: user._id,
        type: "payout",
        amount: -payout.amount,
        balanceAfter: updated.earningsBalance,
        description: `Auto-payout request #${payout._id}`,
        relatedPayout: payout._id,
        metadata: { auto: true },
      };
      if (session) await EarningsTransaction.create([txData], { session });
      else await EarningsTransaction.create(txData);

      payout.status = "approved";
      payout.reviewedAt = new Date();
      payout.processedAt = new Date();
      payout.metadata = { ...(payout.metadata || {}), autoApproved: true };
      await payout.save();
    });

    // ── Step 2: Initiate Paystack transfer ────────────────────────────────────
    try {
      await this._initiatePaystackTransfer(payout);
      return payout;
    } catch (err) {
      // Transfer failed — refund earnings and surface clearly
      logger.error("[Payout] Auto-payout transfer failed, refunding earnings", {
        payoutId,
        code: err.code,
        message: err.message,
      });

      await refundEarnings(
        payout.user._id,
        payout.amount,
        payoutId,
        "auto_transfer_failed",
      );

      // Reset to pending so it shows in admin queue for manual resolution
      payout.status = "pending";
      payout.reviewedAt = undefined;
      payout.processedAt = undefined;
      payout.metadata = {
        ...(payout.metadata || {}),
        autoApproved: false,
        autoFailReason: err.message,
        autoFailCode: err.code,
        autoFailedAt: new Date(),
      };
      await payout.save().catch(() => {});

      await notifyAgent(
        payout.user._id,
        "Auto-Payout Failed",
        `Your payout of GHS ${payout.amount.toFixed(2)} could not be processed automatically. An admin will review it shortly.`,
        "error",
        { payoutId },
      );

      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Mode: SEMI-AUTO  (Admin step 1: approve + deduct)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin approves the payout — deducts earnings and marks as approved.
   * A separate call to processApprovedPayout() fires the actual Paystack transfer.
   *
   * Passing `transferReference` skips the Paystack transfer entirely and marks
   * the payout complete immediately (used when the admin already sent money manually).
   */
  async approvePayout(payoutId, adminId, transferReference = null) {
    return withTransaction(async (session) => {
      const payout = session
        ? await PayoutRequest.findById(payoutId)
            .populate("user")
            .session(session)
        : await PayoutRequest.findById(payoutId).populate("user");

      if (!payout) throw new Error("Payout not found");
      if (payout.status !== "pending")
        throw new Error(`Payout is already ${payout.status}`);

      const fees =
        payout.netAmount != null
          ? { netAmount: payout.netAmount }
          : await this.calculateTransferFee(
              payout.amount,
              payout.destination?.type ?? "mobile_money",
            );

      if (fees.netAmount <= 0) {
        throw new Error(
          "Net amount is zero or negative after fees. Adjust amount or fee settings before approving.",
        );
      }

      const user = payout.user;
      const balance = Number(user.earningsBalance) || 0;
      if (balance < payout.amount)
        throw new Error("Insufficient earnings balance");

      // Atomic deduction
      const updated = await User.findByIdAndUpdate(
        user._id,
        { $inc: { earningsBalance: -payout.amount } },
        session ? { session, new: true } : { new: true },
      );

      const txData = {
        user: user._id,
        type: "payout",
        amount: -payout.amount,
        balanceAfter: updated.earningsBalance,
        description: `Payout approved #${payout._id}`,
        relatedPayout: payout._id,
        metadata: { destination: payout.destination },
      };
      if (session) await EarningsTransaction.create([txData], { session });
      else await EarningsTransaction.create(txData);

      payout.status = transferReference ? "completed" : "approved";
      payout.reviewedBy = adminId;
      payout.reviewedAt = new Date();
      payout.processedAt = new Date();
      if (transferReference) {
        payout.completedAt = new Date();
        payout.paystackTransfer = {
          ...(payout.paystackTransfer || {}),
          transferReference,
        };
      }
      await payout.save();

      logger.info("[Payout] Approved", {
        payoutId,
        userId: user._id,
        amount: payout.amount,
        transferReference,
      });

      const msg = transferReference
        ? `Your payout of GHS ${payout.amount.toFixed(2)} has been approved and completed. Reference: ${transferReference}`
        : `Your payout request of GHS ${payout.amount.toFixed(2)} has been approved. Transfer in progress.`;
      await notifyAgent(user._id, "Payout Approved", msg, "success", {
        payoutId,
      });

      return payout;
    });
  }

  /**
   * Admin fires the Paystack transfer for an already-approved payout (semi-auto path).
   * Does not touch earnings — deduction happened in approvePayout.
   * If Paystack rejects, leaves the payout as 'approved' so the admin can
   * retry or fall back to markManuallyCompleted.
   */
  async processApprovedPayout(payoutId) {
    const payout = await PayoutRequest.findById(payoutId).populate("user");
    if (!payout) throw new Error("Payout not found");

    if (payout.status === "completed") {
      throw Object.assign(new Error("Payout is already completed"), {
        code: "ALREADY_COMPLETED",
      });
    }
    if (payout.status === "processing") {
      throw Object.assign(new Error("Payout is already being processed"), {
        code: "ALREADY_PROCESSING",
      });
    }
    if (payout.status !== "approved") {
      throw Object.assign(
        new Error(
          `Payout must be in 'approved' state. Current: ${payout.status}`,
        ),
        { code: "NOT_APPROVED", status: payout.status },
      );
    }

    return this._initiatePaystackTransfer(payout);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Mode: MANUAL  (Admin sends money outside platform, then marks complete)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin marks an approved or failed payout as manually completed.
   * If the payout was 'failed' (Paystack webhook set it), earnings are
   * re-deducted here since the refundEarnings already ran on failure.
   */
  async markManuallyCompleted(payoutId, adminId, transferReference) {
    const payout = await PayoutRequest.findById(payoutId).populate("user");
    if (!payout) throw new Error("Payout not found");

    if (!["approved", "failed", "pending"].includes(payout.status)) {
      throw new Error(
        `Cannot manually complete payout with status: ${payout.status}`,
      );
    }

    // If failed, earnings were already refunded by the webhook handler.
    // Re-deduct them now since we're confirming the money was actually sent.
    if (payout.status === "failed") {
      const user = payout.user;
      const balance = Number(user.earningsBalance) || 0;
      if (balance < payout.amount) {
        throw new Error(
          `Agent has insufficient earnings (GHS ${balance.toFixed(2)}) to finalise this payout. ` +
            `Consider rejecting instead.`,
        );
      }
      await deductEarnings(
        user._id,
        payout.amount,
        payoutId,
        `Manual completion re-deduction for payout #${payoutId}`,
        null,
      );
    }

    // If pending (auto-payout fell back), deduct earnings now
    if (payout.status === "pending") {
      const user = payout.user;
      const balance = Number(user.earningsBalance) || 0;
      if (balance < payout.amount) {
        throw new Error(
          `Insufficient earnings balance (GHS ${balance.toFixed(2)})`,
        );
      }
      await deductEarnings(
        user._id,
        payout.amount,
        payoutId,
        `Manual completion for pending payout #${payoutId}`,
        null,
      );
    }

    payout.status = "completed";
    payout.reviewedBy = payout.reviewedBy || adminId;
    payout.completedAt = new Date();
    payout.paystackTransfer = {
      ...(payout.paystackTransfer || {}),
      transferReference:
        transferReference || `manual_${payoutId}_${Date.now()}`,
    };
    payout.metadata = {
      ...(payout.metadata || {}),
      manuallyCompleted: true,
      completedBy: adminId,
    };
    await payout.save();

    logger.info("[Payout] Manually completed", {
      payoutId,
      adminId,
      transferReference,
    });

    const ref = transferReference ? ` Reference: ${transferReference}` : "";
    await notifyAgent(
      payout.user._id,
      "Payout Completed",
      `Your payout of GHS ${payout.amount.toFixed(2)} has been sent.${ref}`,
      "success",
      { payoutId },
    );

    return payout;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Admin: Reject payout
  // ═══════════════════════════════════════════════════════════════════════════

  async rejectPayout(payoutId, adminId, rejectionReason) {
    const payout = await PayoutRequest.findById(payoutId).populate("user");
    if (!payout) throw new Error("Payout not found");

    const refundable = ["approved", "processing"].includes(payout.status);
    const rejectable = ["pending", "approved", "processing", "failed"].includes(
      payout.status,
    );

    if (!rejectable) {
      throw new Error(
        `Payout cannot be rejected from status: ${payout.status}`,
      );
    }

    // Refund earnings if they were already deducted
    if (refundable) {
      await refundEarnings(
        payout.user._id,
        payout.amount,
        payoutId,
        "admin_rejected",
      );
    }

    payout.status = "rejected";
    payout.reviewedBy = adminId;
    payout.reviewedAt = new Date();
    payout.rejectionReason = rejectionReason || "Rejected by administrator";
    await payout.save();

    logger.info("[Payout] Rejected", { payoutId, userId: payout.user._id });

    await notifyAgent(
      payout.user._id,
      "Payout Rejected",
      `Your payout of GHS ${payout.amount.toFixed(2)} was rejected. ${payout.rejectionReason}`,
      "error",
      { payoutId },
    );

    return payout;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Paystack Webhook Handler
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handles transfer.success and transfer.failed events from Paystack.
   * These are async confirmations — the payout is already in 'processing' state.
   *
   * transfer.success → mark completed, credit profit notification
   * transfer.failed  → mark failed, refund earnings, notify agent
   */
  async handleTransferWebhook(event) {
    const { data } = event;
    const reference = data.reference;

    const payout = await PayoutRequest.findOne({
      "paystackTransfer.transferReference": reference,
    }).populate("user");

    if (!payout) {
      logger.warn("[Payout Webhook] No payout found for transfer reference", {
        reference,
      });
      return;
    }

    if (event.event === "transfer.success") {
      if (payout.status === "completed") {
        logger.info("[Payout Webhook] Already completed — idempotency guard", {
          payoutId: payout._id,
        });
        return;
      }
      payout.status = "completed";
      payout.completedAt = new Date();
      if (payout.paystackTransfer) payout.paystackTransfer.status = "success";
      await payout.save();

      logger.info("[Payout Webhook] Transfer successful", {
        payoutId: payout._id,
        amount: payout.amount,
      });

      await notifyAgent(
        payout.user._id,
        "Payout Completed",
        `Your payout of GHS ${payout.amount.toFixed(2)} has been sent successfully.`,
        "success",
        { payoutId: payout._id },
      );
    } else if (event.event === "transfer.failed") {
      if (payout.status === "failed") {
        logger.info("[Payout Webhook] Already failed — idempotency guard", {
          payoutId: payout._id,
        });
        return;
      }

      const reason = data.failure_reason || data.reason || "Transfer failed";
      payout.status = "failed";
      if (payout.paystackTransfer) {
        payout.paystackTransfer.status = "failed";
        payout.paystackTransfer.failureReason = reason;
      }
      await payout.save();

      logger.error("[Payout Webhook] Transfer failed", {
        payoutId: payout._id,
        reason,
      });

      // Refund earnings — agent can re-request
      await refundEarnings(payout.user._id, payout.amount, payout._id, reason);

      await notifyAgent(
        payout.user._id,
        "Payout Failed",
        `Your payout of GHS ${payout.amount.toFixed(2)} failed (${reason}). Your earnings have been restored.`,
        "error",
        { payoutId: payout._id },
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Queries
  // ═══════════════════════════════════════════════════════════════════════════

  async getEarningsDashboard(userId) {
    const user = await User.findById(userId).select(
      "earningsBalance walletBalance payoutAccount",
    );
    if (!user) throw new Error("User not found");

    const [agg] = await EarningsTransaction.aggregate([
      {
        $match: {
          user: user._id,
          type: "credit",
          $or: [
            { "metadata.source": "storefront_order_completed" },
            {
              $and: [
                { relatedOrder: { $exists: true, $ne: null } },
                {
                  description: { $regex: "^Storefront profit", $options: "i" },
                },
              ],
            },
          ],
        },
      },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: "$amount" },
        },
      },
    ]);

    const [completedWithdrawn] = await PayoutRequest.aggregate([
      { $match: { user: user._id, status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const recentPayouts = await PayoutRequest.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const feeConfig = await getFeeConfig();
    const payoutSettings = await settingsService.getPayoutSettings();

    // canAutoPayout is the single source of truth for "is auto mode actually live?".
    // Requires BOTH the admin setting AND Paystack keys configured.
    // Mirrors the logic in getAutoPayoutAvailability() so all components agree.
    const paystackConfigured = paystackService.isConfigured();
    const autoPayoutEnabled = payoutSettings.autoPayoutEnabled || false;
    const canAutoPayout = autoPayoutEnabled && paystackConfigured;

    const minMoMo = payoutSettings.minimumPayoutAmounts.mobile_money;

    return {
      availableBalance: Number(user.earningsBalance) || 0,
      walletBalance: Number(user.walletBalance) || 0,
      totalEarned: agg?.totalEarned || 0,
      totalWithdrawn: Math.abs(completedWithdrawn?.total || 0),
      recentPayouts,
      transferFees: {
        mobile_money: feeConfig.paystackTransferFees?.mobile_money ?? 1.0,
        bank_account: feeConfig.paystackTransferFees?.bank_account ?? 8.0,
      },
      payoutFeeBearer: feeConfig.payoutFeeBearer ?? "agent",
      platformPayoutFeePercent: feeConfig.platformPayoutFeePercent ?? 0,
      autoPayoutEnabled,
      canAutoPayout,
      paystackConfigured,
      savedPayoutAccount: user.payoutAccount || null,
      minimumPayoutAmounts: payoutSettings.minimumPayoutAmounts,
      canRequestPayout: (Number(user.earningsBalance) || 0) >= minMoMo,
    };
  }

  async getEarningsReconciliation(userId) {
    const user = await User.findById(userId).select("earningsBalance");
    if (!user) throw new Error("User not found");

    const [agg] = await EarningsTransaction.aggregate([
      {
        $match: {
          user: user._id,
          type: "credit",
          $or: [
            { "metadata.source": "storefront_order_completed" },
            {
              $and: [
                { relatedOrder: { $exists: true, $ne: null } },
                {
                  description: { $regex: "^Storefront profit", $options: "i" },
                },
              ],
            },
          ],
        },
      },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: "$amount" },
        },
      },
    ]);

    const [completedWithdrawn] = await PayoutRequest.aggregate([
      { $match: { user: user._id, status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalEarned = agg?.totalEarned || 0;
    const totalWithdrawn = Math.abs(completedWithdrawn?.total || 0);
    const expectedAvailable = totalEarned - totalWithdrawn;
    const availableBalance = Number(user.earningsBalance) || 0;
    const delta = availableBalance - expectedAvailable;

    return {
      userId: user._id,
      availableBalance,
      totalEarned,
      totalWithdrawn,
      expectedAvailable,
      delta,
      isBalanced: Math.abs(delta) <= 0.01,
      reconciledAt: new Date(),
    };
  }

  async applyEarningsReconciliation(userId, adminId, reason) {
    const reconciliation = await this.getEarningsReconciliation(userId);

    if (reconciliation.isBalanced) {
      return { ...reconciliation, adjusted: false };
    }

    const adjustmentAmount = Math.abs(reconciliation.delta);
    const adjustmentType = reconciliation.delta < 0 ? "credit" : "debit";

    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          earningsBalance:
            adjustmentType === "credit" ? adjustmentAmount : -adjustmentAmount,
        },
      },
      { new: true },
    );

    if (!updated) throw new Error("User not found");

    const description = reason?.trim()
      ? `Admin reconciliation adjustment: ${reason.trim()}`
      : "Admin reconciliation adjustment";

    const transaction = await EarningsTransaction.create({
      user: userId,
      type: adjustmentType,
      amount: adjustmentAmount,
      balanceAfter: updated.earningsBalance,
      description,
      metadata: {
        source: "admin_reconciliation",
        adminId,
        reason: reason?.trim() || null,
        expectedAvailable: reconciliation.expectedAvailable,
        previousAvailable: reconciliation.availableBalance,
        delta: reconciliation.delta,
      },
    });

    const deltaAfter =
      (Number(updated.earningsBalance) || 0) - reconciliation.expectedAvailable;

    return {
      ...reconciliation,
      availableBalance: Number(updated.earningsBalance) || 0,
      delta: deltaAfter,
      isBalanced: Math.abs(deltaAfter) <= 0.01,
      adjusted: true,
      adjustedAt: new Date(),
      adjustment: {
        type: adjustmentType,
        amount: adjustmentAmount,
        transactionId: transaction._id,
      },
    };
  }

  async getEarningsBackfillPreview(userId, limit = 50) {
    const storefronts = await AgentStorefront.find({ agentId: userId })
      .select("_id")
      .lean();
    const storefrontIds = storefronts.map((sf) => sf._id);

    if (storefrontIds.length === 0) {
      return { missingCount: 0, totalMissingAmount: 0, orders: [] };
    }

    const missingOrders = await Order.aggregate([
      {
        $match: {
          orderType: "storefront",
          status: "completed",
          "storefrontData.storefrontId": { $in: storefrontIds },
          "storefrontData.totalMarkup": { $gt: 0 },
        },
      },
      {
        $lookup: {
          from: "earningstransactions",
          let: { orderId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$relatedOrder", "$$orderId"] },
                    { $eq: ["$type", "credit"] },
                  ],
                },
              },
            },
            { $project: { _id: 1 } },
          ],
          as: "earningsTxns",
        },
      },
      { $match: { "earningsTxns.0": { $exists: false } } },
      {
        $project: {
          _id: 1,
          orderNumber: 1,
          totalMarkup: "$storefrontData.totalMarkup",
          storefrontId: "$storefrontData.storefrontId",
          createdAt: 1,
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: Math.max(1, Number(limit) || 50) },
    ]);

    const totalMissingAmount = missingOrders.reduce(
      (sum, order) => sum + (Number(order.totalMarkup) || 0),
      0,
    );

    return {
      missingCount: missingOrders.length,
      totalMissingAmount,
      orders: missingOrders,
    };
  }

  async applyEarningsBackfill(userId, adminId, reason, limit = 50) {
    const preview = await this.getEarningsBackfillPreview(userId, limit);

    if (preview.missingCount === 0) {
      const user = await User.findById(userId).select("earningsBalance");
      return {
        appliedCount: 0,
        totalAppliedAmount: 0,
        availableBalance: Number(user?.earningsBalance) || 0,
        ordersApplied: [],
      };
    }

    const ordersApplied = [];
    const totalAppliedAmount = await withTransaction(async (session) => {
      let total = 0;
      for (const order of preview.orders) {
        const existingTxn = await EarningsTransaction.findOne(
          { relatedOrder: order._id, type: "credit" },
          null,
          session ? { session } : {},
        );
        if (existingTxn) continue;

        const markup = Number(order.totalMarkup) || 0;
        if (markup <= 0) continue;

        const updatedAgent = await User.findByIdAndUpdate(
          userId,
          { $inc: { earningsBalance: markup } },
          session
            ? { session, new: true, runValidators: false }
            : { new: true, runValidators: false },
        );

        if (!updatedAgent) throw new Error("User not found");

        const description = reason?.trim()
          ? `Admin backfill: ${reason.trim()}`
          : "Admin backfill for missing storefront profit";

        const txData = {
          user: userId,
          type: "credit",
          amount: markup,
          balanceAfter: updatedAgent.earningsBalance,
          description,
          relatedOrder: order._id,
          metadata: {
            source: "admin_backfill",
            adminId,
            reason: reason?.trim() || null,
            orderNumber: order.orderNumber,
            storefrontId: order.storefrontId?.toString(),
            markup,
          },
        };

        if (session) {
          await EarningsTransaction.create([txData], { session });
          await Order.findByIdAndUpdate(
            order._id,
            { "metadata.profitCredited": true },
            { session },
          );
        } else {
          await EarningsTransaction.create(txData);
          await Order.findByIdAndUpdate(order._id, {
            "metadata.profitCredited": true,
          });
        }

        ordersApplied.push({
          orderId: order._id,
          orderNumber: order.orderNumber,
          amount: markup,
        });
        total += markup;
      }
      return total;
    });

    const user = await User.findById(userId).select("earningsBalance");

    return {
      appliedCount: ordersApplied.length,
      totalAppliedAmount,
      availableBalance: Number(user?.earningsBalance) || 0,
      ordersApplied,
    };
  }

  async getPayoutsForUser(userId, filters = {}) {
    const query = { user: userId };
    if (filters.status) query.status = filters.status;
    return PayoutRequest.find(query).sort({ createdAt: -1 }).limit(50).lean();
  }

  async getPendingPayoutsForAdmin(filters = {}) {
    const statusFilter = filters.status
      ? { status: filters.status }
      : { status: { $in: ["pending", "approved", "processing"] } };

    return PayoutRequest.find(statusFilter)
      .populate("user", "fullName email phone earningsBalance userType")
      .sort({ requestedAt: 1 })
      .lean();
  }

  async getPayoutHistoryForAdmin({
    page = 1,
    limit = 25,
    status,
    userId,
    search,
    startDate,
    endDate,
  } = {}) {
    const query = {};

    if (status && status !== "all") query.status = status;
    if (userId) query.user = userId;
    if (startDate || endDate) {
      query.requestedAt = {};
      if (startDate) query.requestedAt.$gte = new Date(startDate);
      if (endDate) query.requestedAt.$lte = new Date(endDate);
    }
    if (search?.trim()) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { "paystackTransfer.transferReference": re },
        { "destination.phoneNumber": re },
        { "destination.accountNumber": re },
      ];
    }

    const total = await PayoutRequest.countDocuments(query);
    const pages = Math.max(1, Math.ceil(total / limit));
    const pageNum = Math.min(Math.max(1, Number(page) || 1), pages);

    const payouts = await PayoutRequest.find(query)
      .populate("user", "fullName email phone earningsBalance userType")
      .sort({ requestedAt: -1 })
      .skip((pageNum - 1) * limit)
      .limit(limit)
      .lean();

    return { payouts, pagination: { total, page: pageNum, limit, pages } };
  }
}

export default new PayoutService();
