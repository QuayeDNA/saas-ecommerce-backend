// src/controllers/userController.js
import { generateSpecialOrderNumber } from "../utils/orderNumberGenerator.js";
import User from "../models/User.js";
import logger from "../utils/logger.js";
import crypto from "crypto";
import {
  isBusinessUser,
  getBusinessUserTypes,
} from "../utils/userTypeHelpers.js";

class UserController {
  // Get current user profile
  async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.userId).select(
        "-password -refreshToken"
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.json({
        success: true,
        user: user.toJSON(),
      });
    } catch (error) {
      logger.error(`Get profile error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get user profile",
      });
    }
  }

  // Update user profile
  async updateProfile(req, res) {
    try {
      const { fullName, phone, businessName, businessCategory } = req.body;
      const userId = req.user.userId;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Update allowed fields
      if (fullName) user.fullName = fullName;
      if (phone) user.phone = phone;

      // Update business fields for business users
      if (isBusinessUser(user.userType)) {
        if (businessName !== undefined) user.businessName = businessName;
        if (businessCategory !== undefined)
          user.businessCategory = businessCategory;
      }

      await user.save();

      logger.info(`Profile updated for user: ${user.email}`);
      res.json({
        success: true,
        message: "Profile updated successfully",
        user: user.toJSON(),
      });
    } catch (error) {
      logger.error(`Update profile error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to update profile",
      });
    }
  }

  // Change password
  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.userId;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Verify current password
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      // Update password
      user.password = newPassword;
      await user.save();

      logger.info(`Password changed for user: ${user.email}`);
      res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      logger.error(`Change password error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to change password",
      });
    }
  }

  // Get users list (Agent only - for viewing their customers)
  async getUsers(req, res) {
    try {
      const { page = 1, limit = 10, search, userType, status } = req.query;
      const { userType: requestUserType, tenantId, userId } = req.user;

      let query = {};

      // If business user, only show their customers
      if (isBusinessUser(requestUserType)) {
        query.tenantId = userId;
        if (userType) {
          query.userType = userType;
        }
      } else if (requestUserType === "super_admin") {
        // Super admin can see all users
        if (userType) {
          query.userType = userType;
        }
        // Add status filter for super admin
        if (status) {
          query.status = status;
        }
      } else {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
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

      res.json({
        success: true,
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error(`Get users error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get users",
      });
    }
  }

  // Get users with wallet information (super admin only)
  async getUsersWithWallet(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        userType,
        includeWallet = "true",
      } = req.query;
      const { userType: requestUserType } = req.user;

      // Only super admin can access this endpoint
      if (requestUserType !== "super_admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied. Super admin only.",
        });
      }

      let query = {};

      // Filter by user type if specified
      if (userType) {
        query.userType = userType;
      }

      // Add search functionality
      if (search) {
        query.$or = [
          { fullName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
        ];
      }

      // Select fields including wallet balance
      const selectFields =
        "-password -refreshToken -verificationToken -resetPasswordToken";
      const users = await User.find(query)
        .select(selectFields)
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const total = await User.countDocuments(query);

      res.json({
        success: true,
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error(`Get users with wallet error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get users",
      });
    }
  }

  // Get user by ID (Agent can only view their customers)
  async getUserById(req, res) {
    try {
      const { id } = req.params;
      const { userType: requestUserType, userId: requestUserId } = req.user;

      let user;

      if (isBusinessUser(requestUserType)) {
        // Business user can only view their customers or themselves
        user = await User.findOne({
          _id: id,
          $or: [{ tenantId: requestUserId }, { _id: requestUserId }],
        }).select(
          "-password -refreshToken -verificationToken -resetPasswordToken"
        );
      } else if (requestUserType === "super_admin") {
        user = await User.findById(id).select(
          "-password -refreshToken -verificationToken -resetPasswordToken"
        );
      } else {
        // Regular users can only view their own profile
        if (id !== requestUserId.toString()) {
          return res.status(403).json({
            success: false,
            message: "Access denied",
          });
        }
        user = await User.findById(id).select(
          "-password -refreshToken -verificationToken -resetPasswordToken"
        );
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.json({
        success: true,
        user: user.toJSON(),
      });
    } catch (error) {
      logger.error(`Get user by ID error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get user",
      });
    }
  }

  // Update user status (Admin only)
  async updateUserStatus(req, res) {
    try {
      const { id } = req.params;
      const { isVerified, subscriptionStatus, userType } = req.body;
      const { userType: requestUserType } = req.user;

      if (requestUserType !== "super_admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied. Admin privileges required.",
        });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Update allowed status fields
      if (typeof isVerified === "boolean") {
        user.isVerified = isVerified;
      }

      if (
        subscriptionStatus &&
        ["agent", "super_agent", "dealer", "super_dealer"].includes(
          user.userType
        )
      ) {
        user.subscriptionStatus = subscriptionStatus;
      }

      // Allow super admins to change user types
      if (
        userType &&
        [
          "agent",
          "super_agent",
          "dealer",
          "super_dealer",
          "super_admin",
        ].includes(userType)
      ) {
        user.userType = userType;
      }

      await user.save();

      logger.info(`User status updated: ${user.email} by ${req.user.email}`);
      res.json({
        success: true,
        message: "User status updated successfully",
        user: user.toJSON(),
      });
    } catch (error) {
      logger.error(`Update user status error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to update user status",
      });
    }
  }

  // Delete user (Soft delete)
  async deleteUser(req, res) {
    try {
      const { id } = req.params;
      const { userType: requestUserType, userId: requestUserId } = req.user;

      if (requestUserType !== "super_admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied. Admin privileges required.",
        });
      }

      // Prevent self-deletion
      if (id === requestUserId.toString()) {
        return res.status(400).json({
          success: false,
          message: "You cannot delete your own account",
        });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // For now, we'll just mark the user as inactive
      // In a real app, you might want to implement soft delete
      user.subscriptionStatus = "suspended";
      user.isVerified = false;
      await user.save();

      logger.info(`User deleted: ${user.email} by ${req.user.email}`);
      res.json({
        success: true,
        message: "User deleted successfully",
      });
    } catch (error) {
      logger.error(`Delete user error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to delete user",
      });
    }
  }

  // Get user statistics (for dashboard)
  async getUserStats(req, res) {
    try {
      const { userType: requestUserType, userId } = req.user;

      let stats = {};

      if (isBusinessUser(requestUserType)) {
        // Business user stats - their subordinates (other business roles under them)
        const totalSubordinates = await User.countDocuments({
          tenantId: userId,
          userType: { $in: getBusinessUserTypes() },
        });

        const verifiedSubordinates = await User.countDocuments({
          tenantId: userId,
          userType: { $in: getBusinessUserTypes() },
          isVerified: true,
        });

        const recentSubordinates = await User.countDocuments({
          tenantId: userId,
          userType: { $in: getBusinessUserTypes() },
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        });

        stats = {
          totalSubordinates,
          verifiedSubordinates,
          unverifiedSubordinates: totalSubordinates - verifiedSubordinates,
          recentSubordinates,
        };
      } else if (requestUserType === "super_admin") {
        // Admin stats - all users
        const totalUsers = await User.countDocuments();
        const totalAgents = await User.countDocuments({ userType: "agent" });
        const totalBusinessUsers = await User.countDocuments({
          userType: { $in: getBusinessUserTypes() },
        });
        const verifiedUsers = await User.countDocuments({ isVerified: true });
        const activeBusinessUsers = await User.countDocuments({
          userType: { $in: getBusinessUserTypes() },
          subscriptionStatus: "active",
        });

        stats = {
          totalUsers,
          totalAgents,
          totalBusinessUsers,
          verifiedUsers,
          unverifiedUsers: totalUsers - verifiedUsers,
          activeBusinessUsers,
          inactiveBusinessUsers: totalBusinessUsers - activeBusinessUsers,
        };
      } else {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      logger.error(`Get user stats error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get user statistics",
      });
    }
  }

  // Get comprehensive dashboard statistics for super admin
  async getDashboardStats(req, res) {
    try {
      const { userType: requestUserType } = req.user;

      if (requestUserType !== "super_admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied. Super admin privileges required.",
        });
      }

      // Import Order model for statistics
      const Order = (await import("../models/Order.js")).default;
      const WalletTransaction = (await import("../models/WalletTransaction.js"))
        .default;
      const Provider = (await import("../models/Provider.js")).default;

      // Calculate date ranges
      const now = new Date();
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const last90Days = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      // User Statistics
      const totalUsers = await User.countDocuments();
      const totalAgents = await User.countDocuments({ userType: "agent" });
      const totalCustomers = await User.countDocuments({
        userType: "customer",
      });
      const verifiedUsers = await User.countDocuments({ isVerified: true });
      const activeAgents = await User.countDocuments({
        userType: "agent",
        subscriptionStatus: "active",
      });
      const pendingAgents = await User.countDocuments({
        userType: "agent",
        status: "pending",
      });
      const newUsersThisWeek = await User.countDocuments({
        createdAt: { $gte: last7Days },
      });
      const newUsersThisMonth = await User.countDocuments({
        createdAt: { $gte: last30Days },
      });

      // Order Statistics
      const totalOrders = await Order.countDocuments();
      const completedOrders = await Order.countDocuments({
        status: "completed",
      });
      const pendingOrders = await Order.countDocuments({ status: "pending" });
      const processingOrders = await Order.countDocuments({
        status: "processing",
      });
      const cancelledOrders = await Order.countDocuments({
        status: "cancelled",
      });
      const failedOrders = await Order.countDocuments({ status: "failed" });
      const ordersThisWeek = await Order.countDocuments({
        createdAt: { $gte: last7Days },
      });
      const ordersThisMonth = await Order.countDocuments({
        createdAt: { $gte: last30Days },
      });

      // Today's range
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);

      const todaysOrders = await Order.countDocuments({
        createdAt: { $gte: startOfToday, $lt: endOfToday },
      });

      // Today's revenue (only count completed orders)
      const revenueTodayAgg = await Order.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: { $gte: startOfToday, $lt: endOfToday },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]);
      const revenueToday = revenueTodayAgg[0]?.total || 0;

      // Revenue Statistics
      const totalRevenue = await Order.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]);
      const revenueThisWeek = await Order.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: { $gte: last7Days },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]);
      const revenueThisMonth = await Order.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: { $gte: last30Days },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]);

      // Provider Statistics
      const totalProviders = await Provider.countDocuments();
      const activeProviders = await Provider.countDocuments({
        status: "active",
      });
      const newProvidersThisMonth = await Provider.countDocuments({
        createdAt: { $gte: last30Days },
      });

      // Wallet Statistics
      const totalTransactions = await WalletTransaction.countDocuments();
      const transactionsThisWeek = await WalletTransaction.countDocuments({
        createdAt: { $gte: last7Days },
      });
      const totalWalletBalance = await WalletTransaction.aggregate([
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      // Recent Activity (last 10 items)
      const recentUsers = await User.find()
        .select("fullName email userType createdAt status")
        .sort({ createdAt: -1 })
        .limit(10);

      const recentOrders = await Order.find()
        .select("orderNumber total status createdAt")
        .sort({ createdAt: -1 })
        .limit(10);

      const recentTransactions = await WalletTransaction.find()
        .select("amount type description createdAt")
        .sort({ createdAt: -1 })
        .limit(10);

      // Calculate percentages and rates
      const userVerificationRate =
        totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0;
      const orderSuccessRate =
        totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
      const agentActivationRate =
        totalAgents > 0 ? Math.round((activeAgents / totalAgents) * 100) : 0;

      const stats = {
        users: {
          total: totalUsers,
          agents: totalAgents,
          customers: totalCustomers,
          verified: verifiedUsers,
          unverified: totalUsers - verifiedUsers,
          activeAgents,
          inactiveAgents: totalAgents - activeAgents,
          pendingAgents,
          newThisWeek: newUsersThisWeek,
          newThisMonth: newUsersThisMonth,
          verificationRate: userVerificationRate,
        },
        orders: {
          total: totalOrders,
          completed: completedOrders,
          pending: pendingOrders,
          processing: processingOrders,
          cancelled: cancelledOrders,
          draft: 0,
          failed: failedOrders,
          today: todaysOrders,
          thisWeek: ordersThisWeek,
          thisMonth: ordersThisMonth,
          successRate: orderSuccessRate,
        },
        revenue: {
          total: totalRevenue[0]?.total || 0,
          today: revenueToday,
          thisWeek: revenueThisWeek[0]?.total || 0,
          thisMonth: revenueThisMonth[0]?.total || 0,
        },
        providers: {
          total: totalProviders,
          active: activeProviders,
          newThisMonth: newProvidersThisMonth,
        },
        wallet: {
          totalTransactions,
          thisWeek: transactionsThisWeek,
          totalBalance: totalWalletBalance[0]?.total || 0,
        },
        rates: {
          userVerification: userVerificationRate,
          orderSuccess: orderSuccessRate,
          agentActivation: agentActivationRate,
        },
        recentActivity: {
          users: recentUsers,
          orders: recentOrders,
          transactions: recentTransactions,
        },
      };

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      logger.error(`Get dashboard stats error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get dashboard statistics",
      });
    }
  }

  // Get chart data for super admin dashboard
  async getChartData(req, res) {
    try {
      const { userType: requestUserType } = req.user;

      if (requestUserType !== "super_admin") {
        return res.status(403).json({
          success: false,
          message: "Access denied. Super admin privileges required.",
        });
      }

      // Import Order model for statistics
      const Order = (await import("../models/Order.js")).default;
      const WalletTransaction = (await import("../models/WalletTransaction.js"))
        .default;

      // Generate last 30 days data
      const days = 30;
      const chartData = {
        labels: [],
        userRegistrations: [],
        orders: [],
        revenue: [],
        orderStatus: {
          completed: 0,
          pending: 0,
          failed: 0,
        },
        userTypes: {
          agents: 0,
          customers: 0,
          super_admins: 0,
        },
      };

      // Generate labels for last 30 days
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        chartData.labels.push(
          date.toLocaleDateString("en-GB", { month: "short", day: "numeric" })
        );
      }

      // Get user registrations per day
      for (let i = days - 1; i >= 0; i--) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - i);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

        const userCount = await User.countDocuments({
          createdAt: { $gte: startDate, $lt: endDate },
        });
        chartData.userRegistrations.push(userCount);
      }

      // Get orders per day
      for (let i = days - 1; i >= 0; i--) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - i);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

        const orderCount = await Order.countDocuments({
          createdAt: { $gte: startDate, $lt: endDate },
        });
        chartData.orders.push(orderCount);
      }

      // Get revenue per day
      for (let i = days - 1; i >= 0; i--) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - i);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

        const revenue = await Order.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: startDate, $lt: endDate },
            },
          },
          { $group: { _id: null, total: { $sum: "$total" } } },
        ]);
        chartData.revenue.push(revenue[0]?.total || 0);
      }

      // Get order status distribution
      const orderStatusData = await Order.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);

      orderStatusData.forEach((item) => {
        if (item._id === "completed")
          chartData.orderStatus.completed = item.count;
        else if (item._id === "pending")
          chartData.orderStatus.pending = item.count;
        else if (item._id === "failed")
          chartData.orderStatus.failed = item.count;
      });

      // Get user type distribution
      const userTypeData = await User.aggregate([
        { $group: { _id: "$userType", count: { $sum: 1 } } },
      ]);

      userTypeData.forEach((item) => {
        if (item._id === "agent") chartData.userTypes.agents = item.count;
        else if (item._id === "customer")
          chartData.userTypes.customers = item.count;
        else if (item._id === "super_admin")
          chartData.userTypes.super_admins = item.count;
      });

      res.json({
        success: true,
        chartData,
      });
    } catch (error) {
      logger.error(`Get chart data error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get chart data",
      });
    }
  }

  // AFA Registration endpoint - Now uses bundles
  async afaRegistration(req, res) {
    try {
      const { fullName, phone, bundleId, ghanaCardNumber } = req.body;
      const userId = req.user.userId;

      // Validate required fields
      if (!fullName || !phone || !bundleId) {
        return res.status(400).json({
          success: false,
          message: "Full name, phone number, and bundle selection are required",
        });
      }

      // Validate phone number
      const phoneRegex = /^0\d{9}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({
          success: false,
          message: "Phone number must be 10 digits starting with 0",
        });
      }

      // Import required models
      const Order = (await import("../models/Order.js")).default;
      const User = (await import("../models/User.js")).default;
      const WalletTransaction = (await import("../models/WalletTransaction.js"))
        .default;
      const Bundle = (await import("../models/Bundle.js")).default;

      // Get the selected bundle
      const bundle = await Bundle.findById(bundleId).populate(
        "packageId providerId"
      );
      if (!bundle || !bundle.isActive || bundle.isDeleted) {
        return res.status(400).json({
          success: false,
          message: "Selected bundle is not available",
        });
      }

      // Verify bundle is for AFA provider
      if (!bundle.providerId || bundle.providerId.code !== "AFA") {
        return res.status(400).json({
          success: false,
          message: "Selected bundle is not an AFA bundle",
        });
      }

      // Check if Ghana Card is required
      if (bundle.requiresGhanaCard && !ghanaCardNumber) {
        return res.status(400).json({
          success: false,
          message: "Ghana Card number is required for this bundle",
        });
      }

      // Validate Ghana Card number if provided
      if (ghanaCardNumber) {
        const ghanaCardRegex = /^GHA-\d{9}-\d$/i;
        if (!ghanaCardRegex.test(ghanaCardNumber.toUpperCase())) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid Ghana Card number format. Must be in format GHA-XXXXXXXXX-X (9 digits in middle, 1 at end)",
          });
        }
      }

      // Get user and determine pricing
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Get price based on user type
      const fee = bundle.getPriceForUserType(user.userType || "default");

      // Determine order status based on wallet balance
      let orderStatus = "pending";
      let walletDeducted = false;

      if (user.walletBalance >= fee) {
        // Sufficient balance - deduct wallet
        user.walletBalance -= fee;
        await user.save();

        // Record wallet transaction
        const transaction = new WalletTransaction({
          user: userId,
          type: "debit",
          amount: fee,
          balanceAfter: user.walletBalance,
          description: `AFA Registration - ${bundle.name} for ${fullName}`,
          metadata: { orderType: "afa_registration", bundleId: bundle._id },
        });
        await transaction.save();

        walletDeducted = true;
      } else {
        // Insufficient balance - create as draft
        orderStatus = "draft";
      }

      // Create the AFA order
      const orderNumber = await generateSpecialOrderNumber("AFA");

      const order = new Order({
        orderNumber,
        orderType: "single",
        customerInfo: {
          name: fullName,
          phone: phone,
          ...(ghanaCardNumber && {
            ghanaCardNumber: ghanaCardNumber.toUpperCase(),
          }),
        },
        items: [
          {
            packageGroup: bundle.packageId._id,
            packageItem: bundle._id,
            packageDetails: {
              name: bundle.name,
              code: bundle.bundleCode || "AFA",
              price: fee,
              provider: "AFA",
              bundleDetails: {
                dataVolume: bundle.dataVolume,
                dataUnit: bundle.dataUnit,
                validity: bundle.validity,
                validityUnit: bundle.validityUnit,
                requiresGhanaCard: bundle.requiresGhanaCard,
              },
            },
            quantity: 1,
            unitPrice: fee,
            totalPrice: fee,
            customerPhone: phone,
            bundleSize: {
              value: bundle.dataVolume,
              unit: bundle.dataUnit,
            },
          },
        ],
        subtotal: fee,
        total: fee,
        status: orderStatus,
        paymentStatus: walletDeducted ? "paid" : "pending",
        paymentMethod: "wallet",
        tenantId: userId,
        createdBy: userId,
        notes: `AFA Registration - ${bundle.name} for ${fullName} (${phone})${
          ghanaCardNumber
            ? ` - Ghana Card: ${ghanaCardNumber.toUpperCase()}`
            : ""
        }`,
      });

      await order.save();

      logger.info(
        `AFA registration order created: ${order.orderNumber} for user: ${userId} using bundle: ${bundle.name}`
      );

      res.json({
        success: true,
        message: "AFA registration order created successfully",
        order: {
          orderNumber: order.orderNumber,
          totalAmount: order.total,
          status: order.status,
          customerName: order.customerInfo.name,
          customerPhone: order.customerInfo.phone,
          bundleName: bundle.name,
          requiresGhanaCard: bundle.requiresGhanaCard,
        },
      });
    } catch (error) {
      logger.error(`AFA registration error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "AFA registration failed. Please try again.",
      });
    }
  }

  // Get AFA orders for the user
  async getAfaRegistration(req, res) {
    try {
      const userId = req.user.userId;

      // Import Order model
      const Order = (await import("../models/Order.js")).default;

      // Get AFA orders for this user
      const afaOrders = await Order.find({
        tenantId: userId,
        "items.packageDetails.provider": "AFA",
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      const total = await Order.countDocuments({
        tenantId: userId,
        "items.packageDetails.provider": "AFA",
      });

      res.json({
        success: true,
        afaOrders: afaOrders || [],
        total: total || 0,
      });
    } catch (error) {
      logger.error(`Get AFA orders error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get AFA orders",
      });
    }
  }

  // Get available AFA bundles
  async getAfaBundles(req, res) {
    try {
      const Bundle = (await import("../models/Bundle.js")).default;
      const Provider = (await import("../models/Provider.js")).default;

      // Get AFA provider
      const afaProvider = await Provider.findOne({
        code: "AFA",
        isActive: true,
      });
      if (!afaProvider) {
        return res.status(404).json({
          success: false,
          message: "AFA provider not found or inactive",
        });
      }

      // Get active AFA bundles
      const afaBundles = await Bundle.find({
        providerId: afaProvider._id,
        isActive: true,
        isDeleted: false,
      })
        .populate("packageId", "name description")
        .sort({ createdAt: -1 })
        .lean();

      res.json({
        success: true,
        bundles: afaBundles || [],
      });
    } catch (error) {
      logger.error(`Get AFA bundles error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get AFA bundles",
      });
    }
  }
}

const userController = new UserController();
export default {
  getProfile: userController.getProfile.bind(userController),
  updateProfile: userController.updateProfile.bind(userController),
  changePassword: userController.changePassword.bind(userController),
  getUsers: userController.getUsers.bind(userController),
  getUsersWithWallet: userController.getUsersWithWallet.bind(userController),
  getUserById: userController.getUserById.bind(userController),
  updateUserStatus: userController.updateUserStatus.bind(userController),
  deleteUser: userController.deleteUser.bind(userController),
  getUserStats: userController.getUserStats.bind(userController),
  afaRegistration: userController.afaRegistration.bind(userController),
  getAfaRegistration: userController.getAfaRegistration.bind(userController),
  getAfaBundles: userController.getAfaBundles.bind(userController),
  getDashboardStats: userController.getDashboardStats.bind(userController),
  getChartData: userController.getChartData.bind(userController),
};
