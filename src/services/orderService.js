// src/services/orderService.js
import Order from '../models/Order.js';
import Product from '../models/Product.js';
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

  // Execute operation with optional transaction support
  async executeWithTransaction(operation) {
    const useTransactions = await this.supportsTransactions();
    
    if (useTransactions) {
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
      const { packageGroupId, packageItemId, customerPhone, bundleSize, quantity = 1 } = orderData;
      
      // Get package group and package item details
      const packageGroup = session 
        ? await Product.findOne({
            _id: packageGroupId,
            tenantId,
            isActive: true,
            isDeleted: false
          }).session(session)
        : await Product.findOne({
            _id: packageGroupId,
            tenantId,
            isActive: true,
            isDeleted: false
          });
      
      if (!packageGroup) {
        throw new Error('Package group not found');
      }
      
      const packageItem = packageGroup.packageItems.id(packageItemId);
      if (!packageItem || !packageItem.isActive || packageItem.isDeleted) {
        throw new Error('Package item not found or inactive');
      }
      
      // Check inventory
      if (packageItem.availableInventory < quantity) {
        throw new Error(`Insufficient inventory. Available: ${packageItem.availableInventory}`);
      }

      // Calculate total price
      const totalPrice = packageItem.price * quantity;
      
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
      
      // Reserve inventory
      packageItem.reservedInventory += quantity;
      if (session) {
        await packageGroup.save({ session });
      } else {
        await packageGroup.save();
      }
      
      // Create order
      const order = new Order({
        orderType: 'single',
        tenantId,
        createdBy: userId,
        items: [{
          packageGroup: packageGroupId,
          packageItem: packageItemId,
          packageDetails: {
            name: packageItem.name,
            code: packageItem.code,
            price: packageItem.price,
            dataVolume: packageItem.dataVolume,
            validity: packageItem.validity,
            provider: packageGroup.provider,
          },
          quantity,
          unitPrice: packageItem.price,
          totalPrice: packageItem.price * quantity,
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
      const { packageGroupId, packageItemId, bulkData, delimiter = ',' } = orderData;
      
      if (!bulkData || !bulkData.trim()) {
        throw new Error('Bulk data is required');
      }
      
      // Get package group and package item details
      const packageGroup = session 
        ? await Product.findOne({
            _id: packageGroupId,
            tenantId,
            isActive: true,
            isDeleted: false
          }).session(session)
        : await Product.findOne({
            _id: packageGroupId,
            tenantId,
            isActive: true,
            isDeleted: false
          });
      
      if (!packageGroup) {
        throw new Error('Package group not found');
      }
      
      const packageItem = packageGroup.packageItems.id(packageItemId);
      if (!packageItem || !packageItem.isActive || packageItem.isDeleted) {
        throw new Error('Package item not found or inactive');
      }
      
      // Parse bulk data
      const lines = bulkData.trim().split('\n');
      const items = [];
      let validItems = 0;
      let totalQuantity = 0;
      
      for (const element of lines) {
        const line = element.trim();
        if (!line) continue;
        
        const parts = line.split(delimiter);
        const phoneNumber = parts[0].trim();
        // Optional: handle bundle size
        let bundleSize;
        if (parts.length > 1) {
          const bundleValue = parseFloat(parts[1]);
          const bundleUnit = parts.length > 2 ? parts[2].trim().toUpperCase() : 'GB';
          
          if (!isNaN(bundleValue)) {
            bundleSize = {
              value: bundleValue,
              unit: bundleUnit === 'MB' ? 'MB' : 'GB'
            };
          }
        }
        
        if (phoneNumber) {
          validItems++;
          totalQuantity++;
          items.push({
            packageGroup: packageGroupId,
            packageItem: packageItemId,
            packageDetails: {
              name: packageItem.name,
              code: packageItem.code,
              price: packageItem.price,
              dataVolume: packageItem.dataVolume,
              validity: packageItem.validity,
              provider: packageGroup.provider,
            },
            quantity: 1,
            unitPrice: packageItem.price,
            totalPrice: packageItem.price,
            customerPhone: phoneNumber,
            bundleSize,
            processingStatus: 'pending'
          });
        }
      }
      
      if (items.length === 0) {
        throw new Error('No valid items found in bulk data');
      }
      
      // Check inventory
      if (packageItem.availableInventory < totalQuantity) {
        throw new Error(`Insufficient inventory. Required: ${totalQuantity}, Available: ${packageItem.availableInventory}`);
      }
      
      // Calculate total price
      const totalPrice = packageItem.price * totalQuantity;
      
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
      
      // Reserve inventory
      packageItem.reservedInventory += totalQuantity;
      if (session) {
        await packageGroup.save({ session });
      } else {
        await packageGroup.save();
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
          successfulItems: 0,
          failedItems: 0
        }
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
            description: `Payment for bulk order ${order.orderNumber}`,
            relatedOrder: order._id
          });
          
          await transaction.save({ session });
        } else {
          // Use wallet service if not in transaction mode
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
      return order;
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

// Process single order item
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
        throw new Error('Item is not in pending status');
      }
      
      // Update item status
      item.processingStatus = 'processing';
      item.processedBy = userId;
      
      // Simulate bundle processing (replace with actual API integration)
      try {
        await this.processMobileBundle(item);
        
        item.processingStatus = 'completed';
        item.processedAt = new Date();
        
        // Release reserved inventory and reduce actual inventory
        const packageGroup = session 
          ? await Product.findById(item.packageGroup).session(session)
          : await Product.findById(item.packageGroup);
        const packageItem = packageGroup.packageItems.id(item.packageItem);
        packageItem.reservedInventory -= item.quantity;
        packageItem.inventory -= item.quantity;
        if (session) {
          await packageGroup.save({ session });
        } else {
          await packageGroup.save();
        }
        
      } catch (processingError) {
        item.processingStatus = 'failed';
        item.processingError = processingError.message;
        
        // Release reserved inventory without reducing actual inventory
        const packageGroup = session 
          ? await Product.findById(item.packageGroup).session(session)
          : await Product.findById(item.packageGroup);
        const packageItem = packageGroup.packageItems.id(item.packageItem);
        packageItem.reservedInventory -= item.quantity;
        if (session) {
          await packageGroup.save({ session });
        } else {
          await packageGroup.save();
        }
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
    const order = await Order.findOne({ _id: orderId, tenantId });
    if (!order) {
      throw new Error('Order not found');
    }
    
    if (order.orderType !== 'bulk') {
      throw new Error('Order is not a bulk order');
    }
    
    // Process items in batches to avoid overwhelming the system
    const batchSize = 10;
    const items = order.items.filter(item => item.processingStatus === 'pending');
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map(item => 
        this.processOrderItem(orderId, item._id, tenantId, userId)
          .catch(error => {
            logger.error(`Failed to process item ${item._id}: ${error.message}`);
            return null;
          })
      );
      
      await Promise.all(promises);
      
      // Add delay between batches
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return await Order.findById(orderId);
  }
  
  // Simulate mobile bundle processing (replace with actual API)
  async processMobileBundle(item) {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
    
    // Simulate random failures for demo (remove in production)
    if (Math.random() < 0.1) {
      throw new Error('Network provider API error');
    }
    
    logger.info(`Bundle processed: ${item.customerPhone} - ${item.bundleSize.value}${item.bundleSize.unit}`);
    return true;
  }
  
  // Get order analytics
  async getOrderAnalytics(tenantId, timeframe = '30d') {
    const days = parseInt(timeframe.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const [
      totalOrders,
      completedOrders,
      pendingOrders,
      totalRevenue,
      bulkOrders
    ] = await Promise.all([
      Order.countDocuments({ tenantId, createdAt: { $gte: startDate } }),
      Order.countDocuments({ tenantId, status: 'completed', createdAt: { $gte: startDate } }),
      Order.countDocuments({ tenantId, status: { $in: ['pending', 'processing'] } }),
      Order.aggregate([
        { $match: { tenantId: new mongoose.Types.ObjectId(tenantId), status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Order.countDocuments({ tenantId, orderType: 'bulk', createdAt: { $gte: startDate } })
    ]);
    
    return {
      totalOrders,
      completedOrders,
      pendingOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
      bulkOrders,
      completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
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
      
      // Release reserved inventory
      for (const item of order.items) {
        if (item.processingStatus === 'pending') {
          const packageGroup = session 
            ? await Product.findById(item.packageGroup).session(session)
            : await Product.findById(item.packageGroup);
          const packageItem = packageGroup.packageItems.id(item.packageItem);
          packageItem.reservedInventory -= item.quantity;
          if (session) {
            await packageGroup.save({ session });
          } else {
            await packageGroup.save();
          }
          
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
