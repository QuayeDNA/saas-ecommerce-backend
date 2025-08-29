// src/services/commissionService.js
import CommissionRecord from '../models/CommissionRecord.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import Settings from '../models/Settings.js';
import walletService from './walletService.js';
import notificationService from './notificationService.js';
import websocketService from './websocketService.js';
import logger from '../utils/logger.js';

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
      // Get completed orders for the period
      const orders = await Order.find({
        createdBy: agentId,
        tenantId: tenantId,
        status: 'completed',
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);

      // Get commission rate from settings
      const settings = await Settings.getInstance();
      const commissionRate = settings.agentCommission || 5.0;

      const commissionAmount = (totalRevenue * commissionRate) / 100;

      return {
        agentId,
        tenantId,
        periodStart: startDate,
        periodEnd: endDate,
        totalOrders: orders.length,
        totalRevenue,
        commissionRate,
        amount: Math.round(commissionAmount * 100) / 100,
        orders: orders.map(order => ({
          orderId: order._id,
          orderNumber: order.orderNumber,
          total: order.total,
          createdAt: order.createdAt
        }))
      };
    } catch (error) {
      logger.error(`Commission calculation error: ${error.message}`);
      throw new Error('Failed to calculate commission');
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

      logger.info(`Commission record created for agent ${commissionData.agentId}: ${commissionData.amount}`);
      return commissionRecord;
    } catch (error) {
      logger.error(`Create commission record error: ${error.message}`);
      throw new Error('Failed to create commission record');
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

      const commissions = await CommissionRecord.find(query)
        .sort({ periodStart: -1 })
        .populate('paidBy', 'fullName email');

      return commissions;
    } catch (error) {
      logger.error(`Get agent commissions error: ${error.message}`);
      throw new Error('Failed to fetch agent commissions');
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
        const [year, month] = filters.month.split('-');
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
        .populate('agentId', 'fullName email businessName')
        .populate('paidBy', 'fullName email');

      return commissions;
    } catch (error) {
      logger.error(`Get all commissions error: ${error.message}`);
      throw new Error('Failed to fetch commissions');
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
        throw new Error('Commission record not found');
      }

      if (commission.status === 'paid') {
        throw new Error('Commission already paid');
      }

      // Get agent details
      const agent = await User.findById(commission.agentId);

      if (!agent) {
        throw new Error('Agent not found');
      }

      // Get admin who is paying
      const admin = await User.findById(paidBy);

      // Credit commission amount to agent's wallet
      await walletService.creditWallet(
        commission.agentId,
        commission.amount,
        `Commission payment for ${commission.period} period (${commission.periodStart.toLocaleDateString()} - ${commission.periodEnd.toLocaleDateString()})`,
        paidBy,
        {
          commissionId: commission._id,
          period: commission.period,
          totalOrders: commission.totalOrders,
          totalRevenue: commission.totalRevenue,
          paymentReference: paymentReference || `COM-${commissionId}`
        }
      );

      // Update commission record
      commission.status = 'paid';
      commission.paidAt = new Date();
      commission.paidBy = paidBy;
      commission.paymentReference = paymentReference;
      await commission.save();

      // Send notification to agent
      try {
        await notificationService.createInAppNotification(
          commission.agentId.toString(),
          'Commission Paid',
          `Your commission of GH₵${commission.amount} for ${commission.period} period has been paid to your wallet.`,
          'success',
          {
            commissionId: commission._id.toString(),
            amount: commission.amount,
            period: commission.period,
            paidBy: admin?.fullName || admin?.email || 'Admin',
            type: 'commission_paid',
            navigationLink: '/agent/dashboard/wallet'
          }
        );

        // Send WebSocket notification
        websocketService.sendToUser(commission.agentId.toString(), {
          type: 'commission_paid',
          commissionId: commission._id.toString(),
          amount: commission.amount,
          period: commission.period,
          paidBy: admin?.fullName || admin?.email || 'Admin',
          message: `Your commission of GH₵${commission.amount} has been paid to your wallet!`,
          timestamp: new Date().toISOString()
        });

      } catch (notificationError) {
        logger.error(`Failed to send commission payment notification: ${notificationError.message}`);
      }

      logger.info(`Commission paid to agent ${agent.fullName}: GH₵${commission.amount}`);

      return commission;
    } catch (error) {
      logger.error(`Pay commission error: ${error.message}`);
      throw new Error('Failed to pay commission');
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
          const commission = await this.payCommission(commissionId, paidBy, paymentReference);
          results.push({ success: true, commissionId, commission });
        } catch (error) {
          results.push({ success: false, commissionId, error: error.message });
        }
      }

      return results;
    } catch (error) {
      logger.error(`Pay multiple commissions error: ${error.message}`);
      throw new Error('Failed to pay multiple commissions');
    }
  }

  /**
   * Generate monthly commission records for all agents
   * @param {Date} month - Month to generate commissions for (defaults to current month)
   * @returns {Promise<Array>} Generated commission records
   */
  async generateMonthlyCommissions(month = new Date()) {
    try {
      const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
      const endOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);

      // Get all agents
      const agents = await User.find({ userType: 'agent', isActive: true });

      const results = [];

      for (const agent of agents) {
        try {
          // Check if commission record already exists for this period
          const existingRecord = await CommissionRecord.findOne({
            agentId: agent._id,
            period: 'monthly',
            periodStart: startOfMonth,
            periodEnd: endOfMonth
          });

          if (existingRecord) {
            results.push({ agentId: agent._id, status: 'exists', record: existingRecord });
            continue;
          }

          // Calculate commission
          const calculation = await this.calculateCommission(
            agent._id,
            agent.tenantId,
            startOfMonth,
            endOfMonth
          );

          // Create commission record
          const commissionRecord = await this.createCommissionRecord({
            ...calculation,
            period: 'monthly'
          });

          // Send notification to agent about new commission
          try {
            await notificationService.createInAppNotification(
              agent._id.toString(),
              'New Commission Generated',
              `Your commission of GH₵${commissionRecord.amount} for ${startOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} has been generated.`,
              'info',
              {
                commissionId: commissionRecord._id.toString(),
                amount: commissionRecord.amount,
                period: commissionRecord.period,
                totalOrders: commissionRecord.totalOrders,
                totalRevenue: commissionRecord.totalRevenue,
                type: 'commission_generated',
                navigationLink: '/agent/dashboard/commissions'
              }
            );

            // Send WebSocket notification
            websocketService.sendToUser(agent._id.toString(), {
              type: 'commission_generated',
              commissionId: commissionRecord._id.toString(),
              amount: commissionRecord.amount,
              period: commissionRecord.period,
              totalOrders: commissionRecord.totalOrders,
              totalRevenue: commissionRecord.totalRevenue,
              message: `New commission of GH₵${commissionRecord.amount} generated for ${startOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}!`,
              timestamp: new Date().toISOString()
            });

          } catch (notificationError) {
            logger.error(`Failed to send commission generation notification: ${notificationError.message}`);
          }

          results.push({ agentId: agent._id, status: 'created', record: commissionRecord });
        } catch (error) {
          results.push({ agentId: agent._id, status: 'error', error: error.message });
        }
      }

      logger.info(`Generated monthly commissions for ${agents.length} agents`);
      return results;
    } catch (error) {
      logger.error(`Generate monthly commissions error: ${error.message}`);
      throw new Error('Failed to generate monthly commissions');
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
      const resetMonthEnd = new Date(month.getFullYear(), month.getMonth(), 0, 23, 59, 59, 999);

      // Get current month for new commissions
      const currentMonth = new Date(month.getFullYear(), month.getMonth(), 1);

      logger.info(`Resetting commissions for ${resetMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);

      // Find all pending commissions from the previous month
      const pendingCommissions = await CommissionRecord.find({
        status: 'pending',
        period: 'monthly',
        periodStart: resetMonth,
        periodEnd: resetMonthEnd
      }).populate('agentId', 'fullName email');

      const expiredCount = pendingCommissions.length;
      let expiredAmount = 0;

      // Mark pending commissions as expired
      for (const commission of pendingCommissions) {
        commission.status = 'expired';
        commission.notes = `Expired on ${new Date().toLocaleDateString()} - Monthly reset`;
        await commission.save();
        expiredAmount += commission.amount;

        // Notify agent about expired commission
        try {
          await notificationService.createInAppNotification(
            commission.agentId._id.toString(),
            'Commission Expired',
            `Your pending commission of GH₵${commission.amount} for ${resetMonth.toLocaleDateString('en-US', { month: 'long' })} has expired due to monthly reset.`,
            'warning',
            {
              commissionId: commission._id.toString(),
              amount: commission.amount,
              period: commission.period,
              expiredDate: new Date().toISOString(),
              type: 'commission_expired'
            }
          );

          // Send WebSocket notification for expired commission
          websocketService.sendToUser(commission.agentId._id.toString(), {
            type: 'commission_expired',
            commissionId: commission._id.toString(),
            amount: commission.amount,
            period: commission.period,
            message: `Your commission of GH₵${commission.amount} has expired due to monthly reset.`,
            timestamp: new Date().toISOString()
          });

        } catch (notificationError) {
          logger.error(`Failed to send commission expiry notification: ${notificationError.message}`);
        }
      }

      // Generate new commissions for current month
      const generationResults = await this.generateMonthlyCommissions(currentMonth);

      const newCommissions = generationResults.filter(r => r.status === 'created');
      const newCommissionAmount = newCommissions.reduce((sum, r) => sum + r.record.amount, 0);

      logger.info(`Monthly commission reset completed: ${expiredCount} expired (GH₵${expiredAmount}), ${newCommissions.length} new (GH₵${newCommissionAmount})`);

      return {
        resetMonth: resetMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        expiredCommissions: expiredCount,
        expiredAmount: Math.round(expiredAmount * 100) / 100,
        newCommissions: newCommissions.length,
        newCommissionAmount: Math.round(newCommissionAmount * 100) / 100,
        results: generationResults
      };
    } catch (error) {
      logger.error(`Reset monthly commissions error: ${error.message}`);
      throw new Error('Failed to reset monthly commissions');
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
        monthlyCommissions
      ] = await Promise.all([
        CommissionRecord.find({ ...baseQuery, status: 'paid' }),
        CommissionRecord.find({ ...baseQuery, status: 'pending' }),
        CommissionRecord.distinct('agentId', baseQuery),
        CommissionRecord.find({
          ...baseQuery,
          period: 'monthly',
          periodStart: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
        })
      ]);

      // Calculate totals manually
      const totalPaid = paidCommissions.reduce((sum, record) => sum + (record.amount || 0), 0);
      const totalPending = pendingCommissions.reduce((sum, record) => sum + (record.amount || 0), 0);
      const pendingCount = pendingCommissions.length;

      // Calculate monthly stats
      const monthlyPaid = monthlyCommissions
        .filter(record => record.status === 'paid')
        .reduce((sum, record) => sum + (record.amount || 0), 0);
      const monthlyPending = monthlyCommissions
        .filter(record => record.status === 'pending')
        .reduce((sum, record) => sum + (record.amount || 0), 0);

      return {
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalPending: Math.round(totalPending * 100) / 100,
        pendingCount,
        totalAgents: totalAgents.length,
        thisMonth: {
          totalPaid: Math.round(monthlyPaid * 100) / 100,
          totalPending: Math.round(monthlyPending * 100) / 100,
          totalRecords: monthlyCommissions.length
        }
      };
    } catch (error) {
      logger.error(`Commission statistics error: ${error.message}`);
      return {
        totalPaid: 0,
        totalPending: 0,
        pendingCount: 0,
        totalAgents: 0,
        thisMonth: { totalPaid: 0, totalPending: 0, totalRecords: 0 }
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

      if (settings.customerCommission !== undefined) {
        settingsDoc.customerCommission = settings.customerCommission;
      }

      await settingsDoc.save();

      logger.info('Commission settings updated:', settings);
      return {
        agentCommission: settingsDoc.agentCommission,
        customerCommission: settingsDoc.customerCommission
      };
    } catch (error) {
      logger.error(`Update commission settings error: ${error.message}`);
      throw new Error('Failed to update commission settings');
    }
  }

  /**
   * Get commission settings
   * @returns {Promise<Object>} Commission settings
   */
  async getCommissionSettings() {
    try {
      const settings = await Settings.getInstance();
      return {
        agentCommission: settings.agentCommission,
        customerCommission: settings.customerCommission
      };
    } catch (error) {
      logger.error(`Get commission settings error: ${error.message}`);
      throw new Error('Failed to get commission settings');
    }
  }
}

export default new CommissionService();
