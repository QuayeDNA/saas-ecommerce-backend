// src/services/orderService.js
import Order from '../models/Order.js';
import Bundle from '../models/Bundle.js';
import User from '../models/User.js';
import WalletTransaction from '../models/WalletTransaction.js';
import walletService from './walletService.js';
import notificationService from './notificationService.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { parseBulkOrderRow } from '../utils/parseBulkOrderRow.js';

class OrderService {
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
      const { packageGroupId, packageItemId, customerPhone, bundleSize, quantity = 1 } = orderData;
      
      // Get bundle details with provider info - try without tenantId first
      let bundle = session 
        ? await Bundle.findOne({
            _id: packageItemId,
            packageId: packageGroupId,
            isActive: true,
            isDeleted: false
          }).populate('providerId', 'name code').session(session)
        : await Bundle.findOne({
            _id: packageItemId,
            packageId: packageGroupId,
            isActive: true,
            isDeleted: false
          }).populate('providerId', 'name code');
      
      if (!bundle) {
        // Fallback: try to find bundle by ID only
        bundle = session 
          ? await Bundle.findOne({
              _id: packageItemId,
              isActive: true,
              isDeleted: false
            }).populate('providerId', 'name code').session(session)
          : await Bundle.findOne({
              _id: packageItemId,
              isActive: true,
              isDeleted: false
            }).populate('providerId', 'name code');
      }
      
      if (!bundle) {
        throw new Error('Bundle not found or inactive');
      }

      // Calculate order total
      const orderTotal = bundle.price * quantity;
      
      // Check wallet balance
      const user = session 
        ? await User.findById(userId).session(session)
        : await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      // Determine order status based on wallet balance
      let orderStatus = 'confirmed';
      let paymentStatus = 'pending';
      let walletDeducted = false;

      if (user.walletBalance >= orderTotal) {
        // Sufficient balance - deduct wallet and confirm order
        if (session) {
          user.walletBalance -= orderTotal;
          await user.save({ session });
          
          // Record wallet transaction
          const transaction = new WalletTransaction({
            user: userId,
            type: 'debit',
            amount: orderTotal,
            balanceAfter: user.walletBalance,
            description: `Payment for order - ${bundle.name} for ${customerPhone}`,
            metadata: { orderType: 'single' }
          });
          await transaction.save({ session });
        } else {
          await walletService.debitWallet(
            userId.toString(),
            orderTotal,
            `Payment for order - ${bundle.name} for ${customerPhone}`,
            null,
            { orderType: 'single' }
          );
        }
        walletDeducted = true;
        paymentStatus = 'paid';
      } else {
        // Insufficient balance - create as draft
        orderStatus = 'draft';
        paymentStatus = 'pending';
      }
            
      // Create order
      const order = new Order({
        orderType: 'single',
        tenantId,
        createdBy: userId,
        items: [{
          packageGroup: bundle.packageId,
          packageItem: packageItemId,
          packageDetails: {
            name: bundle.name,
            code: bundle._id.toString(),
            price: bundle.price,
            dataVolume: bundle.dataVolume,
            validity: bundle.validity,
            provider: bundle.providerId?.code || bundle.providerId?.name,
          },
          quantity,
          unitPrice: bundle.price,
          totalPrice: orderTotal,
          customerPhone,
          bundleSize: bundleSize ? {
            value: bundleSize.value,
            unit: bundleSize.unit || 'GB'
          } : undefined
        }],
        paymentMethod: 'wallet',
        status: orderStatus,
        paymentStatus: paymentStatus,
        // The pre-save hook will calculate subtotal, total, and generate orderNumber
      });
      
      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }

      const statusMessage = walletDeducted 
        ? `Order created successfully: ${order.orderNumber}`
        : `Order created as draft due to insufficient wallet balance. Required: GH₵${orderTotal.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}`;
      
      logger.info(statusMessage);

      // Send notification for new order creation
      try {
        // Notify super admins about new order
        const superAdmins = await User.find({ userType: 'super_admin' }, 'userType');
        for (const admin of superAdmins) {
          await notificationService.createInAppNotification(
            admin._id.toString(),
            'New Order Created',
            `Order ${order.orderNumber} has been created by ${user.email || user.name || 'User'}. Amount: GH₵${orderTotal.toFixed(2)}`,
            'info',
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              amount: orderTotal,
              customerEmail: user.email,
              type: 'new_order_created',
              navigationLink: this.getNavigationLink(admin.userType, 'orders')
            }
          );
        }

        // Notify the order creator about their order
        await notificationService.createInAppNotification(
          userId.toString(),
          'Order Created Successfully',
          `Your order ${order.orderNumber} has been created. ${walletDeducted ? 'Payment processed from wallet.' : 'Payment pending - insufficient wallet balance.'}`,
          walletDeducted ? 'success' : 'warning',
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            amount: orderTotal,
            paymentStatus: paymentStatus,
            type: 'order_created',
            navigationLink: this.getNavigationLink(user.userType, 'orders')
          }
        );
      } catch (error) {
        logger.error(`Failed to send order creation notification: ${error.message}`);
      }

      return order;
    });
  }

  // Create bulk order (new logic)
  async createBulkOrders({ items, tenantId, userId, packageId }) {
    return await this.executeWithTransaction(async (session) => {
      const createdOrders = [];
      const errors = [];
      let totalOrderAmount = 0;
      const orderItems = [];

      // Ensure tenantId and userId are ObjectId instances
      const getObjectId = (id) => {
        if (typeof id === 'string') return new mongoose.Types.ObjectId(id);
        if (id instanceof mongoose.Types.ObjectId) return id;
        // fallback: try to convert
        return new mongoose.Types.ObjectId(String(id));
      };
      const tenantObjectId = getObjectId(tenantId);
      const userObjectId = getObjectId(userId);

      // First pass: validate all items and calculate total
      for (let i = 0; i < items.length; i++) {
        const row = items[i];
        const parsed = parseBulkOrderRow(row);
        if (parsed.error) {
          errors.push({ index: i, row, error: parsed.error });
          continue;
        }

        // Look up the correct bundle (packageItem) within the specific package (packageGroup)
        const bundle = session 
          ? await Bundle.findOne({
              packageId: packageId,
              dataVolume: parsed.value.bundleSize.value,
              dataUnit: parsed.value.bundleSize.unit,
              isActive: true,
              isDeleted: false
            }).populate('providerId', 'name code').session(session)
          : await Bundle.findOne({
              packageId: packageId,
              dataVolume: parsed.value.bundleSize.value,
              dataUnit: parsed.value.bundleSize.unit,
              isActive: true,
              isDeleted: false
            }).populate('providerId', 'name code');
        
        if (!bundle) {
          errors.push({ index: i, row, error: 'Bundle not found for specified data volume and unit in this package' });
          continue;
        }

        orderItems.push({
          index: i,
          row,
          bundle,
          parsed: parsed.value
        });
        totalOrderAmount += bundle.price;
      }

      // Check wallet balance
      const user = session 
        ? await User.findById(userId).session(session)
        : await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      // Determine if we can process all orders or need to create as drafts
      let canProcessAll = user.walletBalance >= totalOrderAmount;
      let walletDeducted = false;

      if (canProcessAll) {
        // Deduct wallet for all orders
        if (session) {
          user.walletBalance -= totalOrderAmount;
          await user.save({ session });
          
          // Record wallet transaction
          const transaction = new WalletTransaction({
            user: userId,
            type: 'debit',
            amount: totalOrderAmount,
            balanceAfter: user.walletBalance,
            description: `Bulk order payment for ${orderItems.length} items`,
            metadata: { orderType: 'bulk', itemCount: orderItems.length }
          });
          await transaction.save({ session });
        } else {
          await walletService.debitWallet(
            userId.toString(),
            totalOrderAmount,
            `Bulk order payment for ${orderItems.length} items`,
            null,
            { orderType: 'bulk', itemCount: orderItems.length }
          );
        }
        walletDeducted = true;
      }

      // Second pass: create orders
      for (const item of orderItems) {
        const { bundle, parsed, index, row } = item;
        const packageGroup = bundle.packageId;

        try {
          const orderStatus = canProcessAll ? 'confirmed' : 'draft';
          const paymentStatus = canProcessAll ? 'paid' : 'pending';

          const order = new Order({
            orderType: 'single',
            tenantId: tenantObjectId,
            createdBy: userObjectId,
            items: [
              {
                packageGroup,
                packageItem: bundle._id,
                packageDetails: {
                  name: bundle.name,
                  code: bundle._id.toString(),
                  price: bundle.price,
                  dataVolume: bundle.dataVolume,
                  validity: bundle.validity,
                  validityUnit: bundle.validityUnit,
                  provider: bundle.providerId?.code || bundle.providerId?.name
                },
                quantity: 1,
                unitPrice: bundle.price,
                totalPrice: bundle.price,
                customerPhone: parsed.customerPhone,
                bundleSize: parsed.bundleSize,
                processingStatus: 'pending'
              }
            ],
            status: orderStatus,
            paymentStatus: paymentStatus
          });

          if (session) {
            await order.save({ session });
          } else {
            await order.save();
          }
          
          createdOrders.push(order);
        } catch (err) {
          errors.push({ index, row, error: err.message });
        }
      }

      const statusMessage = walletDeducted 
        ? `Bulk order created successfully: ${createdOrders.length} orders`
        : `Bulk order created as drafts due to insufficient wallet balance. Required: GH₵${totalOrderAmount.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}`;

      logger.info(statusMessage);

      // Send notification for bulk order creation
      try {
        // Notify super admins about bulk order
        const superAdmins = await User.find({ userType: 'super_admin' }, 'userType');
        for (const admin of superAdmins) {
          await notificationService.createInAppNotification(
            admin._id.toString(),
            'Bulk Order Created',
            `Bulk order with ${createdOrders.length} items has been created by ${user.email || user.name || 'User'}. Total amount: GH₵${totalOrderAmount.toFixed(2)}`,
            'info',
            {
              orderCount: createdOrders.length,
              totalAmount: totalOrderAmount,
              customerEmail: user.email,
              type: 'bulk_order_created',
              navigationLink: this.getNavigationLink(admin.userType, 'orders')
            }
          );
        }

        // Notify the order creator about their bulk order
        await notificationService.createInAppNotification(
          userId.toString(),
          'Bulk Order Created Successfully',
          `Your bulk order with ${createdOrders.length} items has been created. ${walletDeducted ? 'Payment processed from wallet.' : 'Payment pending - insufficient wallet balance.'}`,
          walletDeducted ? 'success' : 'warning',
          {
            orderCount: createdOrders.length,
            totalAmount: totalOrderAmount,
            paymentStatus: walletDeducted ? 'paid' : 'pending',
            type: 'bulk_order_created',
            navigationLink: this.getNavigationLink(user.userType, 'orders')
          }
        );
      } catch (error) {
        logger.error(`Failed to send bulk order creation notification: ${error.message}`);
      }

      return {
        successCount: createdOrders.length,
        failedCount: errors.length,
        failedRecords: errors,
        orders: createdOrders.map(o => o._id),
        totalAmount: totalOrderAmount,
        walletDeducted
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
      search,
      createdBy
    } = filters;
    
    // For super admins (tenantId is null), don't filter by tenant
    // For regular users, filter by their tenant
    const query = tenantId ? { tenantId } : {};
    
    if (status) query.status = status;
    if (orderType) query.orderType = orderType;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (createdBy) query.createdBy = createdBy;
    
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
      // For super admins (tenantId is null), don't filter by tenant
      // For regular users, filter by their tenant
      const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };
      
      const order = session 
        ? await Order.findOne(query).session(session)
        : await Order.findOne(query);
      
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
      let processedSuccessfully = false;
      try {
        await this.processMobileBundle(item);
        // Mark as completed - wallet was already checked and deducted when order was created
        item.paymentStatus = 'Done';
        item.processingStatus = 'completed';
        item.processedAt = new Date();
        processedSuccessfully = true;
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

      // Send notification for order processing
      try {
        const orderCreator = await User.findById(order.createdBy);
        const processor = await User.findById(userId);
        
        if (orderCreator) {
          await notificationService.createInAppNotification(
            orderCreator._id.toString(),
            'Order Processing Update',
            `Your order ${order.orderNumber} is being processed by ${processor?.fullName || processor?.email || 'Admin'}. Status: ${processedSuccessfully ? 'Completed' : 'Failed'}`,
            processedSuccessfully ? 'success' : 'error',
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              status: processedSuccessfully ? 'completed' : 'failed',
              processedBy: processor?.fullName || processor?.email,
              type: 'order_processing_update',
              navigationLink: this.getNavigationLink(orderCreator.userType, 'orders')
            }
          );
        }

        // Notify super admins about order processing
        const superAdmins = await User.find({ userType: 'super_admin' }, 'userType');
        for (const admin of superAdmins) {
          await notificationService.createInAppNotification(
            admin._id.toString(),
            'Order Processed',
            `Order ${order.orderNumber} has been processed by ${processor?.fullName || processor?.email || 'Admin'}. Status: ${processedSuccessfully ? 'Completed' : 'Failed'}`,
            processedSuccessfully ? 'success' : 'error',
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              status: processedSuccessfully ? 'completed' : 'failed',
              processedBy: processor?.fullName || processor?.email,
              type: 'order_processed',
              navigationLink: this.getNavigationLink(admin.userType, 'orders')
            }
          );
        }
      } catch (error) {
        logger.error(`Failed to send order processing notification: ${error.message}`);
      }
      
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

    // Send notification for bulk order processing
    try {
      const orderCreator = await User.findById(order.createdBy);
      const processor = await User.findById(userId);
      
      if (orderCreator) {
        await notificationService.createInAppNotification(
          orderCreator._id.toString(),
          'Bulk Order Processing Update',
          `Your bulk order ${order.orderNumber} is being processed by ${processor?.fullName || processor?.email || 'Admin'}.`,
          'info',
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            processedBy: processor?.fullName || processor?.email,
            type: 'bulk_order_processing_update',
            navigationLink: this.getNavigationLink(orderCreator.userType, 'orders')
          }
        );
      }

      // Notify super admins about bulk order processing
      const superAdmins = await User.find({ userType: 'super_admin' }, 'userType');
      for (const admin of superAdmins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          'Bulk Order Processing',
          `Bulk order ${order.orderNumber} is being processed by ${processor?.fullName || processor?.email || 'Admin'}.`,
          'info',
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            processedBy: processor?.fullName || processor?.email,
            type: 'bulk_order_processing',
            navigationLink: this.getNavigationLink(admin.userType, 'orders')
          }
        );
      }
    } catch (error) {
      logger.error(`Failed to send bulk order processing notification: ${error.message}`);
    }

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

  // Process draft orders when wallet is topped up
  async processDraftOrders(userId, tenantId) {
    return await this.executeWithTransaction(async (session) => {
      // Get all draft orders for the user
      const draftOrders = session 
        ? await Order.find({
            createdBy: userId,
            tenantId,
            status: 'draft'
          }).session(session)
        : await Order.find({
            createdBy: userId,
            tenantId,
            status: 'draft'
          });

      if (draftOrders.length === 0) {
        return { processed: 0, message: 'No draft orders found' };
      }

      // Get user's current wallet balance
      const user = session 
        ? await User.findById(userId).session(session)
        : await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      let totalRequired = 0;
      const processableOrders = [];

      // Calculate total required for all draft orders
      for (const order of draftOrders) {
        const orderTotal = order.items.reduce((sum, item) => sum + item.totalPrice, 0);
        totalRequired += orderTotal;
        processableOrders.push({ order, orderTotal });
      }

      // Check if user has sufficient balance
      if (user.walletBalance < totalRequired) {
        throw new Error(`Insufficient wallet balance to process all draft orders. Required: GH₵${totalRequired.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}`);
      }

      // Process all draft orders
      let processedCount = 0;
      for (const { order, orderTotal } of processableOrders) {
        // Deduct wallet for this order
        if (session) {
          user.walletBalance -= orderTotal;
          await user.save({ session });
          
          // Record wallet transaction
          const transaction = new WalletTransaction({
            user: userId,
            type: 'debit',
            amount: orderTotal,
            balanceAfter: user.walletBalance,
            description: `Payment for draft order ${order.orderNumber}`,
            relatedOrder: order._id,
            metadata: { orderType: 'draft_processing' }
          });
          await transaction.save({ session });
        } else {
          await walletService.debitWallet(
            userId.toString(),
            orderTotal,
            `Payment for draft order ${order.orderNumber}`,
            order._id,
            { orderType: 'draft_processing' }
          );
        }

        // Update order status
        order.status = 'confirmed';
        order.paymentStatus = 'paid';
        
        if (session) {
          await order.save({ session });
        } else {
          await order.save();
        }
        
        processedCount++;
      }

      logger.info(`Processed ${processedCount} draft orders for user ${userId}`);

      // Send notification for draft order processing
      try {
        if (processedCount > 0) {
          await notificationService.createInAppNotification(
            userId.toString(),
            'Draft Orders Processed',
            `Successfully processed ${processedCount} draft orders. Total amount: GH₵${totalRequired.toFixed(2)}`,
            'success',
            {
              processedCount,
              totalAmount: totalRequired,
              type: 'draft_orders_processed',
              navigationLink: this.getNavigationLink(user.userType, 'orders')
            }
          );

          // Notify super admins about draft order processing
          const superAdmins = await User.find({ userType: 'super_admin' }, 'userType');
          for (const admin of superAdmins) {
            await notificationService.createInAppNotification(
              admin._id.toString(),
              'Draft Orders Processed',
              `User ${user.email || user.name || 'User'} processed ${processedCount} draft orders. Total amount: GH₵${totalRequired.toFixed(2)}`,
              'info',
              {
                processedCount,
                totalAmount: totalRequired,
                userEmail: user.email,
                type: 'draft_orders_processed',
                navigationLink: this.getNavigationLink(admin.userType, 'orders')
              }
            );
          }
        }
      } catch (error) {
        logger.error(`Failed to send draft order processing notification: ${error.message}`);
      }

      return { 
        processed: processedCount, 
        message: `Successfully processed ${processedCount} draft orders`,
        totalAmount: totalRequired
      };
    });
  }
  
  // Cancel order
  async cancelOrder(orderId, tenantId, userId, reason) {
    return await this.executeWithTransaction(async (session) => {
      // For super admins (tenantId is null), don't filter by tenant
      // For regular users, filter by their tenant
      const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };
      
      const order = session 
        ? await Order.findOne(query).session(session)
        : await Order.findOne(query);
      
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

      // Send notification for order cancellation
      try {
        const orderCreator = await User.findById(order.createdBy);
        const canceller = await User.findById(userId);
        
        if (orderCreator) {
          await notificationService.createInAppNotification(
            orderCreator._id.toString(),
            'Order Cancelled',
            `Your order ${order.orderNumber} has been cancelled by ${canceller?.fullName || canceller?.email || 'Admin'}. Reason: ${reason || 'No reason provided'}`,
            'error',
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              cancelledBy: canceller?.fullName || canceller?.email,
              reason: reason || 'No reason provided',
              type: 'order_cancelled',
              navigationLink: this.getNavigationLink(orderCreator.userType, 'orders')
            }
          );
        }

        // Notify super admins about order cancellation
        const superAdmins = await User.find({ userType: 'super_admin' }, 'userType');
        for (const admin of superAdmins) {
          await notificationService.createInAppNotification(
            admin._id.toString(),
            'Order Cancelled',
            `Order ${order.orderNumber} has been cancelled by ${canceller?.fullName || canceller?.email || 'Admin'}. Reason: ${reason || 'No reason provided'}`,
            'warning',
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              cancelledBy: canceller?.fullName || canceller?.email,
              reason: reason || 'No reason provided',
              type: 'order_cancelled',
              navigationLink: this.getNavigationLink(admin.userType, 'orders')
            }
          );
        }
      } catch (error) {
        logger.error(`Failed to send order cancellation notification: ${error.message}`);
      }

      return order;
    });
  }
}

export default new OrderService();