// src/services/storefrontService.js
import Storefront from '../models/Storefront.js';
import Package from '../models/Package.js';
import logger from '../utils/logger.js';

class StorefrontService {
  // Create storefront
  async createStorefront(storefrontData) {
    try {
      const storefront = new Storefront(storefrontData);
      await storefront.save();
      logger.info(`Storefront created: ${storefront._id} by user ${storefrontData.createdBy}`);
      return storefront;
    } catch (error) {
      logger.error(`Storefront creation failed: ${error.message}`);
      throw error;
    }
  }

  // Get storefronts with filtering
  async getStorefronts(tenantId, filters = {}, pagination = {}) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = pagination;
    const { search, isActive, includeDeleted = false } = filters;
    
    const query = { tenantId };
    
    if (!includeDeleted) {
      query.isDeleted = false;
    }
    
    if (isActive !== undefined) query.isActive = isActive;
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } }
      ];
    }

    const [storefronts, total] = await Promise.all([
      Storefront.find(query)
        .populate('createdBy', 'fullName email')
        .populate('updatedBy', 'fullName email')
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .sort({ [sortBy]: sortOrder }),
      Storefront.countDocuments(query)
    ]);

    return {
      storefronts,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
        limit: Number(limit)
      }
    };
  }

  // Get storefront by ID
  async getStorefrontById(id, tenantId) {
    const storefront = await Storefront.findOne({
      _id: id,
      tenantId,
      isDeleted: false
    }).populate('createdBy', 'fullName email')
      .populate('updatedBy', 'fullName email');
    
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    return storefront;
  }

  // Get storefront by slug (public)
  async getStorefrontBySlug(slug) {
    const storefront = await Storefront.findOne({
      slug,
      isActive: true,
      isDeleted: false
    }).populate('createdBy', 'fullName email');
    
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    return storefront;
  }

  // Update storefront
  async updateStorefront(id, updateData, tenantId, userId) {
    try {
      const storefront = await Storefront.findOneAndUpdate(
        {
          _id: id,
          tenantId,
          isDeleted: false
        },
        {
          ...updateData,
          updatedBy: userId
        },
        { new: true, runValidators: true }
      ).populate('createdBy', 'fullName email')
       .populate('updatedBy', 'fullName email');

      if (!storefront) {
        throw new Error('Storefront not found');
      }

      logger.info(`Storefront updated: ${id} by user ${userId}`);
      return storefront;
    } catch (error) {
      logger.error(`Storefront update failed: ${error.message}`);
      throw error;
    }
  }

  // Delete storefront (soft delete)
  async deleteStorefront(id, tenantId, userId) {
    try {
      const storefront = await Storefront.findOne({
        _id: id,
        tenantId,
        isDeleted: false
      });

      if (!storefront) {
        throw new Error('Storefront not found');
      }

      await storefront.softDelete(userId);
      logger.info(`Storefront deleted: ${id} by user ${userId}`);
      return storefront;
    } catch (error) {
      logger.error(`Storefront deletion failed: ${error.message}`);
      throw error;
    }
  }

  // Restore storefront
  async restoreStorefront(id, tenantId, userId) {
    try {
      const storefront = await Storefront.findOne({
        _id: id,
        tenantId,
        isDeleted: true
      });

      if (!storefront) {
        throw new Error('Storefront not found');
      }

      await storefront.restore();
      logger.info(`Storefront restored: ${id} by user ${userId}`);
      return storefront;
    } catch (error) {
      logger.error(`Storefront restoration failed: ${error.message}`);
      throw error;
    }
  }

  // Get storefront products (public)
  async getStorefrontProducts(slug, filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = pagination;
      const { 
        search, 
        provider, 
        category, 
        minPrice, 
        maxPrice 
      } = filters;

      // First get the storefront
      const storefront = await this.getStorefrontBySlug(slug);
      
      const query = { 
        tenantId: storefront.tenantId,
        isActive: true,
        isDeleted: false
      };
      
      if (provider) query.provider = provider;
      if (category) query.category = category;
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }

      const [products, total] = await Promise.all([
        Package.find(query)
          .populate('createdBy', 'fullName email')
          .skip((page - 1) * limit)
          .limit(Number(limit))
          .sort({ [sortBy]: sortOrder }),
        Package.countDocuments(query)
      ]);

      return {
        storefront,
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

  // Process storefront order
  async processStorefrontOrder(slug, orderData) {
    const session = await Storefront.startSession();
    session.startTransaction();

    try {
      // Get storefront
      const storefront = await this.getStorefrontBySlug(slug);
      
      // Validate and process order items
      const processedItems = [];
      let totalAmount = 0;

      for (const item of orderData.items) {
        const product = await Package.findOne({
          _id: item.productId,
          tenantId: storefront.tenantId,
          isActive: true,
          isDeleted: false
        }).session(session);

        if (!product) {
          throw new Error(`Product not found: ${item.productId}`);
        }

        // Check if product has variants
        if (item.variantId && product.variants) {
          const variant = product.variants.id(item.variantId);
          if (!variant) {
            throw new Error(`Product variant not found: ${item.variantId}`);
          }
          if (variant.inventory < item.quantity) {
            throw new Error(`Insufficient inventory for ${product.name} - ${variant.name}`);
          }
          variant.inventory -= item.quantity;
          totalAmount += variant.price * item.quantity;
        } else {
          // Handle non-variant products
          totalAmount += (product.price || 0) * item.quantity;
        }

        await product.save({ session });

        processedItems.push({
          product: product._id,
          quantity: item.quantity,
          variantId: item.variantId,
          price: item.variantId ? product.variants.id(item.variantId).price : product.price
        });
      }

      // Create order (this would typically be handled by order service)
      const order = {
        storefrontId: storefront._id,
        tenantId: storefront.tenantId,
        customerInfo: orderData.customerInfo,
        items: processedItems,
        totalAmount,
        status: 'pending',
        paymentMethod: orderData.paymentMethod
      };

      await session.commitTransaction();
      
      logger.info(`Storefront order processed: ${storefront.slug} - ${totalAmount}`);
      return order;
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Storefront order processing failed: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Get storefront analytics
  async getStorefrontAnalytics(tenantId, timeframe = '30d') {
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

    const [totalStorefronts, activeStorefronts, totalProducts] = await Promise.all([
      Storefront.countDocuments({ 
        tenantId, 
        isDeleted: false,
        createdAt: { $gte: startDate, $lte: endDate }
      }),
      Storefront.countDocuments({ 
        tenantId, 
        isActive: true, 
        isDeleted: false,
        createdAt: { $gte: startDate, $lte: endDate }
      }),
      Package.countDocuments({
        tenantId,
        isActive: true,
        isDeleted: false,
        createdAt: { $gte: startDate, $lte: endDate }
      })
    ]);

    return {
      totalStorefronts,
      activeStorefronts,
      totalProducts,
      timeframe
    };
  }

  // Get storefront by slug for public access
  async getPublicStorefront(slug) {
    const storefront = await Storefront.findOne({
      slug,
      isActive: true,
      isDeleted: false
    }).populate('createdBy', 'fullName email');
    
    if (!storefront) {
      throw new Error('Storefront not found or inactive');
    }
    
    return storefront;
  }

  // Get storefront products for public access
  async getPublicStorefrontProducts(slug, filters = {}, pagination = {}) {
    const storefront = await this.getPublicStorefront(slug);
    return this.getStorefrontProducts(slug, filters, pagination);
  }
}

export default new StorefrontService();
