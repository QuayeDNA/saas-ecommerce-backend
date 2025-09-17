// src/config/redis.js
import { createClient } from "redis";
import logger from "../utils/logger.js";

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      if (this.client && this.isConnected) {
        return this.client;
      }

      const redisConfig = {
        url: process.env.REDIS_URL || "redis://localhost:6379",
        socket: {
          host: process.env.REDIS_HOST || "localhost",
          port: parseInt(process.env.REDIS_PORT) || 6379,
          tls: process.env.REDIS_TLS === "true",
          connectTimeout:
            parseInt(process.env.REDIS_CONNECTION_TIMEOUT) || 5000,
          commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT) || 3000,
          // Additional options for cloud Redis (Upstash)
          keepAlive: 30000,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error("Redis max reconnection attempts reached");
              return false;
            }
            return Math.min(retries * 1000, 5000);
          },
        },
        database: parseInt(process.env.REDIS_DB) || 0,
      };

      // Add password if provided
      if (process.env.REDIS_PASSWORD) {
        redisConfig.password = process.env.REDIS_PASSWORD;
      }

      this.client = createClient(redisConfig);

      // Event handlers
      this.client.on("error", (err) => {
        logger.error("Redis Client Error:", err);
        this.isConnected = false;
      });

      this.client.on("connect", () => {
        logger.info("Redis client connected");
        this.isConnected = true;
      });

      this.client.on("ready", () => {
        logger.info("Redis client ready");
        this.isConnected = true;
      });

      this.client.on("end", () => {
        logger.info("Redis client disconnected");
        this.isConnected = false;
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      logger.error("Failed to connect to Redis:", error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.client && this.isConnected) {
        await this.client.disconnect();
        this.isConnected = false;
        logger.info("Redis client disconnected successfully");
      }
    } catch (error) {
      logger.error("Error disconnecting from Redis:", error);
    }
  }

  async getClient() {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }
    return this.client;
  }

  // Health check
  async ping() {
    try {
      const client = await this.getClient();
      const result = await client.ping();
      return result === "PONG";
    } catch (error) {
      logger.error("Redis ping failed:", error);
      return false;
    }
  }

  // Get connection status
  getStatus() {
    return {
      connected: this.isConnected,
      client: this.client ? "initialized" : "not initialized",
    };
  }
}

// Create singleton instance
const redisClient = new RedisClient();

export default redisClient;
