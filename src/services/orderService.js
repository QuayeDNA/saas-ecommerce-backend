// src/services/orderService.js
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

class OrderService {
  // Create single order
  async createSingleOrder(orderData, tenantId, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const { productId, variantId, customerPhone, bundleSize, quantity = 1 } = orderData;
      
      // Get product and variant details
      const product = await Product.findOne({
        _id: productId,
        tenantId,
        isActive: true,
        isDeleted: false
      }).session(session);
      
      if (!product) {
        throw new Error('Product not found');
      }
      
      const variant = product.variants.id(variantId);
      if (!variant || !variant.isActive) {
        throw new Error('Product variant not found or inactive');
      }
      
      // Check inventory
      if (variant.availableInventory < quantity) {
        throw new Error(`Insufficient inventory. Available: ${variant.availableInventory}`);
      }
      
      // Reserve inventory
      variant.reservedInventory += quantity;
      await product.save({ session });
      
      // Create order
      const order = new Order({
        orderType: 'single',
        tenantId,
        createdBy: userId,
        items: [{
          product: productId,
          variant: variantId,
          variantDetails: {
            name: variant.name,
            sku: variant.sku,
            price: variant.price,
            dataVolume: variant.dataVolume,
            validity: variant.validity,
            network: variant.network,
            bundleType: variant.bundleType
          },
          quantity,
          unitPrice: variant.price,
          totalPrice: variant.price * quantity,
          customerPhone,
          bundleSize: bundleSize ? {
            value: bundleSize.value,
            unit: bundleSize.unit || 'GB'
          } : undefined
        }],
        paymentMethod: 'wallet',
        status: 'confirmed'
      });
      
      await order.save({ session });
      await session.commitTransaction();
      
      logger.info(`Single order created: ${order.orderNumber}`);
      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  // Create bulk order
  async createBulkOrder(bulkData, tenantId, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const { productId, variantId, rawInput } = bulkData;
      
      // Parse bulk input
      const parsedItems = this.parseBulkInput(rawInput);
      if (parsedItems.length === 0) {
        throw new Error('No valid items found in bulk input');
      }
      
      // Get product and variant details
      const product = await Product.findOne({
        _id: productId,
        tenantId,
        isActive: true,
        isDeleted: false
      }).session(session);
      
      if (!product) {
        throw new Error('Product not found');
      }
      
      const variant = product.variants.id(variantId);
      if (!variant || !variant.isActive) {
        throw new Error('Product variant not found or inactive');
      }
      
      // Check total inventory needed
      const totalQuantity = parsedItems.length;
      if (variant.availableInventory < totalQuantity) {
        throw new Error(`Insufficient inventory. Available: ${variant.availableInventory}, Required: ${totalQuantity}`);
      }
      
      // Reserve inventory
      variant.reservedInventory += totalQuantity;
      await product.save({ session });
      
      // Create order items
      const orderItems = parsedItems.map(item => ({
        product: productId,
        variant: variantId,
        variantDetails: {
          name: variant.name,
          sku: variant.sku,
          price: variant.price,
          dataVolume: variant.dataVolume,
          validity: variant.validity,
          network: variant.network,
          bundleType: variant.bundleType
        },
        quantity: 1,
        unitPrice: variant.price,
        totalPrice: variant.price,
        customerPhone: item.phone,
        bundleSize: {
          value: item.bundleSize.value,
          unit: item.bundleSize.unit
        }
      }));
      
      // Create order
      const order = new Order({
        orderType: 'bulk',
        tenantId,
        createdBy: userId,
        items: orderItems,
        bulkData: {
          rawInput,
          totalItems: parsedItems.length,
          successfulItems: 0,
          failedItems: 0
        },
        paymentMethod: 'wallet',
        status: 'confirmed'
      });
      
      await order.save({ session });
      await session.commitTransaction();
      
      logger.info(`Bulk order created: ${order.orderNumber} with ${parsedItems.length} items`);
      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  // Parse bulk input format: "phone:bundleSize" per line
  parseBulkInput(rawInput) {
    const lines = rawInput.split('\n').filter(line => line.trim());
    const items = [];
    
    for (const line of lines) {
      try {
        const [phone, bundleSizeStr] = line.split(':').map(s => s.trim());
        
        if (!phone || !bundleSizeStr) continue;
        
        // Parse bundle size (e.g., "1GB", "500MB")
        const bundleMatch = bundleSizeStr.match(/^(\d+(?:\.\d+)?)(MB|GB)$/i);
        if (!bundleMatch) continue;
        
        const value = parseFloat(bundleMatch[1]);
        const unit = bundleMatch[2].toUpperCase();
        
        // Validate phone number
        if (!/^\+?[\d\s-()]{10,}$/.test(phone)) continue;
        
        items.push({
          phone,
          bundleSize: { value, unit }
        });
      } catch (error) {
        logger.warn(`Failed to parse bulk line: ${line}`);
        continue;
      }
    }
    
    return items;
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
        .populate('items.product', 'name category provider')
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const order = await Order.findOne({
        _id: orderId,
        tenantId
      }).session(session);
      
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
        const product = await Product.findById(item.product).session(session);
        const variant = product.variants.id(item.variant);
        variant.reservedInventory -= item.quantity;
        variant.inventory -= item.quantity;
        await product.save({ session });
        
      } catch (processingError) {
        item.processingStatus = 'failed';
        item.processingError = processingError.message;
        
        // Release reserved inventory without reducing actual inventory
        const product = await Product.findById(item.product).session(session);
        const variant = product.variants.id(item.variant);
        variant.reservedInventory -= item.quantity;
        await product.save({ session });
      }
      
      // Update order status
      await order.updateStatus();
      await order.save({ session });
      
      await session.commitTransaction();
      
      logger.info(`Order item processed: ${orderId}/${itemId} - Status: ${item.processingStatus}`);
      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const order = await Order.findOne({
        _id: orderId,
        tenantId
      }).session(session);
      
      if (!order) {
        throw new Error('Order not found');
      }
      
      if (!['pending', 'confirmed'].includes(order.status)) {
        throw new Error('Order cannot be cancelled in current status');
      }
      
      // Release reserved inventory
      for (const item of order.items) {
        if (item.processingStatus === 'pending') {
          const product = await Product.findById(item.product).session(session);
          const variant = product.variants.id(item.variant);
          variant.reservedInventory -= item.quantity;
          await product.save({ session });
          
          item.processingStatus = 'cancelled';
        }
      }
      
      order.status = 'cancelled';
      order.notes = reason || 'Order cancelled';
      order.processedBy = userId;
      
      await order.save({ session });
      await session.commitTransaction();
      
      logger.info(`Order cancelled: ${order.orderNumber}`);
      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

export default new OrderService();
