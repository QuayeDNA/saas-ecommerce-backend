// src/jobs/commissionGeneration.js
import cron from 'node-cron';
import commissionService from '../services/commissionService.js';
import logger from '../utils/logger.js';

/**
 * Resource-efficient commission generation job
 * Runs on the 1st of every month at 3:00 AM
 * Uses batch processing and optimized queries
 */
export const scheduleCommissionGeneration = () => {
  // Run on the 1st of every month at 3:00 AM
  cron.schedule('0 3 1 * *', async () => {
    try {
      logger.info('Starting monthly commission generation job...');

      const startTime = Date.now();

      // Generate commissions for current month
      const generationResult = await commissionService.generateMonthlyCommissions();

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      // Log detailed results
      const successful = generationResult.filter(r => r.status === 'created').length;
      const existing = generationResult.filter(r => r.status === 'exists').length;
      const errors = generationResult.filter(r => r.status === 'error').length;

      logger.info('Monthly commission generation completed:', {
        duration: `${duration.toFixed(2)}s`,
        totalAgents: generationResult.length,
        successful,
        existing,
        errors,
        successRate: `${((successful / generationResult.length) * 100).toFixed(1)}%`
      });

      // Log any errors for debugging
      const errorResults = generationResult.filter(r => r.status === 'error');
      if (errorResults.length > 0) {
        logger.warn('Commission generation errors:', errorResults);
      }

    } catch (error) {
      logger.error('Monthly commission generation job failed:', error);
    }
  }, {
    timezone: "UTC"
  });

  logger.info('Commission generation job scheduled to run monthly on the 1st at 3:00 AM UTC');
};

/**
 * Manual commission generation for testing or admin purposes
 * @param {Date} month - Month to generate commissions for (defaults to current month)
 * @returns {Promise<Object>} Generation results
 */
export const manualCommissionGeneration = async (month = new Date()) => {
  try {
    logger.info('Starting manual commission generation...');

    const startTime = Date.now();
    const result = await commissionService.generateMonthlyCommissions(month);
    const endTime = Date.now();

    const successful = result.filter(r => r.status === 'created').length;
    const existing = result.filter(r => r.status === 'exists').length;
    const errors = result.filter(r => r.status === 'error').length;

    logger.info('Manual commission generation completed:', {
      duration: `${((endTime - startTime) / 1000).toFixed(2)}s`,
      totalAgents: result.length,
      successful,
      existing,
      errors
    });

    return {
      success: true,
      duration: (endTime - startTime) / 1000,
      results: result,
      summary: {
        total: result.length,
        successful,
        existing,
        errors
      }
    };

  } catch (error) {
    logger.error('Manual commission generation failed:', error);
    throw error;
  }
};

/**
 * Generate commissions for a specific agent (for testing)
 * @param {string} agentId - Agent ID
 * @param {Date} month - Month to generate commission for
 * @returns {Promise<Object>} Generation result
 */
export const generateAgentCommission = async (agentId, month = new Date()) => {
  try {
    logger.info(`Generating commission for agent ${agentId}...`);

    const result = await commissionService.generateMonthlyCommissions(month);

    const agentResult = result.find(r => r.agentId?.toString() === agentId);

    if (agentResult) {
      logger.info(`Commission generation for agent ${agentId}:`, agentResult);
      return agentResult;
    } else {
      logger.warn(`Agent ${agentId} not found in generation results`);
      return null;
    }

  } catch (error) {
    logger.error(`Failed to generate commission for agent ${agentId}:`, error);
    throw error;
  }
};
