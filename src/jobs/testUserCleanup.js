// src/jobs/testUserCleanup.js
import cron from "node-cron";
import Order from "../models/Order.js";
import WalletTransaction from "../models/WalletTransaction.js";
import CommissionRecord from "../models/CommissionRecord.js";
import logger from "../utils/logger.js";

// Test user ID
const TEST_USER_ID = "689bae9e81b90ad7c5ad66d4";

/**
 * Delete all test data for completed orders
 * This includes:
 * - The completed/received order
 * - Related wallet transactions
 * - Related commission records
 */
async function cleanupCompletedTestOrders() {
  try {
    logger.info("Starting test user data cleanup...");

    // Find all completed/received orders by test user
    const completedOrders = await Order.find({
      user: TEST_USER_ID,
      status: { $in: ["completed", "received"] },
    });

    if (completedOrders.length === 0) {
      logger.info("No completed test orders to clean up");
      return;
    }

    logger.info(
      `Found ${completedOrders.length} completed test orders to delete`
    );

    let deletedOrders = 0;
    let deletedTransactions = 0;
    let deletedCommissions = 0;

    for (const order of completedOrders) {
      try {
        const orderId = order._id;

        // Delete related wallet transactions
        const transactionResult = await WalletTransaction.deleteMany({
          relatedOrder: orderId,
        });
        deletedTransactions += transactionResult.deletedCount || 0;

        // Also delete any transactions where the test user is involved
        const userTransactionResult = await WalletTransaction.deleteMany({
          user: TEST_USER_ID,
          createdAt: {
            $gte: order.createdAt,
            $lte: order.updatedAt || new Date(),
          },
        });
        deletedTransactions += userTransactionResult.deletedCount || 0;

        // Delete related commission records
        // Find commissions that were generated around the order time
        const commissionResult = await CommissionRecord.deleteMany({
          agentId: TEST_USER_ID,
          periodStart: { $lte: order.updatedAt || new Date() },
          periodEnd: { $gte: order.createdAt },
        });
        deletedCommissions += commissionResult.deletedCount || 0;

        // Delete the order itself
        await Order.findByIdAndDelete(orderId);
        deletedOrders++;

        logger.info(`Deleted test order ${order.orderNumber} and related data`);
      } catch (error) {
        logger.error(
          `Failed to cleanup test order ${order.orderNumber}:`,
          error
        );
      }
    }

    logger.info(
      `Test user cleanup completed: ${deletedOrders} orders, ${deletedTransactions} transactions, ${deletedCommissions} commissions deleted`
    );
  } catch (error) {
    logger.error("Error in test user cleanup job:", error);
  }
}

/**
 * Delete test orders after a delay once they're completed
 * This function checks for orders that have been completed for more than 10 minutes
 */
async function cleanupDelayedTestOrders() {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // Find completed orders older than 10 minutes
    const ordersToDelete = await Order.find({
      user: TEST_USER_ID,
      status: { $in: ["completed", "received"] },
      updatedAt: { $lte: tenMinutesAgo },
    });

    if (ordersToDelete.length === 0) {
      return; // No orders ready for cleanup yet
    }

    logger.info(
      `Found ${ordersToDelete.length} test orders ready for delayed cleanup`
    );

    for (const order of ordersToDelete) {
      try {
        const orderId = order._id;

        // Delete related wallet transactions
        await WalletTransaction.deleteMany({
          $or: [{ relatedOrder: orderId }, { user: TEST_USER_ID }],
        });

        // Delete related commission records
        await CommissionRecord.deleteMany({
          agentId: TEST_USER_ID,
          periodStart: { $lte: order.updatedAt || new Date() },
          periodEnd: { $gte: order.createdAt },
        });

        // Delete the order
        await Order.findByIdAndDelete(orderId);

        logger.info(
          `Delayed cleanup completed for test order ${order.orderNumber}`
        );
      } catch (error) {
        logger.error(
          `Failed to cleanup delayed test order ${order.orderNumber}:`,
          error
        );
      }
    }
  } catch (error) {
    logger.error("Error in delayed test order cleanup:", error);
  }
}

/**
 * Manual cleanup function that can be called to immediately clean all test data
 */
export async function cleanupAllTestUserData() {
  try {
    logger.info("Starting manual cleanup of all test user data...");

    // Delete all orders
    const orderResult = await Order.deleteMany({ user: TEST_USER_ID });
    logger.info(`Deleted ${orderResult.deletedCount} test orders`);

    // Delete all transactions
    const transactionResult = await WalletTransaction.deleteMany({
      user: TEST_USER_ID,
    });
    logger.info(`Deleted ${transactionResult.deletedCount} test transactions`);

    // Delete all commissions
    const commissionResult = await CommissionRecord.deleteMany({
      agentId: TEST_USER_ID,
    });
    logger.info(`Deleted ${commissionResult.deletedCount} test commissions`);

    logger.info("Manual test user data cleanup completed successfully");
    return {
      success: true,
      deleted: {
        orders: orderResult.deletedCount,
        transactions: transactionResult.deletedCount,
        commissions: commissionResult.deletedCount,
      },
    };
  } catch (error) {
    logger.error("Error in manual test user cleanup:", error);
    throw error;
  }
}

/**
 * Initialize the test user cleanup job
 * Runs every 5 minutes to check for orders ready to be deleted
 */
export function initTestUserCleanupJob() {
  // Run every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    try {
      await cleanupDelayedTestOrders();
    } catch (error) {
      logger.error("Test user cleanup job failed:", error);
    }
  });

  // Also run cleanup on startup for any existing completed orders
  logger.info("Test user cleanup job initialized");
  cleanupCompletedTestOrders()
    .then(() => {
      logger.info("Initial test user cleanup completed");
    })
    .catch((error) => {
      logger.error("Initial test user cleanup failed:", error);
    });
}

export default {
  initTestUserCleanupJob,
  cleanupAllTestUserData,
  cleanupCompletedTestOrders,
  cleanupDelayedTestOrders,
};
