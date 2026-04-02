// src/jobs/clearOldNotifications.js
import cron from "node-cron";
import Notification from "../models/Notification.js";
import logger from "../utils/logger.js";

/**
 * Job to clear all notifications (read and unread)
 * Runs daily at 2:00 AM
 */
const clearOldNotifications = async () => {
  try {
    logger.info("Starting notification cleanup job (clear all)...");
    const result = await Notification.deleteMany({});
    logger.info(
      `Notification cleanup completed. Deleted ${result.deletedCount} notifications.`,
    );
  } catch (error) {
    logger.error("Error in notification cleanup job:", error);
  }
};

/**
/**
 * Schedule the job to run daily at 2:00 AM
 * Cron format: daily at 2:00 AM
 */
const scheduleNotificationCleanup = () => {
  // Run daily at 2:00 AM
  cron.schedule("0 2 * * *", clearOldNotifications, {
    scheduled: true,
    timezone: "Africa/Accra", // Ghana timezone
  });

  logger.info("Notification cleanup job scheduled to run daily at 2:00 AM");
};

/**
 * Manual cleanup function that can be called immediately
 */
const runManualCleanup = async () => {
  logger.info("Running manual notification cleanup...");
  await clearOldNotifications();
};

export { clearOldNotifications, scheduleNotificationCleanup, runManualCleanup };
