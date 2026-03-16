// src/jobs/pendingPaymentExpiry.js

/**
 * Pending Payment Expiry Job
 *
 * Automatically cancels storefront orders that remain stuck in "pending_payment"
 * for longer than a configured grace period.
 *
 * This prevents storefront orders from sitting indefinitely in a limbo state when
 * customers abandon checkout or fail to complete Paystack payment.
 *
 * Configuration:
 * - STORE_FRONT_PENDING_PAYMENT_EXPIRY_HOURS (default: 24)
 */

import cron from "node-cron";
import Order from "../models/Order.js";
import logger from "../utils/logger.js";

const DEFAULT_EXPIRY_HOURS = 24;

function getExpiryHours() {
  const envVal = process.env.STORE_FRONT_PENDING_PAYMENT_EXPIRY_HOURS;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EXPIRY_HOURS;
  }
  return parsed;
}

/**
 * Cancel storefront orders stuck in pending_payment beyond the TTL.
 * This is a safety net for abandoned checkouts.
 */
export async function runPendingPaymentExpiryJob() {
  try {
    const expiryHours = getExpiryHours();
    const cutoff = new Date(Date.now() - expiryHours * 60 * 60 * 1000);

    const query = {
      orderType: "storefront",
      status: "pending_payment",
      updatedAt: { $lt: cutoff },
    };

    const update = {
      $set: {
        status: "cancelled",
        paymentStatus: "failed",
        "storefrontData.paymentMethod.verificationNotes":
          `Auto-cancelled after ${expiryHours}h without payment verification`,
        updatedAt: new Date(),
      },
    };

    const result = await Order.updateMany(query, update);

    logger.info(
      `Pending payment expiry job: cancelled ${result.modifiedCount || 0} storefront order(s) older than ${expiryHours} hour(s)`
    );

    return {
      cancelledCount: result.modifiedCount || 0,
      expiryHours,
    };
  } catch (error) {
    logger.error(`Pending payment expiry job failed: ${error.message}`);
    return { cancelledCount: 0, error: error.message };
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
