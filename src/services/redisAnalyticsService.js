import redisService from "./redisService.js";
import logger from "../utils/logger.js";

/**
 * Redis Analytics Aggregation Service
 * Uses Redis data structures for efficient analytics data storage and retrieval
 */
class RedisAnalyticsService {
  constructor() {
    this.prefix = "analytics";
  }

  /**
   * Record user activity for real-time analytics
   * @param {string} userId - User ID
   * @param {string} action - Action performed
   * @param {Object} metadata - Additional metadata
   */
  async recordUserActivity(userId, action, metadata = {}) {
    try {
      const timestamp = Date.now();
      const dateKey = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

      // Store activity in sorted set with timestamp as score
      const activityKey = `${this.prefix}:user:${userId}:activity`;
      await redisService.zadd(
        activityKey,
        timestamp,
        JSON.stringify({
          action,
          timestamp,
          metadata,
        })
      );

      // Keep only last 1000 activities per user
      await redisService.zremrangebyrank(activityKey, 0, -1001);

      // Set expiration (30 days)
      await redisService.expire(activityKey, 30 * 24 * 60 * 60);

      // Update daily activity count
      const dailyKey = `${this.prefix}:daily:${dateKey}:user_activity`;
      await redisService.hincrby(dailyKey, action, 1);
      await redisService.expire(dailyKey, 90 * 24 * 60 * 60); // 90 days

      // Update user type activity if available
      if (metadata.userType) {
        const userTypeKey = `${this.prefix}:usertype:${metadata.userType}:activity`;
        await redisService.hincrby(userTypeKey, action, 1);
        await redisService.expire(userTypeKey, 30 * 24 * 60 * 60);
      }

      logger.debug(`Recorded user activity: ${userId} - ${action}`);
    } catch (error) {
      logger.error(`Failed to record user activity: ${error.message}`);
    }
  }

  /**
   * Record order metrics for real-time analytics
   * @param {Object} orderData - Order data
   */
  async recordOrderMetrics(orderData) {
    try {
      const timestamp = Date.now();
      const dateKey = new Date().toISOString().split("T")[0];

      // Store order in sorted set
      const ordersKey = `${this.prefix}:orders:daily:${dateKey}`;
      await redisService.zadd(ordersKey, timestamp, JSON.stringify(orderData));
      await redisService.expire(ordersKey, 90 * 24 * 60 * 60);

      // Update order statistics
      const statsKey = `${this.prefix}:stats:orders:${dateKey}`;
      await redisService.hincrby(statsKey, "total_orders", 1);
      await redisService.hincrbyfloat(
        statsKey,
        "total_amount",
        orderData.amount || 0
      );
      await redisService.expire(statsKey, 90 * 24 * 60 * 60);

      // Update provider statistics
      if (orderData.provider) {
        const providerKey = `${this.prefix}:provider:${orderData.provider}:orders`;
        await redisService.hincrby(providerKey, dateKey, 1);
        await redisService.expire(providerKey, 90 * 24 * 60 * 60);
      }

      // Update user order count
      if (orderData.userId) {
        const userOrdersKey = `${this.prefix}:user:${orderData.userId}:orders`;
        await redisService.incr(userOrdersKey);
        await redisService.expire(userOrdersKey, 90 * 24 * 60 * 60);
      }

      logger.debug(`Recorded order metrics for order ${orderData.id}`);
    } catch (error) {
      logger.error(`Failed to record order metrics: ${error.message}`);
    }
  }

  /**
   * Record wallet transaction for real-time analytics
   * @param {Object} transactionData - Transaction data
   */
  async recordWalletTransaction(transactionData) {
    try {
      const timestamp = Date.now();
      const dateKey = new Date().toISOString().split("T")[0];

      // Store transaction in sorted set
      const transactionsKey = `${this.prefix}:wallet:transactions:${dateKey}`;
      await redisService.zadd(
        transactionsKey,
        timestamp,
        JSON.stringify(transactionData)
      );
      await redisService.expire(transactionsKey, 90 * 24 * 60 * 60);

      // Update wallet statistics
      const statsKey = `${this.prefix}:stats:wallet:${dateKey}`;
      await redisService.hincrbyfloat(
        statsKey,
        "total_amount",
        transactionData.amount || 0
      );

      if (transactionData.type === "credit") {
        await redisService.hincrby(statsKey, "credit_transactions", 1);
      } else if (transactionData.type === "debit") {
        await redisService.hincrby(statsKey, "debit_transactions", 1);
      }

      await redisService.expire(statsKey, 90 * 24 * 60 * 60);

      // Update user wallet balance tracking
      if (transactionData.userId) {
        const balanceKey = `${this.prefix}:user:${transactionData.userId}:wallet_balance`;
        await redisService.set(balanceKey, transactionData.newBalance || 0);
        await redisService.expire(balanceKey, 30 * 24 * 60 * 60);
      }

      logger.debug(
        `Recorded wallet transaction for user ${transactionData.userId}`
      );
    } catch (error) {
      logger.error(`Failed to record wallet transaction: ${error.message}`);
    }
  }

  /**
   * Get real-time user activity metrics
   * @param {string} userId - User ID
   * @param {number} limit - Number of activities to retrieve
   * @returns {Promise<Array>} User activities
   */
  async getUserActivity(userId, limit = 50) {
    try {
      const activityKey = `${this.prefix}:user:${userId}:activity`;
      const activities = await redisService.zrange(activityKey, -limit, -1);

      return activities.map((activity) => {
        try {
          return JSON.parse(activity);
        } catch (parseError) {
          logger.warn(`Failed to parse activity data: ${parseError.message}`);
          return { error: "Invalid activity data" };
        }
      });
    } catch (error) {
      logger.error(`Failed to get user activity: ${error.message}`);
      return [];
    }
  }

  /**
   * Get daily statistics
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<Object>} Daily statistics
   */
  async getDailyStats(date = null) {
    try {
      const dateKey = date || new Date().toISOString().split("T")[0];

      const [orderStats, walletStats, userActivity] = await Promise.all([
        redisService.hgetall(`${this.prefix}:stats:orders:${dateKey}`),
        redisService.hgetall(`${this.prefix}:stats:wallet:${dateKey}`),
        redisService.hgetall(`${this.prefix}:daily:${dateKey}:user_activity`),
      ]);

      return {
        date: dateKey,
        orders: {
          total: parseInt(orderStats?.total_orders || 0),
          amount: parseFloat(orderStats?.total_amount || 0),
        },
        wallet: {
          totalAmount: parseFloat(walletStats?.total_amount || 0),
          creditTransactions: parseInt(walletStats?.credit_transactions || 0),
          debitTransactions: parseInt(walletStats?.debit_transactions || 0),
        },
        userActivity: userActivity || {},
      };
    } catch (error) {
      logger.error(`Failed to get daily stats: ${error.message}`);
      return null;
    }
  }

  /**
   * Get user wallet balance from cache
   * @param {string} userId - User ID
   * @returns {Promise<number>} Wallet balance
   */
  async getUserWalletBalance(userId) {
    try {
      const balanceKey = `${this.prefix}:user:${userId}:wallet_balance`;
      const balance = await redisService.get(balanceKey);
      return balance ? parseFloat(balance) : null;
    } catch (error) {
      logger.error(`Failed to get user wallet balance: ${error.message}`);
      return null;
    }
  }

  /**
   * Get provider performance metrics
   * @param {string} provider - Provider name
   * @param {number} days - Number of days to look back
   * @returns {Promise<Object>} Provider metrics
   */
  async getProviderMetrics(provider, days = 30) {
    try {
      const providerKey = `${this.prefix}:provider:${provider}:orders`;
      const metrics = await redisService.hgetall(providerKey);

      let totalOrders = 0;
      const dailyBreakdown = [];

      // Calculate date range
      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split("T")[0];

        const orders = parseInt(metrics?.[dateKey] || 0);
        totalOrders += orders;

        dailyBreakdown.push({
          date: dateKey,
          orders,
        });
      }

      return {
        provider,
        totalOrders,
        averageDaily: Math.round(totalOrders / days),
        dailyBreakdown,
      };
    } catch (error) {
      logger.error(`Failed to get provider metrics: ${error.message}`);
      return null;
    }
  }

  /**
   * Get top active users by activity count
   * @param {number} limit - Number of users to return
   * @returns {Promise<Array>} Top active users
   */
  async getTopActiveUsers(limit = 10) {
    // This would require maintaining a separate sorted set for user activity counts
    // For now, return empty array as this would need additional implementation
    return [];
  }

  /**
   * Clean up old analytics data
   * @param {number} daysOld - Remove data older than this many days
   */
  async cleanupOldData(daysOld = 90) {
    try {
      const cutoffTimestamp = Date.now() - daysOld * 24 * 60 * 60 * 1000;

      // Get all analytics keys
      const keys = await redisService.keys(`${this.prefix}:*`);

      let deletedCount = 0;
      for (const key of keys) {
        // Check if key contains date-based data that should be cleaned up
        if (key.includes(":daily:") || key.includes(":stats:")) {
          // For sorted sets, remove old entries
          if (
            key.includes(":activity") ||
            key.includes(":orders:") ||
            key.includes(":transactions:")
          ) {
            const removed = await redisService.zremrangebyscore(
              key,
              0,
              cutoffTimestamp
            );
            deletedCount += removed;

            // If sorted set is empty, delete the key
            const count = await redisService.zcard(key);
            if (count === 0) {
              await redisService.del([key]);
            }
          }
        }
      }

      logger.info(`Cleaned up ${deletedCount} old analytics entries`);
      return deletedCount;
    } catch (error) {
      logger.error(`Failed to cleanup old analytics data: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get analytics summary for dashboard
   * @returns {Promise<Object>} Analytics summary
   */
  async getAnalyticsSummary() {
    try {
      const today = new Date().toISOString().split("T")[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      const [todayStats, yesterdayStats] = await Promise.all([
        this.getDailyStats(today),
        this.getDailyStats(yesterday),
      ]);

      // Calculate growth rates
      const orderGrowth =
        yesterdayStats?.orders?.total > 0
          ? ((todayStats?.orders?.total - yesterdayStats.orders.total) /
              yesterdayStats.orders.total) *
            100
          : 0;

      const amountGrowth =
        yesterdayStats?.orders?.amount > 0
          ? ((todayStats?.orders?.amount - yesterdayStats.orders.amount) /
              yesterdayStats.orders.amount) *
            100
          : 0;

      return {
        today: todayStats,
        yesterday: yesterdayStats,
        growth: {
          orders: Math.round(orderGrowth * 100) / 100,
          amount: Math.round(amountGrowth * 100) / 100,
        },
      };
    } catch (error) {
      logger.error(`Failed to get analytics summary: ${error.message}`);
      return null;
    }
  }
}

export default new RedisAnalyticsService();
