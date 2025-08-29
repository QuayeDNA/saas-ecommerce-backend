// src/controllers/commissionController.js

import commissionService from '../services/commissionService.js';
import logger from '../utils/logger.js';

class CommissionController {
  /**
   * Get commission settings
   */
  async getCommissionSettings(req, res) {
    try {
      const settings = await commissionService.getCommissionSettings();

      res.json({
        success: true,
        data: settings
      });
    } catch (error) {
      logger.error("Get commission settings error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to get commission settings'
      });
    }
  }

  /**
   * Update commission settings
   */
  async updateCommissionSettings(req, res) {
    try {
      const { agentCommission, customerCommission } = req.body;

      if (agentCommission !== undefined && (agentCommission < 0 || agentCommission > 100)) {
        return res.status(400).json({
          success: false,
          message: 'Agent commission must be between 0 and 100'
        });
      }

      if (customerCommission !== undefined && (customerCommission < 0 || customerCommission > 100)) {
        return res.status(400).json({
          success: false,
          message: 'Customer commission must be between 0 and 100'
        });
      }

      const settings = await commissionService.updateCommissionSettings({
        agentCommission,
        customerCommission
      });

      res.json({
        success: true,
        data: settings,
        message: 'Commission settings updated successfully'
      });
    } catch (error) {
      logger.error("Update commission settings error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to update commission settings'
      });
    }
  }

  /**
   * Get agent commissions
   */
  async getAgentCommissions(req, res) {
    try {
      const { userId } = req.user;
      const { status, period, startDate, endDate, page = 1, limit = 20 } = req.query;

      const filters = {};
      if (status) filters.status = status;
      if (period) filters.period = period;
      if (startDate && endDate) {
        filters.startDate = new Date(startDate);
        filters.endDate = new Date(endDate);
      }

      const commissions = await commissionService.getAgentCommissions(userId, filters);

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
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      logger.error("Get agent commissions error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch agent commissions'
      });
    }
  }

  /**
   * Get all commissions (super admin)
   */
  async getAllCommissions(req, res) {
    try {
      const { status, agentId, period, startDate, endDate, month, page = 1, limit = 20 } = req.query;

      const filters = {};
      if (status) filters.status = status;
      if (agentId) filters.agentId = agentId;
      if (period) filters.period = period;
      if (month) filters.month = month;
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
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      logger.error("Get all commissions error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch commissions'
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
          message: 'Agent ID, start date, and end date are required'
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
        data: calculation
      });
    } catch (error) {
      logger.error("Calculate commission error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to calculate commission'
      });
    }
  }

  /**
   * Create commission record
   */
  async createCommissionRecord(req, res) {
    try {
      const { agentId, periodStart, periodEnd, period = 'monthly' } = req.body;
      const { tenantId } = req.user;

      if (!agentId || !periodStart || !periodEnd) {
        return res.status(400).json({
          success: false,
          message: 'Agent ID, period start, and period end are required'
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
        periodEnd: new Date(periodEnd)
      };

      const commissionRecord = await commissionService.createCommissionRecord(commissionData);

      res.status(201).json({
        success: true,
        data: commissionRecord,
        message: 'Commission record created successfully'
      });
    } catch (error) {
      logger.error("Create commission record error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to create commission record'
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
        message: 'Commission paid successfully'
      });
    } catch (error) {
      logger.error("Pay commission error:", error);
      res.status(400).json({
        success: false,
        message: error.message
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

      if (!commissionIds || !Array.isArray(commissionIds) || commissionIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Commission IDs array is required'
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
        message: `${results.length} commissions paid successfully`
      });
    } catch (error) {
      logger.error("Pay multiple commissions error:", error);
      res.status(400).json({
        success: false,
        message: 'Failed to pay multiple commissions'
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
      const results = await commissionService.generateMonthlyCommissions(targetDate);

      const successful = results.filter(r => r.status === 'created').length;
      const existing = results.filter(r => r.status === 'exists').length;
      const noCommission = results.filter(r => r.status === 'no_commission').length;
      const errors = results.filter(r => r.status === 'error').length;

      res.json({
        success: true,
        data: {
          results,
          summary: {
            total: results.length,
            successful,
            existing,
            noCommission,
            errors
          }
        },
        message: `Generated ${successful} commission records with ${errors} errors`
      });
    } catch (error) {
      logger.error("Generate monthly commissions error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate monthly commissions'
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

      const result = await commissionService.resetMonthlyCommissions(resetMonth);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error("Reset monthly commissions error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to reset monthly commissions'
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

      const { manualCommissionReset } = await import('../jobs/commissionReset.js');
      const result = await manualCommissionReset(resetMonth);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error("Manual commission reset error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to manually reset commissions'
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
      const statisticsTenantId = userType === 'super_admin' ? null : tenantId;

      const statistics = await commissionService.getCommissionStatistics(statisticsTenantId);

      res.json({
        success: true,
        data: statistics
      });
    } catch (error) {
      logger.error("Get commission statistics error:", error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch commission statistics'
      });
    }
  }
}

export default new CommissionController();
