// src/jobs/reportedOrdersCleanup.js

/**
 * Reported Orders Cleanup Cron Job
 *
 * This job handles two cleanup operations for reported orders:
 * 1. Auto-marks orders as received if they've been reported but not resolved for 24 hours
 * 2. Removes the reported flag from resolved orders after 10 minutes
 *
 * Runs every 5 minutes to ensure timely cleanup
 */

import cron from "node-cron";
import Order from "../models/Order.js";
import logger from "../utils/logger.js";

/**
 * Auto-mark reported orders as received after 24 hours
 * If an order is reported and still in not_received/checking state after 24 hours,
 * it should be automatically marked as received (removing from reported list)
 */
async function autoMarkReportedAsReceived() {
  try {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Find reported orders in not_received/checking state older than 24 hours
    const ordersToResolve = await Order.find({
      reported: true,
      receptionStatus: { $in: ["not_received", "checking"] },
      reportedAt: { $exists: true, $lt: twentyFourHoursAgo },
    });

    if (ordersToResolve.length === 0) {
      return {
        autoMarkedCount: 0,
      };
    }

    logger.info(
      `Auto-marking ${ordersToResolve.length} reported orders as received after 24 hours`
    );

    let autoMarkedCount = 0;

    for (const order of ordersToResolve) {
      try {
        // Mark as received (auto-resolved)
        order.receptionStatus = "received";
        order.reported = false; // Remove reported flag
        order.resolvedAt = new Date();
        order.notes = order.notes
          ? `${order.notes}\nAuto-marked as received after 24 hours on ${new Date().toLocaleString()}`
          : `Auto-marked as received after 24 hours on ${new Date().toLocaleString()}`;

        await order.save();
        autoMarkedCount++;

        logger.info(
          `Auto-marked order ${order.orderNumber} as received (24hr rule)`
        );
      } catch (error) {
        logger.error(
          `Failed to auto-mark order ${order.orderNumber}: ${error.message}`
        );
      }
    }

    logger.info(
      `Successfully auto-marked ${autoMarkedCount} orders as received`
    );

    return {
      autoMarkedCount,
    };
  } catch (error) {
    logger.error(`Error in autoMarkReportedAsReceived: ${error.message}`);
    return {
      autoMarkedCount: 0,
      error: error.message,
    };
  }
}

/**
 * Remove reported flag from resolved orders after 10 minutes
 * This cleans up the reported tracking for orders that have been resolved
 */
async function cleanupResolvedReports() {
  try {
    const tenMinutesAgo = new Date();
    tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

    // Find resolved reported orders older than 10 minutes
    const resolvedOrders = await Order.find({
      reported: true,
      receptionStatus: "resolved",
      resolvedAt: { $exists: true, $lt: tenMinutesAgo },
    });

    if (resolvedOrders.length === 0) {
      return {
        cleanedCount: 0,
      };
    }

    logger.info(
      `Cleaning up ${resolvedOrders.length} resolved reports after 10 minutes`
    );

    let cleanedCount = 0;

    for (const order of resolvedOrders) {
      try {
        // Remove the reported flag (keep receptionStatus as resolved)
        order.reported = false;
        await order.save();
        cleanedCount++;

        logger.debug(
          `Removed reported flag from resolved order ${order.orderNumber}`
        );
      } catch (error) {
        logger.error(
          `Failed to clean up resolved order ${order.orderNumber}: ${error.message}`
        );
      }
    }

    logger.info(`Successfully cleaned up ${cleanedCount} resolved reports`);

    return {
      cleanedCount,
    };
  } catch (error) {
    logger.error(`Error in cleanupResolvedReports: ${error.message}`);
    return {
      cleanedCount: 0,
      error: error.message,
    };
  }
}

/**
 * Main cleanup function that runs both operations
 */
async function runReportedOrdersCleanup() {
  try {
    logger.info("Starting reported orders cleanup job");

    const [autoMarkResult, cleanupResult] = await Promise.all([
      autoMarkReportedAsReceived(),
      cleanupResolvedReports(),
    ]);

    logger.info(
      `Reported orders cleanup completed: ${autoMarkResult.autoMarkedCount} auto-marked, ${cleanupResult.cleanedCount} cleaned up`
    );

    return {
      success: true,
      autoMarkedCount: autoMarkResult.autoMarkedCount,
      cleanedCount: cleanupResult.cleanedCount,
    };
  } catch (error) {
    logger.error(`Reported orders cleanup job failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Initialize cron job
 * Runs every 5 minutes to ensure timely cleanup
 *
 * Cron pattern:
 * Every 5 minutes
 */
export function initializeReportedOrdersCleanupJob() {
  // Schedule the job to run every 5 minutes
  cron.schedule(
    "*/5 * * * *",
    async () => {
      await runReportedOrdersCleanup();
    },
    {
      scheduled: true,
      timezone: "UTC",
    }
  );

  logger.info(
    "Reported orders cleanup job initialized. Running every 5 minutes to:\n" +
      "  1. Auto-mark reported orders as received after 24 hours\n" +
      "  2. Remove reported flag from resolved orders after 10 minutes"
  );
}

/**
 * Manual trigger for testing
 */
export async function runReportedOrdersCleanupManually() {
  logger.info("Running manual reported orders cleanup");
  return await runReportedOrdersCleanup();
}

export default {
  initializeReportedOrdersCleanupJob,
  runReportedOrdersCleanupManually,
  runReportedOrdersCleanup,
  autoMarkReportedAsReceived,
  cleanupResolvedReports,
};