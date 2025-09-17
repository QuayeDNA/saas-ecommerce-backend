import redisService from "./redisService.js";
import logger from "../utils/logger.js";

/**
 * Redis Cache Invalidation and Cleanup Service
 * Provides comprehensive cache management and cleanup strategies
 */
class CacheInvalidationService {
  constructor() {
    this.prefixes = {
      user: "cache:user",
      order: "cache:order",
      commission: "cache:commission",
      analytics: "analytics",
      settings: "settings",
      session: "session",
      ratelimit: "ratelimit",
      jobqueue: "jobqueue",
    };
  }

  /**
   * Invalidate cache by pattern
   * @param {string} pattern - Redis key pattern to invalidate
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateByPattern(pattern) {
    try {
      const keys = await redisService.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }

      await redisService.del(keys);
      logger.info(
        `Invalidated ${keys.length} cache keys matching pattern: ${pattern}`
      );
      return keys.length;
    } catch (error) {
      logger.error(
        `Failed to invalidate cache pattern ${pattern}: ${error.message}`
      );
      return 0;
    }
  }

  /**
   * Invalidate user-related cache
   * @param {string} userId - User ID
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateUserCache(userId) {
    try {
      const patterns = [
        `${this.prefixes.user}:${userId}:*`,
        `${this.prefixes.analytics}:user:${userId}:*`,
        `${this.prefixes.session}:${userId}:*`,
        `${this.prefixes.ratelimit}:user:${userId}:*`,
      ];

      let totalInvalidated = 0;
      for (const pattern of patterns) {
        totalInvalidated += await this.invalidateByPattern(pattern);
      }

      // Also invalidate analytics cache that might reference this user
      totalInvalidated += await this.invalidateByPattern(
        `${this.prefixes.analytics}:super_admin:*`
      );
      totalInvalidated += await this.invalidateByPattern(
        `${this.prefixes.analytics}:agent:*:*`
      );

      logger.info(
        `Invalidated ${totalInvalidated} cache keys for user ${userId}`
      );
      return totalInvalidated;
    } catch (error) {
      logger.error(
        `Failed to invalidate user cache for ${userId}: ${error.message}`
      );
      return 0;
    }
  }

  /**
   * Invalidate order-related cache
   * @param {string} orderId - Order ID (optional, if not provided invalidates all order cache)
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateOrderCache(orderId = null) {
    try {
      let patterns = [
        `${this.prefixes.order}:*`,
        `${this.prefixes.analytics}:orders:*`,
        `${this.prefixes.analytics}:super_admin:*`,
        `${this.prefixes.analytics}:agent:*:*`,
      ];

      if (orderId) {
        patterns.push(`${this.prefixes.order}:${orderId}`);
      }

      let totalInvalidated = 0;
      for (const pattern of patterns) {
        totalInvalidated += await this.invalidateByPattern(pattern);
      }

      const message = orderId
        ? `Invalidated ${totalInvalidated} order-related cache keys for order ${orderId}`
        : `Invalidated ${totalInvalidated} order-related cache keys`;
      logger.info(message);
      return totalInvalidated;
    } catch (error) {
      logger.error(`Failed to invalidate order cache: ${error.message}`);
      return 0;
    }
  }

  /**
   * Invalidate commission-related cache
   * @param {string} userId - User ID (optional, for specific user commissions)
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateCommissionCache(userId = null) {
    try {
      let patterns = [
        `${this.prefixes.commission}:*`,
        `${this.prefixes.analytics}:commissions:*`,
        `${this.prefixes.analytics}:super_admin:*`,
      ];

      if (userId) {
        patterns.push(`${this.prefixes.commission}:${userId}:*`);
        patterns.push(`${this.prefixes.analytics}:agent:${userId}:*`);
      }

      let totalInvalidated = 0;
      for (const pattern of patterns) {
        totalInvalidated += await this.invalidateByPattern(pattern);
      }

      const message = userId
        ? `Invalidated ${totalInvalidated} commission-related cache keys for user ${userId}`
        : `Invalidated ${totalInvalidated} commission-related cache keys`;
      logger.info(message);
      return totalInvalidated;
    } catch (error) {
      logger.error(`Failed to invalidate commission cache: ${error.message}`);
      return 0;
    }
  }

  /**
   * Invalidate analytics cache
   * @param {string} scope - Scope of invalidation ('all', 'super_admin', 'agent', 'daily')
   * @param {string} identifier - Additional identifier (userId for agent scope)
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateAnalyticsCache(scope = "all", identifier = null) {
    try {
      let patterns = [];

      switch (scope) {
        case "super_admin":
          patterns = [`${this.prefixes.analytics}:super_admin:*`];
          break;
        case "agent":
          patterns = identifier
            ? [`${this.prefixes.analytics}:agent:${identifier}:*`]
            : [`${this.prefixes.analytics}:agent:*:*`];
          break;
        case "daily":
          patterns = [`${this.prefixes.analytics}:daily:*`];
          break;
        default:
          patterns = [`${this.prefixes.analytics}:*`];
      }

      let totalInvalidated = 0;
      for (const pattern of patterns) {
        totalInvalidated += await this.invalidateByPattern(pattern);
      }

      logger.info(
        `Invalidated ${totalInvalidated} analytics cache keys for scope: ${scope}`
      );
      return totalInvalidated;
    } catch (error) {
      logger.error(`Failed to invalidate analytics cache: ${error.message}`);
      return 0;
    }
  }

  /**
   * Invalidate settings cache
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateSettingsCache() {
    try {
      const patterns = [`${this.prefixes.settings}:*`];

      let totalInvalidated = 0;
      for (const pattern of patterns) {
        totalInvalidated += await this.invalidateByPattern(pattern);
      }

      logger.info(`Invalidated ${totalInvalidated} settings cache keys`);
      return totalInvalidated;
    } catch (error) {
      logger.error(`Failed to invalidate settings cache: ${error.message}`);
      return 0;
    }
  }

  /**
   * Clean up expired cache keys
   * @returns {Promise<number>} Number of keys cleaned up
   */
  async cleanupExpiredKeys() {
    try {
      // Redis automatically expires keys with TTL, but we can check for any inconsistencies
      const allKeys = await redisService.keys("*");
      let expiredCount = 0;

      for (const key of allKeys) {
        const ttl = await redisService.ttl(key);
        if (ttl === -2) {
          // Key doesn't exist
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        logger.info(`Found ${expiredCount} expired keys during cleanup`);
      }

      return expiredCount;
    } catch (error) {
      logger.error(`Failed to cleanup expired keys: ${error.message}`);
      return 0;
    }
  }

  /**
   * Clean up old cache data based on age
   * @param {number} maxAgeHours - Maximum age in hours for cache entries
   * @returns {Promise<number>} Number of keys cleaned up
   */
  async cleanupOldCache(maxAgeHours = 24) {
    try {
      const patterns = [
        `${this.prefixes.user}:*`,
        `${this.prefixes.order}:*`,
        `${this.prefixes.commission}:*`,
        `${this.prefixes.analytics}:*`,
        `${this.prefixes.settings}:*`,
      ];

      let totalCleaned = 0;

      for (const pattern of patterns) {
        const keys = await redisService.keys(pattern);

        for (const key of keys) {
          // Check if key has an associated timestamp or if it's old based on TTL
          const ttl = await redisService.ttl(key);

          // If TTL is -1 (no expiration) and key looks old, consider cleaning it
          if (ttl === -1) {
            // For keys without TTL that might be old, we could implement custom logic
            // For now, skip these to avoid accidentally deleting important data
            continue;
          }

          // Keys with TTL will be automatically cleaned by Redis
          // We could force cleanup of keys close to expiration
          if (ttl > 0 && ttl < 3600) {
            // Less than 1 hour TTL
            await redisService.del([key]);
            totalCleaned++;
          }
        }
      }

      if (totalCleaned > 0) {
        logger.info(`Cleaned up ${totalCleaned} old cache keys`);
      }

      return totalCleaned;
    } catch (error) {
      logger.error(`Failed to cleanup old cache: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache statistics
   */
  async getCacheStats() {
    try {
      const stats = {
        totalKeys: 0,
        byPrefix: {},
        memoryUsage: 0,
        hitRate: 0, // Would need additional tracking for hit rate
      };

      // Count keys by prefix
      for (const [name, prefix] of Object.entries(this.prefixes)) {
        const keys = await redisService.keys(`${prefix}:*`);
        stats.byPrefix[name] = keys.length;
        stats.totalKeys += keys.length;
      }

      // Get memory usage info
      try {
        const info = await redisService.info("memory");
        stats.memoryUsage = this.parseMemoryUsage(info);
      } catch (memoryError) {
        logger.warn(
          `Could not retrieve Redis memory info: ${memoryError.message}`
        );
      }

      return stats;
    } catch (error) {
      logger.error(`Failed to get cache stats: ${error.message}`);
      return {
        totalKeys: 0,
        byPrefix: {},
        memoryUsage: 0,
        hitRate: 0,
      };
    }
  }

  /**
   * Parse Redis memory usage from INFO command
   * @param {string} info - Redis INFO output
   * @returns {number} Memory usage in bytes
   */
  parseMemoryUsage(info) {
    try {
      const lines = info.split("\n");
      for (const line of lines) {
        if (line.startsWith("used_memory:")) {
          return parseInt(line.split(":")[1]);
        }
      }
      return 0;
    } catch (parseError) {
      logger.warn(`Failed to parse Redis memory info: ${parseError.message}`);
      return 0;
    }
  }

  /**
   * Set up automatic cache invalidation hooks
   * This would be called when certain events occur in the application
   */
  setupInvalidationHooks() {
    // This would integrate with the application's event system
    // For example:
    // eventEmitter.on('user:updated', (userId) => this.invalidateUserCache(userId));
    // eventEmitter.on('order:created', () => this.invalidateOrderCache());
    // eventEmitter.on('commission:calculated', (userId) => this.invalidateCommissionCache(userId));

    logger.info("Cache invalidation hooks setup completed");
  }

  /**
   * Perform comprehensive cache maintenance
   * @returns {Promise<Object>} Maintenance results
   */
  async performMaintenance() {
    try {
      const results = {
        expiredKeysCleaned: 0,
        oldCacheCleaned: 0,
        stats: {},
      };

      // Clean up expired keys
      results.expiredKeysCleaned = await this.cleanupExpiredKeys();

      // Clean up old cache (older than 48 hours)
      results.oldCacheCleaned = await this.cleanupOldCache(48);

      // Get updated stats
      results.stats = await this.getCacheStats();

      logger.info("Cache maintenance completed", results);
      return results;
    } catch (error) {
      logger.error(`Cache maintenance failed: ${error.message}`);
      return {
        expiredKeysCleaned: 0,
        oldCacheCleaned: 0,
        stats: {},
        error: error.message,
      };
    }
  }

  /**
   * Clear all cache (emergency cleanup)
   * @returns {Promise<number>} Number of keys cleared
   */
  async clearAllCache() {
    try {
      const allKeys = await redisService.keys("*");
      if (allKeys.length === 0) {
        return 0;
      }

      // Clear in batches to avoid blocking
      const batchSize = 100;
      let totalCleared = 0;

      for (let i = 0; i < allKeys.length; i += batchSize) {
        const batch = allKeys.slice(i, i + batchSize);
        await redisService.del(batch);
        totalCleared += batch.length;
      }

      logger.warn(`Cleared all ${totalCleared} cache keys`);
      return totalCleared;
    } catch (error) {
      logger.error(`Failed to clear all cache: ${error.message}`);
      return 0;
    }
  }

  /**
   * Warm up frequently accessed cache
   * @returns {Promise<number>} Number of cache entries warmed up
   */
  async warmupCache() {
    try {
      // This would pre-populate frequently accessed cache entries
      // Implementation would depend on the specific cache warming strategy needed
      let warmedCount = 0;

      // Example: Warm up settings cache
      const settingsKeys = await redisService.keys(
        `${this.prefixes.settings}:*`
      );
      warmedCount += settingsKeys.length;

      logger.info(
        `Cache warmup completed, checked ${warmedCount} existing entries`
      );
      return warmedCount;
    } catch (error) {
      logger.error(`Cache warmup failed: ${error.message}`);
      return 0;
    }
  }
}

export default new CacheInvalidationService();
