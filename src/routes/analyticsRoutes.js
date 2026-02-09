// src/routes/analyticsRoutes.js
import express from "express";
import analyticsService from "../services/analyticsService.js";
import {
  authenticate,
  authorize,
  authorizeBusinessUser,
} from "../middlewares/auth.js";
import logger from "../utils/logger.js";

const router = express.Router();

// Get comprehensive analytics for super admin
router.get(
  "/superadmin",
  authenticate,
  authorize("super_admin"),
  async (req, res) => {
    try {
      const { timeframe = "30d" } = req.query;

      const analytics = await analyticsService.getSuperAdminAnalytics(
        timeframe
      );

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      logger.error(`Super admin analytics error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch analytics data",
      });
    }
  }
);

// Get analytics for business user dashboard (agent, super_agent, dealer, super_dealer)
router.get("/agent", authenticate, authorizeBusinessUser, async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { timeframe = "30d" } = req.query;

    const analytics = await analyticsService.getAgentAnalytics(
      userId,
      tenantId,
      timeframe
    );

    res.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    logger.error(`Agent analytics error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Failed to fetch agent analytics",
    });
  }
});

// Get analytics summary (for both super admin and business users)
router.get(
  "/summary",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  async (req, res) => {
    try {
      const { userType, userId, tenantId } = req.user;
      const { timeframe = "30d" } = req.query;

      let analytics;

      if (userType === "super_admin") {
        analytics = await analyticsService.getSuperAdminAnalytics(timeframe);
      } else {
        analytics = await analyticsService.getAgentAnalytics(
          userId,
          tenantId,
          timeframe
        );
      }

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      logger.error(`Analytics summary error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch analytics summary",
      });
    }
  }
);

// Get chart data only
router.get(
  "/charts",
  authenticate,
  authorize("agent", "super_agent", "dealer", "super_dealer", "super_admin"),
  async (req, res) => {
    try {
      const { userType, userId, tenantId } = req.user;
      const { timeframe = "30d" } = req.query;

      let chartData;

      if (userType === "super_admin") {
        const analytics = await analyticsService.getSuperAdminAnalytics(
          timeframe
        );
        chartData = analytics.charts;
      } else {
        chartData = await analyticsService.getAgentChartData(
          userId,
          tenantId,
          timeframe
        );
      }

      res.json({
        success: true,
        data: chartData,
      });
    } catch (error) {
      logger.error(`Chart data error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch chart data",
      });
    }
  }
);

// Get real-time metrics
router.get(
  "/realtime",
  authenticate,
  authorize("super_admin"),
  async (req, res) => {
    try {
      // Get today's metrics
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const Order = (await import("../models/Order.js")).default;
      const User = (await import("../models/User.js")).default;

      const [todayOrders, todayRevenue, todayUsers] = await Promise.all([
        Order.countDocuments({
          createdAt: { $gte: today, $lt: tomorrow },
          status: { $nin: ["draft", "pending_payment"] },
        }),
        Order.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: today, $lt: tomorrow },
            },
          },
          { $group: { _id: null, total: { $sum: "$total" } } },
        ]),
        User.countDocuments({
          createdAt: { $gte: today, $lt: tomorrow },
        }),
      ]);

      const realtimeData = {
        todayOrders: todayOrders || 0,
        todayRevenue: todayRevenue[0]?.total || 0,
        todayUsers: todayUsers || 0,
        timestamp: new Date(),
      };

      res.json({
        success: true,
        data: realtimeData,
      });
    } catch (error) {
      logger.error(`Realtime metrics error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch realtime metrics",
      });
    }
  }
);

export default router;
