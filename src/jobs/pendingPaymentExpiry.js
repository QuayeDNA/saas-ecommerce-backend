// src/jobs/pendingPaymentExpiry.js

/**
 * Pending Payment Expiry Job
 *
 * Automatically handles storefront orders that remain stuck in "pending_payment"
 * for longer than a configured grace period.
 *
 * Paystack orders: deleted directly — no payment was ever completed on Paystack's
 * side, so no financial records exist. Keeping them just creates noise.
 *
 * Non-Paystack orders (mobile_money, bank_transfer): cancelled so an admin can
 * review and manually handle if needed (payment may have been made off-platform).
 *
 * Configuration:
 * - STORE_FRONT_PENDING_PAYMENT_EXPIRY_HOURS (default: 2)
 */

import cron from "node-cron";
import Order from "../models/Order.js";
import logger from "../utils/logger.js";

const DEFAULT_EXPIRY_HOURS = 2;

function getExpiryHours() {
  const envVal = process.env.STORE_FRONT_PENDING_PAYMENT_EXPIRY_HOURS;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EXPIRY_HOURS;
  }
  return parsed;
}

/**
 * Delete Paystack orders stuck in pending_payment beyond the TTL.
 * These were never actually paid on Paystack's side — the user abandoned
 * checkout before completing payment. No financial record to preserve.
 */
async function deleteExpiredPaystackOrders(cutoff) {
  const result = await Order.deleteMany({
    orderType: "storefront",
    status: "pending_payment",
    "storefrontData.paymentMethod.type": "paystack",
    updatedAt: { $lt: cutoff },
  });

  if (result.deletedCount > 0) {
    logger.info(
      `Pending payment expiry job: deleted ${result.deletedCount} abandoned Paystack order(s) older than ${getExpiryHours()} hour(s)`
    );
  }

  return result.deletedCount || 0;
}

/**
 * Cancel non-Paystack orders stuck in pending_payment beyond the TTL.
 * These may have had off-platform payment initiated, so we keep them
 * as cancelled for the cleanup job's retention period.
 */
async function cancelExpiredNonPaystackOrders(cutoff) {
  const result = await Order.updateMany(
    {
      orderType: "storefront",
      status: "pending_payment",
      "storefrontData.paymentMethod.type": { $ne: "paystack" },
      updatedAt: { $lt: cutoff },
    },
    {
      $set: {
        status: "cancelled",
        paymentStatus: "failed",
        "storefrontData.paymentMethod.verificationNotes":
          `Auto-cancelled after ${getExpiryHours()}h without payment verification`,
        updatedAt: new Date(),
      },
    },
  );

  if (result.modifiedCount > 0) {
    logger.info(
      `Pending payment expiry job: cancelled ${result.modifiedCount} non-Paystack order(s) older than ${getExpiryHours()} hour(s)`
    );
  }

  return result.modifiedCount || 0;
}

/**
 * Handle expired storefront orders stuck in pending_payment.
 * Paystack orders are deleted (never paid, no financial impact).
 * Other orders are cancelled (may have off-platform payment).
 */
export async function runPendingPaymentExpiryJob() {
  try {
    const expiryHours = getExpiryHours();
    const cutoff = new Date(Date.now() - expiryHours * 60 * 60 * 1000);

    const [deletedCount, cancelledCount] = await Promise.all([
      deleteExpiredPaystackOrders(cutoff),
      cancelExpiredNonPaystackOrders(cutoff),
    ]);

    return { deletedCount, cancelledCount, expiryHours };
  } catch (error) {
    logger.error(`Pending payment expiry job failed: ${error.message}`);
    return { deletedCount: 0, cancelledCount: 0, error: error.message };
  }
}

/**
 * Initialize cron job
 * Runs hourly at minute 5 (smoothed slightly to avoid exact-on-the-hour load)
 */
export function initializePendingPaymentExpiryJob() {
  cron.schedule(
    "5 * * * *",
    async () => {
      logger.info("Running pending payment expiry job");
      await runPendingPaymentExpiryJob();
    },
    {
      scheduled: true,
      timezone: "UTC",
    }
  );

  logger.info(
    "Pending payment expiry job initialized. It will run hourly to auto-cancel storefront orders stuck in pending_payment."
  );
}
