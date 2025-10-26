// src/jobs/dailyCommissionGeneration.js
import cron from "node-cron";
import commissionService from "../services/commissionService.js";
import logger from "../utils/logger.js";

/**
 * Daily commission generation job
 * Runs every day at 2:00 AM to generate commission records for the previous day
 * This allows users to see their commissions accumulate daily throughout the month
 */
export const scheduleDailyCommissionGeneration = () => {
  // Run every day at 2:00 AM
  cron.schedule(
    "0 2 * * *",
    async () => {
      try {
        logger.info("=== Starting Daily Commission Generation Job ===");

        const startTime = Date.now();

        // Generate commissions for yesterday
        const generationResult =
          await commissionService.generateDailyCommissions();

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        // Log detailed results
        const created = generationResult.summary.created;
        const updated = generationResult.summary.updated;
        const noCommission = generationResult.summary.noCommission;
        const errors = generationResult.summary.errors;

        logger.info("Daily commission generation completed:", {
          day: generationResult.day,
          duration: `${duration.toFixed(2)}s`,
          totalAgents: generationResult.summary.totalAgents,
          created,
          updated,
          noCommission,
          errors,
          successRate: generationResult.summary.successRate,
        });

        // Log any errors for debugging
        const errorResults = generationResult.results.filter(
          (r) => r.status === "error"
        );
        if (errorResults.length > 0) {
          logger.warn("Daily commission generation errors:", errorResults);
        }

        logger.info("=== Daily Commission Generation Job Completed ===");
      } catch (error) {
        logger.error("Daily commission generation job failed:", error);
      }
    },
    {
      timezone: "Africa/Accra", // Ghana timezone
    }
  );

  logger.info(
    "Daily commission generation job scheduled to run every day at 2:00 AM (Africa/Accra timezone)"
  );
};

/**
 * Manual daily commission generation for testing or admin purposes
 * @param {Date} date - Date to generate commissions for (defaults to yesterday)
 * @returns {Promise<Object>} Generation results
 */
export const manualDailyCommissionGeneration = async (date = new Date()) => {
  try {
    logger.info("Starting manual daily commission generation...");

    const startTime = Date.now();
    const result = await commissionService.generateDailyCommissions(date);
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    result.duration = duration;

    const created = result.summary.created;
    const updated = result.summary.updated;
    const noCommission = result.summary.noCommission;
    const errors = result.summary.errors;

    logger.info("Manual daily commission generation completed:", {
      day: result.day,
      duration: `${duration.toFixed(2)}s`,
      totalAgents: result.summary.totalAgents,
      created,
      updated,
      noCommission,
      errors,
      successRate: result.summary.successRate,
    });

    return {
      success: true,
      duration,
      results: result.results,
      summary: result.summary,
      day: result.day,
    };
  } catch (error) {
    logger.error("Manual daily commission generation failed:", error);
    throw error;
  }
};

/**
 * Generate daily commissions for a specific agent (for testing)
 * @param {string} agentId - Agent ID
 * @param {Date} date - Date to generate commission for (defaults to yesterday)
 * @returns {Promise<Object>} Generation result
 */
export const generateAgentDailyCommission = async (
  agentId,
  date = new Date()
) => {
  try {
    logger.info(`Generating daily commission for agent ${agentId}...`);

    const result = await commissionService.generateDailyCommissions(date);

    const agentResult = result.results.find(
      (r) => r.agentId?.toString() === agentId
    );

    if (agentResult) {
      logger.info(
        `Daily commission generation for agent ${agentId}:`,
        agentResult
      );
      return agentResult;
    } else {
      logger.warn(`Agent ${agentId} not found in daily generation results`);
      return null;
    }
  } catch (error) {
    logger.error(
      `Failed to generate daily commission for agent ${agentId}:`,
      error
    );
    throw error;
  }
};
