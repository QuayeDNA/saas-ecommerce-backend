import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import settingsService from "./settingsService.js";
import logger from "../utils/logger.js";
import { logAuditAction } from "../utils/auditLogger.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

class MomoBridgeService {

  async _relayUrl() {
    const settings = await settingsService.getMomoBridgeSettings();
    return settings.momoBridgeRelayUrl.replace(/\/+$/, "");
  }

  async _apiKey() {
    const settings = await settingsService.getMomoBridgeSettings();
    return settings.momoBridgeApiKey;
  }

  async _isEnabled() {
    const settings = await settingsService.getMomoBridgeSettings();
    return settings.momoBridgeEnabled;
  }

  async _feePercent() {
    const settings = await settingsService.getMomoBridgeSettings();
    return settings.momoBridgeClaimFeePercent ?? 0;
  }

  async _notifyUser(userId, balance, message) {
    try {
      const { default: websocketService } = await import(
        "./websocketService.js"
      );
      websocketService.sendToUser(userId.toString(), {
        type: "wallet_update",
        userId: userId.toString(),
        balance,
        message,
      });
    } catch (err) {
      logger.warn(
        `[MomoBridge] WebSocket notify failed for user ${userId}: ${err.message}`,
      );
    }
  }

  async getCheckoutConfig(userId, amount) {
    const enabled = await this._isEnabled();
    if (!enabled) {
      throw new Error(
        "MoMo Bridge payments are currently disabled by the administrator.",
      );
    }

    const apiKey = await this._apiKey();
    if (!apiKey) {
      throw new Error(
        "MoMo Bridge API key not configured. Please set it in Admin settings.",
      );
    }

    const relayUrl = await this._relayUrl();
    const feePercent = await this._feePercent();

    const feeAmount = amount * (feePercent / 100);
    const netAmount = amount - feeAmount;

    return {
      relayUrl,
      apiKey,
      amount: parseFloat(amount.toFixed(2)),
      netAmount: parseFloat(netAmount.toFixed(2)),
      feeAmount: parseFloat(feeAmount.toFixed(2)),
      feePercent,
    };
  }

  async verifyAndCredit(userId, reference, amount) {
    if (!reference || !reference.trim()) {
      throw new Error("Transaction reference is required");
    }
    if (!amount || amount <= 0) {
      throw new Error("A valid amount is required");
    }

    const ref = reference.trim();
    const txnReference = `momobridge_${ref}`;

    // ── Idempotency guard ──────────────────────────────────────────────────
    const existing = await WalletTransaction.findOne({
      reference: txnReference,
      status: { $in: ["processing", "completed"] },
    });
    if (existing) {
      if (existing.status === "completed") {
        throw new Error("This transaction has already been claimed.");
      }
      throw new Error(
        "This transaction is currently being processed. Please wait.",
      );
    }

    // ── Verify with relay ──────────────────────────────────────────────────
    const apiKey = await this._apiKey();
    const relayUrl = await this._relayUrl();

    if (!apiKey) {
      throw new Error("MoMo Bridge API key not configured.");
    }

    let relayResult;
    try {
      const response = await fetch(`${relayUrl}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          reference: ref,
          amount: parseFloat(amount),
        }),
        signal: AbortSignal.timeout(35000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Relay returned ${response.status}: ${text}`);
      }

      relayResult = await response.json();
    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new Error(
          "Relay request timed out. The store phone may be offline.",
        );
      }
      throw new Error(`Failed to reach MoMo Bridge relay: ${err.message}`);
    }

    const isConfirmed =
      relayResult.confirmed === true ||
      (relayResult.message || "").toLowerCase().includes("already");

    if (!isConfirmed) {
      const msg = relayResult.message || "Verification failed";
      throw new Error(msg);
    }

    // ── Calculate fees ──────────────────────────────────────────────────────
    const feePercent = await this._feePercent();
    const feeAmount = amount * (feePercent / 100);
    const netAmount = amount - feeAmount;

    // ── Credit wallet (atomic $inc) ─────────────────────────────────────────
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: netAmount } },
      { new: true, runValidators: false },
    );

    if (!updatedUser) {
      throw new Error("User not found");
    }

    // ── Create transaction record ───────────────────────────────────────────
    let transaction;
    try {
      transaction = await WalletTransaction.create({
        user: userId,
        type: "credit",
        amount: netAmount,
        balanceAfter: updatedUser.walletBalance,
        description: `MoMo Bridge payment verified — ref: ${ref}`,
        status: "completed",
        reference: txnReference,
        metadata: {
          source: "momobridge",
          momoReference: ref,
          originalAmount: amount,
          feePercent,
          feeAmount,
          grossAmount: amount,
          relayResponse: {
            confirmed: relayResult.confirmed,
            message: relayResult.message,
          },
        },
      });
    } catch (insertErr) {
      if (insertErr.code === 11000) {
        const dup = await WalletTransaction.findOne({
          reference: txnReference,
        });
        if (dup && dup.status === "completed") {
          throw new Error("This transaction has already been claimed.");
        }
        throw new Error(
          "Duplicate request detected. Please try again.",
        );
      }

      await User.findByIdAndUpdate(userId, {
        $inc: { walletBalance: -netAmount },
      });

      throw insertErr;
    }

    logger.info(
      `[MomoBridge] Wallet credited GH₵${netAmount} for user ${userId} (ref: ${ref}, gross: GH₵${amount})`,
    );
    await logAuditAction(null, {
      userId,
      action: AUDIT_ACTIONS.WALLET_CREDITED,
      category: AUDIT_CATEGORIES.WALLET,
      resource: { userId },
      metadata: {
        source: "momoBridgeService.verifyAndCredit",
        amount: netAmount,
        grossAmount: amount,
        momoReference: ref,
      },
      severity: AUDIT_SEVERITIES.INFO,
    });

    await this._notifyUser(
      userId,
      updatedUser.walletBalance,
      `Your wallet has been credited with GH₵${netAmount} via MoMo Bridge. New balance: GH₵${updatedUser.walletBalance}`,
    );

    return {
      success: true,
      confirmed: true,
      amount: netAmount,
      grossAmount: amount,
      feeAmount,
      reference: ref,
      transaction,
    };
  }
}

export default new MomoBridgeService();
