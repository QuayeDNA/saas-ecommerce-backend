// src/services/pushNotificationService.js
import webpush from "web-push";
import logger from "../utils/logger.js";
import PushSubscription from "../models/PushSubscription.js";

class PushNotificationService {
  constructor() {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        "mailto:" + (process.env.VAPID_EMAIL || "admin@brytelinks.com"),
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
      logger.info("Push notification service initialized with VAPID keys");
    } else {
      logger.warn(
        "VAPID keys not configured. Push notifications will not work.",
      );
    }
  }

  generateVAPIDKeys() {
    return webpush.generateVAPIDKeys();
  }

  buildPayload(notification) {
    return JSON.stringify({
      title: notification.title,
      body: notification.body,
      icon: notification.icon || "/android-chrome-192x192.png",
      badge: "/favicon-32x32.png",
      url: notification.url || "/",
      data: notification.data || {},
      timestamp: Date.now(),
    });
  }

  async sendToUser(userId, notification) {
    try {
      const subs = await PushSubscription.find({ user: userId, enabled: true });
      if (!subs.length) {
        logger.info(`No push subscriptions for user ${userId}`);
        return false;
      }

      const payload = this.buildPayload(notification);
      const results = await Promise.allSettled(
        subs.map((sub) => this._sendToEndpoint(sub, payload)),
      );

      const anySuccess = results.some((r) => r.status === "fulfilled");
      return anySuccess;
    } catch (error) {
      logger.error(
        `Failed to send push notification to user ${userId}:`,
        error,
      );
      return false;
    }
  }

  async _sendToEndpoint(subscription, payload) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        payload,
      );
      await PushSubscription.findByIdAndUpdate(subscription._id, {
        lastSeenAt: new Date(),
      });
    } catch (error) {
      const statusCode = error?.statusCode;
      if (statusCode === 410 || statusCode === 404 || statusCode === 400) {
        logger.warn(
          `Invalid/expired push subscription (endpoint ${subscription.endpoint.substring(0, 40)}...) status ${statusCode}. Removing.`,
        );
        await PushSubscription.findByIdAndDelete(subscription._id).catch(() =>
          {},
        );
        throw error;
      }
      throw error;
    }
  }

  async sendToUsers(userIds, notification) {
    const results = [];
    await Promise.allSettled(
      userIds.map(async (userId) => {
        try {
          const success = await this.sendToUser(userId, notification);
          results.push({ userId, success });
        } catch (error) {
          logger.error(
            `Error sending push notification to user ${userId}:`,
            error,
          );
          results.push({ userId, success: false, error: error.message });
        }
      }),
    );
    return results;
  }

  async broadcast(notification) {
    try {
      const subs = await PushSubscription.find({ enabled: true }).distinct(
        "user",
      );
      logger.info(
        `Broadcasting push notification to ${subs.length} unique users`,
      );
      return await this.sendToUsers(subs.map(String), notification);
    } catch (error) {
      logger.error("Failed to broadcast push notification:", error);
      return [{ success: false, error: error.message }];
    }
  }

  async registerSubscription(userId, subscription, meta = {}) {
    try {
      const { endpoint, keys } = subscription;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        logger.warn(`Invalid subscription data for user ${userId}`);
        return false;
      }

      await PushSubscription.findOneAndUpdate(
        { endpoint },
        {
          user: userId,
          endpoint,
          keys,
          userAgent: meta.userAgent || "",
          platform: meta.platform || "unknown",
          enabled: true,
          lastSeenAt: new Date(),
        },
        { upsert: true, new: true },
      );

      logger.info(
        `Push subscription registered for user ${userId} (endpoint ${endpoint.substring(0, 40)}...)`,
      );
      return true;
    } catch (error) {
      logger.error(
        `Failed to register push subscription for user ${userId}:`,
        error,
      );
      return false;
    }
  }

  async unregisterSubscription(userId, endpoint) {
    try {
      if (endpoint) {
        await PushSubscription.findOneAndDelete({ endpoint, user: userId });
      } else {
        await PushSubscription.deleteMany({ user: userId });
      }
      logger.info(`Push subscription(s) unregistered for user ${userId}`);
      return true;
    } catch (error) {
      logger.error(
        `Failed to unregister push subscription for user ${userId}:`,
        error,
      );
      return false;
    }
  }

  async getDevices(userId) {
    try {
      return await PushSubscription.find({ user: userId }).sort({
        lastSeenAt: -1,
      });
    } catch (error) {
      logger.error(`Failed to get devices for user ${userId}:`, error);
      return [];
    }
  }

  async removeDevice(userId, deviceId) {
    try {
      const deleted = await PushSubscription.findOneAndDelete({
        _id: deviceId,
        user: userId,
      });
      if (deleted) {
        logger.info(`Device ${deviceId} removed for user ${userId}`);
        return true;
      }
      logger.warn(
        `Device ${deviceId} not found for user ${userId}`,
      );
      return false;
    } catch (error) {
      logger.error(`Failed to remove device ${deviceId} for user ${userId}:`, error);
      return false;
    }
  }

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

  async sendWalletUpdate(userId, amount, type, description) {
    const notification = {
      title: "Wallet Update",
      body: `${type === "credit" ? "+" : "-"}${Math.abs(
        amount,
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
}

const pushNotificationService = new PushNotificationService();
export default pushNotificationService;
