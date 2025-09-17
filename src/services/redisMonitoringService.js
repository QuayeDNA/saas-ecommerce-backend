import redisService from "./redisService.js";
import logger from "../utils/logger.js";

/**
 * Redis Monitoring and Health Check Service
 * Provides comprehensive monitoring and health checks for Redis infrastructure
 */
class RedisMonitoringService {
  constructor() {
    this.healthCheckInterval = null;
    this.metrics = {
      connections: 0,
      operations: 0,
      errors: 0,
      latency: 0,
      memoryUsage: 0,
      hitRate: 0,
      uptime: 0,
    };

    this.alerts = {
      highLatency: false,
      highMemoryUsage: false,
      connectionIssues: false,
      highErrorRate: false,
    };

    this.thresholds = {
      maxLatency: 100, // ms
      maxMemoryUsage: 0.8, // 80% of max memory
      maxErrorRate: 0.05, // 5% error rate
      healthCheckInterval: 30000, // 30 seconds
    };
  }

  /**
   * Start monitoring Redis health
   */
  startMonitoring() {
    if (this.healthCheckInterval) {
      logger.warn("Redis monitoring is already running");
      return;
    }

    logger.info("Starting Redis monitoring service");
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.thresholds.healthCheckInterval);

    // Perform initial health check
    this.performHealthCheck();
  }

  /**
   * Stop monitoring Redis health
   */
  stopMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info("Stopped Redis monitoring service");
    }
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    try {
      const startTime = Date.now();

      // Basic connectivity check
      const isConnected = await this.checkConnectivity();
      const latency = Date.now() - startTime;

      if (!isConnected) {
        this.handleConnectionIssue();
        return;
      }

      // Get Redis info
      const info = await this.getRedisInfo();

      // Update metrics
      this.updateMetrics(info, latency);

      // Check thresholds and alert if necessary
      this.checkThresholds();

      // Log health status
      this.logHealthStatus();
    } catch (error) {
      logger.error(`Health check failed: ${error.message}`);
      this.metrics.errors++;
      this.handleConnectionIssue();
    }
  }

  /**
   * Check Redis connectivity
   * @returns {Promise<boolean>} Connection status
   */
  async checkConnectivity() {
    try {
      await redisService.ping();
      return true;
    } catch (error) {
      logger.error(`Redis connectivity check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get Redis server information
   * @returns {Promise<Object>} Redis info
   */
  async getRedisInfo() {
    try {
      const info = await redisService.info();
      return this.parseRedisInfo(info);
    } catch (error) {
      logger.error(`Failed to get Redis info: ${error.message}`);
      return {};
    }
  }

  /**
   * Parse Redis INFO command output
   * @param {string} info - Raw Redis info
   * @returns {Object} Parsed info
   */
  parseRedisInfo(info) {
    const parsed = {};
    try {
      const lines = info.split("\n");
      for (const line of lines) {
        if (line.includes(":")) {
          const [key, value] = line.split(":");
          parsed[key] = value;
        }
      }
    } catch (error) {
      logger.error(`Failed to parse Redis info: ${error.message}`);
    }
    return parsed;
  }

  /**
   * Update monitoring metrics
   * @param {Object} info - Redis info
   * @param {number} latency - Response latency
   */
  updateMetrics(info, latency) {
    this.metrics.latency = latency;
    this.metrics.memoryUsage = parseInt(info.used_memory || 0);
    this.metrics.uptime = parseInt(info.uptime_in_seconds || 0);
    this.metrics.connections = parseInt(info.connected_clients || 0);

    // Calculate hit rate if available
    if (info.keyspace_hits && info.keyspace_misses) {
      const hits = parseInt(info.keyspace_hits);
      const misses = parseInt(info.keyspace_misses);
      this.metrics.hitRate = hits / (hits + misses);
    }
  }

  /**
   * Check if metrics exceed thresholds
   */
  checkThresholds() {
    this.checkLatencyThreshold();
    this.checkMemoryThreshold();
    this.checkErrorRateThreshold();
  }

  /**
   * Check latency threshold
   */
  checkLatencyThreshold() {
    if (this.metrics.latency > this.thresholds.maxLatency) {
      if (!this.alerts.highLatency) {
        this.alerts.highLatency = true;
        logger.warn(`High Redis latency detected: ${this.metrics.latency}ms`);
        this.sendAlert(
          "high_latency",
          `Redis latency is ${this.metrics.latency}ms`
        );
      }
    } else {
      this.alerts.highLatency = false;
    }
  }

  /**
   * Check memory usage threshold
   */
  checkMemoryThreshold() {
    const maxMemory = parseInt(process.env.REDIS_MAX_MEMORY || "0");
    if (maxMemory > 0) {
      const memoryUsageRatio = this.metrics.memoryUsage / maxMemory;
      if (memoryUsageRatio > this.thresholds.maxMemoryUsage) {
        if (!this.alerts.highMemoryUsage) {
          this.alerts.highMemoryUsage = true;
          logger.warn(
            `High Redis memory usage: ${(memoryUsageRatio * 100).toFixed(1)}%`
          );
          this.sendAlert(
            "high_memory",
            `Redis memory usage is ${(memoryUsageRatio * 100).toFixed(1)}%`
          );
        }
      } else {
        this.alerts.highMemoryUsage = false;
      }
    }
  }

  /**
   * Check error rate threshold
   */
  checkErrorRateThreshold() {
    const totalOperations = this.metrics.operations + this.metrics.errors;
    if (totalOperations > 100) {
      // Only check after sufficient operations
      const errorRate = this.metrics.errors / totalOperations;
      if (errorRate > this.thresholds.maxErrorRate) {
        if (!this.alerts.highErrorRate) {
          this.alerts.highErrorRate = true;
          logger.warn(
            `High Redis error rate: ${(errorRate * 100).toFixed(1)}%`
          );
          this.sendAlert(
            "high_error_rate",
            `Redis error rate is ${(errorRate * 100).toFixed(1)}%`
          );
        }
      } else {
        this.alerts.highErrorRate = false;
      }
    }
  }

  /**
   * Handle connection issues
   */
  handleConnectionIssue() {
    if (!this.alerts.connectionIssues) {
      this.alerts.connectionIssues = true;
      logger.error("Redis connection issue detected");
      this.sendAlert(
        "connection_issue",
        "Redis connection is down or unresponsive"
      );
    }
  }

  /**
   * Send alert notification
   * @param {string} type - Alert type
   * @param {string} message - Alert message
   */
  sendAlert(type, message) {
    // In a real implementation, this would send notifications via email, Slack, etc.
    logger.error(`REDIS ALERT [${type.toUpperCase()}]: ${message}`);

    // Could integrate with notification service
    // await notificationService.sendAlert('redis', type, message);
  }

  /**
   * Log current health status
   */
  logHealthStatus() {
    const status = this.getHealthStatus();
    logger.info(
      `Redis Health: ${status.overall} | Latency: ${
        this.metrics.latency
      }ms | Memory: ${this.formatBytes(
        this.metrics.memoryUsage
      )} | Connections: ${this.metrics.connections}`
    );
  }

  /**
   * Get comprehensive health status
   * @returns {Object} Health status
   */
  getHealthStatus() {
    const issues = [];

    if (this.alerts.highLatency) issues.push("high_latency");
    if (this.alerts.highMemoryUsage) issues.push("high_memory");
    if (this.alerts.connectionIssues) issues.push("connection_issue");
    if (this.alerts.highErrorRate) issues.push("high_error_rate");

    const overall = issues.length === 0 ? "healthy" : "unhealthy";

    return {
      overall,
      issues,
      metrics: { ...this.metrics },
      alerts: { ...this.alerts },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get detailed Redis statistics
   * @returns {Promise<Object>} Detailed statistics
   */
  async getDetailedStats() {
    try {
      const info = await redisService.info();
      const parsed = this.parseRedisInfo(info);

      // Get additional stats
      const dbSize = await redisService.dbsize();
      const keyPatterns = await this.getKeyPatternStats();

      return {
        server: {
          version: parsed.redis_version,
          mode: parsed.redis_mode,
          uptime: parseInt(parsed.uptime_in_seconds || 0),
          connected_clients: parseInt(parsed.connected_clients || 0),
        },
        memory: {
          used: parseInt(parsed.used_memory || 0),
          peak: parseInt(parsed.used_memory_peak || 0),
          fragmentation: parseFloat(parsed.mem_fragmentation_ratio || 0),
        },
        stats: {
          total_connections: parseInt(parsed.total_connections_received || 0),
          total_commands: parseInt(parsed.total_commands_processed || 0),
          instantaneous_ops_per_sec: parseInt(
            parsed.instantaneous_ops_per_sec || 0
          ),
          keyspace_hits: parseInt(parsed.keyspace_hits || 0),
          keyspace_misses: parseInt(parsed.keyspace_misses || 0),
        },
        database: {
          size: dbSize,
          key_patterns: keyPatterns,
        },
        monitoring: this.getHealthStatus(),
      };
    } catch (error) {
      logger.error(`Failed to get detailed stats: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Get statistics for different key patterns
   * @returns {Promise<Object>} Key pattern statistics
   */
  async getKeyPatternStats() {
    try {
      const patterns = [
        "cache:*",
        "analytics:*",
        "session:*",
        "ratelimit:*",
        "jobqueue:*",
      ];
      const stats = {};

      for (const pattern of patterns) {
        const keys = await redisService.keys(pattern);
        stats[pattern] = {
          count: keys.length,
          sample: keys.slice(0, 5), // First 5 keys as sample
        };
      }

      return stats;
    } catch (error) {
      logger.error(`Failed to get key pattern stats: ${error.message}`);
      return {};
    }
  }

  /**
   * Perform Redis performance benchmark
   * @returns {Promise<Object>} Benchmark results
   */
  async runBenchmark() {
    try {
      const results = {
        set: 0,
        get: 0,
        incr: 0,
        hset: 0,
        hget: 0,
      };

      const iterations = 100;

      // SET benchmark
      const setStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redisService.set(`bench:set:${i}`, `value${i}`, 60);
      }
      results.set = (Date.now() - setStart) / iterations;

      // GET benchmark
      const getStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redisService.get(`bench:set:${i}`);
      }
      results.get = (Date.now() - getStart) / iterations;

      // INCR benchmark
      const incrStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redisService.incr(`bench:counter:${i}`);
      }
      results.incr = (Date.now() - incrStart) / iterations;

      // HSET benchmark
      const hsetStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redisService.hset(`bench:hash:${i}`, `field${i}`, `value${i}`);
      }
      results.hset = (Date.now() - hsetStart) / iterations;

      // HGET benchmark
      const hgetStart = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redisService.hget(`bench:hash:${i}`, `field${i}`);
      }
      results.hget = (Date.now() - hgetStart) / iterations;

      // Cleanup benchmark keys
      const benchKeys = await redisService.keys("bench:*");
      if (benchKeys.length > 0) {
        await redisService.del(benchKeys);
      }

      logger.info("Redis benchmark completed", results);
      return results;
    } catch (error) {
      logger.error(`Redis benchmark failed: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Format bytes to human readable format
   * @param {number} bytes - Bytes to format
   * @returns {string} Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * Get monitoring configuration
   * @returns {Object} Current configuration
   */
  getConfig() {
    return {
      thresholds: { ...this.thresholds },
      alerts: { ...this.alerts },
      metrics: { ...this.metrics },
      isMonitoring: this.healthCheckInterval !== null,
    };
  }

  /**
   * Update monitoring thresholds
   * @param {Object} newThresholds - New threshold values
   */
  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    logger.info("Redis monitoring thresholds updated", this.thresholds);
  }

  /**
   * Reset alerts
   */
  resetAlerts() {
    this.alerts = {
      highLatency: false,
      highMemoryUsage: false,
      connectionIssues: false,
      highErrorRate: false,
    };
    logger.info("Redis alerts reset");
  }

  /**
   * Clean up monitoring resources
   */
  cleanup() {
    this.stopMonitoring();
    this.resetAlerts();
    logger.info("Redis monitoring cleanup completed");
  }
}

export default new RedisMonitoringService();
