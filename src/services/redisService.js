// src/services/redisService.js
import redisClient from "../config/redis.js";
import logger from "../utils/logger.js";

class RedisService {
  constructor() {
    this.defaultTTL = parseInt(process.env.REDIS_DEFAULT_TTL) || 3600; // 1 hour
    this.cachePrefix = process.env.REDIS_CACHE_PREFIX || "saas_ecommerce:";
  }

  // Get value from cache
  async get(key) {
    try {
      let client;
      try {
        client = await redisClient.getClient();
      } catch (clientError) {
        logger.warn(
          `Redis getClient error for key ${key}, falling back to database:`,
          clientError.message
        );
        return null;
      }

      if (!client) {
        logger.debug(
          `Redis client not available, skipping cache for key: ${key}`
        );
        return null;
      }

      const fullKey = this.cachePrefix + key;
      const value = await client.get(fullKey);

      if (value) {
        logger.debug(`Cache hit for key: ${key}`);
        return JSON.parse(value);
      }

      logger.debug(`Cache miss for key: ${key}`);
      return null;
    } catch (error) {
      logger.warn(
        `Redis get error for key ${key}, falling back to database:`,
        error.message
      );
      return null;
    }
  }

  // Set value in cache with optional TTL
  async set(key, value, ttl = null) {
    try {
      let client;
      try {
        client = await redisClient.getClient();
      } catch (clientError) {
        logger.warn(
          `Redis getClient error for key ${key}, skipping cache set:`,
          clientError.message
        );
        return false;
      }

      if (!client) {
        logger.debug(
          `Redis client not available, skipping cache set for key: ${key}`
        );
        return false;
      }

      const fullKey = this.cachePrefix + key;
      const serializedValue = JSON.stringify(value);
      const expiration = ttl || this.defaultTTL;

      await client.setEx(fullKey, expiration, serializedValue);
      logger.debug(`Cache set for key: ${key} with TTL: ${expiration}s`);
      return true;
    } catch (error) {
      logger.warn(
        `Redis set error for key ${key}, continuing without cache:`,
        error.message
      );
      return false;
    }
  }

  // Delete value from cache
  async del(key) {
    try {
      let client;
      try {
        client = await redisClient.getClient();
      } catch (clientError) {
        logger.warn(
          `Redis getClient error for key ${key}, skipping cache delete:`,
          clientError.message
        );
        return false;
      }

      if (!client) {
        logger.debug(
          `Redis client not available, skipping cache delete for key: ${key}`
        );
        return false;
      }

      const fullKey = this.cachePrefix + key;
      const result = await client.del(fullKey);

      if (result > 0) {
        logger.debug(`Cache deleted for key: ${key}`);
      }

      return result > 0;
    } catch (error) {
      logger.warn(
        `Redis delete error for key ${key}, continuing without cache:`,
        error.message
      );
      return false;
    }
  }

  // Check if key exists
  async exists(key) {
    try {
      const client = await redisClient.getClient();
      const fullKey = this.cachePrefix + key;
      const result = await client.exists(fullKey);
      return result > 0;
    } catch (error) {
      logger.error("Redis exists error:", error);
      return false;
    }
  }

  // Set multiple values
  async mset(keyValuePairs, ttl = null) {
    try {
      const client = await redisClient.getClient();
      const pipeline = client.multi();

      for (const [key, value] of Object.entries(keyValuePairs)) {
        const fullKey = this.cachePrefix + key;
        const serializedValue = JSON.stringify(value);
        const expiration = ttl || this.defaultTTL;

        pipeline.setEx(fullKey, expiration, serializedValue);
      }

      await pipeline.exec();
      logger.debug(`Cache mset for ${Object.keys(keyValuePairs).length} keys`);
      return true;
    } catch (error) {
      logger.error("Redis mset error:", error);
      return false;
    }
  }

  // Get multiple values
  async mget(keys) {
    try {
      const client = await redisClient.getClient();
      const fullKeys = keys.map((key) => this.cachePrefix + key);
      const values = await client.mGet(fullKeys);

      const result = {};
      keys.forEach((key, index) => {
        const value = values[index];
        result[key] = value ? JSON.parse(value) : null;
      });

      return result;
    } catch (error) {
      logger.error("Redis mget error:", error);
      return {};
    }
  }

  // Increment counter
  async incr(key, ttl = null) {
    try {
      const client = await redisClient.getClient();
      const fullKey = this.cachePrefix + key;
      const result = await client.incr(fullKey);

      if (ttl) {
        await client.expire(fullKey, ttl);
      }

      return result;
    } catch (error) {
      logger.error("Redis incr error:", error);
      return null;
    }
  }

  // Set with expiration only if key doesn't exist
  async setnx(key, value, ttl = null) {
    try {
      const client = await redisClient.getClient();
      const fullKey = this.cachePrefix + key;
      const serializedValue = JSON.stringify(value);
      const result = await client.setNx(fullKey, serializedValue);

      if (result && ttl) {
        await client.expire(fullKey, ttl);
      }

      return result;
    } catch (error) {
      logger.error("Redis setnx error:", error);
      return false;
    }
  }

  // Get TTL for key
  async ttl(key) {
    try {
      const client = await redisClient.getClient();
      const fullKey = this.cachePrefix + key;
      return await client.ttl(fullKey);
    } catch (error) {
      logger.error("Redis ttl error:", error);
      return -2; // Error code
    }
  }

  // Extend TTL for key
  async expire(key, ttl) {
    try {
      const client = await redisClient.getClient();
      const fullKey = this.cachePrefix + key;
      return await client.expire(fullKey, ttl);
    } catch (error) {
      logger.error("Redis expire error:", error);
      return false;
    }
  }

  // Get all keys matching pattern
  async keys(pattern = "*") {
    try {
      const client = await redisClient.getClient();
      const fullPattern = this.cachePrefix + pattern;
      const keys = await client.keys(fullPattern);
      return keys.map((key) => key.replace(this.cachePrefix, ""));
    } catch (error) {
      logger.error("Redis keys error:", error);
      return [];
    }
  }

  // Delete all keys matching pattern
  async delPattern(pattern) {
    try {
      const client = await redisClient.getClient();
      const fullPattern = this.cachePrefix + pattern;
      const keys = await client.keys(fullPattern);

      if (keys.length > 0) {
        await client.del(keys);
        logger.debug(
          `Deleted ${keys.length} keys matching pattern: ${pattern}`
        );
      }

      return keys.length;
    } catch (error) {
      logger.error("Redis delPattern error:", error);
      return 0;
    }
  }

  // Clear all cache
  async clearAll() {
    try {
      const client = await redisClient.getClient();
      const pattern = this.cachePrefix + "*";
      const keys = await client.keys(pattern);

      if (keys.length > 0) {
        await client.del(keys);
        logger.info(`Cleared ${keys.length} cache entries`);
      }

      return keys.length;
    } catch (error) {
      logger.error("Redis clearAll error:", error);
      return 0;
    }
  }

  // Get cache statistics
  async getStats() {
    try {
      const client = await redisClient.getClient();
      const pattern = this.cachePrefix + "*";
      const keys = await client.keys(pattern);

      return {
        totalKeys: keys.length,
        prefix: this.cachePrefix,
        connected: redisClient.isConnected,
      };
    } catch (error) {
      logger.error("Redis getStats error:", error);
      return {
        totalKeys: 0,
        prefix: this.cachePrefix,
        connected: false,
        error: error.message,
      };
    }
  }

  // Health check
  async healthCheck() {
    try {
      const isConnected = await redisClient.ping();
      const stats = await this.getStats();

      return {
        status: isConnected ? "healthy" : "unhealthy",
        connected: isConnected,
        ...stats,
      };
    } catch (error) {
      return {
        status: "error",
        connected: false,
        error: error.message,
      };
    }
  }
}

// Create singleton instance
const redisService = new RedisService();

export default redisService;
