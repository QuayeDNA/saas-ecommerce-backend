// src/services/notificationService.js
import axios from "axios";
import logger from "../utils/logger.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import websocketService from "./websocketService.js";
import pushNotificationService from "./pushNotificationService.js";

class NotificationService {
  constructor() {
    this.whatsappApiUrl = process.env.WHATSAPP_API_URL;
    this.whatsappToken = process.env.WHATSAPP_TOKEN;
    this.whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  }

  /**
   * Get the correct navigation link based on user type
   * @param {string} userType - User type (agent, super_admin, etc.)
   * @param {string} page - Page to navigate to (wallet, orders, etc.)
   * @returns {string} Navigation link
   */
  getNavigationLink(userType, page) {
    const routes = {
      agent: {
        wallet: "/agent/dashboard/wallet",
        orders: "/agent/dashboard/orders",
      },
      super_admin: {
        wallet: "/superadmin/wallet",
        orders: "/superadmin/orders",
      },
      admin: {
        wallet: "/admin/wallet",
        orders: "/admin/orders",
      },
    };

    return routes[userType]?.[page] || `/${page}`;
  }

  /**
   * Send WhatsApp message using WhatsApp Business API
   * @param {string} phoneNumber - Recipient phone number (with country code)
   * @param {string} message - Message to send
   * @returns {Promise<boolean>} Success status
   */
  async sendWhatsAppMessage(phoneNumber, message) {
    try {
      if (
        !this.whatsappApiUrl ||
        !this.whatsappToken ||
        !this.whatsappPhoneNumberId
      ) {
        logger.warn(
          "WhatsApp configuration missing. Skipping WhatsApp notification."
        );
        return false;
      }

      // Format phone number (remove + if present, ensure it starts with country code)
      const formattedPhone = phoneNumber.replace(/^\+/, "");

      const payload = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "text",
        text: {
          body: message,
        },
      };

      const response = await axios.post(
        `${this.whatsappApiUrl}/${this.whatsappPhoneNumberId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.whatsappToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      logger.info(`WhatsApp message sent successfully to ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error(`Failed to send WhatsApp message: ${error.message}`);
      return false;
    }
  }

  /**
   * Create in-app notification
   * @param {string} userId - User ID
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} type - Notification type (success, error, warning, info)
   * @param {object} metadata - Additional data
   * @returns {Promise<object>} Created notification
   */
  async createInAppNotification(
    userId,
    title,
    message,
    type = "info",
    metadata = {}
  ) {
    try {
      const notification = new Notification({
        user: userId,
        title,
        message,
        type,
        metadata,
        read: false,
      });

      await notification.save();
      logger.info(`In-app notification created for user ${userId}: ${title}`);

      // Send real-time notification via WebSocket
      websocketService.sendNotificationToUser(userId, {
        type: "new_notification",
        notification: notification,
      });

      // Send push notification if user has enabled it
      try {
        const user = await User.findById(userId);
        logger.info(`Checking push notification for user ${userId}:`, {
          hasUser: !!user,
          hasPushSubscription: !!user?.pushSubscription,
          pushPreferences: user?.pushNotificationPreferences,
        });

        if (user && user.pushSubscription) {
          const prefsEnabled =
            user.pushNotificationPreferences?.enabled !== false;
          logger.info(`Push notification enabled: ${prefsEnabled}`);

          if (prefsEnabled) {
            const result = await pushNotificationService.sendToUser(userId, {
              title,
              body: message,
              url: metadata.navigationLink || "/",
              data: metadata,
            });
            logger.info(
              `Push notification result for user ${userId}: ${result}`
            );
          } else {
            logger.info(`Push notifications disabled for user ${userId}`);
          }
        } else {
          logger.info(`No push subscription for user ${userId}`);
        }
      } catch (pushError) {
        logger.error(`Failed to send push notification: ${pushError.message}`);
        logger.error(`Push error stack:`, pushError.stack);
        // Don't fail the whole notification process if push fails
      }

      return notification;
    } catch (error) {
      logger.error(`Failed to create in-app notification: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send wallet top-up approval notification
   * @param {string} userId - User ID
   * @param {number} amount - Approved amount
   * @param {string} approvedBy - Admin who approved
   * @returns {Promise<void>}
   */
  async sendWalletTopUpApprovalNotification(userId, amount, approvedBy) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        logger.error(`User not found for wallet notification: ${userId}`);
        return;
      }

      const title = "Wallet Top-Up Approved";
      const message = `Your wallet top-up request of GH₵${amount} has been approved and credited to your account.`;

      // Create in-app notification
      await this.createInAppNotification(userId, title, message, "success", {
        amount,
        approvedBy,
        type: "wallet_topup_approved",
        navigationLink: this.getNavigationLink(user.userType, "wallet"),
      });

      // Send WhatsApp notification if phone number exists
      if (user.phone) {
        const whatsappMessage = `✅ *Wallet Top-Up Approved*\n\nYour wallet top-up request of *GH₵${amount}* has been approved and credited to your account.\n\nNew balance: *GH₵${user.walletBalance}*\n\nThank you for using our service!`;
        await this.sendWhatsAppMessage(user.phone, whatsappMessage);
      }

      logger.info(`Wallet top-up approval notification sent to user ${userId}`);
    } catch (error) {
      logger.error(
        `Failed to send wallet top-up approval notification: ${error.message}`
      );
    }
  }

  /**
   * Send wallet top-up rejection notification
   * @param {string} userId - User ID
   * @param {number} amount - Rejected amount
   * @param {string} reason - Rejection reason
   * @param {string} rejectedBy - Admin who rejected
   * @returns {Promise<void>}
   */
  async sendWalletTopUpRejectionNotification(
    userId,
    amount,
    reason,
    rejectedBy
  ) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        logger.error(
          `User not found for wallet rejection notification: ${userId}`
        );
        return;
      }

      const title = "Wallet Top-Up Rejected";
      const message = `Your wallet top-up request of GH₵${amount} has been rejected. Reason: ${reason}`;

      // Create in-app notification
      await this.createInAppNotification(userId, title, message, "error", {
        amount,
        reason,
        rejectedBy,
        type: "wallet_topup_rejected",
        navigationLink: this.getNavigationLink(user.userType, "wallet"),
      });

      // Send WhatsApp notification if phone number exists
      if (user.phone) {
        const whatsappMessage = `❌ *Wallet Top-Up Rejected*\n\nYour wallet top-up request of *GH₵${amount}* has been rejected.\n\n*Reason:* ${reason}\n\nPlease contact support if you have any questions.`;
        await this.sendWhatsAppMessage(user.phone, whatsappMessage);
      }

      logger.info(
        `Wallet top-up rejection notification sent to user ${userId}`
      );
    } catch (error) {
      logger.error(
        `Failed to send wallet top-up rejection notification: ${error.message}`
      );
    }
  }

  /**
   * Send order status update notification
   * @param {string} userId - User ID
   * @param {string} orderId - Order ID
   * @param {string} orderNumber - Order number
   * @param {string} oldStatus - Previous status
   * @param {string} newStatus - New status
   * @param {object} orderDetails - Order details
   * @returns {Promise<void>}
   */
  async sendOrderStatusNotification(
    userId,
    orderId,
    orderNumber,
    oldStatus,
    newStatus,
    orderDetails = {}
  ) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        logger.error(`User not found for order notification: ${userId}`);
        return;
      }

      const statusMessages = {
        confirmed: "Your order has been confirmed and is being processed.",
        processing: "Your order is now being processed.",
        completed: "Your order has been completed successfully!",
        failed: "Your order processing failed. Please contact support.",
        cancelled: "Your order has been cancelled.",
      };

      const title = `Order ${orderNumber} - ${
        newStatus.charAt(0).toUpperCase() + newStatus.slice(1)
      }`;
      const message =
        statusMessages[newStatus] ||
        `Your order status has been updated to ${newStatus}.`;

      // Create in-app notification
      await this.createInAppNotification(
        userId,
        title,
        message,
        newStatus === "completed"
          ? "success"
          : newStatus === "failed"
          ? "error"
          : "info",
        {
          orderId,
          orderNumber,
          oldStatus,
          newStatus,
          type: "order_status_update",
          navigationLink: this.getNavigationLink(user.userType, "orders"),
        }
      );

      // Send WhatsApp notification if phone number exists
      if (user.phone) {
        const statusEmoji = {
          confirmed: "✅",
          processing: "⚙️",
          completed: "🎉",
          failed: "❌",
          cancelled: "🚫",
        };

        const whatsappMessage = `${
          statusEmoji[newStatus] || "📋"
        } *Order ${orderNumber} - ${newStatus.toUpperCase()}*\n\n${
          statusMessages[newStatus] ||
          `Your order status has been updated to ${newStatus}.`
        }\n\nOrder Total: *GH₵${orderDetails.total || 0}*`;
        await this.sendWhatsAppMessage(user.phone, whatsappMessage);
      }

      logger.info(
        `Order status notification sent to user ${userId} for order ${orderNumber}`
      );
    } catch (error) {
      logger.error(
        `Failed to send order status notification: ${error.message}`
      );
    }
  }

  /**
   * Send bulk order progress notification
   * @param {string} userId - User ID
   * @param {string} orderId - Order ID
   * @param {string} orderNumber - Order number
   * @param {number} processed - Number of processed items
   * @param {number} total - Total number of items
   * @returns {Promise<void>}
   */
  async sendBulkOrderProgressNotification(
    userId,
    orderId,
    orderNumber,
    processed,
    total
  ) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        logger.error(`User not found for bulk order notification: ${userId}`);
        return;
      }

      const percentage = Math.round((processed / total) * 100);
      const title = `Bulk Order Progress - ${orderNumber}`;
      const message = `${processed} of ${total} items processed (${percentage}% complete)`;

      // Create in-app notification
      await this.createInAppNotification(userId, title, message, "info", {
        orderId,
        orderNumber,
        processed,
        total,
        percentage,
        type: "bulk_order_progress",
        navigationLink: this.getNavigationLink(user.userType, "orders"),
      });

      // Send WhatsApp notification if phone number exists and progress is significant
      if (user.phone && (percentage % 25 === 0 || percentage === 100)) {
        const progressEmoji = percentage === 100 ? "🎉" : "📊";
        const whatsappMessage = `${progressEmoji} *Bulk Order Progress*\n\nOrder: *${orderNumber}*\nProgress: *${processed}/${total} items* (${percentage}%)\n\n${
          percentage === 100
            ? "All items have been processed successfully!"
            : "Your bulk order is being processed."
        }`;
        await this.sendWhatsAppMessage(user.phone, whatsappMessage);
      }

      logger.info(
        `Bulk order progress notification sent to user ${userId} for order ${orderNumber}`
      );
    } catch (error) {
      logger.error(
        `Failed to send bulk order progress notification: ${error.message}`
      );
    }
  }

  /**
   * Get user's unread notifications
   * @param {string} userId - User ID
   * @param {object} options - Query options
   * @returns {Promise<Array>} Unread notifications
   */
  async getUnreadNotifications(userId, options = {}) {
    try {
      const { limit = 20, skip = 0 } = options;

      const notifications = await Notification.find({
        user: userId,
        read: false,
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);

      return notifications;
    } catch (error) {
      logger.error(`Failed to get unread notifications: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark notification as read
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID
   * @returns {Promise<object>} Updated notification
   */
  async markNotificationAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, user: userId },
        { read: true },
        { new: true }
      );

      return notification;
    } catch (error) {
      logger.error(`Failed to mark notification as read: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   * @param {string} userId - User ID
   * @returns {Promise<object>} Update result
   */
  async markAllNotificationsAsRead(userId) {
    try {
      const result = await Notification.updateMany(
        { user: userId, read: false },
        { read: true }
      );

      return result;
    } catch (error) {
      logger.error(
        `Failed to mark all notifications as read: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get all notifications for a user (both read and unread)
   * @param {string} userId - User ID
   * @param {object} options - Query options
   * @returns {Promise<Array>} All notifications
   */
  async getAllNotifications(userId, options = {}) {
    try {
      const { limit = 50, skip = 0, filter = {} } = options;

      const query = { user: userId, ...filter };

      const notifications = await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);

      return notifications;
    } catch (error) {
      logger.error(`Failed to get all notifications: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get notification count for a user
   * @param {string} userId - User ID
   * @param {object} filter - Filter options
   * @returns {Promise<number>} Notification count
   */
  async getNotificationCount(userId, filter = {}) {
    try {
      const query = { user: userId, ...filter };
      const count = await Notification.countDocuments(query);
      return count;
    } catch (error) {
      logger.error(`Failed to get notification count: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark notification as unread
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID
   * @returns {Promise<object>} Updated notification
   */
  async markNotificationAsUnread(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, user: userId },
        { read: false },
        { new: true }
      );

      return notification;
    } catch (error) {
      logger.error(`Failed to mark notification as unread: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a notification
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteNotification(notificationId, userId) {
    try {
      const result = await Notification.findOneAndDelete({
        _id: notificationId,
        user: userId,
      });

      return !!result;
    } catch (error) {
      logger.error(`Failed to delete notification: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete multiple notifications
   * @param {Array} notificationIds - Array of notification IDs
   * @param {string} userId - User ID
   * @returns {Promise<object>} Delete result
   */
  async deleteMultipleNotifications(notificationIds, userId) {
    try {
      const result = await Notification.deleteMany({
        _id: { $in: notificationIds },
        user: userId,
      });

      return result;
    } catch (error) {
      logger.error(`Failed to delete multiple notifications: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear all read notifications for a user
   * @param {string} userId - User ID
   * @returns {Promise<object>} Delete result
   */
  async clearReadNotifications(userId) {
    try {
      const result = await Notification.deleteMany({
        user: userId,
        read: true,
      });

      return result;
    } catch (error) {
      logger.error(`Failed to clear read notifications: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear all notifications for a user
   * @param {string} userId - User ID
   * @returns {Promise<object>} Delete result
   */
  async clearAllNotifications(userId) {
    try {
      const result = await Notification.deleteMany({
        user: userId,
      });

      return result;
    } catch (error) {
      logger.error(`Failed to clear all notifications: ${error.message}`);
      throw error;
    }
  }
}

export default new NotificationService();
