// src/jobs/commissionReset.js
import cron from 'node-cron';
import commissionService from '../services/commissionService.js';
import logger from '../utils/logger.js';

/**
 * Commission reset job - runs on the 1st of every month at 2:00 AM
 * Expires pending commissions from previous month and generates new ones
 */
export const scheduleCommissionReset = () => {
  // Run on the 1st of every month at 2:00 AM
  cron.schedule('0 2 1 * *', async () => {
    try {
      logger.info('Starting monthly commission reset job...');

      const resetResult = await commissionService.resetMonthlyCommissions();

      logger.info('Monthly commission reset completed:', {
        expiredCommissions: resetResult.expiredCommissions,
        expiredAmount: resetResult.expiredAmount,
        newCommissions: resetResult.newCommissions,
        newCommissionAmount: resetResult.newCommissionAmount
      });

    } catch (error) {
      logger.error('Monthly commission reset job failed:', error);
    }
  }, {
    timezone: "UTC" // You can change this to your local timezone
  });

  logger.info('Commission reset job scheduled to run monthly on the 1st at 2:00 AM UTC');
};

/**
 * Manual commission reset for testing or admin purposes
 * @param {Date} month - Month to reset (defaults to current month)
 */
export const manualCommissionReset = async (month = new Date()) => {
  try {
    logger.info('Starting manual commission reset...');

    const resetResult = await commissionService.resetMonthlyCommissions(month);

    logger.info('Manual commission reset completed:', {
      expiredCommissions: resetResult.expiredCommissions,
      expiredAmount: resetResult.expiredAmount,
      newCommissions: resetResult.newCommissions,
      newCommissionAmount: resetResult.newCommissionAmount
    });

    return resetResult;
  } catch (error) {
    logger.error('Manual commission reset failed:', error);
    throw error;
  }
};
