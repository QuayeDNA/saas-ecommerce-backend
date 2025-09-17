// src/services/sessionService.js
import redisService from "./redisService.js";
import crypto from "crypto";
import logger from "../utils/logger.js";

class SessionService {
  constructor() {
    this.sessionPrefix = "session:";
    this.sessionTTL = parseInt(process.env.REDIS_SESSION_TTL) || 86400; // 24 hours
    this.maxSessionsPerUser =
      parseInt(process.env.REDIS_MAX_SESSIONS_PER_USER) || 5;
  }

  // Generate a unique session ID
  generateSessionId() {
    return crypto.randomBytes(32).toString("hex");
  }

  // Create a new session
  async createSession(userId, userData = {}, metadata = {}) {
    try {
      const sessionId = this.generateSessionId();
      const sessionKey = this.sessionPrefix + sessionId;

      const sessionData = {
        userId,
        userData,
        metadata: {
          ...metadata,
          createdAt: new Date().toISOString(),
          userAgent: metadata.userAgent || "unknown",
          ipAddress: metadata.ipAddress || "unknown",
          lastActivity: new Date().toISOString(),
        },
        isActive: true,
      };

      // Store session in Redis
      const success = await redisService.set(
        sessionKey,
        sessionData,
        this.sessionTTL
      );

      if (success) {
        // Clean up old sessions for this user if they exceed the limit
        await this.cleanupOldSessions(userId);

        logger.info(`Session created for user ${userId}: ${sessionId}`);
        return { sessionId, sessionData };
      }

      return null;
    } catch (error) {
      logger.error("Error creating session:", error);
      return null;
    }
  }

  // Get session by ID
  async getSession(sessionId) {
    try {
      const sessionKey = this.sessionPrefix + sessionId;
      const sessionData = await redisService.get(sessionKey);

      if (sessionData && sessionData.isActive) {
        // Update last activity
        sessionData.metadata.lastActivity = new Date().toISOString();
        await redisService.set(sessionKey, sessionData, this.sessionTTL);

        return sessionData;
      }

      return null;
    } catch (error) {
      logger.error("Error getting session:", error);
      return null;
    }
  }

  // Update session data
  async updateSession(sessionId, updates) {
    try {
      const sessionKey = this.sessionPrefix + sessionId;
      const sessionData = await redisService.get(sessionKey);

      if (!sessionData) {
        return false;
      }

      // Update session data
      const updatedSession = {
        ...sessionData,
        ...updates,
        metadata: {
          ...sessionData.metadata,
          lastActivity: new Date().toISOString(),
        },
      };

      return await redisService.set(
        sessionKey,
        updatedSession,
        this.sessionTTL
      );
    } catch (error) {
      logger.error("Error updating session:", error);
      return false;
    }
  }

  // Destroy session
  async destroySession(sessionId) {
    try {
      const sessionKey = this.sessionPrefix + sessionId;
      const result = await redisService.del(sessionKey);

      if (result) {
        logger.info(`Session destroyed: ${sessionId}`);
      }

      return result;
    } catch (error) {
      logger.error("Error destroying session:", error);
      return false;
    }
  }

  // Get all active sessions for a user
  async getUserSessions(userId) {
    try {
      const pattern = `${this.sessionPrefix}*`;
      const allSessions = await redisService.keys(pattern);

      const userSessions = [];

      for (const sessionKey of allSessions) {
        const sessionData = await redisService.get(sessionKey);
        if (
          sessionData &&
          sessionData.userId === userId &&
          sessionData.isActive
        ) {
          userSessions.push({
            sessionId: sessionKey.replace(this.sessionPrefix, ""),
            ...sessionData,
          });
        }
      }

      return userSessions;
    } catch (error) {
      logger.error("Error getting user sessions:", error);
      return [];
    }
  }

  // Destroy all sessions for a user
  async destroyUserSessions(userId) {
    try {
      const userSessions = await this.getUserSessions(userId);
      let destroyedCount = 0;

      for (const session of userSessions) {
        const result = await this.destroySession(session.sessionId);
        if (result) destroyedCount++;
      }

      logger.info(`Destroyed ${destroyedCount} sessions for user ${userId}`);
      return destroyedCount;
    } catch (error) {
      logger.error("Error destroying user sessions:", error);
      return 0;
    }
  }

  // Clean up old sessions for a user (keep only the most recent ones)
  async cleanupOldSessions(userId) {
    try {
      const userSessions = await this.getUserSessions(userId);

      if (userSessions.length <= this.maxSessionsPerUser) {
        return 0;
      }

      // Sort by creation date (newest first)
      userSessions.sort(
        (a, b) =>
          new Date(b.metadata.createdAt) - new Date(a.metadata.createdAt)
      );

      // Destroy old sessions
      const sessionsToDestroy = userSessions.slice(this.maxSessionsPerUser);
      let destroyedCount = 0;

      for (const session of sessionsToDestroy) {
        const result = await this.destroySession(session.sessionId);
        if (result) destroyedCount++;
      }

      if (destroyedCount > 0) {
        logger.info(
          `Cleaned up ${destroyedCount} old sessions for user ${userId}`
        );
      }

      return destroyedCount;
    } catch (error) {
      logger.error("Error cleaning up old sessions:", error);
      return 0;
    }
  }

  // Extend session TTL
  async extendSession(sessionId, additionalSeconds = null) {
    try {
      const sessionKey = this.sessionPrefix + sessionId;
      const extension = additionalSeconds || this.sessionTTL;

      const result = await redisService.expire(sessionKey, extension);

      if (result) {
        logger.debug(`Extended session ${sessionId} by ${extension} seconds`);
      }

      return result;
    } catch (error) {
      logger.error("Error extending session:", error);
      return false;
    }
  }

  // Validate session and return user data
  async validateSession(sessionId) {
    try {
      const sessionData = await this.getSession(sessionId);

      if (!sessionData || !sessionData.isActive) {
        return null;
      }

      // Check if session has expired based on last activity
      const lastActivity = new Date(sessionData.metadata.lastActivity);
      const now = new Date();
      const sessionTimeout =
        parseInt(process.env.REDIS_SESSION_TIMEOUT) || 3600; // 1 hour

      if ((now - lastActivity) / 1000 > sessionTimeout) {
        // Session timed out, destroy it
        await this.destroySession(sessionId);
        return null;
      }

      return sessionData;
    } catch (error) {
      logger.error("Error validating session:", error);
      return null;
    }
  }

  // Get session statistics
  async getSessionStats() {
    try {
      const pattern = `${this.sessionPrefix}*`;
      const sessionKeys = await redisService.keys(pattern);

      let activeSessions = 0;
      let totalUsers = new Set();

      for (const sessionKey of sessionKeys) {
        const sessionData = await redisService.get(sessionKey);
        if (sessionData && sessionData.isActive) {
          activeSessions++;
          totalUsers.add(sessionData.userId);
        }
      }

      return {
        totalSessions: sessionKeys.length,
        activeSessions,
        uniqueUsers: totalUsers.size,
        maxSessionsPerUser: this.maxSessionsPerUser,
        sessionTTL: this.sessionTTL,
      };
    } catch (error) {
      logger.error("Error getting session stats:", error);
      return {
        totalSessions: 0,
        activeSessions: 0,
        uniqueUsers: 0,
        error: error.message,
      };
    }
  }

  // Clean up expired sessions (maintenance task)
  async cleanupExpiredSessions() {
    try {
      const pattern = `${this.sessionPrefix}*`;
      const sessionKeys = await redisService.keys(pattern);
      let cleanedCount = 0;

      for (const sessionKey of sessionKeys) {
        const ttl = await redisService.ttl(sessionKey);
        if (ttl === -2) {
          // Key doesn't exist
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} expired sessions`);
      }

      return cleanedCount;
    } catch (error) {
      logger.error("Error cleaning up expired sessions:", error);
      return 0;
    }
  }
}

// Create singleton instance
const sessionService = new SessionService();

export default sessionService;
