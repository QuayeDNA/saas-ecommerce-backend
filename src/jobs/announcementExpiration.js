// src/jobs/announcementExpiration.js

import cron from "node-cron";
import announcementService from "../services/announcementService.js";
import logger from "../utils/logger.js";

/**
 * Job to automatically expire announcements that have passed their expiry date
 * Runs every hour
 */
const announcementExpirationJob = () => {
  // Run every hour at minute 0
  cron.schedule("0 * * * *", async () => {
    try {
      logger.info("Running announcement expiration job");

      const expiredCount = await announcementService.expireAnnouncements();

      if (expiredCount > 0) {
        logger.info(`Expired ${expiredCount} announcements`);
      }
    } catch (error) {
      logger.error("Error in announcement expiration job:", error);
    }
  });

  logger.info("Announcement expiration job scheduled (runs every hour)");
};

export default announcementExpirationJob;