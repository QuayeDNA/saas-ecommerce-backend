// src/controllers/orderController.js
import orderService from '../services/orderService.js';
import Order from '../models/Order.js';
import logger from '../utils/logger.js';
import { orderValidation } from '../validators/orderValidator.js';
import User from '../models/User.js'; // Added import for User
import walletService from '../services/walletService.js'; // Added import for walletService

class OrderController {
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
      return res.status(400).json({ success: false, message: err.message });
    }
  }
  
  // Get orders
  async getOrders(req, res) {
    try {
      const { tenantId, userType } = req.user;
      const filters = {
        status: req.query.status,
        orderType: req.query.orderType,
        paymentStatus: req.query.paymentStatus,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        search: req.query.search,
        createdBy: req.query.createdBy
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
      
      const result = await orderService.getOrders(effectiveTenantId, filters, pagination);
      
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
      
      const order = await orderService.cancelOrder(id, effectiveTenantId, userId, reason);
      
      res.json({
        success: true,
        message: 'Order cancelled successfully',
        order
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
          if (!['pending', 'confirmed'].includes(order.status)) {
            results.failed.push({
              orderId,
              reason: `Order is in ${order.status} status and cannot be processed`
            });
            continue;
          }

          // If changing to processing or completed, check wallet balance
          if (action === 'processing' || action === 'completed') {
            const user = await User.findById(order.createdBy);
            if (!user) {
              results.failed.push({
                orderId,
                reason: 'User not found'
              });
              continue;
            }
            
            const totalCost = order.items.reduce((sum, item) => sum + item.totalPrice, 0);
            if (user.walletBalance < totalCost) {
              results.failed.push({
                orderId,
                reason: `Insufficient wallet balance. Required: GH₵${totalCost.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}`
              });
              continue;
            }
            
            // If status is completed, deduct from wallet
            if (action === 'completed') {
              await walletService.debitWallet(
                order.createdBy.toString(),
                totalCost,
                `Payment for order ${order.orderNumber || order._id}`,
                order._id
              );
            }
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
