// src/jobs/cancelledStorefrontOrdersCleanup.js

/**
 * Cancelled Storefront Orders Cleanup
 *
 * This job deletes storefront orders that were cancelled and have aged beyond a
 * configurable retention period.
 *
 * Motivation:
 * - Prevents cancelled storefront orders from accumulating indefinitely
 * - Keeps the orders collection manageable for reporting and performance
 *
 * Configuration:
 * - CANCELLED_STOREFRONT_ORDER_TTL_DAYS (default: 30)
 */

import cron from "node-cron";
import Order from "../models/Order.js";
import logger from "../utils/logger.js";

const DEFAULT_TTL_DAYS = 30;

function getTtlDays() {
  const envVal = process.env.CANCELLED_STOREFRONT_ORDER_TTL_DAYS;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TTL_DAYS;
  }
  return parsed;
}

/**
 * Delete cancelled storefront orders older than the retention period
 */
export async function runCancelledStorefrontOrdersCleanup() {
  try {
    const ttlDays = getTtlDays();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ttlDays);

    const query = {
      orderType: "storefront",
      status: "cancelled",
      updatedAt: { $lt: cutoff },
    };

    const result = await Order.deleteMany(query);

    logger.info(
      `Cancelled storefront order cleanup: removed ${result.deletedCount || 0} order(s) older than ${ttlDays} day(s)`
    );

    return {
      deletedCount: result.deletedCount || 0,
      ttlDays,
    };
  } catch (error) {
    logger.error(`Cancelled storefront order cleanup failed: ${error.message}`);
    return {
      deletedCount: 0,
      error: error.message,
    };
  }
}

/**
 * Initialize cron job
 * Runs once per day at 03:00 UTC by default
 */
export function initializeCancelledStorefrontOrdersCleanupJob() {
  cron.schedule(
    "0 3 * * *",
    async () => {
      logger.info("Running cancelled storefront order cleanup job");
      await runCancelledStorefrontOrdersCleanup();
    },
    {
      scheduled: true,
      timezone: "UTC",
    }
  );

  logger.info(
    "Cancelled storefront order cleanup job initialized. " +
      "It will run daily at 03:00 UTC and remove cancelled storefront orders older than the configured TTL."
  );
}
