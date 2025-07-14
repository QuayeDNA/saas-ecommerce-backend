// src/controllers/orderController.js
import orderService from '../services/orderService.js';
import Order from '../models/Order.js';
import logger from '../utils/logger.js';

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
    try {
      const { tenantId, userId, userType } = req.user;
      const result = await orderService.createBulkOrder(req.body, tenantId, userId, userType);
      
      res.status(201).json({
        success: true,
        ...result
      });
    } catch (error) {
      logger.error(`Bulk order creation failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Get orders
  async getOrders(req, res) {
    try {
      const { tenantId } = req.user;
      const filters = {
        status: req.query.status,
        orderType: req.query.orderType,
        paymentStatus: req.query.paymentStatus,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        search: req.query.search
      };
      
      const pagination = {
        page: parseInt(req.query.page) || 1,
        limit: Math.min(parseInt(req.query.limit) || 20, 100),
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder === 'asc' ? 1 : -1
      };
      
      const result = await orderService.getOrders(tenantId, filters, pagination);
      
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
      const { tenantId } = req.user;
      const { id } = req.params;
      
      const order = await Order.findOne({ _id: id, tenantId })
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
      const { tenantId, userId } = req.user;
      const { orderId, itemId } = req.params;
      
      const order = await orderService.processOrderItem(orderId, itemId, tenantId, userId);
      
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
      const { tenantId, userId } = req.user;
      const { id } = req.params;
      const { reason } = req.body;
      
      const order = await orderService.cancelOrder(id, tenantId, userId, reason);
      
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
}

export default new OrderController();
