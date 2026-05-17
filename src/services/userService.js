// src/services/userService.js
import { BUSINESS_ROLES } from "../constants/roles.js";
import User from "../models/User.js";
import logger from "../utils/logger.js";
import {
  isBusinessUser,
  getBusinessUserTypes,
} from "../utils/userTypeHelpers.js";
import mongoose from "mongoose";
import settingsService from "../services/settingsService.js";

class UserService {
  /**
   * Get user by ID with caching
   * @param {string} userId - User ID
   * @param {boolean} includeSensitive - Whether to include sensitive fields
   * @returns {Promise<Object>} User object
   */
  async getUserById(userId, includeSensitive = false) {
    try {
      const selectFields = includeSensitive
        ? "-password -refreshToken"
        : "-password -refreshToken -verificationToken -resetPasswordToken";

      const user = await User.findById(userId).select(selectFields);

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

      const query = {};

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
          "-password -refreshToken -verificationToken -resetPasswordToken",
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

      const query = {};

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
        BUSINESS_ROLES.includes(user.userType)
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

      logger.info(`User deleted: ${user.email}`);
      return true;
    } catch (error) {
      logger.error(`Delete user error: ${error.message}`);
      throw new Error("Failed to delete user");
    }
  }

  /**
   * Register a new agent (moved from controller)
   */
  async registerAgent(payload, appContext = {}) {
    try {
      const {
        fullName,
        email,
        phone,
        password,
        businessName,
        businessCategory = "services",
        subscriptionPlan = "basic",
        userType = "agent",
        tenantId,
      } = payload;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        const err = new Error("User already exists with this email");
        err.statusCode = 400;
        throw err;
      }

      if (!isBusinessUser(userType)) {
        const err = new Error(
          "Invalid user type. Must be agent, super_agent, dealer, or super_dealer",
        );
        err.statusCode = 400;
        throw err;
      }

      const requireApproval = await settingsService.getSignupApprovalSetting();
      const userStatus = requireApproval ? "pending" : "active";

      const agent = new User({
        fullName,
        email,
        phone,
        password,
        userType,
        businessName,
        businessCategory,
        subscriptionPlan,
        subscriptionStatus: "active",
        isVerified: true,
        status: userStatus,
        agentCode: "TEMP",
        tenantId: new mongoose.Types.ObjectId(),
      });

      await agent.save();

      // Set tenantId and generate real agent code
      agent.tenantId = tenantId || agent._id;
      const { generateUniqueAgentCode } =
        await import("../utils/agentCodeGenerator.js");
      const agentCode = await generateUniqueAgentCode(appContext.appId);
      agent.agentCode = agentCode;
      await agent.save();

      logger.info(
        `${userType} registered successfully: ${email} - Business: ${businessName} - Agent Code: ${agentCode}`,
      );

      return { agent, agentCode, userType, userStatus };
    } catch (error) {
      logger.error(`Register agent error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get agent dashboard data
   */
  async getAgentDashboard(agentId, userMeta = {}) {
    try {
      const subordinateCount = await User.countDocuments({
        tenantId: agentId,
        userType: { $in: getBusinessUserTypes() },
      });

      const recentSubordinates = await User.find({
        tenantId: agentId,
        userType: { $in: getBusinessUserTypes() },
      })
        .select("fullName email phone createdAt isVerified userType")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      return {
        totalSubordinates: subordinateCount,
        recentSubordinates,
        businessInfo: {
          businessName: userMeta.businessName,
          businessCategory: userMeta.businessCategory,
          subscriptionPlan: userMeta.subscriptionPlan,
          subscriptionStatus: userMeta.subscriptionStatus,
        },
      };
    } catch (error) {
      logger.error(`Get agent dashboard error: ${error.message}`);
      throw new Error("Failed to load dashboard data");
    }
  }

  /**
   * Update user (admin)
   */
  async updateUser(userId, updates) {
    try {
      const allowedFields = [
        "fullName",
        "email",
        "phone",
        "userType",
        "businessName",
        "businessCategory",
        "subscriptionPlan",
        "subscriptionStatus",
        "isActive",
        "status",
      ];
      const updateData = {};
      for (const key of allowedFields) {
        if (updates[key] !== undefined) updateData[key] = updates[key];
      }
      const user = await User.findByIdAndUpdate(userId, updateData, {
        new: true,
        runValidators: true,
      }).select("-password -refreshToken");
      if (!user) {
        const err = new Error("User not found");
        err.statusCode = 404;
        throw err;
      }
      return user;
    } catch (error) {
      logger.error(`Update user error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reset user password (admin)
   */
  async resetUserPassword(userId, newPassword) {
    try {
      if (!newPassword || newPassword.length < 6) {
        const err = new Error("Password must be at least 6 characters.");
        err.statusCode = 400;
        throw err;
      }
      const user = await User.findById(userId);
      if (!user) {
        const err = new Error("User not found");
        err.statusCode = 404;
        throw err;
      }

      user.password = newPassword;
      // Invalidate all active sessions globally
      user.passwordChangedAt = new Date();
      // Wipe the forgotten PIN so they are forced to set it up again
      user.securityPin = undefined;
      user.requiresPinSetup = true;

      await user.save();
      return true;
    } catch (error) {
      logger.error(`Reset user password error: ${error.message}`);
      throw error;
    }
  }
}

export default new UserService();
