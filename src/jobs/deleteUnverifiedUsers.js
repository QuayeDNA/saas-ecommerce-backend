// src/jobs/deleteUnverifiedUsers.js
import cron from 'node-cron';
import User from '../models/User.js';
import logger from '../utils/logger.js';

// Delete users not verified after 10 minutes
const deleteUnverifiedUsersJob = () => {
  // Run every minute to clean up unverified users
  cron.schedule('* * * * *', async () => {
    const threshold = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes
    try {
      const result = await User.deleteMany({
        isVerified: false,
        createdAt: { $lt: threshold }
      });
      if (result.deletedCount > 0) {
        logger.info(`Deleted ${result.deletedCount} unverified users older than 10 minutes.`);
      }
    } catch (err) {
      logger.error(`Error deleting unverified users: ${err.message}`);
    }
  });
};

export default deleteUnverifiedUsersJob;
