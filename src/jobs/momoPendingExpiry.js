// src/jobs/momoPendingExpiry.js
import cron from "node-cron";
import WalletTransaction from "../models/WalletTransaction.js";
import logger from "../utils/logger.js";
import notificationService from "../services/notificationService.js";

const DEFAULT_EXPIRY_MINUTES = 60; // default: consider pending MoMo top-ups stale after 60 minutes

function getExpiryMinutes() {
  const envVal = process.env.WALLET_MOMO_PENDING_EXPIRY_MINUTES;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EXPIRY_MINUTES;
  return parsed;
}

export async function runMomoPendingExpiryJob() {
  try {
    const expiryMinutes = getExpiryMinutes();
    const cutoff = new Date(Date.now() - expiryMinutes * 60 * 1000);

    // Find pending credit transactions that look like MoMo top-ups and are older than the cutoff
    const query = {
      type: "credit",
      status: "pending",
      "metadata.momoReferenceId": { $exists: true },
      createdAt: { $lt: cutoff },
    };

    const stale = await WalletTransaction.find(query).limit(500);
    if (!stale || stale.length === 0) {
      logger.info(
        `Momo pending expiry job: no stale MoMo pending top-ups older than ${expiryMinutes} minutes`,
      );
      return { rejectedCount: 0, expiryMinutes };
    }

    let rejectedCount = 0;
    for (const tx of stale) {
      try {
        tx.status = "rejected";
        tx.description = `${tx.description} - Auto-rejected (no verification)`;
        tx.metadata = tx.metadata || {};
        tx.metadata.momoFailed = true;
        tx.metadata.autoRejected = true;
        tx.metadata.processedAt = new Date();
        // Keep existing momoStatus if present, otherwise mark as stale
        if (!tx.metadata.momoStatus)
          tx.metadata.momoStatus = { status: "STALE" };
        await tx.save();
        rejectedCount += 1;

        // Notify user (best-effort)
        try {
          await notificationService.sendWalletTopUpRejectionNotification(
            tx.user.toString(),
            tx.amount,
            "Auto-rejected: no payment verification",
            "system",
          );
        } catch (notifyErr) {
          logger.warn(
            `[MomoPendingExpiry] notify failed for tx ${tx._id}: ${notifyErr.message}`,
          );
        }
      } catch (err) {
        logger.error(
          `[MomoPendingExpiry] failed to auto-reject tx ${tx._id}: ${err.message}`,
        );
      }
    }

    logger.info(
      `Momo pending expiry job: auto-rejected ${rejectedCount} stale MoMo pending top-up(s) older than ${expiryMinutes} minutes`,
    );
    return { rejectedCount, expiryMinutes };
  } catch (error) {
    logger.error(`Momo pending expiry job failed: ${error.message}`);
    return { rejectedCount: 0, error: error.message };
  }
}

export function initializeMomoPendingExpiryJob() {
  // Run every 15 minutes at minute 5,20,35,50
  cron.schedule(
    "5,20,35,50 * * * *",
    async () => {
      logger.info("Running MoMo pending expiry job");
      await runMomoPendingExpiryJob();
    },
    { scheduled: true, timezone: "UTC" },
  );

  logger.info(
    "MoMo pending expiry job initialized. It will run every 15 minutes to auto-reject stale pending MoMo top-ups.",
  );
}
