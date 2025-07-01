// src/services/storefrontService.js
import Storefront from '../models/Storefront.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

class StorefrontService {
  // Create storefront for agent
  async createStorefront(storefrontData, tenantId) {
    try {
      // Check if agent already has a storefront
      const existingStorefront = await Storefront.findOne({ tenantId });
      if (existingStorefront) {
        throw new Error('Agent already has a storefront');
      }
      
      // Get agent details for default values
      const agent = await User.findById(tenantId);
      if (!agent || agent.userType !== 'agent') {
        throw new Error('Invalid agent');
      }
      
      // Generate unique slug
      let slug = storefrontData.slug || storefrontData.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      // Ensure slug uniqueness
      let counter = 1;
      let originalSlug = slug;
      while (await Storefront.findOne({ slug })) {
        slug = `${originalSlug}-${counter}`;
        counter++;
      }
      
      const storefront = new Storefront({
        ...storefrontData,
        tenantId,
        slug,
        contactInfo: {
          email: agent.email,
          ...storefrontData.contactInfo
        }
      });
      
      await storefront.save();
      logger.info(`Storefront created: ${storefront.slug} for agent ${tenantId}`);
      return storefront;
    } catch (error) {
      logger.error(`Storefront creation failed: ${error.message}`);
      throw error;
    }
  }
  
  // Update storefront
  async updateStorefront(tenantId, updateData) {
    try {
      const storefront = await Storefront.findOneAndUpdate(
        { tenantId },
        updateData,
        { new: true, runValidators: true }
      );
      
      if (!storefront) {
        throw new Error('Storefront not found');
      }
      
      logger.info(`Storefront updated: ${storefront.slug}`);
      return storefront;
    } catch (error) {
      logger.error(`Storefront update failed: ${error.message}`);
      throw error;
    }
  }
  
  // Get agent's storefront
  async getStorefront(tenantId) {
    try {
      const storefront = await Storefront.findOne({ tenantId });
      return storefront;
    } catch (error) {
      logger.error(`Get storefront failed: ${error.message}`);
      throw error;
    }
  }
  
  // Get public storefront by slug
  async getPublicStorefront(slug) {
    try {
      const storefront = await Storefront.findOne({
        slug,
        isActive: true,
        isPublic: true
      }).populate('tenantId', 'businessName businessCategory');
      
      if (!storefront) {
        throw new Error('Storefront not found');
      }
      
      // Increment view count
      await storefront.incrementViews();
      
      return storefront;
    } catch (error) {
      logger.error(`Get public storefront failed: ${error.message}`);
      throw error;
    }
  }
  
  // Get storefront products (public)
  async getStorefrontProducts(slug, filters = {}, pagination = {}) {
    try {
      const storefront = await Storefront.findOne({
        slug,
        isActive: true,
        isPublic: true
      });
      
      if (!storefront) {
        throw new Error('Storefront not found');
      }
      
      const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = pagination;
      const { category, provider, search, minPrice, maxPrice } = filters;
      
      const query = {
        tenantId: storefront.tenantId,
        isActive: true,
        isDeleted: false
      };
      
      if (category) query.category = category;
      if (provider) query.provider = provider;
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ];
      }
      
      // Price filtering on variants
      if (minPrice || maxPrice) {
        const priceMatch = {};
        if (minPrice) priceMatch['variants.price'] = { $gte: minPrice };
        if (maxPrice) priceMatch['variants.price'] = { ...priceMatch['variants.price'], $lte: maxPrice };
        Object.assign(query, priceMatch);
      }
      
      const [products, total] = await Promise.all([
        Product.find(query)
          .select('-createdBy -updatedBy -tenantId')
          .skip((page - 1) * limit)
          .limit(Number(limit))
          .sort({ [sortBy]: sortOrder }),
        Product.countDocuments(query)
      ]);
      
      return {
        products,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / limit),
          limit: Number(limit)
        }
      };
    } catch (error) {
      logger.error(`Get storefront products failed: ${error.message}`);
      throw error;
    }
  }
  
  // Create public order from storefront
  async createStorefrontOrder(slug, orderData) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const storefront = await Storefront.findOne({
        slug,
        isActive: true,
        isPublic: true
      }).session(session);
      
      if (!storefront) {
        throw new Error('Storefront not found');
      }
      
      if (!storefront.features.allowOrders) {
        throw new Error('Orders are not enabled for this storefront');
      }
      
      const { items, customerInfo } = orderData;
      
      // Validate and process order items
      const processedItems = [];
      let subtotal = 0;
      
      for (const item of items) {
        const product = await Product.findOne({
          _id: item.productId,
          tenantId: storefront.tenantId,
          isActive: true,
          isDeleted: false
        }).session(session);
        
        if (!product) {
          throw new Error(`Product not found: ${item.productId}`);
        }
        
        const variant = product.variants.id(item.variantId);
        if (!variant || !variant.isActive) {
          throw new Error(`Product variant not found: ${item.variantId}`);
        }
        
        // Check inventory
        if (variant.availableInventory < item.quantity) {
          throw new Error(`Insufficient inventory for ${product.name} - ${variant.name}`);
        }
        
        // Reserve inventory
        variant.reservedInventory += item.quantity;
        await product.save({ session });
        
        const itemTotal = variant.price * item.quantity;
        subtotal += itemTotal;
        
        processedItems.push({
          product: product._id,
          variant: variant._id,
          variantDetails: {
            name: variant.name,
            sku: variant.sku,
            price: variant.price,
            dataVolume: variant.dataVolume,
            validity: variant.validity,
            network: variant.network,
            bundleType: variant.bundleType
          },
          quantity: item.quantity,
          unitPrice: variant.price,
          totalPrice: itemTotal,
          customerPhone: item.customerPhone || customerInfo.phone,
          bundleSize: item.bundleSize
        });
      }
      
      // Create order
      const order = new Order({
        orderType: 'single',
        tenantId: storefront.tenantId,
        createdBy: storefront.tenantId, // Agent as creator for storefront orders
        customerInfo,
        items: processedItems,
        subtotal,
        total: subtotal,
        status: 'pending',
        paymentStatus: 'pending',
        notes: `Order from storefront: ${storefront.name}`,
        tags: ['storefront', slug]
      });
      
      await order.save({ session });
      
      // Increment storefront order count
      await storefront.incrementOrders();
      
      await session.commitTransaction();
      
      logger.info(`Storefront order created: ${order.orderNumber} from ${slug}`);
      return order;
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Storefront order creation failed: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  // Get storefront analytics
  async getStorefrontAnalytics(tenantId, timeframe = '30d') {
    try {
      const days = parseInt(timeframe.replace('d', ''));
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const storefront = await Storefront.findOne({ tenantId });
      if (!storefront) {
        throw new Error('Storefront not found');
      }
      
      const [
        totalProducts,
        totalOrders,
        recentOrders,
        ordersByStatus
      ] = await Promise.all([
        Product.countDocuments({
          tenantId,
          isActive: true,
          isDeleted: false
        }),
        Order.countDocuments({
          tenantId,
          tags: 'storefront',
          createdAt: { $gte: startDate }
        }),
        Order.find({
          tenantId,
          tags: 'storefront',
          createdAt: { $gte: startDate }
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('orderNumber total status createdAt customerInfo'),
        Order.aggregate([
          {
            $match: {
              tenantId: new mongoose.Types.ObjectId(tenantId),
              tags: 'storefront',
              createdAt: { $gte: startDate }
            }
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              revenue: { $sum: '$total' }
            }
          }
        ])
      ]);
      
      return {
        storefront: {
          views: storefront.analytics.totalViews,
          orders: storefront.analytics.totalOrders,
          lastVisit: storefront.analytics.lastVisit
        },
        products: {
          total: totalProducts
        },
        orders: {
          total: totalOrders,
          recent: recentOrders,
          byStatus: ordersByStatus
        },
        timeframe
      };
    } catch (error) {
      logger.error(`Get storefront analytics failed: ${error.message}`);
      throw error;
    }
  }
  
  // Check slug availability
  async checkSlugAvailability(slug, excludeTenantId = null) {
    try {
      const query = { slug };
      if (excludeTenantId) {
        query.tenantId = { $ne: excludeTenantId };
      }
      
      const existing = await Storefront.findOne(query);
      return !existing;
    } catch (error) {
      logger.error(`Check slug availability failed: ${error.message}`);
      throw error;
    }
  }
  
  // Toggle storefront status
  async toggleStorefrontStatus(tenantId) {
    try {
      const storefront = await Storefront.findOne({ tenantId });
      if (!storefront) {
        throw new Error('Storefront not found');
      }
      
      storefront.isActive = !storefront.isActive;
      await storefront.save();
      
      logger.info(`Storefront status toggled: ${storefront.slug} - ${storefront.isActive}`);
      return storefront;
    } catch (error) {
      logger.error(`Toggle storefront status failed: ${error.message}`);
      throw error;
    }
  }
}

export default new StorefrontService();
