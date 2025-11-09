// src/services/commissionService.js
import CommissionRecord from "../models/CommissionRecord.js";
import CommissionMonthlySummary from "../models/CommissionMonthlySummary.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Settings from "../models/Settings.js";
import walletService from "./walletService.js";
import notificationService from "./notificationService.js";
import websocketService from "./websocketService.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";
import {
  COMMISSION_STATUS,
  COMMISSION_PERIOD,
  COMMISSION_DEFAULTS,
  COMMISSION_ERRORS,
  COMMISSION_MESSAGES,
  COMMISSION_EVENTS,
  COMMISSION_USER_TYPES,
  getCommissionRateField,
  getDefaultRate,
  isValidStatusTransition,
} from "../constants/commission.js";

class CommissionService {
  /**
   * Calculate commission for an agent for a specific period
   *
   * This is the core calculation function used by:
   * 1. Automatic generation when orders are completed (orderService.js)
   * 2. Manual/forced generation via admin dashboard
   * 3. Preview calculations before creating records
   *
   * @param {string} agentId - Agent ID (the user earning the commission)
   * @param {string} tenantId - Tenant ID (business owner, can be same as agentId)
   * @param {Date} startDate - Period start date (inclusive)
   * @param {Date} endDate - Period end date (inclusive)
   * @returns {Promise<Object>} Commission calculation result with breakdown
   */
  async calculateCommission(agentId, tenantId, startDate, endDate) {
    try {
      // Get agent details to determine commission rate
      const agent = await User.findById(agentId);
      if (!agent) {
        throw new Error(COMMISSION_ERRORS.AGENT_NOT_FOUND);
      }

      // Fetch all completed orders for the agent within the period
      // Note: Only 'completed' status orders count toward commission
      const orders = await Order.find({
        createdBy: agentId,
        tenantId: tenantId,
        status: "completed",
        createdAt: { $gte: startDate, $lte: endDate },
      });

      const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);

      // Get commission rate based on user type from Settings
      const settings = await Settings.getInstance();
      const rateField = getCommissionRateField(agent.userType);
      const defaultRate = getDefaultRate(agent.userType);

      // Use setting if available, otherwise use default rate for user type
      const commissionRate =
        settings[rateField] || settings.defaultCommissionRate || defaultRate;

      const commissionAmount = (totalRevenue * commissionRate) / 100;

      const result = {
        agentId,
        tenantId,
        periodStart: startDate,
        periodEnd: endDate,
        totalOrders: orders.length,
        totalRevenue,
        commissionRate,
        amount: Math.round(commissionAmount * 100) / 100, // Round to 2 decimal places
        orders: orders.map((order) => ({
          orderId: order._id,
          orderNumber: order.orderNumber,
          total: order.total,
          createdAt: order.createdAt,
        })),
      };

      logger.info(
        `Commission calculated for agent ${agent.fullName}: ${result.amount} from ${result.totalOrders} orders`
      );
      return result;
    } catch (error) {
      logger.error(`Commission calculation error: ${error.message}`);
      throw new Error(COMMISSION_ERRORS.CALCULATION_FAILED);
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
      const query = { agentId };

      if (filters.status) query.status = filters.status;
      if (filters.period) query.period = filters.period;
      if (filters.startDate && filters.endDate) {
        query.periodStart = { $gte: new Date(filters.startDate) };
        query.periodEnd = { $lte: new Date(filters.endDate) };
      }

      // Handle $or filter for complex status/period combinations
      if (filters.$or) {
        query.$or = filters.$or;
        // Remove individual status/period filters when using $or
        delete query.status;
        delete query.period;
      }

      const commissions = await CommissionRecord.find(query)
        .sort({ periodStart: -1 })
        .populate("paidBy", "fullName email")
        .populate("agentId", "fullName email businessName userType");

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

      // Populate first to enable search on agent details
      let commissions = await CommissionRecord.find(query)
        .sort({ periodStart: -1 })
        .populate("agentId", "fullName email businessName userType agentCode")
        .populate("paidBy", "fullName email");

      // Apply text search filter on populated agent data
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        commissions = commissions.filter((commission) => {
          const agent = commission.agentId;
          return (
            agent.fullName.toLowerCase().includes(searchLower) ||
            agent.email.toLowerCase().includes(searchLower) ||
            (agent.businessName &&
              agent.businessName.toLowerCase().includes(searchLower)) ||
            (agent.agentCode &&
              agent.agentCode.toLowerCase().includes(searchLower))
          );
        });
      }

      return commissions;
    } catch (error) {
      logger.error(`Get all commissions error: ${error.message}`);
      throw new Error("Failed to fetch commissions");
    }
  }

  /**
   * Pay commission to agent (with transaction safety)
   *
   * This is a critical operation that:
   * 1. Updates commission status to 'paid'
   * 2. Credits agent's wallet
   * 3. Creates wallet transaction record
   *
   * Uses MongoDB transactions to ensure atomicity - either all steps succeed or all rollback.
   * Notifications are sent AFTER transaction commits to avoid sending premature notifications.
   *
   * @param {string} commissionId - Commission record ID
   * @param {string} paidBy - User ID who is paying (typically super admin)
   * @param {string} paymentReference - Optional payment reference for audit trail
   * @returns {Promise<Object>} Updated commission record
   */
  async payCommission(commissionId, paidBy, paymentReference = null) {
    // Start a MongoDB session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Step 1: Validate commission exists and can be paid
      const commission = await CommissionRecord.findById(commissionId).session(
        session
      );

      if (!commission) {
        throw new Error(COMMISSION_ERRORS.COMMISSION_NOT_FOUND);
      }

      if (commission.status === COMMISSION_STATUS.PAID) {
        throw new Error(COMMISSION_ERRORS.ALREADY_PAID);
      }

      // Validate status transition
      if (!isValidStatusTransition(commission.status, COMMISSION_STATUS.PAID)) {
        throw new Error(COMMISSION_ERRORS.INVALID_STATUS_TRANSITION);
      }

      // Step 2: Get agent details
      const agent = await User.findById(commission.agentId).session(session);
      if (!agent) {
        throw new Error(COMMISSION_ERRORS.AGENT_NOT_FOUND);
      }

      // Get admin who is paying
      const admin = await User.findById(paidBy);

      // Step 3: Credit commission amount to agent's wallet (within transaction)
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
        },
        { session } // Pass session for transaction
      );

      // Step 4: Update commission record (within transaction)
      commission.status = COMMISSION_STATUS.PAID;
      commission.paidAt = new Date();
      commission.paidBy = paidBy;
      commission.paymentReference = paymentReference || `COM-${commissionId}`;
      await commission.save({ session });

      // Step 5: Commit transaction
      await session.commitTransaction();

      logger.info(
        `Commission paid successfully to agent ${agent.fullName}: GH₵${commission.amount}`
      );

      // Step 6: Send notifications (AFTER successful transaction)
      // This is outside transaction to avoid blocking if notifications fail
      setImmediate(async () => {
        try {
          // Get updated statistics for real-time updates
          const updatedStats = await this.getCurrentMonthStatistics(
            commission.tenantId,
            commission.agentId
          );

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
              type: COMMISSION_EVENTS.PAID,
              navigationLink: "/agent/dashboard/wallet",
            }
          );

          // Send WebSocket notification with updated stats
          websocketService.sendCommissionPaidToUser(
            commission.agentId.toString(),
            {
              _id: commission._id.toString(),
              agentId: commission.agentId.toString(),
              amount: commission.amount,
              period: commission.period,
              periodStart: commission.periodStart,
              periodEnd: commission.periodEnd,
              status: COMMISSION_STATUS.PAID,
              paidAt: commission.paidAt,
              paidBy: commission.paidBy,
              paymentReference: commission.paymentReference,
              // Include updated statistics for real-time frontend updates
              updatedStats: updatedStats.currentMonth,
            }
          );
        } catch (notificationError) {
          // Log notification errors but don't fail the payment
          logger.error(
            `Failed to send commission payment notification: ${notificationError.message}`
          );
        }
      });

      return commission;
    } catch (error) {
      // Rollback transaction on any error
      await session.abortTransaction();
      logger.error(`Pay commission error: ${error.message}`);
      throw new Error(COMMISSION_ERRORS.PAYMENT_FAILED + ": " + error.message);
    } finally {
      // Always end the session
      session.endSession();
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
            type: COMMISSION_EVENTS.REJECTED,
            navigationLink: "/agent/dashboard/commissions",
          }
        );

        // Send WebSocket notification
        websocketService.sendToUser(commission.agentId.toString(), {
          type: COMMISSION_EVENTS.REJECTED,
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
      // Get updated statistics for real-time updates
      const updatedStats = await this.getCurrentMonthStatistics(
        agent.tenantId || agent._id,
        agent._id
      );

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
          type: COMMISSION_EVENTS.GENERATED,
          navigationLink: "/agent/dashboard/commissions",
        }
      );

      // Send WebSocket notification with updated stats
      websocketService.sendToUser(agent._id.toString(), {
        type: COMMISSION_EVENTS.GENERATED,
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
        // Include updated statistics for real-time frontend updates
        updatedStats: updatedStats.currentMonth,
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
   *
   * IMPORTANT: This function is called in TWO ways:
   * 1. AUTOMATIC: When an order is completed (orderService.js) - generates for current month
   * 2. MANUAL: Via admin dashboard - can generate/regenerate for any month
   *
   * To prevent duplicate commission records:
   * - Automatic calls skip if record already exists (force=false)
   * - Manual calls can force regeneration (force=true) for recalculation
   *
   * Batch Processing:
   * - Processes agents in batches of 10 to avoid memory issues
   * - 100ms delay between batches to prevent database overload
   * - Progress can be tracked via callback function
   *
   * @param {Date} month - Month to generate commissions for (defaults to current month)
   * @param {boolean} force - If true, regenerate even if records exist (manual only)
   * @param {Function} onProgress - Optional callback for progress updates (processed, total, percentage)
   * @returns {Promise<Object>} Generation results with summary statistics
   */
  async generateMonthlyCommissions(
    month = new Date(),
    force = false,
    onProgress = null
  ) {
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

      const monthName = startOfMonth.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });

      logger.info(
        `Starting commission generation for ${monthName} (force: ${force})`
      );

      // Check if commissions already exist for this period (unless force=true)
      if (!force) {
        const existingCount = await CommissionRecord.countDocuments({
          period: COMMISSION_PERIOD.MONTHLY,
          periodStart: startOfMonth,
          periodEnd: endOfMonth,
        });

        if (existingCount > 0) {
          logger.warn(
            `Commissions already generated for ${monthName} (${existingCount} records). Use force=true to regenerate.`
          );
          throw new Error(
            COMMISSION_ERRORS.DUPLICATE_GENERATION +
              `. Found ${existingCount} existing records. Use force flag to regenerate.`
          );
        }
      }

      // Get all active agents in a single optimized query
      const agents = await User.find({
        userType: COMMISSION_USER_TYPES.AGENT,
        isActive: true,
      })
        .select("_id fullName email tenantId")
        .lean();

      if (agents.length === 0) {
        logger.info("No active agents found for commission generation");
        return {
          summary: {
            totalAgents: 0,
            created: 0,
            exists: 0,
            noCommission: 0,
            errors: 0,
          },
          results: [],
          month: monthName,
          duration: 0,
        };
      }

      logger.info(
        `Processing ${agents.length} agents for commission generation`
      );

      const results = [];
      const batchSize = COMMISSION_DEFAULTS.BATCH_SIZE;

      // Process agents in batches for better performance
      for (let i = 0; i < agents.length; i += batchSize) {
        const batch = agents.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(agents.length / batchSize);

        logger.info(
          `Processing batch ${batchNumber}/${totalBatches} (${batch.length} agents)`
        );

        const batchPromises = batch.map(async (agent) => {
          try {
            // Check if commission record already exists for this period
            const existingRecord = await CommissionRecord.findOne({
              agentId: agent._id,
              period: COMMISSION_PERIOD.MONTHLY,
              periodStart: startOfMonth,
              periodEnd: endOfMonth,
            })
              .select("_id amount status")
              .lean();

            if (existingRecord && !force) {
              return {
                agentId: agent._id,
                agentName: agent.fullName,
                status: "exists",
                record: existingRecord,
              };
            }

            // Delete existing record if force=true
            if (existingRecord && force) {
              await CommissionRecord.deleteOne({ _id: existingRecord._id });
              logger.info(
                `Deleted existing commission record for agent ${agent.fullName} (force regeneration)`
              );
            }

            // For agents, tenantId can be their own ID or a parent tenant
            // Note: This is a known ambiguity - see COMMISSION_SYSTEM_ANALYSIS.md issue #3
            const agentTenantId = agent.tenantId || agent._id;

            // Calculate commission
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
                period: COMMISSION_PERIOD.MONTHLY,
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
                agentName: agent.fullName,
                status: "created",
                record: {
                  _id: commissionRecord._id,
                  amount: commissionRecord.amount,
                  totalOrders: commissionRecord.totalOrders,
                },
              };
            } else {
              // No commission to generate
              return {
                agentId: agent._id,
                agentName: agent.fullName,
                status: "no_commission",
                message: "No orders/commission for this period",
              };
            }
          } catch (error) {
            logger.error(
              `Error processing agent ${agent.fullName}: ${error.message}`
            );
            return {
              agentId: agent._id,
              agentName: agent.fullName,
              status: "error",
              error: error.message,
            };
          }
        });

        // Wait for current batch to complete before starting next batch
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Report progress if callback provided
        if (onProgress) {
          const processed = Math.min(i + batchSize, agents.length);
          const percentage = (processed / agents.length) * 100;
          onProgress({
            processed,
            total: agents.length,
            percentage: Math.round(percentage * 100) / 100,
            batch: batchNumber,
            totalBatches,
          });
        }

        // Small delay between batches to prevent overwhelming the database
        if (i + batchSize < agents.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, COMMISSION_DEFAULTS.BATCH_DELAY_MS)
          );
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

      const summary = {
        totalAgents: agents.length,
        created: successful,
        exists: existing,
        noCommission,
        errors,
        successRate:
          agents.length > 0
            ? `${((successful / agents.length) * 100).toFixed(1)}%`
            : "0%",
      };

      logger.info(
        `Commission generation completed in ${duration.toFixed(2)}s:`,
        summary
      );

      return {
        summary,
        results,
        month: monthName,
        duration: duration.toFixed(2),
        force,
      };
    } catch (error) {
      logger.error(`Commission generation error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate daily commissions for all agents
   * Runs daily to create commission records for the previous day
   * @param {Date} date - Date to generate commissions for (defaults to yesterday)
   * @returns {Promise<Object>} Generation results with summary statistics
   */
  async generateDailyCommissions(date = new Date()) {
    try {
      // Calculate yesterday's date range
      const yesterday = new Date(date);
      yesterday.setDate(yesterday.getDate() - 1);
      const startOfDay = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate()
      );
      const endOfDay = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate(),
        23,
        59,
        59,
        999
      );

      const dayName = yesterday.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      logger.info(`Starting daily commission generation for ${dayName}`);

      // Get all active agents in a single optimized query
      const agents = await User.find({
        userType: COMMISSION_USER_TYPES.AGENT,
        isActive: true,
      })
        .select("_id fullName email tenantId")
        .lean();

      if (agents.length === 0) {
        logger.info("No active agents found for daily commission generation");
        return {
          summary: {
            totalAgents: 0,
            created: 0,
            updated: 0,
            noCommission: 0,
            errors: 0,
          },
          results: [],
          day: dayName,
          duration: 0,
        };
      }

      logger.info(
        `Processing ${agents.length} agents for daily commission generation`
      );

      const results = [];
      const batchSize = COMMISSION_DEFAULTS.BATCH_SIZE;

      // Process agents in batches for better performance
      for (let i = 0; i < agents.length; i += batchSize) {
        const batch = agents.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(agents.length / batchSize);

        logger.info(
          `Processing batch ${batchNumber}/${totalBatches} (${batch.length} agents)`
        );

        const batchPromises = batch.map(async (agent) => {
          try {
            // Check if commission record already exists for this day
            const existingRecord = await CommissionRecord.findOne({
              agentId: agent._id,
              period: COMMISSION_PERIOD.DAILY,
              periodStart: startOfDay,
              periodEnd: endOfDay,
            })
              .select("_id amount status totalOrders totalRevenue")
              .lean();

            // For agents, tenantId can be their own ID or a parent tenant
            const agentTenantId = agent.tenantId || agent._id;

            // Calculate commission for this day
            const calculation = await this.calculateCommission(
              agent._id,
              agentTenantId,
              startOfDay,
              endOfDay
            );

            // Only create/update record if there's actual commission to pay
            if (calculation.amount > 0) {
              if (existingRecord) {
                // Update existing record (shouldn't happen in normal operation, but handle it)
                await CommissionRecord.updateOne(
                  { _id: existingRecord._id },
                  {
                    $set: {
                      totalOrders: calculation.totalOrders,
                      totalRevenue: calculation.totalRevenue,
                      amount: calculation.amount,
                      commissionRate: calculation.commissionRate,
                      updatedAt: new Date(),
                    },
                  }
                );

                return {
                  agentId: agent._id,
                  agentName: agent.fullName,
                  status: "updated",
                  record: {
                    _id: existingRecord._id,
                    amount: calculation.amount,
                    totalOrders: calculation.totalOrders,
                    totalRevenue: calculation.totalRevenue,
                  },
                };
              } else {
                // Create new daily record
                const commissionRecord = await this.createCommissionRecord({
                  ...calculation,
                  period: COMMISSION_PERIOD.DAILY,
                  periodStart: startOfDay,
                  periodEnd: endOfDay,
                  isFinal: false, // Daily records are never final until month-end
                });

                // Send notification asynchronously
                setImmediate(async () => {
                  try {
                    await this.sendCommissionNotification(
                      agent,
                      commissionRecord,
                      startOfDay
                    );
                  } catch (notificationError) {
                    logger.error(
                      `Failed to send daily commission notification for agent ${agent._id}: ${notificationError.message}`
                    );
                  }
                });

                return {
                  agentId: agent._id,
                  agentName: agent.fullName,
                  status: "created",
                  record: {
                    _id: commissionRecord._id,
                    amount: commissionRecord.amount,
                    totalOrders: commissionRecord.totalOrders,
                  },
                };
              }
            } else {
              // No commission to generate for this day
              return {
                agentId: agent._id,
                agentName: agent.fullName,
                status: "no_commission",
                message: "No orders/commission for this day",
              };
            }
          } catch (error) {
            logger.error(
              `Error processing agent ${agent.fullName} for daily commission: ${error.message}`
            );
            return {
              agentId: agent._id,
              agentName: agent.fullName,
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
          await new Promise((resolve) =>
            setTimeout(resolve, COMMISSION_DEFAULTS.BATCH_DELAY_MS)
          );
        }
      }

      const created = results.filter((r) => r.status === "created").length;
      const updated = results.filter((r) => r.status === "updated").length;
      const noCommission = results.filter(
        (r) => r.status === "no_commission"
      ).length;
      const errors = results.filter((r) => r.status === "error").length;

      const summary = {
        totalAgents: agents.length,
        created,
        updated,
        noCommission,
        errors,
        successRate:
          agents.length > 0
            ? `${(((created + updated) / agents.length) * 100).toFixed(1)}%`
            : "0%",
      };

      logger.info(`Daily commission generation completed:`, summary);

      return {
        summary,
        results,
        day: dayName,
        duration: 0, // Will be set by caller
      };
    } catch (error) {
      logger.error(`Daily commission generation error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reset monthly commissions - mark pending ones as expired and generate new ones
   * @param {Date} month - Month to reset (defaults to previous month)
   * @returns {Promise<Object>} Reset results
   */
  async resetMonthlyCommissions(month = new Date()) {
    try {
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
              type: COMMISSION_EVENTS.EXPIRED,
            }
          );

          // Send WebSocket notification for expired commission
          websocketService.sendToUser(commission.agentId._id.toString(), {
            type: COMMISSION_EVENTS.EXPIRED,
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
      const settings = await Settings.getInstance();
      const result = {
        agentCommission: settings.agentCommission,
        superAgentCommission: settings.superAgentCommission,
        dealerCommission: settings.dealerCommission,
        superDealerCommission: settings.superDealerCommission,
        defaultCommissionRate: settings.defaultCommissionRate,
      };

      return result;
    } catch (error) {
      logger.error(`Get commission settings error: ${error.message}`);
      throw new Error("Failed to get commission settings");
    }
  }

  /**
   * Archive commissions for a specific month
   *
   * Creates a CommissionMonthlySummary for each agent and marks
   * commission records as archived.
   *
   * @param {number} year - Year to archive (e.g., 2025)
   * @param {number} monthNumber - Month number (1-12)
   * @param {string|null} archivedBy - User ID who triggered archival (null for automatic)
   * @returns {Promise<Object>} Archival results
   */
  async archiveMonthCommissions(year, monthNumber, archivedBy = null) {
    try {
      const startTime = Date.now();

      // Create date range for the month
      const startOfMonth = new Date(year, monthNumber - 1, 1);
      const endOfMonth = new Date(year, monthNumber, 0, 23, 59, 59, 999);
      const monthStr = `${year}-${String(monthNumber).padStart(2, "0")}`;
      const monthName = startOfMonth.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });

      logger.info(`Starting archival for ${monthName}...`);

      // Find all commission records for this month
      const commissionRecords = await CommissionRecord.find({
        period: COMMISSION_PERIOD.MONTHLY,
        periodStart: { $gte: startOfMonth },
        periodEnd: { $lte: endOfMonth },
      }).populate("agentId", "fullName email");

      if (commissionRecords.length === 0) {
        logger.info(`No commission records found for ${monthName}`);
        return {
          success: true,
          month: monthName,
          summariesCreated: 0,
          recordsArchived: 0,
          message: "No records to archive",
        };
      }

      // Group records by agent
      const recordsByAgent = {};
      for (const record of commissionRecords) {
        const agentId = record.agentId._id.toString();
        if (!recordsByAgent[agentId]) {
          recordsByAgent[agentId] = {
            agent: record.agentId,
            tenantId: record.tenantId,
            records: [],
          };
        }
        recordsByAgent[agentId].records.push(record);
      }

      const summariesCreated = [];
      let recordsArchived = 0;

      // Create summary for each agent
      for (const [agentId, data] of Object.entries(recordsByAgent)) {
        try {
          const { agent, tenantId, records } = data;

          // Calculate aggregates
          const totalEarned = records.reduce((sum, r) => sum + r.amount, 0);
          const totalPaid = records
            .filter((r) => r.status === COMMISSION_STATUS.PAID)
            .reduce((sum, r) => sum + r.amount, 0);
          const totalPending = records
            .filter((r) => r.status === COMMISSION_STATUS.PENDING)
            .reduce((sum, r) => sum + r.amount, 0);
          const totalRejected = records
            .filter((r) => r.status === COMMISSION_STATUS.REJECTED)
            .reduce((sum, r) => sum + r.amount, 0);
          const totalExpired = records
            .filter((r) => r.status === COMMISSION_STATUS.EXPIRED)
            .reduce((sum, r) => sum + r.amount, 0);
          const orderCount = records.reduce((sum, r) => sum + r.totalOrders, 0);
          const revenue = records.reduce((sum, r) => sum + r.totalRevenue, 0);
          const avgCommissionRate =
            records.reduce((sum, r) => sum + r.commissionRate, 0) /
            records.length;

          // Create or update summary
          let summary = await CommissionMonthlySummary.findOne({
            agentId: agentId,
            month: monthStr,
          });

          if (!summary) {
            summary = new CommissionMonthlySummary({
              month: monthStr,
              year,
              monthNumber,
              monthName,
              agentId,
              tenantId,
              totalEarned,
              totalPaid,
              totalPending,
              totalRejected,
              totalExpired,
              orderCount,
              revenue,
              commissionRate: Math.round(avgCommissionRate * 100) / 100,
              recordIds: records.map((r) => r._id),
              recordCount: records.length,
              isArchived: true,
              archivedAt: new Date(),
              archivedBy: archivedBy,
            });
          } else {
            // Update existing summary
            summary.totalEarned = totalEarned;
            summary.totalPaid = totalPaid;
            summary.totalPending = totalPending;
            summary.totalRejected = totalRejected;
            summary.totalExpired = totalExpired;
            summary.orderCount = orderCount;
            summary.revenue = revenue;
            summary.commissionRate = Math.round(avgCommissionRate * 100) / 100;
            summary.recordIds = records.map((r) => r._id);
            summary.recordCount = records.length;
            summary.isArchived = true;
            summary.archivedAt = new Date();
            summary.archivedBy = archivedBy;
          }

          // Update payment status
          summary.updatePaymentStatus();
          await summary.save();

          summariesCreated.push(summary);
          recordsArchived += records.length;

          logger.info(
            `Created summary for ${agent.fullName}: ${records.length} records, GH₵${totalEarned}`
          );
        } catch (error) {
          logger.error(
            `Failed to create summary for agent ${agentId}: ${error.message}`
          );
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info(
        `Archival completed for ${monthName} in ${duration}s: ${summariesCreated.length} summaries, ${recordsArchived} records`
      );

      return {
        success: true,
        month: monthName,
        monthStr,
        summariesCreated: summariesCreated.length,
        recordsArchived,
        summaries: summariesCreated,
        duration,
      };
    } catch (error) {
      logger.error(`Archive month commissions error: ${error.message}`);
      throw new Error("Failed to archive month commissions");
    }
  }

  /**
   * Get monthly summaries for an agent
   *
   * @param {string} agentId - Agent ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Monthly summaries
   */
  async getAgentMonthlySummaries(agentId, options = {}) {
    try {
      return await CommissionMonthlySummary.getAgentSummaries(agentId, options);
    } catch (error) {
      logger.error(`Get agent monthly summaries error: ${error.message}`);
      throw new Error("Failed to get agent monthly summaries");
    }
  }

  /**
   * Get monthly summaries for all agents (tenant/super admin)
   *
   * @param {string|null} tenantId - Tenant ID (null for super admin)
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Monthly summaries
   */
  async getAllMonthlySummaries(tenantId = null, options = {}) {
    try {
      if (tenantId) {
        return await CommissionMonthlySummary.getTenantSummaries(
          tenantId,
          options
        );
      } else {
        // Super admin - get all summaries
        const query = {};

        if (options.paymentStatus) {
          query.paymentStatus = options.paymentStatus;
        }

        if (options.month) {
          query.month = options.month;
        }

        return await CommissionMonthlySummary.find(query)
          .sort({ year: -1, monthNumber: -1 })
          .limit(options.limit || 100)
          .populate("agentId", "fullName email agentCode userType");
      }
    } catch (error) {
      logger.error(`Get all monthly summaries error: ${error.message}`);
      throw new Error("Failed to get monthly summaries");
    }
  }

  /**
   * Get current month commission statistics (separated from historical)
   *
   * @param {string|null} tenantId - Tenant ID (null for super admin)
   * @param {string|null} agentId - Agent ID (for agent-specific stats)
   * @returns {Promise<Object>} Current month statistics
   */
  async getCurrentMonthStatistics(tenantId = null, agentId = null) {
    try {
      const currentDate = new Date();
      const startOfMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      const endOfMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

      // Get all non-finalized records within current month (regardless of period type)
      // This allows for daily, weekly, or monthly period records to be included
      const baseQuery = {
        periodStart: { $gte: startOfMonth, $lte: endOfMonth },
        isFinal: false, // Only current month's real-time records
      };

      if (tenantId) baseQuery.tenantId = tenantId;
      if (agentId) baseQuery.agentId = agentId;

      const [currentMonthRecords] = await Promise.all([
        CommissionRecord.find(baseQuery),
      ]);

      // Calculate current month stats (real-time accumulation)
      const totalEarned = currentMonthRecords.reduce(
        (sum, r) => sum + r.amount,
        0
      );
      const totalPaid = currentMonthRecords
        .filter((r) => r.status === COMMISSION_STATUS.PAID)
        .reduce((sum, r) => sum + r.amount, 0);
      const totalPending = currentMonthRecords
        .filter((r) => r.status === COMMISSION_STATUS.PENDING)
        .reduce((sum, r) => sum + r.amount, 0);
      const totalRejected = currentMonthRecords
        .filter((r) => r.status === COMMISSION_STATUS.REJECTED)
        .reduce((sum, r) => sum + r.amount, 0);

      const pendingCount = currentMonthRecords.filter(
        (r) => r.status === COMMISSION_STATUS.PENDING
      ).length;
      const uniqueAgents = new Set(
        currentMonthRecords.map((r) => r.agentId.toString())
      ).size;

      return {
        currentMonth: {
          month: currentDate.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          }),
          totalEarned: Math.round(totalEarned * 100) / 100,
          totalPaid: Math.round(totalPaid * 100) / 100,
          totalPending: Math.round(totalPending * 100) / 100,
          totalRejected: Math.round(totalRejected * 100) / 100,
          pendingCount,
          totalRecords: currentMonthRecords.length,
          agentCount: uniqueAgents,
        },
      };
    } catch (error) {
      logger.error(`Get current month statistics error: ${error.message}`);
      return {
        currentMonth: {
          totalEarned: 0,
          totalPaid: 0,
          totalPending: 0,
          totalRejected: 0,
          pendingCount: 0,
          totalRecords: 0,
          agentCount: 0,
        },
      };
    }
  }

  /**
   * Update or create commission record in real-time when order is completed
   * This replaces the old batch generation system
   * @param {string} orderId - Completed order ID
   * @returns {Promise<Object>} Updated/created commission record
   */
  async updateCommissionRealTime(orderId) {
    try {
      const order = await Order.findById(orderId)
        .populate("createdBy", "userType fullName email")
        .populate("tenantId", "_id");

      if (!order || order.status !== "completed") {
        logger.warn(`Order ${orderId} not found or not completed`);
        return null;
      }

      const agentId = order.createdBy._id;
      const tenantId = order.tenantId._id;

      // Get current month period
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

      // Find or create current month commission record for this agent
      let commissionRecord = await CommissionRecord.findOne({
        agentId,
        tenantId,
        periodStart: { $gte: periodStart, $lte: periodEnd },
        isFinal: false, // Only update non-finalized records
      });

      // Get commission rate
      const settings = await Settings.getInstance();
      const rateField = getCommissionRateField(order.createdBy.userType);
      const defaultRate = getDefaultRate(order.createdBy.userType);
      const commissionRate =
        settings[rateField] || settings.defaultCommissionRate || defaultRate;

      // Calculate commission for this order
      const orderCommission = (order.total * commissionRate) / 100;

      if (commissionRecord) {
        // Update existing record
        commissionRecord.totalOrders += 1;
        commissionRecord.totalRevenue += order.total;
        commissionRecord.amount += orderCommission;
        commissionRecord.amount =
          Math.round(commissionRecord.amount * 100) / 100;
        await commissionRecord.save();

        logger.info(
          `Updated commission for agent ${
            order.createdBy.fullName
          }: +${orderCommission.toFixed(2)} (Total: ${commissionRecord.amount})`
        );
      } else {
        // Create new record for current month
        commissionRecord = await this.createCommissionRecord({
          agentId,
          tenantId,
          period: COMMISSION_PERIOD.MONTHLY,
          periodStart,
          periodEnd,
          totalOrders: 1,
          totalRevenue: order.total,
          commissionRate,
          amount: Math.round(orderCommission * 100) / 100,
          status: COMMISSION_STATUS.PENDING,
          isFinal: false,
        });

        logger.info(
          `Created new commission record for agent ${
            order.createdBy.fullName
          }: ${orderCommission.toFixed(2)}`
        );
      }

      // Send real-time WebSocket update to agent
      try {
        websocketService.sendCommissionUpdatedToUser(agentId.toString(), {
          _id: commissionRecord._id.toString(),
          amount: commissionRecord.amount,
          totalOrders: commissionRecord.totalOrders,
          totalRevenue: commissionRecord.totalRevenue,
          status: commissionRecord.status,
          periodStart: commissionRecord.periodStart,
          periodEnd: commissionRecord.periodEnd,
        });

        // Also notify super admins of the update
        const superAdmins = await User.find({ userType: "super_admin" });
        for (const admin of superAdmins) {
          websocketService.sendCommissionUpdatedToUser(admin._id.toString(), {
            agentId: agentId.toString(),
            agentName: order.createdBy.fullName,
            _id: commissionRecord._id.toString(),
            amount: commissionRecord.amount,
            totalOrders: commissionRecord.totalOrders,
            totalRevenue: commissionRecord.totalRevenue,
          });
        }
      } catch (wsError) {
        logger.error(`Failed to send WebSocket update: ${wsError.message}`);
      }

      return commissionRecord;
    } catch (error) {
      logger.error(`Real-time commission update error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Finalize all commissions for the previous month
   * Now aggregates daily records into monthly summaries and finalizes daily records
   * Run on 1st of each month via cron job
   * @returns {Promise<Object>} Finalization result
   */
  async finalizeMonthCommissions() {
    try {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        0,
        23,
        59,
        59,
        999
      );

      logger.info(
        `Starting monthly commission finalization for ${lastMonth.toLocaleDateString(
          "en-US",
          { month: "long", year: "numeric" }
        )}`
      );

      // Find all non-finalized daily commission records from last month
      const dailyRecords = await CommissionRecord.find({
        period: COMMISSION_PERIOD.DAILY,
        periodStart: { $gte: lastMonth, $lte: lastMonthEnd },
        isFinal: false,
      }).populate("agentId", "fullName email");

      if (dailyRecords.length === 0) {
        logger.info("No daily commission records to finalize for last month");
        return {
          success: true,
          count: 0,
          totalAmount: 0,
          totalPending: 0,
          message: "No daily records to finalize",
        };
      }

      // Group daily records by agent
      const recordsByAgent = {};
      for (const record of dailyRecords) {
        const agentId = record.agentId._id.toString();
        if (!recordsByAgent[agentId]) {
          recordsByAgent[agentId] = {
            agent: record.agentId,
            tenantId: record.tenantId,
            records: [],
          };
        }
        recordsByAgent[agentId].records.push(record);
      }

      let totalFinalizedRecords = 0;
      let totalAmount = 0;
      let totalPending = 0;
      const monthlySummaries = [];

      // Create monthly summary for each agent and finalize daily records
      for (const [agentId, data] of Object.entries(recordsByAgent)) {
        try {
          const { agent, tenantId, records } = data;

          // Calculate monthly aggregates from daily records
          const monthlyTotal = records.reduce((sum, r) => sum + r.amount, 0);
          const monthlyOrders = records.reduce(
            (sum, r) => sum + r.totalOrders,
            0
          );
          const monthlyRevenue = records.reduce(
            (sum, r) => sum + r.totalRevenue,
            0
          );
          const avgCommissionRate =
            records.reduce((sum, r) => sum + r.commissionRate, 0) /
            records.length;

          // Create monthly summary record
          const monthlySummary = await this.createCommissionRecord({
            agentId,
            tenantId,
            period: COMMISSION_PERIOD.MONTHLY,
            periodStart: lastMonth,
            periodEnd: lastMonthEnd,
            totalOrders: monthlyOrders,
            totalRevenue: monthlyRevenue,
            commissionRate: Math.round(avgCommissionRate * 100) / 100,
            amount: Math.round(monthlyTotal * 100) / 100,
            status: COMMISSION_STATUS.PENDING,
            isFinal: true, // Monthly summaries are always final
            finalizedAt: now,
          });

          monthlySummaries.push(monthlySummary);

          // Mark all daily records for this agent as finalized
          await CommissionRecord.updateMany(
            {
              agentId,
              period: COMMISSION_PERIOD.DAILY,
              periodStart: { $gte: lastMonth, $lte: lastMonthEnd },
              isFinal: false,
            },
            {
              $set: {
                isFinal: true,
                finalizedAt: now,
              },
            }
          );

          totalFinalizedRecords += records.length;
          totalAmount += monthlyTotal;

          if (monthlySummary.status === COMMISSION_STATUS.PENDING) {
            totalPending += monthlyTotal;
          }

          logger.info(
            `Finalized ${records.length} daily records for ${
              agent.fullName
            }: GHS ${monthlyTotal.toFixed(2)}`
          );
        } catch (error) {
          logger.error(
            `Failed to finalize monthly commissions for agent ${agentId}: ${error.message}`
          );
        }
      }

      // Send notifications to agents and super admins
      for (const summary of monthlySummaries) {
        try {
          const agent = summary.agentId;
          await notificationService.createNotification({
            userId: agent._id,
            type: "commission",
            title: "Monthly Commission Finalized",
            message: `Your commission for ${lastMonth.toLocaleDateString(
              "en-US",
              { month: "long", year: "numeric" }
            )} has been finalized: GHS ${summary.amount.toFixed(2)} (${
              summary.status
            })`,
            relatedId: summary._id,
            relatedModel: "CommissionRecord",
          });

          websocketService.sendCommissionFinalizedToUser(agent._id.toString(), {
            _id: summary._id.toString(),
            amount: summary.amount,
            status: summary.status,
            month: lastMonth.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            }),
          });
        } catch (notifError) {
          logger.error(
            `Failed to notify agent ${summary.agentId._id}: ${notifError.message}`
          );
        }
      }

      // Notify super admins
      const superAdmins = await User.find({ userType: "super_admin" });
      for (const admin of superAdmins) {
        try {
          await notificationService.createNotification({
            userId: admin._id,
            type: "commission",
            title: "Monthly Commissions Finalized",
            message: `${
              monthlySummaries.length
            } monthly summaries created from ${totalFinalizedRecords} daily records. Total pending payment: GHS ${totalPending.toFixed(
              2
            )}`,
            priority: "high",
          });
        } catch (notifError) {
          logger.error(
            `Failed to notify admin ${admin._id}: ${notifError.message}`
          );
        }
      }

      logger.info(
        `Monthly commission finalization completed: ${totalFinalizedRecords} daily records finalized, ${
          monthlySummaries.length
        } monthly summaries created, Total: GHS ${totalAmount.toFixed(
          2
        )}, Pending: GHS ${totalPending.toFixed(2)}`
      );

      return {
        success: true,
        count: totalFinalizedRecords,
        monthlySummariesCount: monthlySummaries.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalPending: Math.round(totalPending * 100) / 100,
        message: `Successfully finalized ${totalFinalizedRecords} daily records into ${monthlySummaries.length} monthly summaries`,
      };
    } catch (error) {
      logger.error(`Finalize month commissions error: ${error.message}`);
      throw error;
    }
  }
}

export default new CommissionService();
