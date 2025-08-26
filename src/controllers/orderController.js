// src/controllers/orderController.js
import orderService from '../services/orderService.js';
import Order from '../models/Order.js';
import logger from '../utils/logger.js';
import { orderValidation } from '../validators/orderValidator.js';
import User from '../models/User.js'; // Added import for User
import notificationService from '../services/notificationService.js'; // Added import for notificationService

class OrderController {
  /**
   * Get the correct navigation link based on user type
   * @param {string} userType - User type (agent, super_admin, etc.)
   * @param {string} page - Page to navigate to (wallet, orders, etc.)
   * @returns {string} Navigation link
   */
  getNavigationLink(userType, page) {
    const routes = {
      'agent': {
        'wallet': '/agent/dashboard/wallet',
        'orders': '/agent/dashboard/orders'
      },
      'super_admin': {
        'wallet': '/superadmin/wallet',
        'orders': '/superadmin/orders'
      },
      'admin': {
        'wallet': '/admin/wallet',
        'orders': '/admin/orders'
      }
    };

    return routes[userType]?.[page] || `/${page}`;
  }

  // Create single order
  async createSingleOrder(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const order = await orderService.createSingleOrder(req.body, tenantId, userId);
      
      res.status(201).json({
        success: true,
        order
      });
    } catch (error) {
      logger.error(`Single order creation failed: ${error.message}`);
      
      // Handle duplicate order errors specially
      if (error.code === 'DUPLICATE_ORDER_DETECTED') {
        return res.status(400).json({
          success: false,
          message: error.message,
          code: 'DUPLICATE_ORDER_DETECTED',
          duplicateInfo: error.duplicateInfo
        });
      }
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Create bulk order
  async createBulkOrder(req, res) {
    // This assumes userId, tenantId come from req.user (middleware) or from the body for flexibility
    const { error, value } = orderValidation.createBulk.validate({
      ...req.body,
      // Example: override with req.user for stricter tenancy
      tenantId: req.user.tenantId,
      userId: req.user.userId
    });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }
    try {
      const result = await orderService.createBulkOrders(value);
      return res.status(201).json({ success: true, ...result });
    } catch (err) {
      logger.error(`Bulk order creation failed: ${err.message}`);
      
      // Handle duplicate order errors specially
      if (err.code === 'DUPLICATE_ORDER_DETECTED') {
        return res.status(400).json({
          success: false,
          message: err.message,
          code: 'DUPLICATE_ORDER_DETECTED',
          duplicateInfo: err.duplicateInfo
        });
      }
      
      return res.status(400).json({ success: false, message: err.message });
    }
  }
  
  // Get orders
  async getOrders(req, res) {
    try {
      const { tenantId, userType, userId } = req.user;
      const filters = {
        status: req.query.status,
        orderType: req.query.orderType,
        paymentStatus: req.query.paymentStatus,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        search: req.query.search,
        createdBy: req.query.createdBy,
        provider: req.query.provider
      };
      
      const pagination = {
        page: parseInt(req.query.page) || 1,
        limit: Math.min(parseInt(req.query.limit) || 20, 100),
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder === 'asc' ? 1 : -1
      };
      
      // For super admins, allow access to all orders (no tenant restriction)
      // For regular users, restrict to their tenant
      const effectiveTenantId = userType === 'super_admin' ? null : tenantId;
      
      const result = await orderService.getOrders(effectiveTenantId, filters, pagination, userId);
      
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      logger.error(`Get orders failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch orders'
      });
    }
  }
  
  // Get single order
  async getOrder(req, res) {
    try {
      const { tenantId, userType } = req.user;
      const { id } = req.params;
      
      // For super admins, allow access to any order (no tenant restriction)
      // For regular users, restrict to their tenant
      const query = userType === 'super_admin' ? { _id: id } : { _id: id, tenantId };
      
      const order = await Order.findOne(query)
        .populate('items.packageGroup', 'name provider')
        .populate('createdBy', 'fullName email')
        .populate('processedBy', 'fullName email');
      
      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }
      
      res.json({
        success: true,
        order
      });
    } catch (error) {
      logger.error(`Get order failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch order'
      });
    }
  }
  
  // Process single order item
  async processOrderItem(req, res) {
    try {
      const { tenantId, userId, userType } = req.user;
      const { orderId, itemId } = req.params;
      
      // For super admins, allow processing any order (no tenant restriction)
      // For regular users, restrict to their tenant
      const effectiveTenantId = userType === 'super_admin' ? null : tenantId;
      
      const order = await orderService.processOrderItem(orderId, itemId, effectiveTenantId, userId);
      
      res.json({
        success: true,
        message: 'Order item processed successfully',
        order
      });
    } catch (error) {
      logger.error(`Process order item failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Process bulk order
  async processBulkOrder(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;
      
      // Start processing in background
      orderService.processBulkOrder(id, tenantId, userId)
        .catch(error => {
          logger.error(`Bulk order processing failed: ${error.message}`);
        });
      
      res.json({
        success: true,
        message: 'Bulk order processing started'
      });
    } catch (error) {
      logger.error(`Process bulk order failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Cancel order
  async cancelOrder(req, res) {
    try {
      const { tenantId, userId, userType } = req.user;
      const { id } = req.params;
      const { reason } = req.body;
      
      // For super admins, allow cancelling any order (no tenant restriction)
      // For regular users, restrict to their tenant
      const effectiveTenantId = userType === 'super_admin' ? null : tenantId;
      
      const result = await orderService.cancelOrder(id, effectiveTenantId, userId, reason);
      
      // Prepare response message based on whether refund was processed
      let message = 'Order cancelled successfully';
      if (result.refundAmount && result.refundAmount > 0) {
        message = `Order cancelled successfully. GH₵${result.refundAmount} has been refunded to the user's wallet.`;
      }
      
      res.json({
        success: true,
        message,
        order: result.order,
        refundAmount: result.refundAmount || 0,
        refundTransaction: result.refundTransaction
      });
    } catch (error) {
      logger.error(`Cancel order failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Process draft orders when wallet is topped up
  async processDraftOrders(req, res) {
    try {
      const { tenantId, userId } = req.user;
      
      const result = await orderService.processDraftOrders(userId, tenantId);
      
      res.json({
        success: true,
        message: result.message,
        ...result
      });
    } catch (error) {
      logger.error(`Process draft orders failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Update order status manually
  async updateOrderStatus(req, res) {
    try {
      const { tenantId, userId, userType } = req.user;
      const { id } = req.params;
      const { status, notes } = req.body;
      
      // Validate status - prevent setting to 'failed' manually
      if (status === 'failed') {
        return res.status(400).json({
          success: false,
          message: 'Cannot manually set status to failed. This status is reserved for system events.'
        });
      }
      
      // For super admins, allow updating any order (no tenant restriction)
      // For regular users, restrict to their tenant
      const query = userType === 'super_admin' ? { _id: id } : { _id: id, tenantId };
      
      const order = await Order.findOne(query);
      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }
      
      // No wallet checks needed - wallet was already checked and deducted when order was created
      
      // Update order status
      order.status = status;
      if (notes) {
        order.processingNotes = notes;
      }
      order.processedBy = userId;
      
      // Set processing timestamps
      if (status === 'processing' && !order.processingStartedAt) {
        order.processingStartedAt = new Date();
      } else if (status === 'completed' && !order.processingCompletedAt) {
        order.processingCompletedAt = new Date();
      }
      
      await order.save();
      
      res.json({
        success: true,
        message: 'Order status updated successfully',
        order
      });
    } catch (error) {
      logger.error(`Update order status failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Get order analytics
  async getAnalytics(req, res) {
    try {
      const { tenantId } = req.user;
      const { timeframe } = req.query;
      
      const analytics = await orderService.getOrderAnalytics(tenantId, timeframe);
      
      res.json({
        success: true,
        analytics
      });
    } catch (error) {
      logger.error(`Get analytics failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch analytics'
      });
    }
  }

  // Get monthly revenue for user (agent or super admin)
  async getMonthlyRevenue(req, res) {
    try {
      const userId = req.user.userId;
      const userType = req.user.userType;
      
      const monthlyData = await orderService.getMonthlyRevenue(userId, userType);
      
      res.json({
        success: true,
        data: monthlyData
      });
    } catch (error) {
      logger.error(`Get monthly revenue failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch monthly revenue'
      });
    }
  }

  // Get daily spending for user (today's completed orders)
  async getDailySpending(req, res) {
    try {
      const userId = req.user.userId;
      const userType = req.user.userType;
      
      const dailyData = await orderService.getDailySpending(userId, userType);
      
      res.json({
        success: true,
        data: dailyData
      });
    } catch (error) {
      logger.error(`Get daily spending failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch daily spending'
      });
    }
  }

  // Get simple agent analytics for dashboard
  async getAgentAnalytics(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { timeframe = '30d' } = req.query;
      
      // Import required models
      const Order = (await import('../models/Order.js')).default;
      const WalletTransaction = (await import('../models/WalletTransaction.js')).default;
      
      // Calculate date range
      const endDate = new Date();
      let startDate;
      
      switch (timeframe) {
        case '7d':
          startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Convert string IDs to ObjectIds for MongoDB query
      const mongoose = (await import('mongoose')).default;
      const userIdObjectId = new mongoose.Types.ObjectId(userId);
      const tenantIdObjectId = new mongoose.Types.ObjectId(tenantId);

      // Get order statistics for the agent
      const orderStats = await Order.aggregate([
        {
          $match: {
            createdBy: userIdObjectId,
            tenantId: tenantIdObjectId,
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            completedOrders: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            totalRevenue: { $sum: '$total' }
          }
        }
      ]);

      // Get wallet balance
      const user = await User.findById(userId).select('walletBalance');
      const walletBalance = user?.walletBalance || 0;

      // Calculate success rate
      const stats = orderStats[0] || { totalOrders: 0, completedOrders: 0, totalRevenue: 0 };
      const successRate = stats.totalOrders > 0 ? Math.round((stats.completedOrders / stats.totalOrders) * 100) : 0;

      const analytics = {
        totalOrders: stats.totalOrders,
        completedOrders: stats.completedOrders,
  // totalRevenue: revenue for the requested timeframe (e.g., last 30 days)
  totalRevenue: stats.totalRevenue,
        successRate: successRate,
        walletBalance: walletBalance,
        timeframe: timeframe,
        overallTotalSales: 0,
  monthlyRevenue: 0,
  monthlyOrderCount: 0,
  month: "",
  // commission for the current month (0.1% of completed monthly sales)
  monthlyCommission: 0
      };
      
      // Compute overall total sales (completed orders total) for this user (agent) across all time
      try {
        // overallTotalSales: sum of completed orders for this agent across all time
        const overallMatch = {
          createdBy: userIdObjectId,
          tenantId: tenantIdObjectId,
          status: 'completed'
        };

        const overallAgg = await Order.aggregate([
          { $match: overallMatch },
          { $group: { _id: null, overallTotalSales: { $sum: '$total' } } }
        ]);

        analytics.overallTotalSales = overallAgg[0]?.overallTotalSales || 0;
      } catch (err) {
        logger.error(`Failed to compute overall total sales for agent: ${err.message}`);
        analytics.overallTotalSales = 0;
      }
      
      // Compute monthly revenue for current month (completed orders only)
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        const monthlyMatch = {
          createdBy: userIdObjectId,
          tenantId: tenantIdObjectId,
          status: 'completed',
          createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        };

        const monthlyAgg = await Order.aggregate([
          { $match: monthlyMatch },
          { $group: { _id: null, monthlyRevenue: { $sum: '$total' }, monthlyOrderCount: { $sum: 1 } } }
        ]);

        analytics.monthlyRevenue = monthlyAgg[0]?.monthlyRevenue || 0;
        analytics.monthlyOrderCount = monthlyAgg[0]?.monthlyOrderCount || 0;
        analytics.month = now.toLocaleString('default', { month: 'long', year: 'numeric' });
        // Commission is 0.1% (0.001) of total completed sales for the month
        try {
          const commission = (analytics.monthlyRevenue || 0) * 0.001;
          // Round to 2 decimal places for currency formatting
          analytics.monthlyCommission = Math.round((commission + Number.EPSILON) * 100) / 100;
        } catch (err) {
          logger.error(`Failed to compute monthly commission for agent: ${err.message}`);
          analytics.monthlyCommission = 0;
        }
      } catch (err) {
        logger.error(`Failed to compute monthly revenue for agent: ${err.message}`);
        analytics.monthlyRevenue = 0;
        analytics.monthlyOrderCount = 0;
        analytics.month = '';
      }
      
      res.json({
        success: true,
        analytics
      });
    } catch (error) {
      logger.error(`Get agent analytics failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch agent analytics'
      });
    }
  }

  // Bulk process multiple orders
  async bulkProcessOrders(req, res) {
    try {
      const { tenantId, userId, userType } = req.user;
      const { orderIds, action } = req.body;
      
      if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Order IDs array is required'
        });
      }

      if (!['processing', 'completed'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Action must be either "processing" or "completed"'
        });
      }

      const results = {
        successful: [],
        failed: [],
        total: orderIds.length
      };

      for (const orderId of orderIds) {
        try {
          // For super admins, allow processing any order (no tenant restriction)
          // For regular users, restrict to their tenant
          const query = userType === 'super_admin' ? { _id: orderId } : { _id: orderId, tenantId };
          
          const order = await Order.findOne(query);
          if (!order) {
            results.failed.push({
              orderId,
              reason: 'Order not found'
            });
            continue;
          }

          // Check if order can be processed
          if (action === 'processing' && order.status === 'completed') {
            results.failed.push({
              orderId,
              reason: `Order is already completed and cannot be set to processing`
            });
            continue;
          }
          
          if (action === 'completed' && !['pending', 'confirmed', 'processing'].includes(order.status)) {
            results.failed.push({
              orderId,
              reason: `Order is in ${order.status} status and cannot be completed`
            });
            continue;
          }



          // Update order status
          order.status = action;
          order.processedBy = userId;
          
          // Set processing timestamps
          if (action === 'processing' && !order.processingStartedAt) {
            order.processingStartedAt = new Date();
          } else if (action === 'completed' && !order.processingCompletedAt) {
            order.processingCompletedAt = new Date();
          }
          
          await order.save();
          
          // Send notification for bulk processing
          try {
            const orderCreator = await User.findById(order.createdBy);
            const processor = await User.findById(userId);
            
            if (orderCreator) {
              await notificationService.createInAppNotification(
                orderCreator._id.toString(),
                `Order ${action === 'completed' ? 'Completed' : 'Processing Started'}`,
                `Your order ${order.orderNumber} has been ${action === 'completed' ? 'completed' : 'started processing'} by ${processor?.fullName || processor?.email || 'Admin'}.`,
                action === 'completed' ? 'success' : 'info',
                {
                  orderId: order._id.toString(),
                  orderNumber: order.orderNumber,
                  status: action,
                  processedBy: processor?.fullName || processor?.email,
                  type: `order_${action}`,
                  navigationLink: this.getNavigationLink(orderCreator.userType, 'orders')
                }
              );
            }

            // Notify super admins about bulk processing
            const superAdmins = await User.find({ userType: 'super_admin' }, 'userType');
            for (const admin of superAdmins) {
              await notificationService.createInAppNotification(
                admin._id.toString(),
                `Order ${action === 'completed' ? 'Completed' : 'Processing Started'}`,
                `Order ${order.orderNumber} has been ${action === 'completed' ? 'completed' : 'started processing'} by ${processor?.fullName || processor?.email || 'Admin'}.`,
                action === 'completed' ? 'success' : 'info',
                {
                  orderId: order._id.toString(),
                  orderNumber: order.orderNumber,
                  status: action,
                  processedBy: processor?.fullName || processor?.email,
                  type: `order_${action}`,
                  navigationLink: this.getNavigationLink(admin.userType, 'orders')
                }
              );
            }
          } catch (error) {
            logger.error(`Failed to send bulk processing notification: ${error.message}`);
          }
          
          results.successful.push({
            orderId,
            orderNumber: order.orderNumber,
            newStatus: action
          });
        } catch (error) {
          results.failed.push({
            orderId,
            reason: error.message
          });
        }
      }

      res.json({
        success: true,
        message: `Bulk processing completed. ${results.successful.length} successful, ${results.failed.length} failed.`,
        results
      });
    } catch (error) {
      logger.error(`Bulk process orders failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to process orders'
      });
    }
  }
}

export default new OrderController();
