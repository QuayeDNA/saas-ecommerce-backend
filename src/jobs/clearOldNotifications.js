// src/jobs/clearOldNotifications.js
import cron from 'node-cron';
import Notification from '../models/Notification.js';
import logger from '../utils/logger.js';

/**
 * Job to clear old notifications (older than 3 days)
 * Runs every 3 days at 2:00 AM
 */
const clearOldNotifications = async () => {
  try {
    logger.info('Starting notification cleanup job...');
    
    // Calculate date 3 days ago
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    // Delete notifications older than 3 days
    const result = await Notification.deleteMany({
      createdAt: { $lt: threeDaysAgo }
    });
    
    logger.info(`Notification cleanup completed. Deleted ${result.deletedCount} old notifications.`);
    
    // Also delete read notifications older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const readResult = await Notification.deleteMany({
      read: true,
      createdAt: { $lt: sevenDaysAgo }
    });
    
    logger.info(`Read notification cleanup completed. Deleted ${readResult.deletedCount} old read notifications.`);
    
  } catch (error) {
    logger.error('Error in notification cleanup job:', error);
  }
};

/**
/**
 * Schedule the job to run every 3 days at 2:00 AM
 * Cron format: every 3 days at 2:00 AM
 */
const scheduleNotificationCleanup = () => {
  // Run every 3 days at 2:00 AM
  cron.schedule('0 2 */3 * *', clearOldNotifications, {
    scheduled: true,
    timezone: 'Africa/Accra' // Ghana timezone
  });
  
  logger.info('Notification cleanup job scheduled to run every 3 days at 2:00 AM');
};

/**
 * Manual cleanup function that can be called immediately
 */
const runManualCleanup = async () => {
  logger.info('Running manual notification cleanup...');
  await clearOldNotifications();
};

export {
  clearOldNotifications,
  scheduleNotificationCleanup,
  runManualCleanup
}; 