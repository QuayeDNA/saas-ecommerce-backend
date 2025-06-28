// src/jobs/deleteUnverifiedUsers.js
import cron from 'node-cron';
import User from '../models/User.js';
import logger from '../utils/logger.js';

// Delete users not verified after 24 hours
const deleteUnverifiedUsersJob = () => {
  cron.schedule('0 * * * *', async () => {
    const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    try {
      const result = await User.deleteMany({
        isVerified: false,
        createdAt: { $lt: threshold }
      });
      if (result.deletedCount > 0) {
        logger.info(`Deleted ${result.deletedCount} unverified users older than 24 hours.`);
      }
    } catch (err) {
      logger.error(`Error deleting unverified users: ${err.message}`);
    }
  });
};

export default deleteUnverifiedUsersJob;
