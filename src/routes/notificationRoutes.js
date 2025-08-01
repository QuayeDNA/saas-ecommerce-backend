// src/routes/notificationRoutes.js
import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import notificationService from '../services/notificationService.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Get user's unread notifications
router.get('/unread', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    
    const notifications = await notificationService.getUnreadNotifications(
      req.user.userId,
      { limit: parseInt(limit), skip: parseInt(skip) }
    );
    
    res.json({
      success: true,
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        skip: parseInt(skip)
      }
    });
  } catch (error) {
    logger.error(`Get unread notifications error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

// Mark notification as read
router.patch('/:notificationId/read', authenticate, async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    const notification = await notificationService.markNotificationAsRead(
      notificationId,
      req.user.userId
    );
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }
    
    res.json({
      success: true,
      notification
    });
  } catch (error) {
    logger.error(`Mark notification as read error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// Mark all notifications as read
router.patch('/read-all', authenticate, async (req, res) => {
  try {
    const result = await notificationService.markAllNotificationsAsRead(req.user.userId);
    
    res.json({
      success: true,
      message: 'All notifications marked as read',
      result
    });
  } catch (error) {
    logger.error(`Mark all notifications as read error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as read'
    });
  }
});

// Get notification count (for badge)
router.get('/count', authenticate, async (req, res) => {
  try {
    const notifications = await notificationService.getUnreadNotifications(
      req.user.userId,
      { limit: 1000 } // Get all to count
    );
    
    res.json({
      success: true,
      count: notifications.length
    });
  } catch (error) {
    logger.error(`Get notification count error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification count'
    });
  }
});

export default router; 