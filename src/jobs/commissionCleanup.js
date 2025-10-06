// src/jobs/commissionCleanup.js

/**
 * Commission Cleanup Cron Job
 *
 * Automatically expires pending commissions that are older than the configured expiry period.
 * This job runs monthly on the 1st of each month at 2:00 AM.
 *
 * What it does:
 * 1. Finds all pending commissions older than EXPIRY_DAYS
 * 2. Marks them as 'expired'
 * 3. Sends notifications to affected agents
 * 4. Logs the cleanup activity
 *
 * This addresses Issue #2 from COMMISSION_SYSTEM_ANALYSIS.md:
 * "Commission Expiry System (Not Fully Implemented)"
 */

import cron from "node-cron";
import commissionService from "../services/commissionService.js";
import CommissionRecord from "../models/CommissionRecord.js";
import User from "../models/User.js";
import notificationService from "../services/notificationService.js";
import websocketService from "../services/websocketService.js";
import logger from "../utils/logger.js";
import {
  COMMISSION_STATUS,
  COMMISSION_PERIOD,
  COMMISSION_DEFAULTS,
  COMMISSION_EVENTS,
} from "../constants/commission.js";

/**
 * Expire old pending commissions
 * Marks commissions as expired if they're older than EXPIRY_DAYS
 */
async function expireOldCommissions() {
  try {
    const startTime = Date.now();

    // Calculate expiry date (EXPIRY_DAYS ago from now)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() - COMMISSION_DEFAULTS.EXPIRY_DAYS);

    logger.info(
      `Starting commission expiry job. Expiring commissions older than ${expiryDate.toLocaleDateString()}`
    );

    // Find all pending commissions older than expiry date
    const expiredCommissions = await CommissionRecord.find({
      status: COMMISSION_STATUS.PENDING,
      period: COMMISSION_PERIOD.MONTHLY,
      periodEnd: { $lt: expiryDate },
    }).populate("agentId", "fullName email");

    if (expiredCommissions.length === 0) {
      logger.info("No commissions to expire");
      return {
        success: true,
        expired: 0,
        totalAmount: 0,
      };
    }

    logger.info(`Found ${expiredCommissions.length} commissions to expire`);

    let expiredCount = 0;
    let expiredAmount = 0;

    // Process each expired commission
    for (const commission of expiredCommissions) {
      try {
        // Update status to expired
        commission.status = COMMISSION_STATUS.EXPIRED;
        commission.notes = `Automatically expired on ${new Date().toLocaleDateString()} after ${
          COMMISSION_DEFAULTS.EXPIRY_DAYS
        } days`;
        await commission.save();

        expiredCount++;
        expiredAmount += commission.amount;

        // Send notification to agent
        if (commission.agentId) {
          const agent = commission.agentId;
          const monthName = commission.periodStart.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          });

          try {
            // In-app notification
            await notificationService.createInAppNotification(
              agent._id.toString(),
              "Commission Expired",
              `Your pending commission of GH₵${commission.amount} for ${monthName} has expired due to the ${COMMISSION_DEFAULTS.EXPIRY_DAYS}-day policy.`,
              "warning",
              {
                commissionId: commission._id.toString(),
                amount: commission.amount,
                period: commission.period,
                periodStart: commission.periodStart,
                periodEnd: commission.periodEnd,
                expiredDate: new Date().toISOString(),
                type: COMMISSION_EVENTS.EXPIRED,
                navigationLink: "/agent/dashboard/commissions",
              }
            );

            // WebSocket notification
            websocketService.sendToUser(agent._id.toString(), {
              type: COMMISSION_EVENTS.EXPIRED,
              commissionId: commission._id.toString(),
              amount: commission.amount,
              period: commission.period,
              periodStart: commission.periodStart,
              periodEnd: commission.periodEnd,
              message: `Your commission of GH₵${commission.amount} for ${monthName} has expired.`,
              timestamp: new Date().toISOString(),
            });
          } catch (notificationError) {
            logger.error(
              `Failed to send expiry notification for commission ${commission._id}: ${notificationError.message}`
            );
          }
        }

        logger.info(
          `Expired commission ${commission._id} for agent ${
            commission.agentId?.fullName || "Unknown"
          }: GH₵${commission.amount}`
        );
      } catch (error) {
        logger.error(
          `Error expiring commission ${commission._id}: ${error.message}`
        );
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info(
      `Commission expiry job completed in ${duration}s: ${expiredCount} commissions expired (GH₵${expiredAmount.toFixed(
        2
      )})`
    );

    return {
      success: true,
      expired: expiredCount,
      totalAmount: expiredAmount.toFixed(2),
      duration,
    };
  } catch (error) {
    logger.error(`Commission expiry job failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Initialize cron job
 * Runs on the 1st of every month at 2:00 AM
 *
 * Cron pattern: '0 2 1 * *'
 * - Minute: 0
 * - Hour: 2 (2:00 AM)
 * - Day of month: 1 (1st)
 * - Month: * (every month)
 * - Day of week: * (any day)
 */
export function initializeCommissionCleanupJob() {
  // Schedule the job
  cron.schedule(
    "0 2 1 * *", // Run on 1st of every month at 2:00 AM
    async () => {
      logger.info("Running scheduled commission expiry job");
      await expireOldCommissions();
    },
    {
      scheduled: true,
      timezone: "UTC", // Use UTC timezone for consistency
    }
  );

  logger.info(
    `Commission cleanup job initialized. Will run on the 1st of every month at 2:00 AM UTC to expire commissions older than ${COMMISSION_DEFAULTS.EXPIRY_DAYS} days.`
  );
}

/**
 * Manual trigger for testing
 * Can be called from admin dashboard or API endpoint
 */
export async function runCommissionCleanupManually() {
  logger.info("Running manual commission expiry job");
  return await expireOldCommissions();
}

export default {
  initializeCommissionCleanupJob,
  runCommissionCleanupManually,
  expireOldCommissions,
};
