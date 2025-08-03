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

// Get all notifications (both read and unread)
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 50, read } = req.query;
    const skip = (page - 1) * limit;
    
    const filter = {};
    if (read !== undefined) {
      filter.read = read === 'true';
    }
    
    const notifications = await notificationService.getAllNotifications(
      req.user.userId,
      { 
        limit: parseInt(limit), 
        skip: parseInt(skip),
        filter
      }
    );
    
    const totalCount = await notificationService.getNotificationCount(
      req.user.userId,
      filter
    );
    
    res.json({
      success: true,
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        skip: parseInt(skip),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error(`Get all notifications error: ${error.message}`);
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

// Mark notification as unread
router.patch('/:notificationId/unread', authenticate, async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    const notification = await notificationService.markNotificationAsUnread(
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
    logger.error(`Mark notification as unread error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as unread'
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

// Clear all read notifications
router.delete('/clear-read', authenticate, async (req, res) => {
  try {
    const result = await notificationService.clearReadNotifications(req.user.userId);
    
    res.json({
      success: true,
      message: 'Read notifications cleared successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    logger.error(`Clear read notifications error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to clear read notifications'
    });
  }
});

// Clear all notifications
router.delete('/clear-all', authenticate, async (req, res) => {
  try {
    const result = await notificationService.clearAllNotifications(req.user.userId);
    
    res.json({
      success: true,
      message: 'All notifications cleared successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    logger.error(`Clear all notifications error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to clear all notifications'
    });
  }
});

// Delete multiple notifications
router.post('/delete-multiple', authenticate, async (req, res) => {
  try {
    const { notificationIds } = req.body;
    
    if (!notificationIds || !Array.isArray(notificationIds)) {
      return res.status(400).json({
        success: false,
        message: 'Notification IDs array is required'
      });
    }
    
    const result = await notificationService.deleteMultipleNotifications(
      notificationIds,
      req.user.userId
    );
    
    res.json({
      success: true,
      message: `${result.deletedCount} notifications deleted successfully`
    });
  } catch (error) {
    logger.error(`Delete multiple notifications error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notifications'
    });
  }
});

// Delete a notification
router.delete('/:notificationId', authenticate, async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    const result = await notificationService.deleteNotification(
      notificationId,
      req.user.userId
    );
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    logger.error(`Delete notification error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
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