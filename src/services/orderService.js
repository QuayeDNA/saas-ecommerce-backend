// src/services/orderService.js
import Order from '../models/Order.js';
import Bundle from '../models/Bundle.js';
import User from '../models/User.js';
import WalletTransaction from '../models/WalletTransaction.js';
import walletService from './walletService.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

class OrderService {
  // Check if MongoDB supports transactions (replica set or sharded cluster)
  async supportsTransactions() {
    try {
      const adminDb = mongoose.connection.db.admin();
      const result = await adminDb.command({ replSetGetStatus: 1 });
      return result.ok === 1;
    } catch (error) {
      // If replSetGetStatus fails, we're probably on a standalone instance
      logger.info('MongoDB transactions not supported (standalone instance)', error.message);
      return false;
    }
  }

  // Execute operation with or without transactions
  async executeWithTransaction(operation) {
    const supportsTransactions = await this.supportsTransactions();
    
    if (supportsTransactions) {
      const session = await mongoose.startSession();
      session.startTransaction();
      
      try {
        const result = await operation(session);
        await session.commitTransaction();
        return result;
      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    } else {
      // Execute without transactions for standalone MongoDB
      return await operation(null);
    }
  }

  // Create single order
  async createSingleOrder(orderData, tenantId, userId) {
    return await this.executeWithTransaction(async (session) => {
      const { bundleId, customerPhone, bundleSize, quantity = 1 } = orderData;
      
      // Get bundle details
      const bundle = session 
        ? await Bundle.findOne({
            _id: bundleId,
            tenantId,
            isActive: true,
            isDeleted: false
          }).session(session)
        : await Bundle.findOne({
            _id: bundleId,
            tenantId,
            isActive: true,
            isDeleted: false
          });
      
      if (!bundle) {
        throw new Error('Bundle not found or inactive');
      }

      // Calculate total price
      const totalPrice = bundle.price * quantity;
      
      // Check wallet balance
      const user = session 
        ? await User.findById(userId).session(session)
        : await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      if (user.walletBalance < totalPrice) {
        throw new Error(`Insufficient wallet balance. Required: GH₵${totalPrice.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}`);
      }
      
      // Create order
      const order = new Order({
        orderType: 'single',
        tenantId,
        createdBy: userId,
        items: [{
          packageGroup: bundle.packageId,
          packageItem: bundleId,
          packageDetails: {
            name: bundle.name,
            code: bundle._id.toString(),
            price: bundle.price,
            dataVolume: bundle.dataVolume,
            validity: bundle.validity,
            provider: bundle.provider,
          },
          quantity,
          unitPrice: bundle.price,
          totalPrice: bundle.price * quantity,
          customerPhone,
          bundleSize: bundleSize ? {
            value: bundleSize.value,
            unit: bundleSize.unit || 'GB'
          } : undefined
        }],
        paymentMethod: 'wallet',
        status: 'confirmed',
        paymentStatus: 'paid',
        // The pre-save hook will calculate subtotal, total, and generate orderNumber
      });
      
      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }

      // Deduct from wallet
      try {
        // We use walletService directly if in transaction mode
        if (session) {
          // Directly update wallet balance in transaction
          user.walletBalance -= totalPrice;
          await user.save({ session });
          
          // Create wallet transaction record in the transaction
          const transaction = new WalletTransaction({
            user: userId,
            type: 'debit',
            amount: totalPrice,
            balanceAfter: user.walletBalance,
            description: `Payment for order ${order.orderNumber}`,
            relatedOrder: order._id
          });
          
          await transaction.save({ session });
        } else {
          // Use wallet service if not in transaction mode
          await walletService.debitWallet(
            userId,
            totalPrice,
            `Payment for order ${order.orderNumber}`,
            order._id
          );
        }
      } catch (walletError) {
        logger.error(`Failed to deduct from wallet: ${walletError.message}`);
        throw new Error(`Order created but payment failed: ${walletError.message}`);
      }
      
      logger.info(`Order created successfully: ${order.orderNumber}`);
      return order;
    });
  }

  // Create bulk order
  async createBulkOrder(orderData, tenantId, userId) {
    return await this.executeWithTransaction(async (session) => {
      const { bundleId, bulkData, delimiter = /[ ,\t]+/ } = orderData;
      if (!bulkData || !bulkData.trim()) {
        throw new Error('Bulk data is required');
      }
      
      // Get bundle
      const bundle = session
        ? await Bundle.findOne({ _id: bundleId, tenantId, isActive: true, isDeleted: false }).session(session)
        : await Bundle.findOne({ _id: bundleId, tenantId, isActive: true, isDeleted: false });
      
      if (!bundle) {
        throw new Error('Bundle not found or inactive');
      }
      
      // Provider prefix map
      const providerPrefixes = {
        MTN: ['024', '025', '054', '055', '059'],
        TELECEL: ['020', '050'],
        AT: ['027', '057', '026', '056'],
        GLO: ['023']
      };
      const allowedPrefixes = providerPrefixes[bundle.provider] || [];
      
      // Parse lines
      const lines = bulkData.trim().split('\n');
      const items = [];
      const errors = [];
      let totalQuantity = 0;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = line.split(delimiter).filter(Boolean);
        if (parts.length < 1) {
          errors.push({ line: i + 1, input: line, error: 'Invalid format. Use: phone (e.g., 0241234556)' });
          continue;
        }
        
        const phone = parts[0];
        
        // Validate phone prefix
        const prefix = phone.replace(/^\+?233/, '0').substring(0, 3);
        if (!allowedPrefixes.includes(prefix)) {
          errors.push({ line: i + 1, input: line, error: `Phone prefix ${prefix} not allowed for provider ${bundle.provider}` });
          continue;
        }
        
        // Validate phone number format
        const cleanPhone = phone.replace(/^\+?233/, '0');
        if (!/^0\d{8}$/.test(cleanPhone)) {
          errors.push({ line: i + 1, input: line, error: 'Invalid phone number format' });
          continue;
        }
        
        items.push({
          packageGroup: bundle.packageId,
          packageItem: bundleId,
          packageDetails: {
            name: bundle.name,
            code: bundle._id.toString(),
            price: bundle.price,
            dataVolume: bundle.dataVolume,
            validity: bundle.validity,
            provider: bundle.provider,
          },
          quantity: 1,
          unitPrice: bundle.price,
          totalPrice: bundle.price,
          customerPhone: cleanPhone,
          bundleSize: {
            value: bundle.dataVolume,
            unit: bundle.dataUnit
          }
        });
        
        totalQuantity += 1;
      }
      
      if (items.length === 0) {
        throw new Error('No valid items found in bulk data');
      }
      
      const totalPrice = bundle.price * totalQuantity;
      
      // Check wallet balance
      const user = session 
        ? await User.findById(userId).session(session)
        : await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      if (user.walletBalance < totalPrice) {
        throw new Error(`Insufficient wallet balance. Required: GH₵${totalPrice.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}`);
      }
      
      // Create order
      const order = new Order({
        orderType: 'bulk',
        tenantId,
        createdBy: userId,
        items,
        paymentMethod: 'wallet',
        paymentStatus: 'paid',
        status: 'confirmed',
        bulkData: {
          rawInput: bulkData,
          totalItems: items.length,
          successfulItems: items.length,
          failedItems: errors.length
        }
      });
      
      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }
      
      // Deduct from wallet
      try {
        if (session) {
          user.walletBalance -= totalPrice;
          await user.save({ session });
          const transaction = new WalletTransaction({
            user: userId,
            type: 'debit',
            amount: totalPrice,
            balanceAfter: user.walletBalance,
            description: `Payment for bulk order ${order.orderNumber}`,
            relatedOrder: order._id
          });
          await transaction.save({ session });
        } else {
          await walletService.debitWallet(
            userId,
            totalPrice,
            `Payment for bulk order ${order.orderNumber}`,
            order._id
          );
        }
      } catch (walletError) {
        logger.error(`Failed to deduct from wallet: ${walletError.message}`);
        throw new Error(`Order created but payment failed: ${walletError.message}`);
      }
      
      logger.info(`Bulk order created successfully: ${order.orderNumber} with ${items.length} items`);
      return {
        orderId: order._id,
        orderNumber: order.orderNumber,
        totalItems: items.length,
        items: items.map(item => ({
          customerPhone: item.customerPhone,
          bundleSize: item.bundleSize,
          status: item.processingStatus
        })),
        errors
      };
    });
  }

  // Get orders with filtering
  async getOrders(tenantId, filters = {}, pagination = {}) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = pagination;
    const {
      status,
      orderType,
      paymentStatus,
      startDate,
      endDate,
      search
    } = filters;
    
    const query = { tenantId };
    
    if (status) query.status = status;
    if (orderType) query.orderType = orderType;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'customerInfo.name': { $regex: search, $options: 'i' } },
        { 'customerInfo.phone': { $regex: search, $options: 'i' } },
        { 'items.customerPhone': { $regex: search, $options: 'i' } }
      ];
    }
    
    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('items.packageGroup', 'name provider')
        .populate('createdBy', 'fullName email')
        .populate('processedBy', 'fullName email')
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .sort({ [sortBy]: sortOrder }),
      Order.countDocuments(query)
    ]);
    
    return {
      orders,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
        limit: Number(limit)
      }
    };
  }

  // Process order item
  async processOrderItem(orderId, itemId, tenantId, userId) {
    return await this.executeWithTransaction(async (session) => {
      const order = session 
        ? await Order.findOne({
            _id: orderId,
            tenantId
          }).session(session)
        : await Order.findOne({
            _id: orderId,
            tenantId
          });
      
      if (!order) {
        throw new Error('Order not found');
      }
      
      const item = order.items.id(itemId);
      if (!item) {
        throw new Error('Order item not found');
      }
      
      if (item.processingStatus !== 'pending') {
        throw new Error('Order item is not in pending status');
      }
      
      item.processingStatus = 'processing';
      item.processedBy = userId;
      
      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }
      
      // Simulate bundle processing (replace with actual API integration)
      try {
        await this.processMobileBundle(item);
        
        item.processingStatus = 'completed';
        item.processedAt = new Date();
        
      } catch (processingError) {
        item.processingStatus = 'failed';
        item.processingError = processingError.message;
      }
      
      // Update order status
      await order.updateStatus();
      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }
      
      logger.info(`Order item processed: ${orderId}/${itemId} - Status: ${item.processingStatus}`);
      return order;
    });
  }

  // Process bulk order
  async processBulkOrder(orderId, tenantId, userId) {
    const order = await Order.findOne({
      _id: orderId,
      tenantId
    });
    
    if (!order) {
      throw new Error('Order not found');
    }
    
    if (order.orderType !== 'bulk') {
      throw new Error('Order is not a bulk order');
    }
    
    // Process all pending items in the bulk order
    const pendingItems = order.items.filter(item => item.processingStatus === 'pending');
    
    for (const item of pendingItems) {
      try {
        await this.processOrderItem(orderId, item._id, tenantId, userId);
      } catch (error) {
        logger.error(`Failed to process bulk order item: ${error.message}`);
        // Continue processing other items
      }
    }
    
    logger.info(`Bulk order processing completed: ${orderId}`);
    return order;
  }

  // Simulate mobile bundle processing
  async processMobileBundle(item) {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate random success/failure (90% success rate)
    const success = Math.random() > 0.1;
    
    if (!success) {
      throw new Error('Bundle activation failed - network error');
    }
    
    logger.info(`Bundle processed successfully for ${item.customerPhone}`);
  }

  // Get order analytics
  async getOrderAnalytics(tenantId, timeframe = '30d') {
    // Convert timeframe to date
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
      case '365d':
        startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const stats = await Order.aggregate([
      {
        $match: {
          tenantId: tenantId,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          completedOrders: {
            $sum: { $cond: ['$status', 1, 0] }
          },
          totalRevenue: { $sum: '$total' },
          bulkOrders: {
            $sum: { $cond: [{ $eq: ['$orderType', 'bulk'] }, 1, 0] }
          }
        }
      }
    ]);

    if (stats.length === 0) {
      return {
        totalOrders: 0,
        completedOrders: 0,
        totalRevenue: 0,
        bulkOrders: 0,
        completionRate: 0,
        timeframe
      };
    }

    const result = stats[0];
    const completionRate = result.totalOrders > 0 ? (result.completedOrders / result.totalOrders) * 100 : 0;

    return {
      totalOrders: result.totalOrders,
      completedOrders: result.completedOrders,
      totalRevenue: result.totalRevenue,
      bulkOrders: result.bulkOrders,
      completionRate: Math.round(completionRate * 100) / 100,
      timeframe
    };
  }
  
  // Cancel order
  async cancelOrder(orderId, tenantId, userId, reason) {
    return await this.executeWithTransaction(async (session) => {
      const order = session 
        ? await Order.findOne({
            _id: orderId,
            tenantId
          }).session(session)
        : await Order.findOne({
            _id: orderId,
            tenantId
          });
      
      if (!order) {
        throw new Error('Order not found');
      }
      
      if (!['pending', 'confirmed'].includes(order.status)) {
        throw new Error('Order cannot be cancelled in current status');
      }
      
      // Update item statuses
      for (const item of order.items) {
        if (item.processingStatus === 'pending') {
          item.processingStatus = 'cancelled';
        }
      }
      
      order.status = 'cancelled';
      order.notes = reason || 'Order cancelled';
      order.processedBy = userId;
      
      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }
      
      logger.info(`Order cancelled: ${order.orderNumber}`);
      return order;
    });
  }
}

export default new OrderService();
