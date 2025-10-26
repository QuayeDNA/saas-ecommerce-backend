// src/jobs/commissionFinalization.js
import cron from "node-cron";
import commissionService from "../services/commissionService.js";
import logger from "../utils/logger.js";

/**
 * Scheduled job to finalize commissions at the end of each month
 * Runs on the 1st of every month at 00:01 AM (1 minute after midnight)
 *
 * This replaces the old commission generation/archive/expire workflow with a simpler system:
 * - Marks all previous month's commission records as final (isFinal=true)
 * - Sets finalizedAt timestamp
 * - Sends notifications to agents and super admins
 * - Agents can see current month accumulating in real-time, previous month as "pending payment"
 */

class CommissionFinalizationJob {
  constructor() {
    this.jobSchedule = "1 0 1 * *"; // Runs at 00:01 AM on the 1st of every month
    this.task = null;
  }

  /**
   * Start the scheduled job
   */
  start() {
    if (this.task) {
      logger.warn("Commission finalization job is already running");
      return;
    }

    this.task = cron.schedule(
      this.jobSchedule,
      async () => {
        logger.info("=== Commission Finalization Job Started ===");

        try {
          const result = await commissionService.finalizeMonthCommissions();

          logger.info(
            `Commission finalization completed: ${
              result.count
            } records finalized, Total: GHS ${result.totalAmount?.toFixed(
              2
            )}, Pending Payment: GHS ${result.totalPending?.toFixed(2)}`
          );
        } catch (error) {
          logger.error(`Commission finalization job failed: ${error.message}`, {
            error: error.stack,
          });
        }

        logger.info("=== Commission Finalization Job Completed ===");
      },
      {
        scheduled: true,
        timezone: "Africa/Accra", // Ghana timezone
      }
    );

    logger.info(
      `Commission finalization job scheduled: ${this.jobSchedule} (Africa/Accra timezone)`
    );
  }

  /**
   * Stop the scheduled job
   */
  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info("Commission finalization job stopped");
    }
  }

  /**
   * Run the finalization job manually (for testing or manual triggers)
   */
  async runManually() {
    logger.info("=== Manual Commission Finalization Started ===");

    try {
      const result = await commissionService.finalizeMonthCommissions();

      logger.info(
        `Manual finalization completed: ${
          result.count
        } records finalized, Total: GHS ${result.totalAmount?.toFixed(
          2
        )}, Pending Payment: GHS ${result.totalPending?.toFixed(2)}`
      );

      return result;
    } catch (error) {
      logger.error(`Manual finalization failed: ${error.message}`, {
        error: error.stack,
      });
      throw error;
    }
  }
}

export default new CommissionFinalizationJob();
