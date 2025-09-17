// src/services/commissionService.js
import CommissionRecord from "../models/CommissionRecord.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Settings from "../models/Settings.js";
import walletService from "./walletService.js";
import notificationService from "./notificationService.js";
import websocketService from "./websocketService.js";
import redisService from "./redisService.js";
import logger from "../utils/logger.js";

class CommissionService {
  /**
   * Calculate commission for an agent for a specific period
   * @param {string} agentId - Agent ID
   * @param {string} tenantId - Tenant ID
   * @param {Date} startDate - Period start date
   * @param {Date} endDate - Period end date
   * @returns {Promise<Object>} Commission calculation result
   */
  async calculateCommission(agentId, tenantId, startDate, endDate) {
    try {
      // Create cache key for commission calculation
      const cacheKey = `commission:calc:${agentId}:${tenantId}:${
        startDate.toISOString().split("T")[0]
      }:${endDate.toISOString().split("T")[0]}`;

      // Try to get from cache first
      const cachedResult = await redisService.get(cacheKey);
      if (cachedResult) {
        logger.debug(`Commission calculation cache hit for agent ${agentId}`);
        return cachedResult;
      }

      // Get agent details to determine commission rate
      const agent = await User.findById(agentId);
      if (!agent) {
        throw new Error("Agent not found");
      }

      // Get completed orders for the period
      const orders = await Order.find({
        createdBy: agentId,
        tenantId: tenantId,
        status: "completed",
        createdAt: { $gte: startDate, $lte: endDate },
      });

      const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);

      // Get commission rate based on user type
      const settings = await Settings.getInstance();
      let commissionRate;

      switch (agent.userType) {
        case "super_dealer":
          commissionRate =
            settings.superDealerCommission ||
            settings.defaultCommissionRate ||
            1.0;
          break;
        case "dealer":
          commissionRate =
            settings.dealerCommission || settings.defaultCommissionRate || 1.0;
          break;
        case "super_agent":
          commissionRate =
            settings.superAgentCommission ||
            settings.defaultCommissionRate ||
            1.0;
          break;
        case "agent":
        default:
          commissionRate =
            settings.agentCommission || settings.defaultCommissionRate || 1.0;
          break;
      }

      const commissionAmount = (totalRevenue * commissionRate) / 100;
      const result = {
        agentId,
        tenantId,
        periodStart: startDate,
        periodEnd: endDate,
        totalOrders: orders.length,
        totalRevenue,
        commissionRate,
        amount: Math.round(commissionAmount * 100) / 100,
        orders: orders.map((order) => ({
          orderId: order._id,
          orderNumber: order.orderNumber,
          total: order.total,
          createdAt: order.createdAt,
        })),
      };

      // Cache the result for 1 hour (3600 seconds)
      await redisService.set(cacheKey, result, 3600);
      logger.debug(`Commission calculation cached for agent ${agentId}`);

      return result;
    } catch (error) {
      logger.error(`Commission calculation error: ${error.message}`);
      throw new Error("Failed to calculate commission");
    }
  }

  /**
   * Create commission record
   * @param {Object} commissionData - Commission data
   * @returns {Promise<Object>} Created commission record
   */
  async createCommissionRecord(commissionData) {
    try {
      const commissionRecord = new CommissionRecord(commissionData);
      await commissionRecord.save();

      // Send WebSocket notification to agent
      try {
        websocketService.sendCommissionCreatedToUser(
          commissionData.agentId.toString(),
          {
            _id: commissionRecord._id.toString(),
            agentId: commissionData.agentId.toString(),
            tenantId: commissionData.tenantId.toString(),
            period: commissionData.period,
            periodStart: commissionData.periodStart,
            periodEnd: commissionData.periodEnd,
            totalOrders: commissionData.totalOrders,
            totalRevenue: commissionData.totalRevenue,
            commissionRate: commissionData.commissionRate,
            amount: commissionData.amount,
            status: commissionData.status || "pending",
            createdAt: commissionRecord.createdAt,
            updatedAt: commissionRecord.updatedAt,
          }
        );
      } catch (wsError) {
        logger.error(
          `Failed to send WebSocket commission created notification: ${wsError.message}`
        );
      }

      logger.info(
        `Commission record created for agent ${commissionData.agentId}: ${commissionData.amount}`
      );

      // Invalidate related caches
      await this.invalidateCommissionCache(
        commissionData.agentId,
        commissionData.tenantId
      );

      return commissionRecord;
    } catch (error) {
      logger.error(`Create commission record error: ${error.message}`);
      throw new Error("Failed to create commission record");
    }
  }

  /**
   * Get commission records for an agent
   * @param {string} agentId - Agent ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Commission records
   */
  async getAgentCommissions(agentId, filters = {}) {
    try {
      // Create cache key based on agent and filters
      const filterKey = JSON.stringify(filters);
      const cacheKey = `commission:agent:${agentId}:${Buffer.from(
        filterKey
      ).toString("base64")}`;

      // Try to get from cache first
      const cachedResult = await redisService.get(cacheKey);
      if (cachedResult) {
        logger.debug(`Agent commissions cache hit for agent ${agentId}`);
        return cachedResult;
      }

      const query = { agentId };

      if (filters.status) query.status = filters.status;
      if (filters.period) query.period = filters.period;
      if (filters.startDate && filters.endDate) {
        query.periodStart = { $gte: new Date(filters.startDate) };
        query.periodEnd = { $lte: new Date(filters.endDate) };
      }

      const commissions = await CommissionRecord.find(query)
        .sort({ periodStart: -1 })
        .populate("paidBy", "fullName email")
        .populate("agentId", "fullName email businessName userType");

      // Cache the result for 15 minutes (900 seconds)
      await redisService.set(cacheKey, commissions, 900);
      logger.debug(`Agent commissions cached for agent ${agentId}`);

      return commissions;
    } catch (error) {
      logger.error(`Get agent commissions error: ${error.message}`);
      throw new Error("Failed to fetch agent commissions");
    }
  }

  /**
   * Get all commission records (for super admin)
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Commission records
   */
  async getAllCommissions(filters = {}) {
    try {
      // Create cache key based on filters
      const filterKey = JSON.stringify(filters);
      const cacheKey = `commission:all:${Buffer.from(filterKey).toString(
        "base64"
      )}`;

      // Try to get from cache first
      const cachedResult = await redisService.get(cacheKey);
      if (cachedResult) {
        logger.debug("All commissions cache hit");
        return cachedResult;
      }

      const query = {};

      if (filters.status) query.status = filters.status;
      if (filters.agentId) query.agentId = filters.agentId;
      if (filters.period) query.period = filters.period;
      if (filters.month) {
        // Filter by month - create date range for the selected month
        const [year, month] = filters.month.split("-");
        const startDate = new Date(year, month - 1, 1); // Month is 0-indexed
        const endDate = new Date(year, month, 1); // Next month
        query.periodStart = { $gte: startDate, $lt: endDate };
      }
      if (filters.startDate && filters.endDate) {
        query.periodStart = { $gte: new Date(filters.startDate) };
        query.periodEnd = { $lte: new Date(filters.endDate) };
      }

      const commissions = await CommissionRecord.find(query)
        .sort({ periodStart: -1 })
        .populate("agentId", "fullName email businessName userType")
        .populate("paidBy", "fullName email");

      // Cache the result for 10 minutes (600 seconds)
      await redisService.set(cacheKey, commissions, 600);
      logger.debug("All commissions cached");

      return commissions;
    } catch (error) {
      logger.error(`Get all commissions error: ${error.message}`);
      throw new Error("Failed to fetch commissions");
    }
  }

  /**
   * Pay commission to agent
   * @param {string} commissionId - Commission record ID
   * @param {string} paidBy - User ID who is paying
   * @param {string} paymentReference - Payment reference
   * @returns {Promise<Object>} Updated commission record
   */
  async payCommission(commissionId, paidBy, paymentReference = null) {
    try {
      const commission = await CommissionRecord.findById(commissionId);

      if (!commission) {
        throw new Error("Commission record not found");
      }

      if (commission.status === "paid") {
        throw new Error("Commission already paid");
      }

      // Get agent details
      const agent = await User.findById(commission.agentId);

      if (!agent) {
        throw new Error("Agent not found");
      }

      // Get admin who is paying
      const admin = await User.findById(paidBy);

      // Credit commission amount to agent's wallet
      await walletService.creditWallet(
        commission.agentId,
        commission.amount,
        `Commission payment for ${
          commission.period
        } period (${commission.periodStart.toLocaleDateString()} - ${commission.periodEnd.toLocaleDateString()})`,
        paidBy,
        {
          commissionId: commission._id,
          period: commission.period,
          totalOrders: commission.totalOrders,
          totalRevenue: commission.totalRevenue,
          paymentReference: paymentReference || `COM-${commissionId}`,
        }
      );

      // Update commission record
      commission.status = "paid";
      commission.paidAt = new Date();
      commission.paidBy = paidBy;
      commission.paymentReference = paymentReference;
      await commission.save();

      // Send notification to agent
      try {
        await notificationService.createInAppNotification(
          commission.agentId.toString(),
          "Commission Paid",
          `Your commission of GH₵${commission.amount} for ${commission.period} period has been paid to your wallet.`,
          "success",
          {
            commissionId: commission._id.toString(),
            amount: commission.amount,
            period: commission.period,
            paidBy: admin?.fullName || admin?.email || "Admin",
            type: "commission_paid",
            navigationLink: "/agent/dashboard/wallet",
          }
        );

        // Send WebSocket notification
        websocketService.sendCommissionPaidToUser(
          commission.agentId.toString(),
          {
            _id: commission._id.toString(),
            agentId: commission.agentId.toString(),
            amount: commission.amount,
            period: commission.period,
            periodStart: commission.periodStart,
            periodEnd: commission.periodEnd,
            status: "paid",
            paidAt: commission.paidAt,
            paidBy: commission.paidBy,
            paymentReference: commission.paymentReference,
          }
        );
      } catch (notificationError) {
        logger.error(
          `Failed to send commission payment notification: ${notificationError.message}`
        );
      }

      logger.info(
        `Commission paid to agent ${agent.fullName}: GH₵${commission.amount}`
      );

      // Invalidate related caches
      await this.invalidateCommissionCache(
        commission.agentId,
        commission.tenantId
      );

      return commission;
    } catch (error) {
      logger.error(`Pay commission error: ${error.message}`);
      throw new Error("Failed to pay commission");
    }
  }

  /**
   * Reject a commission
   * @param {string} commissionId - Commission ID
   * @param {string} rejectedBy - User ID who is rejecting
   * @param {string} rejectionReason - Reason for rejection
   * @returns {Promise<Object>} Updated commission record
   */
  async rejectCommission(commissionId, rejectedBy, rejectionReason = null) {
    try {
      const commission = await CommissionRecord.findById(commissionId);

      if (!commission) {
        throw new Error("Commission record not found");
      }

      if (commission.status === "paid") {
        throw new Error("Cannot reject a paid commission");
      }

      if (commission.status === "rejected") {
        throw new Error("Commission already rejected");
      }

      // Get agent details
      const agent = await User.findById(commission.agentId);

      if (!agent) {
        throw new Error("Agent not found");
      }

      // Get admin who is rejecting
      const admin = await User.findById(rejectedBy);

      // Update commission record
      commission.status = "rejected";
      commission.rejectedAt = new Date();
      commission.rejectedBy = rejectedBy;
      commission.rejectionReason = rejectionReason;
      await commission.save();

      // Send notification to agent
      try {
        await notificationService.createInAppNotification(
          commission.agentId.toString(),
          "Commission Rejected",
          `Your commission of GH₵${commission.amount} for ${commission.period} period has been rejected.`,
          "error",
          {
            commissionId: commission._id.toString(),
            amount: commission.amount,
            period: commission.period,
            rejectedBy: admin?.fullName || admin?.email || "Admin",
            rejectionReason: rejectionReason,
            type: "commission_rejected",
            navigationLink: "/agent/dashboard/commissions",
          }
        );

        // Send WebSocket notification
        websocketService.sendToUser(commission.agentId.toString(), {
          type: "commission_rejected",
          commissionId: commission._id.toString(),
          amount: commission.amount,
          period: commission.period,
          rejectedBy: admin?.fullName || admin?.email || "Admin",
          rejectionReason: rejectionReason,
          message: `Your commission of GH₵${commission.amount} has been rejected.`,
          timestamp: new Date().toISOString(),
        });
      } catch (notificationError) {
        logger.error(
          `Failed to send commission rejection notification: ${notificationError.message}`
        );
      }

      logger.info(
        `Commission rejected for agent ${agent.fullName}: GH₵${commission.amount}`
      );

      // Invalidate related caches
      await this.invalidateCommissionCache(
        commission.agentId,
        commission.tenantId
      );

      return commission;
    } catch (error) {
      logger.error(`Reject commission error: ${error.message}`);
      throw new Error("Failed to reject commission");
    }
  }

  /**
   * Reject multiple commissions
   * @param {Array} commissionIds - Array of commission IDs
   * @param {string} rejectedBy - User ID who is rejecting
   * @param {string} rejectionReason - Reason for rejection
   * @returns {Promise<Array>} Array of results
   */
  async rejectMultipleCommissions(
    commissionIds,
    rejectedBy,
    rejectionReason = null
  ) {
    try {
      const results = [];

      for (const commissionId of commissionIds) {
        try {
          const commission = await this.rejectCommission(
            commissionId,
            rejectedBy,
            rejectionReason
          );
          results.push({ success: true, commissionId, commission });
        } catch (error) {
          results.push({ success: false, commissionId, error: error.message });
        }
      }

      return results;
    } catch (error) {
      logger.error(`Reject multiple commissions error: ${error.message}`);
      throw new Error("Failed to reject multiple commissions");
    }
  }

  /**
   * Pay multiple commissions
   * @param {Array} commissionIds - Array of commission IDs
   * @param {string} paidBy - User ID who is paying
   * @param {string} paymentReference - Payment reference
   * @returns {Promise<Array>} Array of updated commission records
   */
  async payMultipleCommissions(commissionIds, paidBy, paymentReference = null) {
    try {
      const results = [];

      for (const commissionId of commissionIds) {
        try {
          const commission = await this.payCommission(
            commissionId,
            paidBy,
            paymentReference
          );
          results.push({ success: true, commissionId, commission });
        } catch (error) {
          results.push({ success: false, commissionId, error: error.message });
        }
      }

      return results;
    } catch (error) {
      logger.error(`Pay multiple commissions error: ${error.message}`);
      throw new Error("Failed to pay multiple commissions");
    }
  }

  /**
   * Send commission notification to agent
   * @param {Object} agent - Agent object
   * @param {Object} commissionRecord - Commission record
   * @param {Date} periodStart - Period start date
   * @returns {Promise<void>}
   */
  async sendCommissionNotification(agent, commissionRecord, periodStart) {
    try {
      // Send in-app notification
      await notificationService.createInAppNotification(
        agent._id.toString(),
        "New Commission Generated",
        `Your commission of GH₵${
          commissionRecord.amount
        } for ${periodStart.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })} has been generated.`,
        "info",
        {
          commissionId: commissionRecord._id.toString(),
          amount: commissionRecord.amount,
          period: commissionRecord.period,
          totalOrders: commissionRecord.totalOrders,
          totalRevenue: commissionRecord.totalRevenue,
          type: "commission_generated",
          navigationLink: "/agent/dashboard/commissions",
        }
      );

      // Send WebSocket notification
      websocketService.sendToUser(agent._id.toString(), {
        type: "commission_generated",
        commissionId: commissionRecord._id.toString(),
        amount: commissionRecord.amount,
        period: commissionRecord.period,
        totalOrders: commissionRecord.totalOrders,
        totalRevenue: commissionRecord.totalRevenue,
        message: `New commission of GH₵${
          commissionRecord.amount
        } generated for ${periodStart.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })}!`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(
        `Failed to send commission notification for agent ${agent._id}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Generate monthly commission records for all agents
   * @param {Date} month - Month to generate commissions for (defaults to current month)
   * @returns {Promise<Array} Generated commission records
   */
  async generateMonthlyCommissions(month = new Date()) {
    try {
      const startTime = Date.now();
      const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
      const endOfMonth = new Date(
        month.getFullYear(),
        month.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

      logger.info(
        `Starting commission generation for ${startOfMonth.toLocaleDateString(
          "en-US",
          { month: "long", year: "numeric" }
        )}`
      );

      // Get all active agents in a single optimized query
      const agents = await User.find({
        userType: "agent",
        isActive: true,
      })
        .select("_id fullName email tenantId")
        .lean();

      if (agents.length === 0) {
        logger.info("No active agents found for commission generation");
        return [];
      }

      logger.info(
        `Processing ${agents.length} agents for commission generation`
      );

      const results = [];
      const batchSize = 10; // Process in batches to avoid memory issues

      // Process agents in batches for better performance
      for (let i = 0; i < agents.length; i += batchSize) {
        const batch = agents.slice(i, i + batchSize);
        logger.info(
          `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            agents.length / batchSize
          )} (${batch.length} agents)`
        );

        const batchPromises = batch.map(async (agent) => {
          try {
            // Check if commission record already exists for this period (optimized query)
            const existingRecord = await CommissionRecord.findOne({
              agentId: agent._id,
              period: "monthly",
              periodStart: startOfMonth,
              periodEnd: endOfMonth,
            })
              .select("_id")
              .lean();

            if (existingRecord) {
              return {
                agentId: agent._id,
                status: "exists",
                record: existingRecord,
              };
            }

            // For agents, use their userId as tenantId since they don't have a separate tenantId
            const agentTenantId = agent.tenantId || agent._id;

            // Calculate commission with optimized query
            const calculation = await this.calculateCommission(
              agent._id,
              agentTenantId,
              startOfMonth,
              endOfMonth
            );

            // Only create record if there's actual commission to pay
            if (calculation.amount > 0) {
              const commissionRecord = await this.createCommissionRecord({
                ...calculation,
                period: "monthly",
              });

              // Send notification asynchronously (don't block batch processing)
              setImmediate(async () => {
                try {
                  await this.sendCommissionNotification(
                    agent,
                    commissionRecord,
                    startOfMonth
                  );
                } catch (notificationError) {
                  logger.error(
                    `Failed to send commission notification for agent ${agent._id}: ${notificationError.message}`
                  );
                }
              });

              return {
                agentId: agent._id,
                status: "created",
                record: commissionRecord,
              };
            } else {
              // No commission to generate
              return {
                agentId: agent._id,
                status: "no_commission",
                message: "No orders/commission for this period",
              };
            }
          } catch (error) {
            logger.error(
              `Error processing agent ${agent._id}: ${error.message}`
            );
            return {
              agentId: agent._id,
              status: "error",
              error: error.message,
            };
          }
        });

        // Wait for current batch to complete before starting next batch
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Small delay between batches to prevent overwhelming the database
        if (i + batchSize < agents.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      const successful = results.filter((r) => r.status === "created").length;
      const existing = results.filter((r) => r.status === "exists").length;
      const noCommission = results.filter(
        (r) => r.status === "no_commission"
      ).length;
      const errors = results.filter((r) => r.status === "error").length;

      logger.info(
        `Commission generation completed in ${duration.toFixed(2)}s:`,
        {
          totalAgents: agents.length,
          successful,
          existing,
          noCommission,
          errors,
          successRate: `${((successful / agents.length) * 100).toFixed(1)}%`,
        }
      );

      return results;
    } catch (error) {
      logger.error(`Commission generation error: ${error.message}`);
      throw new Error("Failed to generate monthly commissions");
    }
  }

  /**
   * Reset monthly commissions - mark pending ones as expired and generate new ones
   * @param {Date} month - Month to reset (defaults to previous month)
   * @returns {Promise<Object>} Reset results
   */
  async resetMonthlyCommissions(month = new Date()) {
    try {
      // Get the previous month (the one we're resetting)
      const resetMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
      const resetMonthEnd = new Date(
        month.getFullYear(),
        month.getMonth(),
        0,
        23,
        59,
        59,
        999
      );

      // Get current month for new commissions
      const currentMonth = new Date(month.getFullYear(), month.getMonth(), 1);

      logger.info(
        `Resetting commissions for ${resetMonth.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })}`
      );

      // Find all pending commissions from the previous month
      const pendingCommissions = await CommissionRecord.find({
        status: "pending",
        period: "monthly",
        periodStart: resetMonth,
        periodEnd: resetMonthEnd,
      }).populate("agentId", "fullName email");

      const expiredCount = pendingCommissions.length;
      let expiredAmount = 0;

      // Mark pending commissions as expired
      for (const commission of pendingCommissions) {
        commission.status = "expired";
        commission.notes = `Expired on ${new Date().toLocaleDateString()} - Monthly reset`;
        await commission.save();
        expiredAmount += commission.amount;

        // Notify agent about expired commission
        try {
          await notificationService.createInAppNotification(
            commission.agentId._id.toString(),
            "Commission Expired",
            `Your pending commission of GH₵${
              commission.amount
            } for ${resetMonth.toLocaleDateString("en-US", {
              month: "long",
            })} has expired due to monthly reset.`,
            "warning",
            {
              commissionId: commission._id.toString(),
              amount: commission.amount,
              period: commission.period,
              expiredDate: new Date().toISOString(),
              type: "commission_expired",
            }
          );

          // Send WebSocket notification for expired commission
          websocketService.sendToUser(commission.agentId._id.toString(), {
            type: "commission_expired",
            commissionId: commission._id.toString(),
            amount: commission.amount,
            period: commission.period,
            message: `Your commission of GH₵${commission.amount} has expired due to monthly reset.`,
            timestamp: new Date().toISOString(),
          });
        } catch (notificationError) {
          logger.error(
            `Failed to send commission expiry notification: ${notificationError.message}`
          );
        }
      }

      // Generate new commissions for current month
      const generationResults = await this.generateMonthlyCommissions(
        currentMonth
      );

      const newCommissions = generationResults.filter(
        (r) => r.status === "created"
      );
      const newCommissionAmount = newCommissions.reduce(
        (sum, r) => sum + r.record.amount,
        0
      );

      logger.info(
        `Monthly commission reset completed: ${expiredCount} expired (GH₵${expiredAmount}), ${newCommissions.length} new (GH₵${newCommissionAmount})`
      );

      return {
        resetMonth: resetMonth.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        }),
        expiredCommissions: expiredCount,
        expiredAmount: Math.round(expiredAmount * 100) / 100,
        newCommissions: newCommissions.length,
        newCommissionAmount: Math.round(newCommissionAmount * 100) / 100,
        results: generationResults,
      };
    } catch (error) {
      logger.error(`Reset monthly commissions error: ${error.message}`);
      throw new Error("Failed to reset monthly commissions");
    }
  }

  /**
   * Get commission statistics
   * @param {string|null} tenantId - Tenant ID (null for super admin to show all)
   * @returns {Promise<Object>} Commission statistics
   */
  async getCommissionStatistics(tenantId) {
    try {
      // Create cache key based on tenant
      const cacheKey = `commission:stats:${tenantId || "all"}`;

      // Try to get from cache first
      const cachedResult = await redisService.get(cacheKey);
      if (cachedResult) {
        logger.debug(
          `Commission statistics cache hit for tenant ${tenantId || "all"}`
        );
        return cachedResult;
      }

      // Build query based on whether tenantId is provided
      const baseQuery = tenantId ? { tenantId } : {};

      // Use simpler queries to avoid timeout issues
      const [
        paidCommissions,
        pendingCommissions,
        totalAgents,
        monthlyCommissions,
      ] = await Promise.all([
        CommissionRecord.find({ ...baseQuery, status: "paid" }),
        CommissionRecord.find({ ...baseQuery, status: "pending" }),
        CommissionRecord.distinct("agentId", baseQuery),
        CommissionRecord.find({
          ...baseQuery,
          period: "monthly",
          periodStart: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        }),
      ]);

      // Calculate totals manually
      const totalPaid = paidCommissions.reduce(
        (sum, record) => sum + (record.amount || 0),
        0
      );
      const totalPending = pendingCommissions.reduce(
        (sum, record) => sum + (record.amount || 0),
        0
      );
      const pendingCount = pendingCommissions.length;

      // Calculate monthly stats
      const monthlyPaid = monthlyCommissions
        .filter((record) => record.status === "paid")
        .reduce((sum, record) => sum + (record.amount || 0), 0);
      const monthlyPending = monthlyCommissions
        .filter((record) => record.status === "pending")
        .reduce((sum, record) => sum + (record.amount || 0), 0);

      const result = {
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalPending: Math.round(totalPending * 100) / 100,
        pendingCount,
        totalAgents: totalAgents.length,
        thisMonth: {
          totalPaid: Math.round(monthlyPaid * 100) / 100,
          totalPending: Math.round(monthlyPending * 100) / 100,
          totalRecords: monthlyCommissions.length,
        },
      };

      // Cache the result for 5 minutes (300 seconds)
      await redisService.set(cacheKey, result, 300);
      logger.debug(
        `Commission statistics cached for tenant ${tenantId || "all"}`
      );

      return result;
    } catch (error) {
      logger.error(`Commission statistics error: ${error.message}`);
      return {
        totalPaid: 0,
        totalPending: 0,
        pendingCount: 0,
        totalAgents: 0,
        thisMonth: { totalPaid: 0, totalPending: 0, totalRecords: 0 },
      };
    }
  }

  /**
   * Update commission settings
   * @param {Object} settings - Commission settings
   * @returns {Promise<Object>} Updated settings
   */
  async updateCommissionSettings(settings) {
    try {
      const settingsDoc = await Settings.getInstance();

      if (settings.agentCommission !== undefined) {
        settingsDoc.agentCommission = settings.agentCommission;
      }

      if (settings.superAgentCommission !== undefined) {
        settingsDoc.superAgentCommission = settings.superAgentCommission;
      }

      if (settings.dealerCommission !== undefined) {
        settingsDoc.dealerCommission = settings.dealerCommission;
      }

      if (settings.superDealerCommission !== undefined) {
        settingsDoc.superDealerCommission = settings.superDealerCommission;
      }

      if (settings.defaultCommissionRate !== undefined) {
        settingsDoc.defaultCommissionRate = settings.defaultCommissionRate;
      }

      await settingsDoc.save();

      logger.info("Commission settings updated:", settings);

      // Invalidate settings cache (only if Redis is available)
      try {
        await this.invalidateSettingsCache();
      } catch (redisError) {
        logger.warn(
          "Failed to invalidate commission settings cache, continuing:",
          redisError.message
        );
      }

      return {
        agentCommission: settingsDoc.agentCommission,
        superAgentCommission: settingsDoc.superAgentCommission,
        dealerCommission: settingsDoc.dealerCommission,
        superDealerCommission: settingsDoc.superDealerCommission,
        defaultCommissionRate: settingsDoc.defaultCommissionRate,
      };
    } catch (error) {
      logger.error(`Update commission settings error: ${error.message}`);
      throw new Error("Failed to update commission settings");
    }
  }

  /**
   * Get commission settings
   * @returns {Promise<Object>} Commission settings
   */
  async getCommissionSettings() {
    try {
      // Create cache key for settings
      const cacheKey = "commission:settings";

      // Try to get from cache first (only if Redis is available)
      try {
        const cachedResult = await redisService.get(cacheKey);
        if (cachedResult) {
          logger.debug("Commission settings cache hit");
          return cachedResult;
        }
      } catch (redisError) {
        logger.warn(
          "Redis cache unavailable, proceeding with database query:",
          redisError.message
        );
      }

      const settings = await Settings.getInstance();
      const result = {
        agentCommission: settings.agentCommission,
        superAgentCommission: settings.superAgentCommission,
        dealerCommission: settings.dealerCommission,
        superDealerCommission: settings.superDealerCommission,
        defaultCommissionRate: settings.defaultCommissionRate,
      };

      // Try to cache the result (only if Redis is available)
      try {
        await redisService.set(cacheKey, result, 3600);
        logger.debug("Commission settings cached");
      } catch (redisError) {
        logger.warn(
          "Failed to cache commission settings, continuing without cache:",
          redisError.message
        );
      }

      return result;
    } catch (error) {
      logger.error(`Get commission settings error: ${error.message}`);
      throw new Error("Failed to get commission settings");
    }
  }

  /**
   * Invalidate commission-related caches
   * @param {string} agentId - Agent ID (optional, if not provided, clears all agent caches)
   * @param {string} tenantId - Tenant ID (optional)
   */
  async invalidateCommissionCache(agentId = null, tenantId = null) {
    try {
      const keysToDelete = [];

      if (agentId) {
        // Clear specific agent caches
        keysToDelete.push(`commission:agent:${agentId}:*`);
        if (tenantId) {
          // Clear calculation cache for specific agent and tenant
          const today = new Date();
          const startOfMonth = new Date(
            today.getFullYear(),
            today.getMonth(),
            1
          );
          const endOfMonth = new Date(
            today.getFullYear(),
            today.getMonth() + 1,
            0
          );
          const startDateStr = startOfMonth.toISOString().split("T")[0];
          const endDateStr = endOfMonth.toISOString().split("T")[0];
          keysToDelete.push(
            `commission:calc:${agentId}:${tenantId}:${startDateStr}:${endDateStr}`
          );
        }
      }

      // Always clear general caches
      keysToDelete.push("commission:all:*");
      keysToDelete.push("commission:stats:*");

      for (const pattern of keysToDelete) {
        const deletedCount = await redisService.delPattern(pattern);
        if (deletedCount > 0) {
          logger.debug(
            `Invalidated ${deletedCount} cache entries for pattern: ${pattern}`
          );
        }
      }
    } catch (error) {
      logger.error("Error invalidating commission cache:", error);
    }
  }

  /**
   * Invalidate settings cache
   */
  async invalidateSettingsCache() {
    try {
      const deleted = await redisService.del("commission:settings");
      if (deleted) {
        logger.debug("Commission settings cache invalidated");
      }
    } catch (error) {
      logger.warn(
        "Failed to invalidate commission settings cache, continuing without cache:",
        error.message
      );
    }
  }
}

export default new CommissionService();
