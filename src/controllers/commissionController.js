// src/controllers/commissionController.js

import commissionService from "../services/commissionService.js";
import logger from "../utils/logger.js";

class CommissionController {
  /**
   * Get commission settings
   */
  async getCommissionSettings(req, res) {
    try {
      const settings = await commissionService.getCommissionSettings();

      res.json({
        success: true,
        data: settings,
      });
    } catch (error) {
      logger.error("Get commission settings error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get commission settings",
      });
    }
  }

  /**
   * Update commission settings
   */
  async updateCommissionSettings(req, res) {
    try {
      const {
        agentCommission,
        superAgentCommission,
        dealerCommission,
        superDealerCommission,
        defaultCommissionRate,
      } = req.body;

      // Validation for all commission rates
      const commissionFields = {
        agentCommission,
        superAgentCommission,
        dealerCommission,
        superDealerCommission,
        defaultCommissionRate,
      };

      for (const [field, value] of Object.entries(commissionFields)) {
        if (value !== undefined && (value < 0 || value > 100)) {
          return res.status(400).json({
            success: false,
            message: `${field.replace(
              "Commission",
              " commission"
            )} must be between 0 and 100`,
          });
        }
      }

      const settings = await commissionService.updateCommissionSettings({
        agentCommission,
        superAgentCommission,
        dealerCommission,
        superDealerCommission,
        defaultCommissionRate,
      });

      res.json({
        success: true,
        data: settings,
        message: "Commission settings updated successfully",
      });
    } catch (error) {
      logger.error("Update commission settings error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update commission settings",
      });
    }
  }

  /**
   * Get agent commissions
   */
  async getAgentCommissions(req, res) {
    try {
      const { userId, userType } = req.user;
      const {
        status,
        period,
        startDate,
        endDate,
        page = 1,
        limit = 20,
      } = req.query;

      const filters = {};
      if (status) filters.status = status;
      if (period) filters.period = period;
      if (startDate && endDate) {
        filters.startDate = new Date(startDate);
        filters.endDate = new Date(endDate);
      }

      // For non-super-admin users, only show paid commissions and their own pending daily commissions
      if (userType !== "super_admin") {
        // Allow agents to see their own pending daily commissions for current month accumulation
        // But hide pending monthly commissions (which are finalized at month-end)
        if (!status) {
          // If no specific status filter, show paid + pending daily commissions
          filters.$or = [
            { status: "paid" },
            { status: "pending", period: "daily" },
          ];
        } else if (status === "pending") {
          // If specifically filtering for pending, only show daily pending commissions
          filters.status = "pending";
          filters.period = "daily";
        }
        // If status is "paid", it will work as before
      }

      const commissions = await commissionService.getAgentCommissions(
        userId,
        filters
      );

      // Apply pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedCommissions = commissions.slice(startIndex, endIndex);

      res.json({
        success: true,
        data: paginatedCommissions,
        pagination: {
          total: commissions.length,
          page: parseInt(page),
          pages: Math.ceil(commissions.length / limit),
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      logger.error("Get agent commissions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch agent commissions",
      });
    }
  }

  /**
   * Get all commissions (super admin)
   */
  async getAllCommissions(req, res) {
    try {
      const {
        status,
        agentId,
        period,
        startDate,
        endDate,
        month,
        search,
        page = 1,
        limit = 20,
      } = req.query;

      const filters = {};
      if (status) filters.status = status;
      if (agentId) filters.agentId = agentId;
      if (period) filters.period = period;
      if (month) filters.month = month;
      if (search) filters.search = search;
      if (startDate && endDate) {
        filters.startDate = new Date(startDate);
        filters.endDate = new Date(endDate);
      }

      const commissions = await commissionService.getAllCommissions(filters);

      // Apply pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedCommissions = commissions.slice(startIndex, endIndex);

      res.json({
        success: true,
        data: paginatedCommissions,
        pagination: {
          total: commissions.length,
          page: parseInt(page),
          pages: Math.ceil(commissions.length / limit),
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      logger.error("Get all commissions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch commissions",
      });
    }
  }

  /**
   * Calculate commission for an agent
   */
  async calculateCommission(req, res) {
    try {
      const { agentId, startDate, endDate } = req.body;
      const { tenantId } = req.user;

      if (!agentId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "Agent ID, start date, and end date are required",
        });
      }

      const calculation = await commissionService.calculateCommission(
        agentId,
        tenantId,
        new Date(startDate),
        new Date(endDate)
      );

      res.json({
        success: true,
        data: calculation,
      });
    } catch (error) {
      logger.error("Calculate commission error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to calculate commission",
      });
    }
  }

  /**
   * Create commission record
   */
  async createCommissionRecord(req, res) {
    try {
      const { agentId, periodStart, periodEnd, period = "monthly" } = req.body;
      const { tenantId } = req.user;

      if (!agentId || !periodStart || !periodEnd) {
        return res.status(400).json({
          success: false,
          message: "Agent ID, period start, and period end are required",
        });
      }

      // Calculate commission first
      const calculation = await commissionService.calculateCommission(
        agentId,
        tenantId,
        new Date(periodStart),
        new Date(periodEnd)
      );

      // Create commission record
      const commissionData = {
        ...calculation,
        period,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
      };

      const commissionRecord = await commissionService.createCommissionRecord(
        commissionData
      );

      res.status(201).json({
        success: true,
        data: commissionRecord,
        message: "Commission record created successfully",
      });
    } catch (error) {
      logger.error("Create commission record error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create commission record",
      });
    }
  }

  /**
   * Pay commission
   */
  async payCommission(req, res) {
    try {
      const { commissionId } = req.params;
      const { paymentReference } = req.body || {};
      const { userId } = req.user;

      const commission = await commissionService.payCommission(
        commissionId,
        userId,
        paymentReference
      );

      res.json({
        success: true,
        data: commission,
        message: "Commission paid successfully",
      });
    } catch (error) {
      logger.error("Pay commission error:", error);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Reject commission
   */
  async rejectCommission(req, res) {
    try {
      const { commissionId } = req.params;
      const { rejectionReason } = req.body || {};
      const { userId } = req.user;

      const commission = await commissionService.rejectCommission(
        commissionId,
        userId,
        rejectionReason
      );

      res.json({
        success: true,
        data: commission,
        message: "Commission rejected successfully",
      });
    } catch (error) {
      logger.error("Reject commission error:", error);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Reject multiple commissions
   */
  async rejectMultipleCommissions(req, res) {
    try {
      const { commissionIds, rejectionReason } = req.body;
      const { userId } = req.user;

      if (
        !commissionIds ||
        !Array.isArray(commissionIds) ||
        commissionIds.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Commission IDs array is required",
        });
      }

      const results = await commissionService.rejectMultipleCommissions(
        commissionIds,
        userId,
        rejectionReason
      );

      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      res.json({
        success: true,
        data: results,
        message: `${successful} commissions rejected successfully, ${failed} failed`,
      });
    } catch (error) {
      logger.error("Reject multiple commissions error:", error);
      res.status(400).json({
        success: false,
        message: "Failed to reject multiple commissions",
      });
    }
  }

  /**
   * Pay multiple commissions
   */
  async payMultipleCommissions(req, res) {
    try {
      const { commissionIds, paymentReference } = req.body;
      const { userId } = req.user;

      if (
        !commissionIds ||
        !Array.isArray(commissionIds) ||
        commissionIds.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Commission IDs array is required",
        });
      }

      const results = await commissionService.payMultipleCommissions(
        commissionIds,
        userId,
        paymentReference
      );

      res.json({
        success: true,
        data: results,
        message: `${results.length} commissions paid successfully`,
      });
    } catch (error) {
      logger.error("Pay multiple commissions error:", error);
      res.status(400).json({
        success: false,
        message: "Failed to pay multiple commissions",
      });
    }
  }

  /**
   * Generate monthly commissions
   */
  async generateMonthlyCommissions(req, res) {
    try {
      const { targetMonth } = req.body;

      const targetDate = targetMonth ? new Date(targetMonth) : new Date();
      const results = await commissionService.generateMonthlyCommissions(
        targetDate
      );

      const successful = results.results.filter(
        (r) => r.status === "created"
      ).length;
      const existing = results.results.filter(
        (r) => r.status === "exists"
      ).length;
      const noCommission = results.results.filter(
        (r) => r.status === "no_commission"
      ).length;
      const errors = results.results.filter((r) => r.status === "error").length;

      res.json({
        success: true,
        data: {
          results: results.results,
          summary: {
            total: results.results.length,
            successful,
            existing,
            noCommission,
            errors,
          },
        },
        message: `Generated ${successful} commission records with ${errors} errors`,
      });
    } catch (error) {
      logger.error("Generate monthly commissions error:", error);

      // Check if this is a duplicate generation error (expected behavior)
      if (
        error.message.includes("Commissions already generated for this period")
      ) {
        return res.json({
          success: true,
          warning: true,
          message: error.message,
          data: {
            existingRecords: true,
          },
        });
      }

      // For other errors, return 500
      res.status(500).json({
        success: false,
        message: "Failed to generate monthly commissions",
      });
    }
  }

  /**
   * Reset monthly commissions
   */
  async resetMonthlyCommissions(req, res) {
    try {
      const { month } = req.body; // Optional: specific month to reset
      const resetMonth = month ? new Date(month) : new Date();

      const result = await commissionService.resetMonthlyCommissions(
        resetMonth
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Reset monthly commissions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reset monthly commissions",
      });
    }
  }

  /**
   * Manually trigger commission reset (for testing/admin purposes)
   */
  async manualCommissionReset(req, res) {
    try {
      const { month } = req.body; // Optional: specific month to reset
      const resetMonth = month ? new Date(month) : new Date();

      const { manualCommissionReset } = await import(
        "../jobs/commissionReset.js"
      );
      const result = await manualCommissionReset(resetMonth);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error("Manual commission reset error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to manually reset commissions",
      });
    }
  }

  /**
   * Get commission statistics
   */
  async getCommissionStatistics(req, res) {
    try {
      const { tenantId, userType } = req.user;

      // For super admin users, don't filter by tenant (show all data)
      // For regular users, filter by their tenant
      const statisticsTenantId = userType === "super_admin" ? null : tenantId;

      const statistics = await commissionService.getCommissionStatistics(
        statisticsTenantId
      );

      res.json({
        success: true,
        data: statistics,
      });
    } catch (error) {
      logger.error("Get commission statistics error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch commission statistics",
      });
    }
  }

  /**
   * Manually expire old commissions
   * This endpoint allows super admins to manually trigger the expiry job
   * Useful for testing or forcing expiry outside the scheduled cron time
   */
  async expireOldCommissions(req, res) {
    try {
      logger.info(
        `Manual commission expiry triggered by user ${req.user.userId}`
      );

      // Import the cleanup function
      const { runCommissionCleanupManually } = await import(
        "../jobs/commissionCleanup.js"
      );

      // Run the cleanup
      const result = await runCommissionCleanupManually();

      if (result.success) {
        res.json({
          success: true,
          message: `Successfully expired ${result.expired} commission(s)`,
          data: {
            expiredCount: result.expired,
            totalAmount: result.totalAmount,
            duration: result.duration,
          },
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Commission expiry job failed",
          error: result.error,
        });
      }
    } catch (error) {
      logger.error("Manual commission expiry error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to expire commissions",
        error: error.message,
      });
    }
  }

  /**
   * Archive commissions for a specific month
   */
  async archiveMonthCommissions(req, res) {
    try {
      const { year, month } = req.body;
      const { userId } = req.user;

      if (!year || !month) {
        return res.status(400).json({
          success: false,
          message: "Year and month are required",
        });
      }

      if (month < 1 || month > 12) {
        return res.status(400).json({
          success: false,
          message: "Month must be between 1 and 12",
        });
      }

      logger.info(
        `Manual archival triggered for ${year}-${month} by user ${userId}`
      );

      const result = await commissionService.archiveMonthCommissions(
        year,
        month,
        userId
      );

      res.json({
        success: true,
        message: `Successfully archived ${result.summariesCreated} summaries for ${result.month}`,
        data: result,
      });
    } catch (error) {
      logger.error("Archive month commissions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to archive month commissions",
        error: error.message,
      });
    }
  }

  /**
   * Get monthly summaries for an agent
   */
  async getAgentMonthlySummaries(req, res) {
    try {
      const { userId } = req.user;
      const { limit, paymentStatus } = req.query;

      const options = {};
      if (limit) options.limit = parseInt(limit);
      if (paymentStatus) options.paymentStatus = paymentStatus;

      const summaries = await commissionService.getAgentMonthlySummaries(
        userId,
        options
      );

      res.json({
        success: true,
        data: summaries,
      });
    } catch (error) {
      logger.error("Get agent monthly summaries error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get monthly summaries",
      });
    }
  }

  /**
   * Get all monthly summaries (super admin)
   */
  async getAllMonthlySummaries(req, res) {
    try {
      const { tenantId, userType } = req.user;
      const { limit, paymentStatus, month } = req.query;

      const options = {};
      if (limit) options.limit = parseInt(limit);
      if (paymentStatus) options.paymentStatus = paymentStatus;
      if (month) options.month = month;

      // For super admin, don't filter by tenant
      const filterTenantId = userType === "super_admin" ? null : tenantId;

      const summaries = await commissionService.getAllMonthlySummaries(
        filterTenantId,
        options
      );

      res.json({
        success: true,
        data: summaries,
      });
    } catch (error) {
      logger.error("Get all monthly summaries error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get monthly summaries",
      });
    }
  }

  /**
   * Get current month statistics
   */
  async getCurrentMonthStatistics(req, res) {
    try {
      const { tenantId, userType, userId } = req.user;

      // For super admin, show all; for agents, show only their own
      const filterTenantId = userType === "super_admin" ? null : tenantId;
      const filterAgentId = userType === "super_admin" ? null : userId;

      const stats = await commissionService.getCurrentMonthStatistics(
        filterTenantId,
        filterAgentId
      );

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error("Get current month statistics error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get current month statistics",
      });
    }
  }

  /**
   * Generate daily commissions (manual trigger for testing)
   */
  async generateDailyCommissions(req, res) {
    try {
      const { targetDate } = req.body;
      const targetDateObj = targetDate ? new Date(targetDate) : new Date();

      const results = await commissionService.generateDailyCommissions(
        targetDateObj
      );

      res.json({
        success: true,
        data: results,
        message: `Generated ${results.summary.created} daily commission records`,
      });
    } catch (error) {
      logger.error("Generate daily commissions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate daily commissions",
      });
    }
  }
}

export default new CommissionController();
