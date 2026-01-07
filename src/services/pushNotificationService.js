// src/services/pushNotificationService.js
import webpush from "web-push";
import logger from "../utils/logger.js";
import User from "../models/User.js";

class PushNotificationService {
  constructor() {
    // Set VAPID keys for web push
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        "mailto:" + (process.env.VAPID_EMAIL || "admin@brytelinks.com"),
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      logger.info("Push notification service initialized with VAPID keys");
    } else {
      logger.warn(
        "VAPID keys not configured. Push notifications will not work."
      );
    }
  }

  /**
   * Generate VAPID keys for push notifications
   * @returns {Object} Object containing public and private VAPID keys
   */
  generateVAPIDKeys() {
    return webpush.generateVAPIDKeys();
  }

  /**
   * Send push notification to a specific user
   * @param {string} userId - User ID to send notification to
   * @param {Object} notification - Notification payload
   * @param {string} notification.title - Notification title
   * @param {string} notification.body - Notification body
   * @param {string} [notification.icon] - Notification icon URL
   * @param {string} [notification.url] - URL to open when clicked
   * @param {Object} [notification.data] - Additional data
   * @returns {Promise<boolean>} Success status
   */
  async sendToUser(userId, notification) {
    try {
      const user = await User.findById(userId);

      if (!user) {
        logger.warn(`User not found: ${userId}`);
        return false;
      }

      if (!user.pushSubscription) {
        return false;
      }

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        icon: notification.icon || "/android-chrome-192x192.png",
        badge: "/favicon-32x32.png",
        url: notification.url || "/",
        data: notification.data || {},
        timestamp: Date.now(),
      });

      await webpush.sendNotification(user.pushSubscription, payload);
      logger.info(`Push notification sent to user ${userId}`);
      return true;
    } catch (error) {
      logger.error(
        `Failed to send push notification to user ${userId}:`,
        error
      );

      // If subscription is invalid, remove it
      if (error.statusCode === 410 || error.statusCode === 400) {
        try {
          await User.findByIdAndUpdate(userId, {
            $unset: { pushSubscription: 1 },
          });
          logger.info(`Removed invalid push subscription for user ${userId}`);
        } catch (updateError) {
          logger.error(
            `Failed to remove invalid push subscription for user ${userId}:`,
            updateError
          );
        }
      }

      return false;
    }
  }

  /**
   * Send push notification to multiple users
   * @param {Array<string>} userIds - Array of user IDs
   * @param {Object} notification - Notification payload
   * @returns {Promise<Array<Object>>} Array of results with success/failure status
   */
  async sendToUsers(userIds, notification) {
    const results = [];

    for (const userId of userIds) {
      try {
        const success = await this.sendToUser(userId, notification);
        results.push({ userId, success });
      } catch (error) {
        logger.error(
          `Error sending push notification to user ${userId}:`,
          error
        );
        results.push({ userId, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Send broadcast notification to all users with push subscriptions
   * @param {Object} notification - Notification payload
   * @returns {Promise<Array<Object>>} Array of results
   */
  async broadcast(notification) {
    try {
      const users = await User.find({ pushSubscription: { $exists: true } });
      const userIds = users.map((user) => user._id.toString());

      logger.info(`Broadcasting push notification to ${userIds.length} users`);
      return await this.sendToUsers(userIds, notification);
    } catch (error) {
      logger.error("Failed to broadcast push notification:", error);
      return [{ success: false, error: error.message }];
    }
  }

  /**
   * Register push subscription for a user
   * @param {string} userId - User ID
   * @param {Object} subscription - Push subscription object from browser
   * @returns {Promise<boolean>} Success status
   */
  async registerSubscription(userId, subscription) {
    try {
      await User.findByIdAndUpdate(userId, { pushSubscription: subscription });
      logger.info(`Push subscription registered for user ${userId}`);
      return true;
    } catch (error) {
      logger.error(
        `Failed to register push subscription for user ${userId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Unregister push subscription for a user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async unregisterSubscription(userId) {
    try {
      await User.findByIdAndUpdate(userId, { $unset: { pushSubscription: 1 } });
      logger.info(`Push subscription unregistered for user ${userId}`);
      return true;
    } catch (error) {
      logger.error(
        `Failed to unregister push subscription for user ${userId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Send order status update notification
   * @param {string} userId - User ID
   * @param {Object} order - Order object
   * @param {string} newStatus - New order status
   * @returns {Promise<boolean>} Success status
   */
  async sendOrderStatusUpdate(userId, order, newStatus) {
    const statusMessages = {
      pending: "Your order is being processed",
      processing: "Your order is now being processed",
      success: "Your order has been completed successfully",
      failed: "Your order could not be completed",
      cancelled: "Your order has been cancelled",
    };

    const notification = {
      title: "Order Update",
      body: statusMessages[newStatus] || `Order status changed to ${newStatus}`,
      url: `/orders/${order._id}`,
      data: {
        orderId: order._id,
        status: newStatus,
        amount: order.amount,
        network: order.network,
      },
    };

    return await this.sendToUser(userId, notification);
  }

  /**
   * Send wallet balance update notification
   * @param {string} userId - User ID
   * @param {number} amount - Amount added/deducted
   * @param {string} type - Transaction type (credit/debit)
   * @param {string} description - Transaction description
   * @returns {Promise<boolean>} Success status
   */
  async sendWalletUpdate(userId, amount, type, description) {
    const notification = {
      title: "Wallet Update",
      body: `${type === "credit" ? "+" : "-"}${Math.abs(
        amount
      )} GHS: ${description}`,
      url: "/wallet",
      data: {
        amount,
        type,
        description,
        timestamp: Date.now(),
      },
    };

    return await this.sendToUser(userId, notification);
  }

  /**
   * Send commission notification
   * @param {string} userId - User ID
   * @param {number} amount - Commission amount
   * @param {string} status - Commission status
   * @returns {Promise<boolean>} Success status
   */
  async sendCommissionUpdate(userId, amount, status) {
    const notification = {
      title: "Commission Update",
      body: `Commission of ${amount} GHS ${status}`,
      url: "/commissions",
      data: {
        amount,
        status,
        timestamp: Date.now(),
      },
    };

    return await this.sendToUser(userId, notification);
  }
}

const pushNotificationService = new PushNotificationService();
export default pushNotificationService;
