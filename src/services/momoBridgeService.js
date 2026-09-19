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

const PROCESSING_TTL_MS = 5 * 60 * 1000;
const RELAY_TIMEOUT_MS = 28000;

function normalizeReference(ref) {
  return ref.trim().replace(/\s+/g, "").toUpperCase();
}

function classifyResult(relayResult) {
  const code =
    relayResult?.code ||
    (relayResult?.confirmed === true
      ? "confirmed"
      : /already/i.test(relayResult?.message || "")
        ? "already_confirmed"
        : /expir/i.test(relayResult?.message || "")
          ? "expired"
          : /not found|invalid/i.test(relayResult?.message || "")
            ? "invalid"
            : "error");
  const success =
    relayResult?.confirmed === true || code === "already_confirmed";
  return { code, success };
}

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

  async _claimFromRelay(displayRef) {
    const apiKey = await this._apiKey();
    const relayUrl = await this._relayUrl();

    if (!apiKey) {
      throw new Error("MoMo Bridge API key not configured.");
    }

    const attempt = async () => {
      const response = await fetch(`${relayUrl}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, reference: displayRef }),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const err = new Error(`Relay returned ${response.status}: ${text}`);
        err.transient = response.status >= 500;
        throw err;
      }

      return response.json();
    };

    try {
      return await attempt();
    } catch (err) {
      const transient =
        err?.transient === true ||
        err?.name === "TimeoutError" ||
        err?.name === "AbortError" ||
        err?.code === "ECONNREFUSED" ||
        err?.code === "ENOTFOUND" ||
        /fetch failed|network|aborted|timed out/i.test(err?.message || "");
      // One retry for transport failures only — never for business
      // rejections (invalid/expired), which are deterministic.
      if (transient) {
        try {
          return await attempt();
        } catch (retryErr) {
          retryErr.transient = true;
          throw retryErr;
        }
      }
      throw err;
    }
  }

  _successPayload(doc, meta, displayRef) {
    return {
      success: true,
      confirmed: true,
      code: meta.code || "confirmed",
      grossAmount: meta.grossAmount,
      feeAmount: meta.feeAmount,
      netAmount: meta.netAmount,
      feePercent: meta.feePercent,
      reference: displayRef || meta.momoReference,
      transaction: doc,
    };
  }

  // A completed doc whose wallet $inc never landed (crash between the
  // record update and the credit). Finish the credit now instead of
  // telling the user "already claimed" with no money.
  async _resumeCompleted(userId, doc) {
    const meta = doc.metadata || {};
    if (meta.credited === true) {
      return this._successPayload(doc, meta);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: meta.netAmount } },
      { new: true, runValidators: false },
    );
    if (!updatedUser) {
      throw new Error("User not found");
    }

    const updated = await WalletTransaction.findOneAndUpdate(
      { _id: doc._id },
      {
        $set: {
          balanceAfter: updatedUser.walletBalance,
          "metadata.credited": true,
        },
      },
      { new: true },
    );

    logger.info(
      `[MomoBridge] Recovered missing credit GH₵${meta.netAmount} for user ${userId} (ref: ${meta.momoReference})`,
    );
    await this._notifyUser(
      userId,
      updatedUser.walletBalance,
      `Your wallet has been credited with GH₵${meta.netAmount} via MoMo Bridge. New balance: GH₵${updatedUser.walletBalance}`,
    );

    return this._successPayload(updated || doc, meta);
  }

  async _markFailed(doc, lastError, extraMetadata = {}) {
    try {
      await WalletTransaction.findOneAndUpdate(
        { _id: doc._id },
        {
          $set: {
            status: "failed",
            "metadata.lastError": lastError,
            "metadata.finishedAt": new Date(),
            ...extraMetadata,
          },
        },
      );
    } catch (markErr) {
      logger.warn(
        `[MomoBridge] Failed to mark claim ${doc.reference} failed: ${markErr.message}`,
      );
    }
  }

  async getCheckoutConfig(userId) {
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
    const settings = await settingsService.getMomoBridgeSettings();

    return {
      relayUrl,
      apiKey,
      accountName: settings.momoBridgeAccountName || "",
      accountNumber: settings.momoBridgeAccountNumber || "",
    };
  }

  async verifyAndCredit(userId, reference) {
    if (!reference || !reference.trim()) {
      throw new Error("Transaction reference is required");
    }

    // displayRef goes to the relay/phone (exact match against the SMS
    // reference). txnReference is the idempotency key — fully normalized so
    // pasted variants (" abc ", "ABC") map to one record.
    const displayRef = reference.trim();
    const txnReference = `momobridge_${normalizeReference(displayRef)}`;
    const now = Date.now();

    // ── Claim ownership (record-first) ───────────────────────────────────────
    // A processing placeholder is written BEFORE the relay call so concurrent
    // double-submits serialize here instead of racing the phone and the $inc.
    // Placeholders carry amount 0.01 / balanceAfter 0 (schema minimums) and
    // are only ever surfaced after transitioning to completed with real
    // amounts — never as-is.
    let claimDoc = await WalletTransaction.findOne({
      reference: txnReference,
    });

    if (claimDoc) {
      if (claimDoc.status === "completed") {
        // Idempotent replay — and recovery when a previous attempt died
        // between the record update and the wallet credit.
        return this._resumeCompleted(userId, claimDoc);
      }
      if (claimDoc.status === "processing") {
        const startedAt = new Date(
          claimDoc.metadata?.startedAt ?? 0,
        ).getTime();
        if (now - startedAt < PROCESSING_TTL_MS) {
          throw new Error(
            "This transaction is currently being processed. Please wait a moment and try again.",
          );
        }
        // Stale owner (crashed/timed-out without marking) — reclaim atomically.
        const reclaimed = await WalletTransaction.findOneAndUpdate(
          { reference: txnReference, status: "processing" },
          {
            $set: {
              user: userId,
              "metadata.startedAt": new Date(),
            },
            $inc: { "metadata.attempts": 1 },
          },
          { new: true },
        );
        if (!reclaimed) {
          throw new Error(
            "This transaction is currently being processed. Please wait a moment and try again.",
          );
        }
        claimDoc = reclaimed;
      } else {
        // failed (or any other terminal state) — retryable. Transition
        // atomically so only one concurrent retry becomes the owner.
        const resumed = await WalletTransaction.findOneAndUpdate(
          { reference: txnReference, status: claimDoc.status },
          {
            $set: {
              user: userId,
              status: "processing",
              "metadata.startedAt": new Date(),
              "metadata.lastError": null,
            },
            $inc: { "metadata.attempts": 1 },
          },
          { new: true },
        );
        if (!resumed) {
          throw new Error(
            "This transaction is currently being processed. Please wait a moment and try again.",
          );
        }
        claimDoc = resumed;
      }
    } else {
      try {
        claimDoc = await WalletTransaction.create({
          user: userId,
          type: "credit",
          amount: 0.01,
          balanceAfter: 0,
          description: `MoMo Bridge claim in progress — ref: ${displayRef}`,
          status: "processing",
          reference: txnReference,
          metadata: {
            source: "momobridge",
            momoReference: displayRef,
            startedAt: new Date(),
            attempts: 1,
          },
        });
      } catch (insertErr) {
        if (insertErr.code === 11000) {
          const winner = await WalletTransaction.findOne({
            reference: txnReference,
          });
          if (winner && winner.status === "completed") {
            return this._resumeCompleted(userId, winner);
          }
          throw new Error(
            "This transaction is currently being processed. Please wait a moment and try again.",
          );
        }
        throw insertErr;
      }
    }

    // ── Verify with relay (single owner from here on) ────────────────────────
    let relayResult;
    try {
      relayResult = await this._claimFromRelay(displayRef);
    } catch (err) {
      if (err?.transient) {
        await this._markFailed(claimDoc, err.message, { transient: true });
        throw new Error(
          "Relay request timed out. The store phone may be offline — please try again.",
        );
      }
      await this._markFailed(claimDoc, err.message);
      throw new Error(`Failed to reach MoMo Bridge relay: ${err.message}`);
    }

    const { code, success } = classifyResult(relayResult);

    if (!success) {
      await this._markFailed(
        claimDoc,
        relayResult.message || "Verification failed",
      );
      throw new Error(relayResult.message || "Verification failed");
    }

    // ── Extract actual amount from relay response ────────────────────────────
    const grossAmount = relayResult.transaction?.amount;
    if (typeof grossAmount !== "number" || grossAmount <= 0) {
      // Phone consumed its one-time flag but no amount came back (e.g. old
      // APK). Never credit blindly and never park as completed — leave a
      // needs-reconcile marker for support (phone Transactions screen holds
      // the truth) instead of trapping the user in "already claimed".
      await this._markFailed(
        claimDoc,
        "Relay confirmed without a transaction amount",
        { needsReconcile: true, relayCode: code },
      );
      throw new Error(
        "Payment was confirmed but the amount is missing. Please contact support with your reference — do not retry repeatedly.",
      );
    }

    // ── Calculate platform fee on the relay-returned amount ──────────────────
    const feePercent = await this._feePercent();
    const feeAmount = grossAmount * (feePercent / 100);
    const netAmount = grossAmount - feeAmount;

    // ── Record first, then credit ────────────────────────────────────────────
    // processing → completed is atomic; only the owner (this call) can win
    // it. The wallet $inc happens strictly after, so a crash here leaves a
    // completed-but-uncredited doc that _resumeCompleted recovers — never a
    // credit without a record.
    const completed = await WalletTransaction.findOneAndUpdate(
      { _id: claimDoc._id, status: "processing" },
      {
        $set: {
          status: "completed",
          amount: netAmount,
          description: `MoMo Bridge payment verified — ref: ${displayRef}`,
          metadata: {
            source: "momobridge",
            momoReference: displayRef,
            code,
            grossAmount,
            feePercent,
            feeAmount,
            netAmount,
            credited: false,
            startedAt: claimDoc.metadata?.startedAt ?? new Date(),
            attempts: (claimDoc.metadata?.attempts ?? 1),
            finishedAt: new Date(),
            relayResponse: {
              confirmed: relayResult.confirmed,
              code,
              message: relayResult.message,
              transaction: relayResult.transaction,
            },
          },
        },
      },
      { new: true },
    );

    if (!completed) {
      // Lost ownership mid-flight (shouldn't happen — defensive). Read the
      // winner and follow it rather than crediting blindly.
      const winner = await WalletTransaction.findOne({
        reference: txnReference,
      });
      if (winner && winner.status === "completed") {
        return this._resumeCompleted(userId, winner);
      }
      throw new Error(
        "This transaction is currently being processed. Please wait a moment and try again.",
      );
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: netAmount } },
      { new: true, runValidators: false },
    );

    if (!updatedUser) {
      await this._markFailed(completed, "User not found");
      throw new Error("User not found");
    }

    const credited = await WalletTransaction.findOneAndUpdate(
      { _id: completed._id },
      {
        $set: {
          balanceAfter: updatedUser.walletBalance,
          "metadata.credited": true,
        },
      },
      { new: true },
    );

    logger.info(
      `[MomoBridge] Wallet credited GH₵${netAmount} for user ${userId} (ref: ${displayRef}, gross: GH₵${grossAmount}, fee: ${feePercent}%)`,
    );
    await logAuditAction(null, {
      userId,
      action: AUDIT_ACTIONS.WALLET_CREDITED,
      category: AUDIT_CATEGORIES.WALLET,
      resource: { userId },
      metadata: {
        source: "momoBridgeService.verifyAndCredit",
        grossAmount,
        feeAmount,
        netAmount,
        feePercent,
        momoReference: displayRef,
      },
      severity: AUDIT_SEVERITIES.INFO,
    });

    await this._notifyUser(
      userId,
      updatedUser.walletBalance,
      `Your wallet has been credited with GH₵${netAmount} via MoMo Bridge. New balance: GH₵${updatedUser.walletBalance}`,
    );

    return this._successPayload(credited || completed, {
      code,
      grossAmount,
      feeAmount,
      netAmount,
      feePercent,
      momoReference: displayRef,
    }, displayRef);
  }
}

export default new MomoBridgeService();
