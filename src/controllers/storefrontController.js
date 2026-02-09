// src/controllers/storefrontController.js
import storefrontService from '../services/storefrontService.js';
import { validationResult } from 'express-validator';
import logger from '../utils/logger.js';

class StorefrontController {
  
  // =========================================================================
  // Public Endpoints (No Authentication Required)
  // =========================================================================
  
  /**
   * Get public storefront by business name
   * GET /api/storefront/:businessName
   */
  async getPublicStorefront(req, res) {
    try {
      const { businessName } = req.params;
      logger.info(`Fetching public storefront: ${businessName}`);
      
      const storefrontData = await storefrontService.getPublicStorefront(businessName);
      
      res.json({
        success: true,
        data: storefrontData
      });
      
    } catch (error) {
      logger.error(`Error fetching public storefront: ${error.message}`);
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Create storefront order
   * POST /api/storefront/:businessName/order
   */
  async createStorefrontOrder(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }
      
      const { businessName } = req.params;
      const orderData = req.body;
      
      logger.info(`Creating storefront order for: ${businessName}`, {
        items: orderData.items?.length,
        customer: orderData.customerInfo?.name
      });
      
      const order = await storefrontService.createStorefrontOrder(businessName, orderData);
      
      res.status(201).json({
        success: true,
        message: 'Order placed successfully! The store owner will verify your payment.',
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          total: order.total,
          status: order.status
        }
      });
      
    } catch (error) {
      logger.error(`Error creating storefront order: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // =========================================================================
  // Agent Management Endpoints (Authentication Required)
  // =========================================================================
  
  /**
   * Create storefront (checks auto-approve setting)
   * POST /api/storefront/agent/storefront
   */
  async createStorefront(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }
      
      const userId = req.user.userId;
      const storefrontData = req.body;
      
      logger.info(`User ${userId} creating storefront: ${storefrontData.businessName}`);
      
      const storefront = await storefrontService.createStorefront(userId, storefrontData);
      
      const message = storefront.isApproved 
        ? 'Storefront created and auto-approved! Your store is now live.'
        : 'Storefront created successfully. Awaiting admin approval.';
      
      res.status(201).json({
        success: true,
        message,
        data: storefront
      });
      
    } catch (error) {
      logger.error(`Error creating storefront: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Get agent's storefront (shows suspension info if admin-suspended)
   * GET /api/storefront/agent/storefront
   */
  async getAgentStorefront(req, res) {
    try {
      const userId = req.user.userId;
      
      const storefront = await storefrontService.getAgentStorefront(userId);
      
      if (!storefront) {
        return res.status(404).json({
          success: false,
          message: 'No storefront found'
        });
      }
      
      // If admin-suspended, the agent can still see it but with a clear message
      if (storefront.suspendedByAdmin) {
        return res.json({
          success: true,
          data: storefront,
          suspended: true,
          suspensionMessage: `Your storefront has been suspended by an administrator. ${storefront.suspensionReason ? `Reason: ${storefront.suspensionReason}` : ''} Please contact support for assistance.`
        });
      }
      
      res.json({
        success: true,
        data: storefront
      });
      
    } catch (error) {
      logger.error(`Error fetching agent storefront: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
  
  /**
   * Update storefront
   * PUT /api/storefront/agent/storefront
   */
  async updateStorefront(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }
      
      const userId = req.user.userId;
      const updateData = req.body;
      
      const existingStorefront = await storefrontService.getAgentStorefront(userId);
      if (!existingStorefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      const storefront = await storefrontService.updateStorefront(existingStorefront._id, updateData, userId);
      
      res.json({
        success: true,
        message: 'Storefront updated successfully',
        data: storefront
      });
      
    } catch (error) {
      logger.error(`Error updating storefront: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Deactivate storefront (agent can still see it, public can't)
   * PUT /api/storefront/agent/storefront/deactivate
   */
  async deactivateStorefront(req, res) {
    try {
      const userId = req.user.userId;
      
      const existingStorefront = await storefrontService.getAgentStorefront(userId);
      if (!existingStorefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      await storefrontService.deactivateStorefront(existingStorefront._id, userId);
      
      res.json({
        success: true,
        message: 'Storefront deactivated. You can reactivate it anytime.'
      });
      
    } catch (error) {
      logger.error(`Error deactivating storefront: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Reactivate storefront
   * PUT /api/storefront/agent/storefront/reactivate
   */
  async reactivateStorefront(req, res) {
    try {
      const userId = req.user.userId;
      
      const existingStorefront = await storefrontService.getAgentStorefront(userId);
      if (!existingStorefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      const storefront = await storefrontService.reactivateStorefront(existingStorefront._id, userId);
      
      res.json({
        success: true,
        message: 'Storefront reactivated successfully. Your store is now live!',
        data: storefront
      });
      
    } catch (error) {
      logger.error(`Error reactivating storefront: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Delete storefront (graceful - checks active orders)
   * DELETE /api/storefront/agent/storefront
   */
  async deleteStorefront(req, res) {
    try {
      const userId = req.user.userId;
      
      const existingStorefront = await storefrontService.getAgentStorefront(userId);
      if (!existingStorefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      await storefrontService.deleteStorefront(existingStorefront._id, userId);
      
      res.json({
        success: true,
        message: 'Storefront deleted successfully'
      });
      
    } catch (error) {
      logger.error(`Error deleting storefront: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // =========================================================================
  // Pricing & Bundle Management
  // =========================================================================
  
  /**
   * Get available bundles for pricing (shows ALL active bundles with pricing status)
   * GET /api/storefront/agent/storefront/bundles
   */
  async getAvailableBundles(req, res) {
    try {
      const userId = req.user.userId;
      const bundles = await storefrontService.getAgentBundlesForPricing(userId);
      
      res.json({
        success: true,
        data: bundles
      });
      
    } catch (error) {
      logger.error(`Error fetching available bundles: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
  
  /**
   * Get current pricing
   * GET /api/storefront/agent/storefront/pricing
   */
  async getCurrentPricing(req, res) {
    try {
      const userId = req.user.userId;
      
      const storefront = await storefrontService.getAgentStorefront(userId);
      if (!storefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      const pricing = await storefrontService.getStorefrontPricing(storefront._id);
      
      res.json({
        success: true,
        data: pricing
      });
      
    } catch (error) {
      logger.error(`Error fetching pricing: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
  
  /**
   * Set pricing for bundles (can also enable bundles at tier price)
   * POST /api/storefront/agent/storefront/pricing
   */
  async setPricing(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }
      
      const userId = req.user.userId;
      const pricingData = req.body.pricing;
      
      const storefront = await storefrontService.getAgentStorefront(userId);
      if (!storefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      const results = await storefrontService.setPricing(storefront._id, pricingData);
      
      res.json({
        success: true,
        message: `Pricing updated: ${results.created} created, ${results.updated} updated`,
        data: results
      });
      
    } catch (error) {
      logger.error(`Error setting pricing: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Toggle bundle visibility in the store (enable/disable bundles)
   * PUT /api/storefront/agent/storefront/bundles/toggle
   */
  async toggleBundles(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }
      
      const userId = req.user.userId;
      const { bundles } = req.body;
      
      const storefront = await storefrontService.getAgentStorefront(userId);
      if (!storefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      const results = await storefrontService.toggleBundles(storefront._id, bundles, userId);
      
      res.json({
        success: true,
        message: `Bundles updated: ${results.enabled} enabled, ${results.disabled} disabled`,
        data: results
      });
      
    } catch (error) {
      logger.error(`Error toggling bundles: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // =========================================================================
  // Order Management
  // =========================================================================
  
  /**
   * Get storefront orders
   * GET /api/storefront/agent/storefront/orders
   */
  async getStorefrontOrders(req, res) {
    try {
      const userId = req.user.userId;
      const { status, limit = 50, offset = 0 } = req.query;
      
      const storefront = await storefrontService.getAgentStorefront(userId);
      if (!storefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      const filters = {};
      if (status) filters.status = status;
      
      const { orders, total } = await storefrontService.getStorefrontOrders(
        storefront._id, 
        filters,
        { limit: parseInt(limit), offset: parseInt(offset) }
      );
      
      res.json({
        success: true,
        data: {
          orders,
          total,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });
      
    } catch (error) {
      logger.error(`Error fetching storefront orders: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
  
  /**
   * Verify payment - deducts wallet, enters existing order flow (pending for admin)
   * PUT /api/storefront/agent/storefront/orders/:orderId/verify
   */
  async verifyPayment(req, res) {
    try {
      const { orderId } = req.params;
      const { notes } = req.body;
      const userId = req.user.userId;
      
      const order = await storefrontService.verifyPayment(orderId, { notes }, userId);
      
      res.json({
        success: true,
        message: 'Payment verified. Order wallet deducted and queued for admin processing.',
        data: order
      });
      
    } catch (error) {
      logger.error(`Error verifying payment: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Reject order
   * PUT /api/storefront/agent/storefront/orders/:orderId/reject
   */
  async rejectOrder(req, res) {
    try {
      const { orderId } = req.params;
      const { reason } = req.body;
      const userId = req.user.userId;
      
      const order = await storefrontService.rejectOrder(orderId, reason, userId);
      
      res.json({
        success: true,
        message: 'Order rejected',
        data: order
      });
      
    } catch (error) {
      logger.error(`Error rejecting order: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // =========================================================================
  // Analytics
  // =========================================================================
  
  /**
   * Get storefront analytics
   * GET /api/storefront/agent/storefront/analytics
   */
  async getAnalytics(req, res) {
    try {
      const userId = req.user.userId;
      const { startDate, endDate } = req.query;
      
      const storefront = await storefrontService.getAgentStorefront(userId);
      if (!storefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      const dateRange = {};
      if (startDate) dateRange.startDate = startDate;
      if (endDate) dateRange.endDate = endDate;
      
      const analytics = await storefrontService.getStorefrontAnalytics(storefront._id, dateRange);
      
      res.json({
        success: true,
        data: analytics
      });
      
    } catch (error) {
      logger.error(`Error fetching analytics: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
  
  // =========================================================================
  // Admin Endpoints (Super Admin only)
  // =========================================================================
  
  /**
   * Get all storefronts
   * GET /api/storefront/admin/storefronts
   */
  async getAllStorefronts(req, res) {
    try {
      const { status, search, limit = 20, offset = 0 } = req.query;
      
      const { storefronts, total } = await storefrontService.getAllStorefronts(
        { status, search },
        { limit: parseInt(limit), offset: parseInt(offset) }
      );
      
      res.json({
        success: true,
        data: {
          storefronts,
          total,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });
      
    } catch (error) {
      logger.error(`Error fetching all storefronts: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
  
  /**
   * Get admin storefront stats
   * GET /api/storefront/admin/stats
   */
  async getAdminStats(req, res) {
    try {
      const stats = await storefrontService.getAdminStorefrontStats();
      
      res.json({
        success: true,
        data: stats
      });
      
    } catch (error) {
      logger.error(`Error fetching admin stats: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
  
  /**
   * Approve storefront
   * PUT /api/storefront/admin/storefronts/:storefrontId/approve
   */
  async approveStorefront(req, res) {
    try {
      const { storefrontId } = req.params;
      const adminId = req.user.userId;
      
      const storefront = await storefrontService.approveStorefront(storefrontId, adminId);
      
      res.json({
        success: true,
        message: 'Storefront approved successfully',
        data: storefront
      });
      
    } catch (error) {
      logger.error(`Error approving storefront: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Admin suspend storefront (blocks agent and public access)
   * PUT /api/storefront/admin/storefronts/:storefrontId/suspend
   */
  async adminSuspendStorefront(req, res) {
    try {
      const { storefrontId } = req.params;
      const adminId = req.user.userId;
      const { reason } = req.body;
      
      const storefront = await storefrontService.adminSuspendStorefront(storefrontId, adminId, reason);
      
      res.json({
        success: true,
        message: 'Storefront suspended successfully',
        data: storefront
      });
      
    } catch (error) {
      logger.error(`Error suspending storefront: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Admin unsuspend storefront (lifts admin suspension)
   * PUT /api/storefront/admin/storefronts/:storefrontId/unsuspend
   */
  async adminUnsuspendStorefront(req, res) {
    try {
      const { storefrontId } = req.params;
      const adminId = req.user.userId;
      
      const storefront = await storefrontService.adminUnsuspendStorefront(storefrontId, adminId);
      
      res.json({
        success: true,
        message: 'Storefront unsuspended. Store is now live again.',
        data: storefront
      });
      
    } catch (error) {
      logger.error(`Error unsuspending storefront: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Admin delete storefront (graceful - checks orders, notifies agent)
   * DELETE /api/storefront/admin/storefronts/:storefrontId
   */
  async adminDeleteStorefront(req, res) {
    try {
      const { storefrontId } = req.params;
      const adminId = req.user.userId;
      const { reason } = req.body;
      
      await storefrontService.adminDeleteStorefront(storefrontId, adminId, reason);
      
      res.json({
        success: true,
        message: 'Storefront deleted successfully. Agent has been notified.'
      });
      
    } catch (error) {
      logger.error(`Error deleting storefront (admin): ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  /**
   * Toggle auto-approve setting
   * PUT /api/storefront/admin/settings/auto-approve
   */
  async toggleAutoApprove(req, res) {
    try {
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'enabled must be a boolean'
        });
      }
      
      const result = await storefrontService.toggleAutoApprove(enabled);
      
      res.json({
        success: true,
        message: `Auto-approve ${result.autoApproveStorefronts ? 'enabled' : 'disabled'}`,
        data: result
      });
      
    } catch (error) {
      logger.error(`Error toggling auto-approve: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

export default new StorefrontController();