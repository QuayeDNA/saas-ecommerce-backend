// src/jobs/payoutReconciliationJob.js
//
// Reconciles payouts stuck in 'processing' by checking the real Paystack
// transfer status via the API. Handles the case where the webhook never
// arrived (network outage, Paystack downtime, etc.).
//
// Transitions:
//   Paystack success → mark payout completed
//   Paystack failed  → mark payout failed, refund earnings
//   Still pending    → leave for next cycle
//   No transferCode  → skip (no way to reconcile)

import cron from "node-cron";
import PayoutRequest from "../models/PayoutRequest.js";
import paystackService from "../services/paystackService.js";
import earningsService from "../services/earningsService.js";
import notificationService from "../services/notificationService.js";
import logger from "../utils/logger.js";

const JOB_SCHEDULE = "*/15 * * * *";
const STUCK_THRESHOLD_MINUTES = 60;

/**
 * Mark a payout as completed when Paystack confirms the transfer succeeded.
 */
async function resolveSuccess(payout) {
  payout.status = "completed";
  payout.completedAt = new Date();
  if (payout.paystackTransfer) payout.paystackTransfer.status = "success";
  await payout.save();

  logger.info("[PayoutReconciliation] Resolved as completed", {
    payoutId: payout._id,
    transferCode: payout.paystackTransfer?.transferCode,
  });

  await notificationService
    .createInAppNotification(
      payout.user._id.toString(),
      "Payout Completed",
      `Your payout of GHS ${payout.amount.toFixed(2)} has been sent successfully.`,
      "success",
      {
        type: "payout_completed",
        payoutId: payout._id,
        source: "payoutReconciliationJob",
      },
    )
    .catch(() => {});
}

/**
 * Mark a payout as failed when Paystack confirms the transfer failed.
 * Refund earnings so the agent can re-request.
 */
async function resolveFailed(payout, reason) {
  payout.status = "failed";
  if (payout.paystackTransfer) {
    payout.paystackTransfer.status = "failed";
    payout.paystackTransfer.failureReason = reason;
  }
  await payout.save();

  logger.warn("[PayoutReconciliation] Resolved as failed", {
    payoutId: payout._id,
    transferCode: payout.paystackTransfer?.transferCode,
    reason,
  });

  try {
    await earningsService.refundPayout({
      userId: payout.user._id,
      amount: payout.amount,
      payoutId: payout._id,
      description: `Refund for failed payout #${payout._id} (reconciliation)`,
      session: null,
      metadata: { reason, source: "payoutReconciliationJob" },
    });
  } catch (err) {
    logger.error("[PayoutReconciliation] Refund failed", {
      payoutId: payout._id,
      message: err.message,
    });
  }

  await notificationService
    .createInAppNotification(
      payout.user._id.toString(),
      "Payout Failed",
      `Your payout of GHS ${payout.amount.toFixed(2)} failed (${reason}). Your earnings have been restored.`,
      "error",
      {
        type: "payout_failed",
        payoutId: payout._id,
        source: "payoutReconciliationJob",
      },
    )
    .catch(() => {});
}

/**
 * Reconcile a single stuck payout by checking Paystack's transfer status.
 */
async function reconcilePayout(payout) {
  const transferCode = payout.paystackTransfer?.transferCode;
  if (!transferCode) {
    logger.debug("[PayoutReconciliation] No transferCode, skipping", {
      payoutId: payout._id,
    });
    return;
  }

  let transfer;
  try {
    transfer = await paystackService.fetchTransfer(transferCode);
  } catch (err) {
    logger.warn("[PayoutReconciliation] fetchTransfer failed, will retry", {
      payoutId: payout._id,
      transferCode,
      message: err.message,
    });
    return;
  }

  const psStatus = transfer?.status;

  switch (psStatus) {
    case "success":
      await resolveSuccess(payout);
      break;

    case "failed":
    case "reversed":
    case "reversed_failed": {
      const reason =
        transfer.failure_reason || transfer.reason || `Paystack status: ${psStatus}`;
      await resolveFailed(payout, reason);
      break;
    }

    case "otp":
    case "pending":
    case "queued":
      logger.debug("[PayoutReconciliation] Still processing at Paystack, will retry", {
        payoutId: payout._id,
        transferCode,
        paystackStatus: psStatus,
      });
      break;

    default:
      logger.warn("[PayoutReconciliation] Unknown Paystack status", {
        payoutId: payout._id,
        transferCode,
        paystackStatus: psStatus,
      });
      break;
  }
}

/**
 * Run one reconciliation cycle.
 */
async function runReconciliation() {
  logger.info("=== Payout reconciliation job started ===");

  try {
    const stuckSince = new Date(
      Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000,
    );

    // Use updatedAt (Mongoose timestamp) which is set when the document
    // last transitioned to 'processing' via payout.save().
    const stuckPayouts = await PayoutRequest.find({
      status: "processing",
      updatedAt: { $lte: stuckSince },
      "paystackTransfer.transferCode": { $exists: true, $ne: null },
    }).populate("user");

    logger.info(
      `[PayoutReconciliation] Found ${stuckPayouts.length} stuck payout(s)`,
      { thresholdMinutes: STUCK_THRESHOLD_MINUTES },
    );

    for (const payout of stuckPayouts) {
      await reconcilePayout(payout);
    }

    logger.info(
      `[PayoutReconciliation] Processed ${stuckPayouts.length} payout(s)`,
    );
  } catch (err) {
    logger.error("[PayoutReconciliation] Job failed", {
      message: err.message,
    });
  }

  logger.info("=== Payout reconciliation job completed ===");
}

/**
 * Schedule the reconciliation cron job.
 */
export function schedulePayoutReconciliationJob() {
  cron.schedule(
    JOB_SCHEDULE,
    async () => {
      await runReconciliation();
    },
    {
      scheduled: true,
      timezone: "Africa/Accra",
    },
  );

  logger.info(
    `[PayoutReconciliation] Job scheduled: ${JOB_SCHEDULE} (Africa/Accra, threshold=${STUCK_THRESHOLD_MINUTES}min)`,
  );
}

export default schedulePayoutReconciliationJob;
