// src/services/userService.js
import User from "../models/User.js";
import redisService from "./redisService.js";
import logger from "../utils/logger.js";
import {
  isBusinessUser,
  getBusinessUserTypes,
} from "../utils/userTypeHelpers.js";

class UserService {
  /**
   * Get user by ID with caching
   * @param {string} userId - User ID
   * @param {boolean} includeSensitive - Whether to include sensitive fields
   * @returns {Promise<Object>} User object
   */
  async getUserById(userId, includeSensitive = false) {
    try {
      const cacheKey = `user:${userId}:${includeSensitive}`;

      // Try to get from cache first
      const cachedUser = await redisService.get(cacheKey);
      if (cachedUser) {
        logger.debug(`User cache hit for user ${userId}`);
        return cachedUser;
      }

      const selectFields = includeSensitive
        ? "-password -refreshToken"
        : "-password -refreshToken -verificationToken -resetPasswordToken";

      const user = await User.findById(userId).select(selectFields);

      if (user) {
        // Cache the user for 15 minutes
        await redisService.set(cacheKey, user, 900);
        logger.debug(`User cached for user ${userId}`);
      }

      return user;
    } catch (error) {
      logger.error(`Get user by ID error: ${error.message}`);
      throw new Error("Failed to get user");
    }
  }

  /**
   * Get users list with pagination and filters
   * @param {Object} filters - Filter options
   * @param {Object} pagination - Pagination options
   * @param {string} requestUserType - Type of requesting user
   * @param {string} requestUserId - ID of requesting user
   * @returns {Promise<Object>} Users list with pagination
   */
  async getUsers(filters, pagination, requestUserType, requestUserId) {
    filters = filters || {};
    pagination = pagination || {};
    try {
      const { page = 1, limit = 10 } = pagination;
      const { search, userType, status } = filters;

      // Create cache key based on filters and pagination
      const filterKey = JSON.stringify({
        filters,
        pagination,
        requestUserType,
        requestUserId,
      });
      const cacheKey = `users:list:${Buffer.from(filterKey).toString(
        "base64"
      )}`;

      // Try to get from cache first
      const cachedResult = await redisService.get(cacheKey);
      if (cachedResult) {
        logger.debug("Users list cache hit");
        return cachedResult;
      }

      let query = {};

      // Build query based on user permissions
      if (isBusinessUser(requestUserType)) {
        query.tenantId = requestUserId;
        if (userType) {
          query.userType = userType;
        }
      } else if (requestUserType === "super_admin") {
        if (userType) {
          query.userType = userType;
        }
        if (status) {
          query.status = status;
        }
      }

      // Add search functionality
      if (search) {
        query.$or = [
          { fullName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
        ];
      }

      const users = await User.find(query)
        .select(
          "-password -refreshToken -verificationToken -resetPasswordToken"
        )
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const total = await User.countDocuments(query);

      const result = {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      };

      // Cache the result for 10 minutes
      await redisService.set(cacheKey, result, 600);
      logger.debug("Users list cached");

      return result;
    } catch (error) {
      logger.error(`Get users error: ${error.message}`);
      throw new Error("Failed to get users");
    }
  }

  /**
   * Get users with wallet information
   * @param {Object} filters - Filter options
   * @param {Object} pagination - Pagination options
   * @returns {Promise<Object>} Users with wallet info
   */
  async getUsersWithWallet(filters, pagination) {
    filters = filters || {};
    pagination = pagination || {};
    try {
      const { page = 1, limit = 20 } = pagination;
      const { search, userType } = filters;

      // Create cache key
      const filterKey = JSON.stringify({ filters, pagination });
      const cacheKey = `users:wallet:${Buffer.from(filterKey).toString(
        "base64"
      )}`;

      // Try to get from cache first
      const cachedResult = await redisService.get(cacheKey);
      if (cachedResult) {
        logger.debug("Users with wallet cache hit");
        return cachedResult;
      }

      let query = {};

      if (userType) {
        query.userType = userType;
      }

      if (search) {
        query.$or = [
          { fullName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
        ];
      }

      const selectFields =
        "-password -refreshToken -verificationToken -resetPasswordToken";
      const users = await User.find(query)
        .select(selectFields)
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const total = await User.countDocuments(query);

      const result = {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      };

      // Cache the result for 5 minutes
      await redisService.set(cacheKey, result, 300);
      logger.debug("Users with wallet cached");

      return result;
    } catch (error) {
      logger.error(`Get users with wallet error: ${error.message}`);
      throw new Error("Failed to get users");
    }
  }

  /**
   * Get user statistics
   * @param {string} requestUserType - Type of requesting user
   * @param {string} requestUserId - ID of requesting user
   * @returns {Promise<Object>} User statistics
   */
  async getUserStats(requestUserType, requestUserId) {
    try {
      const cacheKey = `user:stats:${requestUserType}:${requestUserId}`;

      // Try to get from cache first
      const cachedStats = await redisService.get(cacheKey);
      if (cachedStats) {
        logger.debug(`User stats cache hit for ${requestUserType}`);
        return cachedStats;
      }

      let stats = {};

      if (isBusinessUser(requestUserType)) {
        // Business user stats - their subordinates
        const [totalSubordinates, verifiedSubordinates, recentSubordinates] =
          await Promise.all([
            User.countDocuments({
              tenantId: requestUserId,
              userType: { $in: getBusinessUserTypes() },
            }),
            User.countDocuments({
              tenantId: requestUserId,
              userType: { $in: getBusinessUserTypes() },
              isVerified: true,
            }),
            User.countDocuments({
              tenantId: requestUserId,
              userType: { $in: getBusinessUserTypes() },
              createdAt: {
                $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              },
            }),
          ]);

        stats = {
          totalSubordinates,
          verifiedSubordinates,
          unverifiedSubordinates: totalSubordinates - verifiedSubordinates,
          recentSubordinates,
        };
      } else if (requestUserType === "super_admin") {
        // Admin stats - all users
        const [
          totalUsers,
          totalAgents,
          totalBusinessUsers,
          verifiedUsers,
          activeBusinessUsers,
        ] = await Promise.all([
          User.countDocuments(),
          User.countDocuments({ userType: "agent" }),
          User.countDocuments({ userType: { $in: getBusinessUserTypes() } }),
          User.countDocuments({ isVerified: true }),
          User.countDocuments({
            userType: { $in: getBusinessUserTypes() },
            subscriptionStatus: "active",
          }),
        ]);

        stats = {
          totalUsers,
          totalAgents,
          totalBusinessUsers,
          verifiedUsers,
          unverifiedUsers: totalUsers - verifiedUsers,
          activeBusinessUsers,
          inactiveBusinessUsers: totalBusinessUsers - activeBusinessUsers,
        };
      }

      // Cache the stats for 10 minutes
      await redisService.set(cacheKey, stats, 600);
      logger.debug(`User stats cached for ${requestUserType}`);

      return stats;
    } catch (error) {
      logger.error(`Get user stats error: ${error.message}`);
      throw new Error("Failed to get user statistics");
    }
  }

  /**
   * Get comprehensive dashboard statistics
   * @returns {Promise<Object>} Dashboard statistics
   */
  async getDashboardStats() {
    try {
      const cacheKey = "user:dashboard:stats";

      // Try to get from cache first
      const cachedStats = await redisService.get(cacheKey);
      if (cachedStats) {
        logger.debug("Dashboard stats cache hit");
        return cachedStats;
      }

      // Get various user statistics
      const [
        totalUsers,
        totalAgents,
        totalBusinessUsers,
        verifiedUsers,
        activeBusinessUsers,
        recentUsers,
        suspendedUsers,
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ userType: "agent" }),
        User.countDocuments({ userType: { $in: getBusinessUserTypes() } }),
        User.countDocuments({ isVerified: true }),
        User.countDocuments({
          userType: { $in: getBusinessUserTypes() },
          subscriptionStatus: "active",
        }),
        User.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        }),
        User.countDocuments({ subscriptionStatus: "suspended" }),
      ]);

      const stats = {
        totalUsers,
        totalAgents,
        totalBusinessUsers,
        verifiedUsers,
        unverifiedUsers: totalUsers - verifiedUsers,
        activeBusinessUsers,
        inactiveBusinessUsers: totalBusinessUsers - activeBusinessUsers,
        recentUsers,
        suspendedUsers,
        userGrowth: {
          last30Days: recentUsers,
        },
      };

      // Cache the dashboard stats for 5 minutes
      await redisService.set(cacheKey, stats, 300);
      logger.debug("Dashboard stats cached");

      return stats;
    } catch (error) {
      logger.error(`Get dashboard stats error: ${error.message}`);
      throw new Error("Failed to get dashboard statistics");
    }
  }

  /**
   * Update user profile
   * @param {string} userId - User ID
   * @param {Object} updates - Profile updates
   * @returns {Promise<Object>} Updated user
   */
  async updateProfile(userId, updates) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Update allowed fields
      if (updates.fullName) user.fullName = updates.fullName;
      if (updates.phone) user.phone = updates.phone;

      await user.save();

      // Invalidate user cache
      await this.invalidateUserCache(userId);

      logger.info(`Profile updated for user: ${user.email}`);
      return user;
    } catch (error) {
      logger.error(`Update profile error: ${error.message}`);
      throw new Error("Failed to update profile");
    }
  }

  /**
   * Update user status
   * @param {string} userId - User ID
   * @param {Object} statusUpdates - Status updates
   * @returns {Promise<Object>} Updated user
   */
  async updateUserStatus(userId, statusUpdates) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Update status fields
      if (typeof statusUpdates.isVerified === "boolean") {
        user.isVerified = statusUpdates.isVerified;
      }

      if (
        statusUpdates.subscriptionStatus &&
        ["agent", "super_agent", "dealer", "super_dealer"].includes(
          user.userType
        )
      ) {
        user.subscriptionStatus = statusUpdates.subscriptionStatus;
      }

      if (
        statusUpdates.userType &&
        [
          "agent",
          "super_agent",
          "dealer",
          "super_dealer",
          "super_admin",
        ].includes(statusUpdates.userType)
      ) {
        user.userType = statusUpdates.userType;
      }

      await user.save();

      // Invalidate user cache and related caches
      await this.invalidateUserCache(userId);
      await this.invalidateStatsCache();

      logger.info(`User status updated: ${user.email}`);
      return user;
    } catch (error) {
      logger.error(`Update user status error: ${error.message}`);
      throw new Error("Failed to update user status");
    }
  }

  /**
   * Delete user (soft delete)
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteUser(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Soft delete by marking as suspended
      user.subscriptionStatus = "suspended";
      user.isVerified = false;
      await user.save();

      // Invalidate user cache and related caches
      await this.invalidateUserCache(userId);
      await this.invalidateStatsCache();

      logger.info(`User deleted: ${user.email}`);
      return true;
    } catch (error) {
      logger.error(`Delete user error: ${error.message}`);
      throw new Error("Failed to delete user");
    }
  }

  /**
   * Invalidate user-related caches
   * @param {string} userId - User ID (optional)
   */
  async invalidateUserCache(userId = null) {
    try {
      const keysToDelete = [];

      if (userId) {
        // Clear specific user caches
        keysToDelete.push(`user:${userId}:*`);
      }

      // Clear general user caches
      keysToDelete.push("users:list:*");
      keysToDelete.push("users:wallet:*");

      for (const pattern of keysToDelete) {
        const deletedCount = await redisService.delPattern(pattern);
        if (deletedCount > 0) {
          logger.debug(
            `Invalidated ${deletedCount} user cache entries for pattern: ${pattern}`
          );
        }
      }
    } catch (error) {
      logger.error("Error invalidating user cache:", error);
    }
  }

  /**
   * Invalidate statistics caches
   */
  async invalidateStatsCache() {
    try {
      const keysToDelete = ["user:stats:*", "user:dashboard:stats"];

      for (const pattern of keysToDelete) {
        const deletedCount = await redisService.delPattern(pattern);
        if (deletedCount > 0) {
          logger.debug(
            `Invalidated ${deletedCount} stats cache entries for pattern: ${pattern}`
          );
        }
      }
    } catch (error) {
      logger.error("Error invalidating stats cache:", error);
    }
  }

  /**
   * Get cache statistics for user service
   * @returns {Promise<Object>} Cache statistics
   */
  async getCacheStats() {
    try {
      const patterns = ["user:*", "users:*"];
      let totalEntries = 0;

      for (const pattern of patterns) {
        const keys = await redisService.keys(pattern);
        totalEntries += keys.length;
      }

      return {
        totalUserCacheEntries: totalEntries,
        cachePatterns: patterns,
      };
    } catch (error) {
      logger.error("Error getting user cache stats:", error);
      return { totalUserCacheEntries: 0, error: error.message };
    }
  }
}

export default new UserService();
