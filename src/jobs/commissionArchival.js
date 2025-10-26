// src/jobs/commissionArchival.js

/**
 * Commission Archival Cron Job
 *
 * Automatically archives the previous month's commissions on the 1st of each month.
 * This job runs monthly on the 1st of each month at 1:00 AM.
 *
 * What it does:
 * 1. Archives all commission records from the previous month
 * 2. Creates CommissionMonthlySummary for each agent
 * 3. Provides historical reporting with payment status
 * 4. Optimizes database performance by freezing old records
 *
 * This addresses the commission lifecycle management:
 * - Separates current month (active) from historical data
 * - Provides clean monthly reporting
 * - Enables payment tracking across months
 */

import cron from "node-cron";
import commissionService from "../services/commissionService.js";
import logger from "../utils/logger.js";

/**
 * Archive previous month's commissions
 * This is called automatically on the 1st of each month
 */
async function archivePreviousMonth() {
  try {
    const startTime = Date.now();
    
    // Get previous month
    const currentDate = new Date();
    const previousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const year = previousMonth.getFullYear();
    const monthNumber = previousMonth.getMonth() + 1;

    logger.info(
      `Starting automatic archival for ${previousMonth.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
      })}...`
    );

    // Archive the previous month
    const result = await commissionService.archiveMonthCommissions(
      year,
      monthNumber,
      null // null = automatic archival
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info(
      `Automatic archival completed in ${duration}s:`,
      {
        month: result.month,
        summariesCreated: result.summariesCreated,
        recordsArchived: result.recordsArchived
      }
    );

    return result;
  } catch (error) {
    logger.error(`Automatic commission archival failed: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Initialize cron job
 * Runs on the 1st of every month at 1:00 AM (before cleanup at 2:00 AM)
 *
 * Cron pattern: '0 1 1 * *'
 * - Minute: 0
 * - Hour: 1 (1:00 AM)
 * - Day of month: 1 (1st)
 * - Month: * (every month)
 * - Day of week: * (any day)
 */
export function initializeCommissionArchivalJob() {
  // Schedule the job
  cron.schedule(
    "0 1 1 * *", // Run on 1st of every month at 1:00 AM
    async () => {
      logger.info("Running scheduled commission archival job");
      await archivePreviousMonth();
    },
    {
      scheduled: true,
      timezone: "UTC", // Use UTC timezone for consistency
    }
  );

  logger.info(
    "Commission archival job initialized. Will run on the 1st of every month at 1:00 AM UTC to archive the previous month's commissions."
  );
}

/**
 * Manual trigger for testing or admin purposes
 * Can be called from admin dashboard or API endpoint
 * 
 * @param {number} year - Year to archive (optional, defaults to last month)
 * @param {number} monthNumber - Month number (1-12) (optional, defaults to last month)
 * @param {string} userId - User ID who triggered archival (optional)
 * @returns {Promise<Object>} Archival results
 */
export async function runCommissionArchivalManually(year = null, monthNumber = null, userId = null) {
  try {
    logger.info("Running manual commission archival job");

    // If year/month not provided, use previous month
    if (!year || !monthNumber) {
      const previousMonth = new Date();
      previousMonth.setMonth(previousMonth.getMonth() - 1);
      year = previousMonth.getFullYear();
      monthNumber = previousMonth.getMonth() + 1;
    }

    const result = await commissionService.archiveMonthCommissions(
      year,
      monthNumber,
      userId
    );

    return result;
  } catch (error) {
    logger.error('Manual commission archival failed:', error);
    throw error;
  }
}

export default {
  initializeCommissionArchivalJob,
  runCommissionArchivalManually,
  archivePreviousMonth
};
