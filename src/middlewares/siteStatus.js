import settingsService from '../services/settingsService.js';
import logger from '../utils/logger.js';

// Middleware to check if site is open for order-related operations
export const checkSiteStatus = async (req, res, next) => {
  try {
    const isOpen = await settingsService.isSiteOpen();
    
    if (!isOpen) {
      // Get the custom message
      const siteSettings = await settingsService.getSiteSettings();
      
      return res.status(503).json({
        error: 'Site is currently under maintenance',
        message: siteSettings.customMessage,
        isSiteClosed: true
      });
    }
    
    next();
  } catch (error) {
    logger.error('Error checking site status:', error);
    next();
  }
};

// Middleware to check site status for order creation specifically
export const checkSiteStatusForOrders = async (req, res, next) => {
  try {
    const isOpen = await settingsService.isSiteOpen();
    
    if (!isOpen) {
      const siteSettings = await settingsService.getSiteSettings();
      
      return res.status(503).json({
        error: 'Site is currently under maintenance',
        message: siteSettings.customMessage,
        isSiteClosed: true,
        details: 'New orders cannot be placed while the site is under maintenance'
      });
    }
    
    next();
  } catch (error) {
    logger.error('Error checking site status for orders:', error);
    next();
  }
}; 