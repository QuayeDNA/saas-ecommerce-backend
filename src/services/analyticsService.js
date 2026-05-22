// src/services/analyticsService.js
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import Provider from "../models/Provider.js";
import PayoutRequest from "../models/PayoutRequest.js";
import EarningsTransaction from "../models/EarningsTransaction.js";
import Commission from "../models/Commission.js";
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
      const previousDateRange = this.getPreviousDateRange(dateRange);

      const [
        userStats,
        orderStats,
        revenueStats,
        walletStats,
        providerStats,
        recentActivity,
        rates,
        chartData,
        payoutStats,
        topPerformers,
        growth,
        earnings,
        referralStats,
        commissionTrends,
      ] = await Promise.all([
        this.getUserStatistics(dateRange),
        this.getOrderStatistics(dateRange),
        this.getRevenueStatistics(dateRange),
        this.getWalletStatistics(dateRange),
        this.getProviderStatistics(),
        this.getRecentActivity(),
        this.getRates(),
        this.getChartData(timeframe),
        this.getPayoutStatistics(dateRange),
        this.getTopPerformers(dateRange),
        this.getGrowthStatistics(dateRange, previousDateRange),
        this.getEarningsStatistics(dateRange),
        this.getReferralStatistics(dateRange),
        this.getCommissionTrends(dateRange),
      ]);

      const overview = {
        totalUsers: userStats.total,
        totalOrders: orderStats.total,
        totalRevenue: revenueStats.total,
        totalWalletBalance: walletStats.totalBalance,
        activeProviders: providerStats.active,
        payoutLiability: payoutStats.pendingLiability,
        pendingPayouts:
          (payoutStats.byStatus.pending || 0) +
          (payoutStats.byStatus.approved || 0) +
          (payoutStats.byStatus.processing || 0),
      };

      const breakdowns = {
        userTypes: userStats.byType,
        orderStatuses: {
          completed: orderStats.completed,
          pending: orderStats.pending,
          processing: orderStats.processing,
          confirmed: orderStats.confirmed,
          failed: orderStats.failed,
          cancelled: orderStats.cancelled,
          partiallyCompleted: orderStats.partiallyCompleted,
        },
        payoutStatuses: payoutStats.byStatus,
      };

      const activityFeed = this.buildActivityFeed(recentActivity);

      const insights = this.generateSuperAdminInsights({
        orderStats,
        payoutStats,
        walletStats,
        rates,
        growth,
      });

      const result = {
        users: userStats,
        orders: orderStats,
        revenue: revenueStats,
        wallet: walletStats,
        providers: providerStats,
        payouts: payoutStats,
        earnings,
        referral: referralStats,
        commissionTrends,
        recentActivity,
        rates,
        charts: chartData,
        growth,
        overview,
        breakdowns,
        topPerformers,
        activityFeed,
        insights,
        centralizedSource: true,
        scope: "super_admin",
        source: "analytics-service-v2",
        timeframe,
        generatedAt: new Date(),
      };

      return result;
    } catch (error) {
      logger.error(`Super admin analytics error: ${error.message}`);
      throw new Error("Failed to generate super admin analytics");
    }
  }

  /**
   * Centralized analytics source with user-scoped payloads.
   * This method is intentionally role-aware so future dashboards can consume
   * one endpoint and request only a section when needed.
   * @param {{ userId: string, userType: string, tenantId?: string }} userContext
   * @param {string} timeframe
   * @param {string} scope
   * @returns {Promise<Object>}
   */
  async getCentralizedAnalytics(userContext, timeframe = "30d", scope = "all") {
    const { userId, userType, tenantId } = userContext;

    const fullData =
      userType === "super_admin"
        ? await this.getSuperAdminAnalytics(timeframe)
        : await this.getAgentAnalytics(userId, tenantId, timeframe);

    return {
      actor: {
        userId,
        userType,
        tenantId: tenantId || userId,
      },
      timeframe,
      scope,
      generatedAt: new Date(),
      source: "centralized-analytics-v1",
      data: this.getScopedAnalyticsData(fullData, scope),
    };
  }

  /**
   * Slice analytics payload by requested scope.
   * @param {Object} payload
   * @param {string} scope
   * @returns {Object}
   */
  getScopedAnalyticsData(payload, scope = "all") {
    if (!scope || scope === "all") {
      return payload;
    }

    if (Object.prototype.hasOwnProperty.call(payload, scope)) {
      return { [scope]: payload[scope] };
    }

    const groupedScopes = {
      overview: ["overview", "growth", "rates"],
      trends: ["charts", "growth"],
      breakdowns: ["breakdowns", "orders", "users", "payouts"],
      activity: ["recentActivity", "activityFeed"],
      financial: ["revenue", "wallet", "payouts", "earnings"],
      performance: ["topPerformers", "orders", "providers", "rates"],
      users: ["users"],
      orders: ["orders"],
    };

    const keys = groupedScopes[scope];
    if (!keys) {
      return payload;
    }

    return keys.reduce((acc, key) => {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        acc[key] = payload[key];
      }
      return acc;
    }, {});
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
      logger.debug(
        `Generating agent analytics for agent ${agentId}, timeframe ${timeframe}`,
      );

      const dateRange = this.getDateRange(timeframe);

      // Get agent's user statistics
      const userStats = await this.getAgentUserStatistics(agentId, dateRange);

      // Get agent's order statistics
      const orderStats = await this.getAgentOrderStatistics(
        agentId,
        tenantId,
        dateRange,
      );

      // Get agent's revenue statistics
      const revenueStats = await this.getAgentRevenueStatistics(
        agentId,
        tenantId,
        dateRange,
      );

      // Get agent's wallet statistics
      const walletStats = await this.getAgentWalletStatistics(agentId);

      // Get agent's recent activity
      const recentActivity = await this.getAgentRecentActivity(agentId);

      // Get agent's chart data
      const chartData = await this.getAgentChartData(
        agentId,
        tenantId,
        timeframe,
      );

      const result = {
        users: userStats,
        orders: orderStats,
        revenue: revenueStats,
        wallet: walletStats,
        recentActivity,
        charts: chartData,
        timeframe,
        generatedAt: new Date(),
      };

      logger.debug(
        `Agent analytics generated for agent ${agentId}, timeframe ${timeframe}`,
      );

      return result;
    } catch (error) {
      logger.error(`Agent analytics error for ${agentId}: ${error.message}`);
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
      case "0d":
      case "today":
        startDate = new Date(endDate);
        startDate.setHours(0, 0, 0, 0);
        break;
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
      case "all":
        startDate = new Date("2020-01-01T00:00:00Z");
        break;
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate };
  }

  /**
   * Get previous period date range for growth comparisons
   * @param {Object} dateRange - Current date range
   * @returns {Object} Previous period range
   */
  getPreviousDateRange(dateRange) {
    const { startDate, endDate } = dateRange;
    const durationMs = endDate.getTime() - startDate.getTime();
    const previousEndDate = new Date(startDate.getTime() - 1);
    const previousStartDate = new Date(previousEndDate.getTime() - durationMs);
    return { startDate: previousStartDate, endDate: previousEndDate };
  }

  /**
   * Calculate growth percentage between current and previous values
   * @param {number} currentValue
   * @param {number} previousValue
   * @returns {{percent: number, trend: string}}
   */
  calculateGrowth(currentValue, previousValue) {
    if (previousValue === 0) {
      return {
        percent: currentValue > 0 ? 100 : 0,
        trend: currentValue > 0 ? "up" : "flat",
      };
    }

    const percent =
      Math.round(((currentValue - previousValue) / previousValue) * 100 * 100) /
      100;

    if (percent > 0) return { percent, trend: "up" };
    if (percent < 0) return { percent, trend: "down" };
    return { percent: 0, trend: "flat" };
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

    // Build dynamic byType object with all user types
    const byType = {};
    const allUserTypes = [
      "agent",
      "super_agent",
      "dealer",
      "super_dealer",
      "super_admin",
    ];

    allUserTypes.forEach((userType) => {
      // Convert user type to plural for display (e.g., agent -> agents)
      const pluralKey =
        userType === "super_admin" ? "super_admins" : `${userType}s`;
      byType[pluralKey] = userTypeMap[userType] || 0;
    });

    return {
      total: totalUsers,
      newThisPeriod: newUsersPeriod,
      newThisWeek: newUsersThisWeek,
      activeAgents,
      verified: verifiedUsers,
      unverified: totalUsers - verifiedUsers,
      byType,
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
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // Calculate this month's range
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [allTimeStats, todayStats, thisMonthStats] = await Promise.all([
      // ALL TIME stats (not limited by date range) — exclude draft/pending_payment
      Order.aggregate([
        { $match: { status: { $nin: ["draft", "pending_payment"] } } },
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
            confirmed: {
              $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
            partiallyCompleted: {
              $sum: {
                $cond: [{ $eq: ["$status", "partially_completed"] }, 1, 0],
              },
            },
            bulk: { $sum: { $cond: [{ $eq: ["$orderType", "bulk"] }, 1, 0] } },
            single: {
              $sum: { $cond: [{ $eq: ["$orderType", "single"] }, 1, 0] },
            },
            regular: {
              $sum: { $cond: [{ $eq: ["$orderType", "regular"] }, 1, 0] },
            },
            storefront: {
              $sum: { $cond: [{ $eq: ["$orderType", "storefront"] }, 1, 0] },
            },
          },
        },
      ]),
      // Today's stats
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: todayStart, $lte: todayEnd },
            status: { $nin: ["draft", "pending_payment"] },
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
            confirmed: {
              $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
            partiallyCompleted: {
              $sum: {
                $cond: [{ $eq: ["$status", "partially_completed"] }, 1, 0],
              },
            },
          },
        },
      ]),
      // This month's stats
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: thisMonthStart, $lte: thisMonthEnd },
            status: { $nin: ["draft", "pending_payment"] },
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
            confirmed: {
              $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
            partiallyCompleted: {
              $sum: {
                $cond: [{ $eq: ["$status", "partially_completed"] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const allTimeData = allTimeStats[0] || {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      confirmed: 0,
      failed: 0,
      cancelled: 0,
      partiallyCompleted: 0,
      bulk: 0,
      single: 0,
      regular: 0,
      storefront: 0,
    };

    const todayData = todayStats[0] || {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      confirmed: 0,
      failed: 0,
      cancelled: 0,
      partiallyCompleted: 0,
    };

    const monthData = thisMonthStats[0] || {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      confirmed: 0,
      failed: 0,
      cancelled: 0,
      partiallyCompleted: 0,
    };

    const successRate =
      allTimeData.total > 0
        ? (allTimeData.completed / allTimeData.total) * 100
        : 0;

    return {
      total: allTimeData.total,
      completed: allTimeData.completed,
      pending: allTimeData.pending,
      processing: allTimeData.processing,
      confirmed: allTimeData.confirmed,
      failed: allTimeData.failed,
      cancelled: allTimeData.cancelled,
      partiallyCompleted: allTimeData.partiallyCompleted,
      successRate: Math.round(successRate * 100) / 100,
      today: {
        total: todayData.total,
        completed: todayData.completed,
        pending: todayData.pending,
        processing: todayData.processing,
        confirmed: todayData.confirmed,
        failed: todayData.failed,
        cancelled: todayData.cancelled,
        partiallyCompleted: todayData.partiallyCompleted,
      },
      thisMonth: {
        total: monthData.total,
        completed: monthData.completed,
        pending: monthData.pending,
        processing: monthData.processing,
        confirmed: monthData.confirmed,
        failed: monthData.failed,
        cancelled: monthData.cancelled,
        partiallyCompleted: monthData.partiallyCompleted,
      },
      byType: {
        bulk: allTimeData.bulk,
        single: allTimeData.single,
        regular: allTimeData.regular,
        storefront: allTimeData.storefront,
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
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const [allTimeRevenueStats, thisMonthRevenueStats, todayRevenueStats] =
      await Promise.all([
        // ALL TIME revenue (not limited by date range)
        Order.aggregate([
          {
            $match: {
              status: "completed",
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

    const allTimeStats = allTimeRevenueStats[0] || { total: 0, count: 0 };
    const monthStats = thisMonthRevenueStats[0] || { total: 0, count: 0 };
    const todayStats = todayRevenueStats[0] || { total: 0, count: 0 };
    const averageOrderValue =
      allTimeStats.count > 0 ? allTimeStats.total / allTimeStats.count : 0;

    return {
      total: allTimeStats.total,
      thisMonth: monthStats.total,
      today: todayStats.total,
      orderCount: allTimeStats.count,
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
        1,
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
      const [
        recentUsers,
        recentOrders,
        recentTransactions,
        recentPayouts,
      ] = await Promise.all([
        User.find({ isDeleted: { $ne: true } })
          .select("fullName email userType createdAt status subscriptionStatus")
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        Order.find()
          .select("orderNumber total status createdAt orderType")
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        WalletTransaction.find()
          .select("amount type description createdAt")
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        PayoutRequest.find()
          .select("amount status createdAt destination.type")
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
      ]);

      return {
        users: recentUsers,
        orders: recentOrders,
        transactions: recentTransactions,
        payouts: recentPayouts,
      };
    } catch (error) {
      logger.error(`Recent activity error: ${error.message}`);
      return {
        users: [],
        orders: [],
        transactions: [],
        payouts: [],
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
   * Get payout statistics for strategy and risk visibility
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Payout statistics
   */
  async getPayoutStatistics(dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      const [
        periodAggregation,
        allTimeCount,
        allTimeAmountAggregation,
        pendingLiabilityAggregation,
        destinationAggregation,
      ] = await Promise.all([
        PayoutRequest.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalAmount: { $sum: "$amount" },
              pendingCount: {
                $sum: {
                  $cond: [{ $eq: ["$status", "pending"] }, 1, 0],
                },
              },
              approvedCount: {
                $sum: {
                  $cond: [{ $eq: ["$status", "approved"] }, 1, 0],
                },
              },
              processingCount: {
                $sum: {
                  $cond: [{ $eq: ["$status", "processing"] }, 1, 0],
                },
              },
              completedCount: {
                $sum: {
                  $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
                },
              },
              rejectedCount: {
                $sum: {
                  $cond: [{ $eq: ["$status", "rejected"] }, 1, 0],
                },
              },
              failedCount: {
                $sum: {
                  $cond: [{ $eq: ["$status", "failed"] }, 1, 0],
                },
              },
            },
          },
        ]),
        PayoutRequest.countDocuments(),
        PayoutRequest.aggregate([
          {
            $group: {
              _id: null,
              totalAmount: { $sum: "$amount" },
            },
          },
        ]),
        PayoutRequest.aggregate([
          {
            $match: {
              status: { $in: ["pending", "approved", "processing"] },
            },
          },
          {
            $group: {
              _id: null,
              pendingLiability: { $sum: "$amount" },
              queuedCount: { $sum: 1 },
            },
          },
        ]),
        PayoutRequest.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: "$destination.type",
              count: { $sum: 1 },
              amount: { $sum: "$amount" },
            },
          },
        ]),
      ]);

      const period = periodAggregation[0] || {
        count: 0,
        totalAmount: 0,
        pendingCount: 0,
        approvedCount: 0,
        processingCount: 0,
        completedCount: 0,
        rejectedCount: 0,
        failedCount: 0,
      };

      const completionRate =
        period.count > 0
          ? Math.round((period.completedCount / period.count) * 10000) / 100
          : 0;

      const byDestination = {
        mobile_money: { count: 0, amount: 0 },
        bank_account: { count: 0, amount: 0 },
      };

      destinationAggregation.forEach((row) => {
        if (row._id && byDestination[row._id]) {
          byDestination[row._id] = { count: row.count, amount: row.amount };
        }
      });

      return {
        totalRequests: allTimeCount,
        totalAmountAllTime: allTimeAmountAggregation[0]?.totalAmount || 0,
        thisPeriod: {
          count: period.count,
          amount: period.totalAmount,
        },
        byStatus: {
          pending: period.pendingCount,
          approved: period.approvedCount,
          processing: period.processingCount,
          completed: period.completedCount,
          failed: period.failedCount,
          rejected: period.rejectedCount,
        },
        completionRate,
        pendingLiability: pendingLiabilityAggregation[0]?.pendingLiability || 0,
        queuedCount: pendingLiabilityAggregation[0]?.queuedCount || 0,
        byDestination,
      };
    } catch (error) {
      logger.error(`Payout statistics error: ${error.message}`);
      return {
        totalRequests: 0,
        totalAmountAllTime: 0,
        thisPeriod: {
          count: 0,
          amount: 0,
        },
        byStatus: {
          pending: 0,
          approved: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          rejected: 0,
        },
        completionRate: 0,
        pendingLiability: 0,
        queuedCount: 0,
        byDestination: {
          mobile_money: { count: 0, amount: 0 },
          bank_account: { count: 0, amount: 0 },
        },
      };
    }
  }

  /**
   * Get earnings ledger statistics
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Earnings statistics
   */
  async getEarningsStatistics(dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      const [periodRows, allTimeRows] = await Promise.all([
        EarningsTransaction.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: "$type",
              amount: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]),
        EarningsTransaction.aggregate([
          {
            $group: {
              _id: "$type",
              amount: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const toMap = (rows) => {
        const map = {
          credit: { amount: 0, count: 0 },
          debit: { amount: 0, count: 0 },
          payout: { amount: 0, count: 0 },
        };
        rows.forEach((row) => {
          if (row._id && map[row._id]) {
            map[row._id] = { amount: row.amount, count: row.count };
          }
        });
        return map;
      };

      const period = toMap(periodRows);
      const allTime = toMap(allTimeRows);

      const normalizeOutflow = (value) => Math.abs(value || 0);

      return {
        period: {
          credits: period.credit,
          debits: {
            amount: normalizeOutflow(period.debit.amount),
            count: period.debit.count,
          },
          payouts: {
            amount: normalizeOutflow(period.payout.amount),
            count: period.payout.count,
          },
          netFlow:
            (period.credit.amount || 0) -
            normalizeOutflow(period.debit.amount) -
            normalizeOutflow(period.payout.amount),
        },
        allTime: {
          credits: allTime.credit,
          debits: {
            amount: normalizeOutflow(allTime.debit.amount),
            count: allTime.debit.count,
          },
          payouts: {
            amount: normalizeOutflow(allTime.payout.amount),
            count: allTime.payout.count,
          },
          netFlow:
            (allTime.credit.amount || 0) -
            normalizeOutflow(allTime.debit.amount) -
            normalizeOutflow(allTime.payout.amount),
        },
      };
    } catch (error) {
      logger.error(`Earnings statistics error: ${error.message}`);
      return {
        period: {
          credits: { amount: 0, count: 0 },
          debits: { amount: 0, count: 0 },
          payouts: { amount: 0, count: 0 },
          netFlow: 0,
        },
        allTime: {
          credits: { amount: 0, count: 0 },
          debits: { amount: 0, count: 0 },
          payouts: { amount: 0, count: 0 },
          netFlow: 0,
        },
      };
    }
  }

  /**
   * Get growth statistics against previous period
   * @param {Object} dateRange - Current range
   * @param {Object} previousDateRange - Previous range
   * @returns {Promise<Object>} Growth metrics
   */
  async getGrowthStatistics(dateRange, previousDateRange) {
    const currentOrderMatch = {
      createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
      status: { $nin: ["draft", "pending_payment"] },
    };

    const previousOrderMatch = {
      createdAt: {
        $gte: previousDateRange.startDate,
        $lte: previousDateRange.endDate,
      },
      status: { $nin: ["draft", "pending_payment"] },
    };

    const [
      currentUsers,
      previousUsers,
      currentOrders,
      previousOrders,
      currentRevenueRows,
      previousRevenueRows,
      currentPayoutRows,
      previousPayoutRows,
    ] = await Promise.all([
      User.countDocuments({
        createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
      }),
      User.countDocuments({
        createdAt: {
          $gte: previousDateRange.startDate,
          $lte: previousDateRange.endDate,
        },
      }),
      Order.countDocuments(currentOrderMatch),
      Order.countDocuments(previousOrderMatch),
      Order.aggregate([
        { $match: { ...currentOrderMatch, status: "completed" } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      Order.aggregate([
        { $match: { ...previousOrderMatch, status: "completed" } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      PayoutRequest.aggregate([
        {
          $match: {
            createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      PayoutRequest.aggregate([
        {
          $match: {
            createdAt: {
              $gte: previousDateRange.startDate,
              $lte: previousDateRange.endDate,
            },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const currentRevenue = currentRevenueRows[0]?.total || 0;
    const previousRevenue = previousRevenueRows[0]?.total || 0;
    const currentPayoutAmount = currentPayoutRows[0]?.total || 0;
    const previousPayoutAmount = previousPayoutRows[0]?.total || 0;
    return {
      users: {
        current: currentUsers,
        previous: previousUsers,
        ...this.calculateGrowth(currentUsers, previousUsers),
      },
      orders: {
        current: currentOrders,
        previous: previousOrders,
        ...this.calculateGrowth(currentOrders, previousOrders),
      },
      revenue: {
        current: currentRevenue,
        previous: previousRevenue,
        ...this.calculateGrowth(currentRevenue, previousRevenue),
      },
      payouts: {
        current: currentPayoutAmount,
        previous: previousPayoutAmount,
        ...this.calculateGrowth(currentPayoutAmount, previousPayoutAmount),
      },
    };
  }

  /**
   * Get top performers for strategic dashboards
   * @param {Object} dateRange - Date range
   * @returns {Promise<Object>} Top performer data
   */
  async getTopPerformers(dateRange) {
    try {
      const { startDate, endDate } = dateRange;
      const maxPerformers = 1000;
      const requiredTopAgents = 10;

      const [
        topAgentsByRevenue,
        topOrderTypes,
        topStorefronts,
      ] = await Promise.all([
        Order.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: startDate, $lte: endDate },
              createdBy: { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: "$createdBy",
              orders: { $sum: 1 },
              revenue: { $sum: "$total" },
              averageOrderValue: { $avg: "$total" },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "user",
            },
          },
          { $unwind: "$user" },
          {
            $match: {
              "user.userType": { $ne: "super_admin" },
            },
          },
          { $sort: { orders: -1, revenue: -1 } },
          { $limit: maxPerformers },
          {
            $project: {
              _id: 0,
              userId: "$user._id",
              fullName: "$user.fullName",
              agentCode: "$user.agentCode",
              userType: "$user.userType",
              orders: 1,
              revenue: 1,
              averageOrderValue: { $round: ["$averageOrderValue", 2] },
            },
          },
        ]),
        Order.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: "$orderType",
              count: { $sum: 1 },
              revenue: { $sum: "$total" },
            },
          },
          { $sort: { revenue: -1 } },
        ]),
        Order.aggregate([
          {
            $match: {
              orderType: "storefront",
              status: "completed",
              createdAt: { $gte: startDate, $lte: endDate },
              "storefrontData.storefrontId": { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: "$storefrontData.storefrontId",
              totalOrders: { $sum: 1 },
              grossRevenue: { $sum: "$total" },
              netProfit: {
                $sum: {
                  $ifNull: ["$storefrontData.totalMarkup", 0],
                },
              },
              averageOrderValue: { $avg: "$total" },
            },
          },
          {
            $lookup: {
              from: "agentstorefronts",
              localField: "_id",
              foreignField: "_id",
              as: "storefront",
            },
          },
          { $unwind: "$storefront" },
          {
            $lookup: {
              from: "users",
              localField: "storefront.agentId",
              foreignField: "_id",
              as: "agent",
            },
          },
          {
            $unwind: {
              path: "$agent",
              preserveNullAndEmptyArrays: true,
            },
          },
          { $sort: { totalOrders: -1, netProfit: -1 } },
          { $limit: maxPerformers },
          {
            $project: {
              _id: 0,
              storefrontId: "$storefront._id",
              storefrontName: {
                $ifNull: [
                  "$storefront.displayName",
                  "$storefront.businessName",
                ],
              },
              businessName: "$storefront.businessName",
              agentId: "$agent._id",
              agentName: "$agent.fullName",
              totalOrders: 1,
              netProfit: 1,
              grossRevenue: 1,
              orders: "$totalOrders",
              revenue: "$netProfit",
              averageOrderValue: { $round: ["$averageOrderValue", 2] },
            },
          },
        ]),
      ]);

      const mergedAgents = [...topAgentsByRevenue];
      const seenAgents = new Set(
        mergedAgents.map((agent) => String(agent.userId)),
      );

      if (mergedAgents.length < requiredTopAgents) {
        const extraUsers = await User.find({
          userType: { $ne: "super_admin" },
          isDeleted: { $ne: true },
        })
          .select("_id fullName agentCode userType")
          .sort({ createdAt: -1 })
          .limit(maxPerformers)
          .lean();

        extraUsers.forEach((user) => {
          if (mergedAgents.length >= requiredTopAgents) {
            return;
          }

          const key = String(user._id);
          if (seenAgents.has(key)) {
            return;
          }

          seenAgents.add(key);
          mergedAgents.push({
            userId: user._id,
            fullName: user.fullName,
            agentCode: user.agentCode,
            userType: user.userType,
            orders: 0,
            revenue: 0,
            averageOrderValue: 0,
          });
        });
      }

      const rankedAgents = [...mergedAgents]
        .sort((a, b) => {
          const orderDiff = (b.orders || 0) - (a.orders || 0);
          if (orderDiff !== 0) {
            return orderDiff;
          }

          return (b.revenue || 0) - (a.revenue || 0);
        })
        .slice(0, maxPerformers);

      return {
        agents: rankedAgents,
        storefronts: topStorefronts,
        orderTypes: topOrderTypes.map((row) => ({
          orderType: row._id || "unknown",
          count: row.count,
          revenue: row.revenue,
        })),
      };
    } catch (error) {
      logger.error(`Top performers error: ${error.message}`);
      return {
        agents: [],
        storefronts: [],
        orderTypes: [],
      };
    }
  }

  /**
   * Build a normalized feed from recent activity datasets
   * @param {Object} recentActivity - Activity object from queries
   * @returns {Array<Object>} Unified activity feed
   */
  buildActivityFeed(recentActivity) {
    const feed = [];

    (recentActivity.users || []).forEach((user) => {
      feed.push({
        id: `user-${user._id}`,
        type: "user_registered",
        message: `${user.fullName} joined as ${String(user.userType || "user").replace(/_/g, " ")}`,
        createdAt: user.createdAt,
        meta: {
          status: user.status,
          subscriptionStatus: user.subscriptionStatus,
        },
      });
    });

    (recentActivity.orders || []).forEach((order) => {
      feed.push({
        id: `order-${order._id}`,
        type: "order_update",
        message: `Order ${order.orderNumber || "N/A"} is ${order.status}`,
        createdAt: order.createdAt,
        value: order.total || 0,
        meta: {
          status: order.status,
          orderType: order.orderType,
        },
      });
    });

    (recentActivity.transactions || []).forEach((transaction) => {
      feed.push({
        id: `txn-${transaction._id}`,
        type: transaction.type === "credit" ? "wallet_credit" : "wallet_debit",
        message:
          transaction.description ||
          `${transaction.type === "credit" ? "Wallet credit" : "Wallet debit"} recorded`,
        createdAt: transaction.createdAt,
        value: transaction.amount || 0,
        meta: {
          type: transaction.type,
        },
      });
    });

    (recentActivity.payouts || []).forEach((payout) => {
      feed.push({
        id: `payout-${payout._id}`,
        type: "payout_update",
        message: `Payout ${payout.status} (${payout.destination?.type || "unknown"})`,
        createdAt: payout.createdAt,
        value: payout.amount || 0,
        meta: {
          status: payout.status,
          destinationType: payout.destination?.type,
        },
      });
    });

    return feed
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20);
  }

  /**
   * Generate short strategic insights from calculated metrics
   * @param {Object} params - Analytics slices
   * @returns {Array<Object>} Insights list
   */
  generateSuperAdminInsights({
    orderStats,
    payoutStats,
    walletStats,
    rates,
    growth,
  }) {
    const insights = [];

    if (growth.revenue.percent >= 0) {
      insights.push({
        title: "Revenue Trend",
        type: "positive",
        description: `Revenue moved ${growth.revenue.percent}% versus the previous period.`,
      });
    } else {
      insights.push({
        title: "Revenue Decline",
        type: "warning",
        description: `Revenue is down ${Math.abs(growth.revenue.percent)}% versus the previous period.`,
      });
    }

    if (orderStats.successRate < 85) {
      insights.push({
        title: "Order Success Risk",
        type: "warning",
        description: `Order success rate is ${orderStats.successRate}%. Investigate failed/cancelled volumes.`,
      });
    } else {
      insights.push({
        title: "Healthy Fulfillment",
        type: "positive",
        description: `Order success rate is ${orderStats.successRate}%, indicating stable fulfillment.`,
      });
    }

    if (payoutStats.pendingLiability > 0) {
      insights.push({
        title: "Outstanding Payout Liability",
        type: "warning",
        description: `Pending payout liability is GHS ${payoutStats.pendingLiability.toLocaleString()} across ${payoutStats.queuedCount} queued requests.`,
      });
    }

    if (rates.userVerification < 70) {
      insights.push({
        title: "Verification Opportunity",
        type: "info",
        description: `User verification rate is ${rates.userVerification}%. Improving verification can reduce fraud risk.`,
      });
    }

    if (
      (walletStats.transactions.debits.amount || 0) >
      (walletStats.transactions.credits.amount || 0)
    ) {
      insights.push({
        title: "Wallet Outflow Pressure",
        type: "info",
        description:
          "Wallet debits exceed credits in the selected period. Monitor float coverage and top-up behavior.",
      });
    }

    if (insights.length === 0) {
      insights.push({
        title: "System Stable",
        type: "positive",
        description:
          "Core operating metrics are stable for the selected period.",
      });
    }

    return insights;
  }

  /**
   * Get chart data for super admin
   * @param {string} timeframe - Time period
   * @returns {Promise<Object>} Chart data
   */
  async getChartData(timeframe) {
    const dateRange = this.getDateRange(timeframe);
    const { startDate, endDate } = dateRange;

    const [dailyData, userData, statusData] = await Promise.all(
      [
        Order.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
              status: { $nin: ["draft", "pending_payment"] },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              orders: { $sum: 1 },
              revenue: {
                $sum: {
                  $cond: [{ $eq: ["$status", "completed"] }, "$total", 0],
                },
              },
              completedOrders: {
                $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        User.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
              isDeleted: { $ne: true },
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
        ]),
        Order.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
              status: { $nin: ["draft", "pending_payment"] },
            },
          },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ]),
      ],
    );

    const labels = [
      ...new Set([
        ...dailyData.map((row) => row._id),
        ...userData.map((row) => row._id),
      ]),
    ].sort();

    const byDateOrder = {};
    const byDateUsers = {};

    dailyData.forEach((row) => {
      byDateOrder[row._id] = row;
    });
    userData.forEach((row) => {
      byDateUsers[row._id] = row;
    });

    const statusMap = {};
    statusData.forEach((stat) => {
      statusMap[stat._id] = stat.count;
    });

    return {
      labels,
      orders: labels.map((label) => byDateOrder[label]?.orders || 0),
      revenue: labels.map((label) => byDateOrder[label]?.revenue || 0),
      completedOrders: labels.map(
        (label) => byDateOrder[label]?.completedOrders || 0,
      ),
      userRegistrations: labels.map(
        (label) => byDateUsers[label]?.registrations || 0,
      ),
      orderStatus: {
        completed: statusMap.completed || 0,
        pending: statusMap.pending || 0,
        processing: statusMap.processing || 0,
        failed: statusMap.failed || 0,
        cancelled: statusMap.cancelled || 0,
        confirmed: statusMap.confirmed || 0,
        partiallyCompleted: statusMap.partially_completed || 0,
      },
    };
  }

  /**
   * Get agent order statistics
   * @param {string} agentId - Agent ID
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
      today.getDate(),
    );
    const todayEnd = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );

    const [periodStats, todayStats] = await Promise.all([
      // Period stats
      Order.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(agentId),
            ...(tenantId
              ? { tenantId: new mongoose.Types.ObjectId(tenantId) }
              : {}),
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $nin: ["draft", "pending_payment"] },
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
            confirmed: {
              $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
            },
            partiallyCompleted: {
              $sum: {
                $cond: [{ $eq: ["$status", "partially_completed"] }, 1, 0],
              },
            },
          },
        },
      ]),
      // Today's stats
      Order.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(agentId),
            ...(tenantId
              ? { tenantId: new mongoose.Types.ObjectId(tenantId) }
              : {}),
            createdAt: { $gte: todayStart, $lte: todayEnd },
            status: { $nin: ["draft", "pending_payment"] },
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
            confirmed: {
              $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
            },
            partiallyCompleted: {
              $sum: {
                $cond: [{ $eq: ["$status", "partially_completed"] }, 1, 0],
              },
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
      confirmed: 0,
      failed: 0,
      cancelled: 0,
      partiallyCompleted: 0,
    };

    const todayData = todayStats[0] || {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      confirmed: 0,
      failed: 0,
      cancelled: 0,
      partiallyCompleted: 0,
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
      confirmed: periodData.confirmed,
      failed: periodData.failed,
      cancelled: periodData.cancelled,
      partiallyCompleted: periodData.partiallyCompleted,
      successRate: Math.round(successRate * 100) / 100,
      todayCounts: {
        total: todayData.total,
        completed: todayData.completed,
        pending: todayData.pending,
        processing: todayData.processing,
        confirmed: todayData.confirmed,
        failed: todayData.failed,
        cancelled: todayData.cancelled,
        partiallyCompleted: todayData.partiallyCompleted,
      },
    };
  }

  /**
   * Get agent revenue statistics
   * @param {string} agentId - Agent ID
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
      today.getDate(),
    );
    const todayEnd = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );

    // Calculate this month's range
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    const [periodStats, todayStats, monthStats] = await Promise.all([
      Order.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(agentId),
            ...(tenantId
              ? { tenantId: new mongoose.Types.ObjectId(tenantId) }
              : {}),
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
            ...(tenantId
              ? { tenantId: new mongoose.Types.ObjectId(tenantId) }
              : {}),
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
            ...(tenantId
              ? { tenantId: new mongoose.Types.ObjectId(tenantId) }
              : {}),
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

    // Determine grouping format based on timeframe
    let dateFormat = "%Y-%m-%d";
    if (timeframe === "365d" || timeframe === "all" || timeframe === "yearly") {
      dateFormat = "%Y-%m"; // Group by month for long periods
    }

    const dailyData = await Order.aggregate([
      {
        $match: {
          createdBy: new mongoose.Types.ObjectId(agentId),
          ...(tenantId
            ? { tenantId: new mongoose.Types.ObjectId(tenantId) }
            : {}),
          createdAt: { $gte: startDate, $lte: endDate },
          status: { $nin: ["draft", "pending_payment"] },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: dateFormat, date: "$createdAt" },
          },
          orders: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, "$total", 0],
            },
          },
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

  /**
   * Get agent user statistics
   * @param {string} agentId - Agent ID
   * @param {Object} dateRange - Date range object
   * @returns {Promise<Object>} Agent user statistics
   */
  async getAgentUserStatistics(agentId, dateRange) {
    try {
      const { startDate, endDate } = dateRange;
      const agentObjectId = new mongoose.Types.ObjectId(agentId);

      // Get users referred by this agent within the date range
      const referredUsers = await User.countDocuments({
        referredBy: agentObjectId,
        createdAt: { $gte: startDate, $lte: endDate },
        isDeleted: { $ne: true },
      });

      // Get total users referred by this agent (all time)
      const totalReferredUsers = await User.countDocuments({
        referredBy: agentObjectId,
        isDeleted: { $ne: true },
      });

      // Get active users referred by this agent
      const activeReferredUsers = await User.countDocuments({
        referredBy: agentObjectId,
        subscriptionStatus: "active",
        isDeleted: { $ne: true },
      });

      return {
        referredUsers,
        totalReferredUsers,
        activeReferredUsers,
        conversionRate:
          totalReferredUsers > 0
            ? (activeReferredUsers / totalReferredUsers) * 100
            : 0,
      };
    } catch (error) {
      logger.error(`Agent user statistics error: ${error.message}`);
      return {
        referredUsers: 0,
        totalReferredUsers: 0,
        activeReferredUsers: 0,
        conversionRate: 0,
      };
    }
  }

  /**
   * Get agent wallet statistics
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Agent wallet statistics
   */
  async getAgentWalletStatistics(agentId) {
    try {
      const agentObjectId = new mongoose.Types.ObjectId(agentId);
      const user = await User.findById(agentObjectId).select(
        "walletBalance subscriptionStatus",
      );

      // Get wallet transactions for this agent
      const transactions = await WalletTransaction.find({
        user: agentObjectId,
      })
        .sort({ createdAt: -1 })
        .limit(10);

      const totalCredits = transactions
        .filter((t) => t.type === "credit")
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      const totalDebits = transactions
        .filter((t) => t.type === "debit")
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      return {
        balance: user?.walletBalance || 0,
        totalCredits,
        totalDebits,
        transactionCount: transactions.length,
        subscriptionStatus: user?.subscriptionStatus || "inactive",
        recentTransactions: transactions.slice(0, 5).map((t) => ({
          id: t._id,
          type: t.type,
          amount: t.amount,
          description: t.description,
          createdAt: t.createdAt,
        })),
      };
    } catch (error) {
      logger.error(`Agent wallet statistics error: ${error.message}`);
      return {
        balance: 0,
        totalCredits: 0,
        totalDebits: 0,
        transactionCount: 0,
        subscriptionStatus: "inactive",
        recentTransactions: [],
      };
    }
  }

  /**
   * Get agent recent activity
   * @param {string} agentId - Agent ID
   * @returns {Promise<Array>} Agent recent activity
   */
  async getAgentRecentActivity(agentId) {
    try {
      const agentObjectId = new mongoose.Types.ObjectId(agentId);
      const activities = [];

      // Get recent orders
      const recentOrders = await Order.find({
        createdBy: agentObjectId,
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("orderNumber total status createdAt");

      // Get recent wallet transactions
      const recentTransactions = await WalletTransaction.find({
        user: agentObjectId,
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("type amount description createdAt");

      // Combine and sort all activities
      recentOrders.forEach((order) => {
        activities.push({
          type: "order",
          description: `Order ${order.orderNumber} created`,
          amount: order.total,
          status: order.status,
          createdAt: order.createdAt,
        });
      });

      recentTransactions.forEach((transaction) => {
        activities.push({
          type: "transaction",
          description:
            transaction.description || `${transaction.type} transaction`,
          amount: transaction.amount,
          status: transaction.type,
          createdAt: transaction.createdAt,
        });
      });

      // Sort by createdAt descending and return top 10
      return activities
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10);
    } catch (error) {
      logger.error(`Agent recent activity error: ${error.message}`);
      return [];
    }
  }

  async getReferralStatistics(dateRange) {
    try {
      const match = dateRange
        ? { createdAt: { $gte: dateRange.start, $lte: dateRange.end } }
        : {};

      const totalReferrers = await User.countDocuments({
        referredBy: { $exists: true, $ne: null },
      });

      const [commissionAgg, referredCount] = await Promise.all([
        Commission.aggregate([
          { $match: { status: "credited", ...match } },
          {
            $group: {
              _id: null,
              totalCommissionsPaid: { $sum: "$amount" },
              totalOrdersFromReferrals: { $sum: "$ordersCount" },
              activeReferrers: { $addToSet: "$referrer" },
            },
          },
        ]),
        User.countDocuments({ referredBy: { $exists: true, $ne: null } }),
      ]);

      const data = commissionAgg[0] || {
        totalCommissionsPaid: 0,
        totalOrdersFromReferrals: 0,
        activeReferrers: [],
      };

      return {
        totalReferrers,
        activeReferrers: data.activeReferrers?.length || 0,
        totalCommissionsPaid: data.totalCommissionsPaid,
        totalOrdersFromReferrals: data.totalOrdersFromReferrals,
        totalReferred: referredCount,
      };
    } catch (error) {
      logger.error(`Referral statistics error: ${error.message}`);
      return {
        totalReferrers: 0,
        activeReferrers: 0,
        totalCommissionsPaid: 0,
        totalOrdersFromReferrals: 0,
        totalReferred: 0,
      };
    }
  }

  async getCommissionTrends(dateRange) {
    try {
      if (!dateRange) return [];

      const diffDays = Math.ceil(
        (dateRange.end - dateRange.start) / (1000 * 60 * 60 * 24),
      );

      const groupBy =
        diffDays <= 31
          ? { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
          : { $dateToString: { format: "%Y-%m", date: "$createdAt" } };

      const trends = await Commission.aggregate([
        {
          $match: {
            status: "credited",
            createdAt: { $gte: dateRange.start, $lte: dateRange.end },
          },
        },
        {
          $group: {
            _id: groupBy,
            totalCommission: { $sum: "$amount" },
            batchCount: { $sum: 1 },
            totalOrders: { $sum: "$ordersCount" },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            period: "$_id",
            totalCommission: 1,
            batchCount: 1,
            totalOrders: 1,
          },
        },
      ]);

      return trends;
    } catch (error) {
      logger.error(`Commission trends error: ${error.message}`);
      return [];
    }
  }
}

export default new AnalyticsService();
