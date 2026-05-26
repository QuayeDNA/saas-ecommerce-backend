import cron from "node-cron";
import commissionService from "../services/commissionService.js";
import logger from "../utils/logger.js";

const processDailyCommissions = async () => {
  try {
    logger.info("[CommissionJob] Running daily commission processing...");
    const result = await commissionService.processDailyCommissions();
    logger.info(
      `[CommissionJob] Daily commission processing complete: ${result.processed} credited, ${result.skipped} skipped`,
    );
  } catch (error) {
    logger.error(
      `[CommissionJob] Error in daily commission processing: ${error.message}`,
    );
  }
};

const scheduleDailyCommissionProcessing = () => {
  cron.schedule("59 23 * * *", processDailyCommissions, {
    scheduled: true,
    timezone: "Africa/Accra",
  });

  logger.info(
    "[CommissionJob] Daily commission processing scheduled at 11:59 PM (Africa/Accra)",
  );
};

export { processDailyCommissions, scheduleDailyCommissionProcessing };
