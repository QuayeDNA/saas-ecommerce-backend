import redisService from "./redisService.js";
import logger from "../utils/logger.js";

/**
 * Redis-based Background Job Queue Service
 * Provides distributed job queuing with Redis backend
 */
class RedisJobQueue {
  constructor() {
    this.prefix = "jobqueue";
    this.defaultQueues = {
      email: "email_jobs",
      report: "report_jobs",
      notification: "notification_jobs",
      data_processing: "data_processing_jobs",
      cleanup: "cleanup_jobs",
    };
  }

  /**
   * Add a job to the queue
   * @param {string} queueName - Name of the queue
   * @param {Object} jobData - Job data
   * @param {Object} options - Job options (priority, delay, etc.)
   * @returns {Promise<string>} Job ID
   */
  async addJob(queueName, jobData, options = {}) {
    try {
      const jobId = this.generateJobId();
      const timestamp = Date.now();

      const job = {
        id: jobId,
        queue: queueName,
        data: jobData,
        options: {
          priority: options.priority || 0,
          delay: options.delay || 0,
          retries: options.retries || 3,
          timeout: options.timeout || 300000, // 5 minutes
          ...options,
        },
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
        attempts: 0,
      };

      const queueKey = `${this.prefix}:queue:${queueName}`;
      const jobKey = `${this.prefix}:job:${jobId}`;

      // Store job data
      await redisService.set(jobKey, JSON.stringify(job), 24 * 60 * 60); // 24 hours

      // Add to queue with priority and delay consideration
      const score = this.calculateJobScore(job);
      await redisService.zadd(queueKey, score, jobId);

      // Add to scheduled queue if delayed
      if (job.options.delay > 0) {
        const scheduledKey = `${this.prefix}:scheduled`;
        await redisService.zadd(
          scheduledKey,
          timestamp + job.options.delay,
          jobId
        );
      }

      // Add to job index for tracking
      const indexKey = `${this.prefix}:index:${queueName}`;
      await redisService.sadd(indexKey, jobId);

      logger.info(`Job ${jobId} added to queue ${queueName}`);
      return jobId;
    } catch (error) {
      logger.error(`Failed to add job to queue: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get next job from queue
   * @param {string} queueName - Name of the queue
   * @returns {Promise<Object|null>} Job data or null if no jobs available
   */
  async getNextJob(queueName) {
    try {
      const queueKey = `${this.prefix}:queue:${queueName}`;

      // Get the job with highest priority (lowest score)
      const jobs = await redisService.zrange(queueKey, 0, 0);
      if (jobs.length === 0) {
        return null;
      }

      const jobId = jobs[0];
      const jobKey = `${this.prefix}:job:${jobId}`;

      // Get job data
      const jobData = await redisService.get(jobKey);
      if (!jobData) {
        // Job data is missing, remove from queue
        await redisService.zrem(queueKey, jobId);
        return null;
      }

      const job = JSON.parse(jobData);

      // Check if job is ready (not delayed)
      if (
        job.options.delay > 0 &&
        Date.now() < job.createdAt + job.options.delay
      ) {
        return null; // Job is still delayed
      }

      // Remove from queue (will be re-added if processing fails)
      await redisService.zrem(queueKey, jobId);

      // Update job status
      job.status = "processing";
      job.updatedAt = Date.now();
      job.attempts += 1;
      await redisService.set(jobKey, JSON.stringify(job), 24 * 60 * 60);

      logger.debug(`Job ${jobId} retrieved from queue ${queueName}`);
      return job;
    } catch (error) {
      logger.error(`Failed to get next job from queue: ${error.message}`);
      return null;
    }
  }

  /**
   * Mark job as completed
   * @param {string} jobId - Job ID
   * @param {Object} result - Job result
   */
  async completeJob(jobId, result = null) {
    try {
      const jobKey = `${this.prefix}:job:${jobId}`;
      const jobData = await redisService.get(jobKey);

      if (!jobData) {
        logger.warn(`Job ${jobId} not found for completion`);
        return;
      }

      const job = JSON.parse(jobData);
      job.status = "completed";
      job.updatedAt = Date.now();
      job.completedAt = Date.now();
      job.result = result;

      // Store completed job for a shorter time
      await redisService.set(jobKey, JSON.stringify(job), 60 * 60); // 1 hour

      // Add to completed jobs set
      const completedKey = `${this.prefix}:completed:${job.queue}`;
      await redisService.sadd(completedKey, jobId);
      await redisService.expire(completedKey, 24 * 60 * 60); // 24 hours

      logger.info(`Job ${jobId} completed successfully`);
    } catch (error) {
      logger.error(`Failed to complete job ${jobId}: ${error.message}`);
    }
  }

  /**
   * Mark job as failed
   * @param {string} jobId - Job ID
   * @param {Error} error - Error that occurred
   */
  async failJob(jobId, error) {
    try {
      const jobKey = `${this.prefix}:job:${jobId}`;
      const jobData = await redisService.get(jobKey);

      if (!jobData) {
        logger.warn(`Job ${jobId} not found for failure`);
        return;
      }

      const job = JSON.parse(jobData);
      job.status = "failed";
      job.updatedAt = Date.now();
      job.failedAt = Date.now();
      job.error = {
        message: error.message,
        stack: error.stack,
      };

      // Check if job should be retried
      if (job.attempts < job.options.retries) {
        // Re-queue the job with backoff delay
        const backoffDelay = Math.min(1000 * Math.pow(2, job.attempts), 300000); // Max 5 minutes
        job.status = "retry";
        job.options.delay = backoffDelay;

        await redisService.set(jobKey, JSON.stringify(job), 24 * 60 * 60);

        // Re-add to queue
        const queueKey = `${this.prefix}:queue:${job.queue}`;
        const score = this.calculateJobScore(job);
        await redisService.zadd(queueKey, score, jobId);

        logger.info(`Job ${jobId} scheduled for retry in ${backoffDelay}ms`);
      } else {
        // Job failed permanently
        job.status = "failed";

        // Store failed job
        await redisService.set(jobKey, JSON.stringify(job), 7 * 24 * 60 * 60); // 7 days

        // Add to failed jobs set
        const failedKey = `${this.prefix}:failed:${job.queue}`;
        await redisService.sadd(failedKey, jobId);
        await redisService.expire(failedKey, 7 * 24 * 60 * 60); // 7 days

        logger.error(
          `Job ${jobId} failed permanently after ${job.attempts} attempts`
        );
      }
    } catch (err) {
      logger.error(`Failed to handle job failure for ${jobId}: ${err.message}`);
    }
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Promise<Object|null>} Job status
   */
  async getJobStatus(jobId) {
    try {
      const jobKey = `${this.prefix}:job:${jobId}`;
      const jobData = await redisService.get(jobKey);

      if (!jobData) {
        return null;
      }

      return JSON.parse(jobData);
    } catch (error) {
      logger.error(`Failed to get job status: ${error.message}`);
      return null;
    }
  }

  /**
   * Get queue statistics
   * @param {string} queueName - Name of the queue
   * @returns {Promise<Object>} Queue statistics
   */
  async getQueueStats(queueName) {
    try {
      const queueKey = `${this.prefix}:queue:${queueName}`;
      const completedKey = `${this.prefix}:completed:${queueName}`;
      const failedKey = `${this.prefix}:failed:${queueName}`;

      const [queued, completed, failed] = await Promise.all([
        redisService.zcard(queueKey),
        redisService.scard(completedKey),
        redisService.scard(failedKey),
      ]);

      return {
        queue: queueName,
        queued,
        completed,
        failed,
        total: queued + completed + failed,
      };
    } catch (error) {
      logger.error(`Failed to get queue stats: ${error.message}`);
      return {
        queue: queueName,
        queued: 0,
        completed: 0,
        failed: 0,
        total: 0,
      };
    }
  }

  /**
   * Get all queue statistics
   * @returns {Promise<Object>} All queue statistics
   */
  async getAllQueueStats() {
    try {
      const stats = {};
      for (const [key, queueName] of Object.entries(this.defaultQueues)) {
        stats[key] = await this.getQueueStats(queueName);
      }
      return stats;
    } catch (error) {
      logger.error(`Failed to get all queue stats: ${error.message}`);
      return {};
    }
  }

  /**
   * Clean up old completed and failed jobs
   * @param {number} daysOld - Remove jobs older than this many days
   */
  async cleanupOldJobs(daysOld = 7) {
    try {
      const cutoffTimestamp = Date.now() - daysOld * 24 * 60 * 60 * 1000;

      // Get all job keys
      const jobKeys = await redisService.keys(`${this.prefix}:job:*`);

      let deletedCount = 0;
      for (const jobKey of jobKeys) {
        const jobData = await redisService.get(jobKey);
        if (jobData) {
          const job = JSON.parse(jobData);

          // Remove old completed or failed jobs
          if (
            (job.status === "completed" || job.status === "failed") &&
            job.updatedAt < cutoffTimestamp
          ) {
            await redisService.del([jobKey]);
            deletedCount++;

            // Remove from completed/failed sets
            const statusKey = `${this.prefix}:${job.status}:${job.queue}`;
            await redisService.srem(statusKey, job.id);
          }
        }
      }

      logger.info(`Cleaned up ${deletedCount} old jobs`);
      return deletedCount;
    } catch (error) {
      logger.error(`Failed to cleanup old jobs: ${error.message}`);
      return 0;
    }
  }

  /**
   * Process scheduled jobs (move from scheduled to regular queues)
   */
  async processScheduledJobs() {
    try {
      const scheduledKey = `${this.prefix}:scheduled`;
      const now = Date.now();

      // Get jobs that are ready to be processed
      const readyJobs = await redisService.zrangebyscore(scheduledKey, 0, now);

      for (const jobId of readyJobs) {
        // Remove from scheduled queue
        await redisService.zrem(scheduledKey, jobId);

        // Get job data
        const jobKey = `${this.prefix}:job:${jobId}`;
        const jobData = await redisService.get(jobKey);

        if (jobData) {
          const job = JSON.parse(jobData);

          // Add to regular queue
          const queueKey = `${this.prefix}:queue:${job.queue}`;
          const score = this.calculateJobScore(job);
          await redisService.zadd(queueKey, score, jobId);

          logger.debug(
            `Job ${jobId} moved from scheduled to queue ${job.queue}`
          );
        }
      }

      return readyJobs.length;
    } catch (error) {
      logger.error(`Failed to process scheduled jobs: ${error.message}`);
      return 0;
    }
  }

  /**
   * Generate a unique job ID
   * @returns {string} Job ID
   */
  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate job score for priority queue ordering
   * @param {Object} job - Job object
   * @returns {number} Score for sorting
   */
  calculateJobScore(job) {
    const now = Date.now();
    const delay = job.options.delay || 0;
    const priority = job.options.priority || 0;

    // Higher priority = lower score (processed first)
    // Delay affects when job becomes available
    return now + delay - priority * 1000;
  }

  /**
   * Clear all jobs from a queue (for testing/admin purposes)
   * @param {string} queueName - Name of the queue
   */
  async clearQueue(queueName) {
    try {
      const queueKey = `${this.prefix}:queue:${queueName}`;
      const indexKey = `${this.prefix}:index:${queueName}`;

      // Get all job IDs in the queue
      const jobIds = await redisService.zrange(queueKey, 0, -1);

      // Remove jobs from queue and index
      if (jobIds.length > 0) {
        await redisService.del([queueKey, indexKey]);

        // Remove individual job data
        const jobKeys = jobIds.map((id) => `${this.prefix}:job:${id}`);
        await redisService.del(jobKeys);
      }

      logger.info(`Cleared queue ${queueName}, removed ${jobIds.length} jobs`);
      return jobIds.length;
    } catch (error) {
      logger.error(`Failed to clear queue ${queueName}: ${error.message}`);
      return 0;
    }
  }
}

export default new RedisJobQueue();
