// src/services/analyticsService.js
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import Settings from "../models/Settings.js";
import CommissionRecord from "../models/CommissionRecord.js";
import Provider from "../models/Provider.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";
import { getBusinessUserTypes } from "../utils/userTypeHelpers.js";

class AnalyticsService {
  /**
   * Get comprehensive analytics for super admin dashboard
   * @param {string} timeframe - Time period (7d, 30d, 90d, 365d)
   * @returns {Promise<Object>} Analytics data
   */
  async getSuperAdminAnalytics(timeframe = "30d") {
    try {
      const dateRange = this.getDateRange(timeframe);

      // Get user statistics
      const userStats = await this.getUserStatistics(dateRange);

      // Get order statistics
      const orderStats = await this.getOrderStatistics(dateRange);

      // Get revenue statistics
      const revenueStats = await this.getRevenueStatistics(dateRange);

      // Get wallet statistics
      const walletStats = await this.getWalletStatistics(dateRange);

      // Get provider statistics
      const providerStats = await this.getProviderStatistics();

      // Get commission statistics
      const commissionStats = await this.getCommissionStatistics(dateRange);

      // Get recent activity
      const recentActivity = await this.getRecentActivity();

      // Calculate rates
      const rates = await this.getRates();

      // Get chart data
      const chartData = await this.getChartData(timeframe);

      return {
        users: userStats,
        orders: orderStats,
        revenue: revenueStats,
        wallet: walletStats,
        providers: providerStats,
        commissions: commissionStats,
        recentActivity,
        rates,
        charts: chartData,
        timeframe,
        generatedAt: new Date(),
      };
    } catch (error) {
      logger.error(`Super admin analytics error: ${error.message}`);
      throw new Error("Failed to generate super admin analytics");
    }
  }

  /**
   * Get analytics for agent dashboard
   * @param {string} agentId - Agent user ID
   * @param {string} tenantId - Tenant ID
   * @param {string} timeframe - Time period
   * @returns {Promise<Object>} Agent analytics data
   */
  async getAgentAnalytics(agentId, tenantId, timeframe = "30d") {
    try {
      const dateRange = this.getDateRange(timeframe);

      // Get agent's order statistics
      const orderStats = await this.getAgentOrderStatistics(
        agentId,
        tenantId,
        dateRange
      );

      // Get agent's revenue statistics
      const revenueStats = await this.getAgentRevenueStatistics(
        agentId,
        tenantId,
        dateRange
      );

      // Get agent's commission data
      const commissionData = await this.getAgentCommissionData(
        agentId,
        tenantId,
        dateRange
      );

      // Get agent's wallet data
      const walletData = await this.getAgentWalletData(agentId);

      // Get agent's chart data
      const chartData = await this.getAgentChartData(
        agentId,
        tenantId,
        timeframe
      );

      return {
        orders: orderStats,
        revenue: revenueStats,
        commissions: commissionData,
        wallet: walletData,
        charts: chartData,
        timeframe,
        generatedAt: new Date(),
      };
    } catch (error) {
      logger.error(`Agent analytics error: ${error.message}`);
      throw new Error("Failed to generate agent analytics");
    }
  }

  /**
   * Get date range for analytics
   * @param {string} timeframe - Time period
   * @returns {Object} Date range object
   */
  getDateRange(timeframe) {
    const endDate = new Date();
    let startDate;

    switch (timeframe) {
      case "7d":
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "365d":
        startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate };
  }

  /**
   * Get user statistics
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} User statistics
   */
  async getUserStatistics(dateRange) {
    const { startDate, endDate } = dateRange;

    // Calculate this week range
    const now = new Date();
    const thisWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newUsersPeriod,
      newUsersThisWeek,
      activeAgents,
      verifiedUsers,
      userTypeStats,
    ] = await Promise.all([
      User.countDocuments({ isDeleted: { $ne: true } }),
      User.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate },
        isDeleted: { $ne: true },
      }),
      User.countDocuments({
        createdAt: { $gte: thisWeekStart, $lte: now },
        isDeleted: { $ne: true },
      }),
      User.countDocuments({
        userType: { $in: getBusinessUserTypes() },
        subscriptionStatus: "active",
        isDeleted: { $ne: true },
      }),
      User.countDocuments({ isVerified: true, isDeleted: { $ne: true } }),
      User.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: "$userType", count: { $sum: 1 } } },
      ]),
    ]);

    const userTypeMap = {};
    userTypeStats.forEach((stat) => {
      userTypeMap[stat._id] = stat.count;
    });

    return {
      total: totalUsers,
      newThisPeriod: newUsersPeriod,
      newThisWeek: newUsersThisWeek,
      activeAgents,
      verified: verifiedUsers,
      unverified: totalUsers - verifiedUsers,
      byType: {
        agents: userTypeMap.agent || 0,
        customers: userTypeMap.customer || 0,
        super_admins: userTypeMap.super_admin || 0,
      },
    };
  }

  /**
   * Get order statistics
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Order statistics
   */
  async getOrderStatistics(dateRange) {
    const { startDate, endDate } = dateRange;

    // Calculate today's range
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // Calculate this month's range
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [periodStats, todayStats, thisMonthStats] = await Promise.all([
      // Period stats (existing logic)
      Order.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            processing: {
              $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
            bulk: { $sum: { $cond: [{ $eq: ["$orderType", "bulk"] }, 1, 0] } },
            single: {
              $sum: { $cond: [{ $eq: ["$orderType", "single"] }, 1, 0] },
            },
          },
        },
      ]),
      // Today's stats
      Order.aggregate([
        { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            processing: {
              $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
          },
        },
      ]),
      // This month's stats
      Order.aggregate([
        { $match: { createdAt: { $gte: thisMonthStart, $lte: thisMonthEnd } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            processing: {
              $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const periodData = periodStats[0] || {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      cancelled: 0,
      bulk: 0,
      single: 0,
    };

    const todayData = todayStats[0] || {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      cancelled: 0,
    };

    const monthData = thisMonthStats[0] || {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      cancelled: 0,
    };

    const successRate =
      periodData.total > 0
        ? (periodData.completed / periodData.total) * 100
        : 0;

    return {
      total: periodData.total,
      completed: periodData.completed,
      pending: periodData.pending,
      processing: periodData.processing,
      failed: periodData.failed,
      cancelled: periodData.cancelled,
      successRate: Math.round(successRate * 100) / 100,
      today: {
        total: todayData.total,
        completed: todayData.completed,
        pending: todayData.pending,
        processing: todayData.processing,
        failed: todayData.failed,
        cancelled: todayData.cancelled,
      },
      thisMonth: {
        total: monthData.total,
        completed: monthData.completed,
        pending: monthData.pending,
        processing: monthData.processing,
        failed: monthData.failed,
        cancelled: monthData.cancelled,
      },
      byType: {
        bulk: periodData.bulk,
        single: periodData.single,
      },
    };
  }

  /**
   * Get revenue statistics
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Revenue statistics
   */
  async getRevenueStatistics(dateRange) {
    const { startDate, endDate } = dateRange;

    // Calculate this month range
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Calculate today's range
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const [totalRevenueStats, thisMonthRevenueStats, todayRevenueStats] =
      await Promise.all([
        Order.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$total" },
              count: { $sum: 1 },
            },
          },
        ]),
        Order.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: thisMonthStart, $lte: thisMonthEnd },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$total" },
              count: { $sum: 1 },
            },
          },
        ]),
        Order.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: todayStart, $lte: todayEnd },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$total" },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

    const totalStats = totalRevenueStats[0] || { total: 0, count: 0 };
    const monthStats = thisMonthRevenueStats[0] || { total: 0, count: 0 };
    const todayStats = todayRevenueStats[0] || { total: 0, count: 0 };
    const averageOrderValue =
      totalStats.count > 0 ? totalStats.total / totalStats.count : 0;

    return {
      total: totalStats.total,
      thisMonth: monthStats.total,
      today: todayStats.total,
      orderCount: totalStats.count,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
    };
  }

  /**
   * Get wallet statistics
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Wallet statistics
   */
  async getWalletStatistics(dateRange) {
    const { startDate, endDate } = dateRange;

    const [transactionStats, totalBalance] = await Promise.all([
      WalletTransaction.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: "$type",
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      User.aggregate([
        { $group: { _id: null, total: { $sum: "$walletBalance" } } },
      ]),
    ]);

    const transactionMap = {};
    transactionStats.forEach((stat) => {
      transactionMap[stat._id] = { amount: stat.amount, count: stat.count };
    });

    return {
      totalBalance: totalBalance[0]?.total || 0,
      transactions: {
        credits: transactionMap.credit || { amount: 0, count: 0 },
        debits: transactionMap.debit || { amount: 0, count: 0 },
      },
    };
  }

  /**
   * Get provider statistics
   * @returns {Promise<Object>} Provider statistics
   */
  async getProviderStatistics() {
    try {
      const currentDate = new Date();
      const thisMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );

      const [totalProviders, activeProviders, newProvidersThisMonth] =
        await Promise.all([
          Provider.countDocuments({ isDeleted: { $ne: true } }),
          Provider.countDocuments({ isActive: true, isDeleted: { $ne: true } }),
          Provider.countDocuments({
            createdAt: { $gte: thisMonth },
            isDeleted: { $ne: true },
          }),
        ]);

      return {
        total: totalProviders,
        active: activeProviders,
        newThisMonth: newProvidersThisMonth,
      };
    } catch (error) {
      logger.error(`Provider statistics error: ${error.message}`);
      return {
        total: 0,
        active: 0,
        newThisMonth: 0,
      };
    }
  }

  /**
   * Get recent activity data
   * @returns {Promise<Object>} Recent activity data
   */
  async getRecentActivity() {
    try {
      const [recentUsers, recentOrders, recentTransactions] = await Promise.all(
        [
          User.find({ isDeleted: { $ne: true } })
            .select(
              "fullName email userType createdAt status subscriptionStatus"
            )
            .sort({ createdAt: -1 })
            .limit(5),
          Order.find()
            .select("orderNumber total status createdAt orderType")
            .sort({ createdAt: -1 })
            .limit(5),
          WalletTransaction.find()
            .select("amount type description createdAt")
            .sort({ createdAt: -1 })
            .limit(5),
        ]
      );

      return {
        users: recentUsers,
        orders: recentOrders,
        transactions: recentTransactions,
      };
    } catch (error) {
      logger.error(`Recent activity error: ${error.message}`);
      return {
        users: [],
        orders: [],
        transactions: [],
      };
    }
  }

  /**
   * Get rates and percentages
   * @returns {Promise<Object>} Rates data
   */
  async getRates() {
    try {
      const [
        totalUsers,
        verifiedUsers,
        totalAgents,
        activeAgents,
        totalOrders,
        completedOrders,
      ] = await Promise.all([
        User.countDocuments({ isDeleted: { $ne: true } }),
        User.countDocuments({ isVerified: true, isDeleted: { $ne: true } }),
        User.countDocuments({
          userType: { $in: getBusinessUserTypes() },
          isDeleted: { $ne: true },
        }),
        User.countDocuments({
          userType: { $in: getBusinessUserTypes() },
          subscriptionStatus: "active",
          isDeleted: { $ne: true },
        }),
        Order.countDocuments(),
        Order.countDocuments({ status: "completed" }),
      ]);

      const userVerification =
        totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0;
      const agentActivation =
        totalAgents > 0 ? Math.round((activeAgents / totalAgents) * 100) : 0;
      const orderSuccess =
        totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;

      return {
        userVerification,
        agentActivation,
        orderSuccess,
      };
    } catch (error) {
      logger.error(`Rates calculation error: ${error.message}`);
      return {
        userVerification: 0,
        agentActivation: 0,
        orderSuccess: 0,
      };
    }
  }

  /**
   * Get commission statistics
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Commission statistics
   */
  async getCommissionStatistics(dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      // Get commission records
      const commissionRecords = await CommissionRecord.find({
        createdAt: { $gte: startDate, $lte: endDate },
      });

      const totalCommission = commissionRecords.reduce(
        (sum, record) => sum + (record.amount || 0),
        0
      );
      const totalRecords = commissionRecords.length;

      // Get pending commissions
      const pendingCommissions = commissionRecords.filter(
        (record) => record.status === "pending"
      );

      return {
        totalPaid: totalCommission,
        totalRecords,
        pendingCount: pendingCommissions.length,
        pendingAmount: pendingCommissions.reduce(
          (sum, record) => sum + (record.amount || 0),
          0
        ),
      };
    } catch (error) {
      logger.error(`Commission statistics error: ${error.message}`);
      return {
        totalPaid: 0,
        totalRecords: 0,
        pendingCount: 0,
        pendingAmount: 0,
      };
    }
  }

  /**
   * Get chart data for super admin
   * @param {string} timeframe - Time period
   * @returns {Promise<Object>} Chart data
   */
  async getChartData(timeframe) {
    const dateRange = this.getDateRange(timeframe);
    const { startDate, endDate } = dateRange;

    // Get daily order and revenue data
    const dailyData = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          orders: { $sum: 1 },
          revenue: { $sum: "$total" },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get user registration data
    const userData = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          registrations: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get order status distribution
    const statusData = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statusMap = {};
    statusData.forEach((stat) => {
      statusMap[stat._id] = stat.count;
    });

    return {
      labels: dailyData.map((d) => d._id),
      orders: dailyData.map((d) => d.orders),
      revenue: dailyData.map((d) => d.revenue),
      completedOrders: dailyData.map((d) => d.completedOrders),
      userRegistrations: userData.map((d) => d.registrations),
      orderStatus: {
        completed: statusMap.completed || 0,
        pending: statusMap.pending || 0,
        processing: statusMap.processing || 0,
        failed: statusMap.failed || 0,
        cancelled: statusMap.cancelled || 0,
      },
    };
  }

  /**
   * Get agent order statistics
   * @param {string} agentId - Agent ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Agent order statistics
   */
  async getAgentOrderStatistics(agentId, tenantId, dateRange) {
    const { startDate, endDate } = dateRange;

    // Calculate today's range
    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const todayEnd = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    );

    const [periodStats, todayStats] = await Promise.all([
      // Period stats
      Order.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(agentId),
            tenantId: new mongoose.Types.ObjectId(tenantId),
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            processing: {
              $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
          },
        },
      ]),
      // Today's stats
      Order.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(agentId),
            tenantId: new mongoose.Types.ObjectId(tenantId),
            createdAt: { $gte: todayStart, $lte: todayEnd },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            processing: {
              $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const periodData = periodStats[0] || {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      cancelled: 0,
    };

    const todayData = todayStats[0] || {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      cancelled: 0,
    };

    const successRate =
      periodData.total > 0
        ? (periodData.completed / periodData.total) * 100
        : 0;

    return {
      total: periodData.total,
      completed: periodData.completed,
      pending: periodData.pending,
      processing: periodData.processing,
      failed: periodData.failed,
      cancelled: periodData.cancelled,
      successRate: Math.round(successRate * 100) / 100,
      todayCounts: {
        total: todayData.total,
        completed: todayData.completed,
        pending: todayData.pending,
        processing: todayData.processing,
        failed: todayData.failed,
        cancelled: todayData.cancelled,
      },
    };
  }

  /**
   * Get agent revenue statistics
   * @param {string} agentId - Agent ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Agent revenue statistics
   */
  async getAgentRevenueStatistics(agentId, tenantId, dateRange) {
    const { startDate, endDate } = dateRange;

    // Calculate today's range
    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const todayEnd = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    );

    // Calculate this month's range
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    const [periodStats, todayStats, monthStats] = await Promise.all([
      Order.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(agentId),
            tenantId: new mongoose.Types.ObjectId(tenantId),
            status: "completed",
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$total" },
            count: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(agentId),
            tenantId: new mongoose.Types.ObjectId(tenantId),
            status: "completed",
            createdAt: { $gte: todayStart, $lte: todayEnd },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$total" },
            count: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(agentId),
            tenantId: new mongoose.Types.ObjectId(tenantId),
            status: "completed",
            createdAt: { $gte: thisMonthStart, $lte: thisMonthEnd },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$total" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const periodData = periodStats[0] || { total: 0, count: 0 };
    const todayData = todayStats[0] || { total: 0, count: 0 };
    const monthData = monthStats[0] || { total: 0, count: 0 };
    const averageOrderValue =
      periodData.count > 0 ? periodData.total / periodData.count : 0;

    return {
      total: periodData.total,
      thisMonth: monthData.total,
      today: todayData.total,
      orderCount: periodData.count,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
    };
  }

  /**
   * Get agent commission data
   * @param {string} agentId - Agent ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Agent commission data
   */
  async getAgentCommissionData(agentId, tenantId, dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      // Get commission settings
      const settings = await Settings.getInstance();
      const commissionRate = settings.agentCommission || 5.0;

      // Get agent's completed orders for the period
      const completedOrders = await Order.find({
        createdBy: agentId,
        tenantId: tenantId,
        status: "completed",
        createdAt: { $gte: startDate, $lte: endDate },
      });

      const totalRevenue = completedOrders.reduce(
        (sum, order) => sum + order.total,
        0
      );
      const commissionAmount = (totalRevenue * commissionRate) / 100;

      // Get commission records for this agent
      const commissionRecords = await CommissionRecord.find({
        agentId: agentId,
        createdAt: { $gte: startDate, $lte: endDate },
      });

      const paidCommission = commissionRecords
        .filter((record) => record.status === "paid")
        .reduce((sum, record) => sum + (record.amount || 0), 0);

      const pendingCommission = commissionRecords
        .filter((record) => record.status === "pending")
        .reduce((sum, record) => sum + (record.amount || 0), 0);

      return {
        rate: commissionRate,
        earned: commissionAmount,
        paid: paidCommission,
        pending: pendingCommission,
        totalOrders: completedOrders.length,
        totalRevenue: totalRevenue,
      };
    } catch (error) {
      logger.error(`Agent commission data error: ${error.message}`);
      return {
        rate: 5.0,
        earned: 0,
        paid: 0,
        pending: 0,
        totalOrders: 0,
        totalRevenue: 0,
      };
    }
  }

  /**
   * Get agent wallet data
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Agent wallet data
   */
  async getAgentWalletData(agentId) {
    try {
      const user = await User.findById(agentId).select("walletBalance");
      return {
        balance: user?.walletBalance || 0,
      };
    } catch (error) {
      logger.error(`Agent wallet data error: ${error.message}`);
      return { balance: 0 };
    }
  }

  /**
   * Get agent chart data
   * @param {string} agentId - Agent ID
   * @param {string} tenantId - Tenant ID
   * @param {string} timeframe - Time period
   * @returns {Promise<Object>} Agent chart data
   */
  async getAgentChartData(agentId, tenantId, timeframe) {
    const dateRange = this.getDateRange(timeframe);
    const { startDate, endDate } = dateRange;

    const dailyData = await Order.aggregate([
      {
        $match: {
          createdBy: new mongoose.Types.ObjectId(agentId),
          tenantId: new mongoose.Types.ObjectId(tenantId),
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          orders: { $sum: 1 },
          revenue: { $sum: "$total" },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      labels: dailyData.map((d) => d._id),
      orders: dailyData.map((d) => d.orders),
      revenue: dailyData.map((d) => d.revenue),
      completedOrders: dailyData.map((d) => d.completedOrders),
    };
  }
}

export default new AnalyticsService();
