// src/services/productService.js
import Product from '../models/Product.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

class ProductService {
  // Create product with validation
  async createProduct(productData, userId) {
    let session = null;
    let useTransaction = false;
    try {
      // Try to start a session and transaction, but fallback if not supported
      try {
        session = await mongoose.startSession();
        session.startTransaction();
        useTransaction = true;
      } catch (err) {
        session = null;
        useTransaction = false;
        logger.warn('Transactions not supported in this MongoDB environment. Proceeding without transaction.');
      }
      // Auto-generate SKUs if not provided
      if (productData.variants) {
        productData.variants = productData.variants.map((variant, index) => ({
          ...variant,
          sku: variant.sku || `${productData.provider || 'GEN'}-${Date.now()}-${index + 1}`
        }));
      }
      const product = new Product(productData);
      if (useTransaction) {
        await product.save({ session });
        await session.commitTransaction();
      } else {
        await product.save();
      }
      logger.info(`Product created: ${product._id} by user ${userId}`);
      return product;
    } catch (error) {
      if (useTransaction && session) {
        await session.abortTransaction();
      }
      logger.error(`Product creation failed: ${error.message}`);
      throw error;
    } finally {
      if (session) session.endSession();
    }
  }

  // Get products with advanced filtering
  async getProducts(tenantId, filters = {}, pagination = {}) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = pagination;
    const {
      category,
      provider,
      network,
      bundleType,
      minPrice,
      maxPrice,
      search,
      isActive = true,
      includeDeleted = false
    } = filters;
    
    const query = { tenantId };
    
    if (!includeDeleted) query.isDeleted = false;
    if (isActive !== undefined) query.isActive = isActive;
    if (category) query.category = category;
    if (provider) query.provider = provider;
    
    // Variant-level filtering
    if (network || bundleType || minPrice || maxPrice) {
      const variantMatch = {};
      if (network) variantMatch['variants.network'] = network;
      if (bundleType) variantMatch['variants.bundleType'] = bundleType;
      if (minPrice) variantMatch['variants.price'] = { $gte: minPrice };
      if (maxPrice) variantMatch['variants.price'] = { ...variantMatch['variants.price'], $lte: maxPrice };
      
      Object.assign(query, variantMatch);
    }
    
    // Text search
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('createdBy', 'fullName email')
        .populate('updatedBy', 'fullName email')
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
  }

  // Update product with audit trail
  async updateProduct(productId, tenantId, updateData, userId) {
    const product = await Product.findOne({ 
      _id: productId, 
      tenantId, 
      isDeleted: false 
    });
    
    if (!product) {
      throw new Error('Product not found');
    }
    
    // Update fields
    Object.assign(product, updateData);
    product.updatedBy = userId;
    
    await product.save();
    logger.info(`Product updated: ${productId} by user ${userId}`);
    return product;
  }

  // Bulk operations
  async bulkUpdateInventory(tenantId, updates, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const results = [];
      
      for (const update of updates) {
        const { productId, variantId, inventory } = update;
        
        const product = await Product.findOne({
          _id: productId,
          tenantId,
          isDeleted: false
        }).session(session);
        
        if (!product) {
          throw new Error(`Product not found: ${productId}`);
        }
        
        const variant = product.variants.id(variantId);
        if (!variant) {
          throw new Error(`Variant not found: ${variantId}`);
        }
        
        variant.inventory = inventory;
        product.updatedBy = userId;
        await product.save({ session });
        
        results.push({
          productId,
          variantId,
          oldInventory: variant.inventory,
          newInventory: inventory
        });
      }
      
      await session.commitTransaction();
      logger.info(`Bulk inventory update completed by user ${userId}`);
      return results;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Stock reservation system
  async reserveStock(tenantId, reservations) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      for (const reservation of reservations) {
        const { productId, variantId, quantity } = reservation;
        
        const product = await Product.findOne({
          _id: productId,
          tenantId,
          isDeleted: false
        }).session(session);
        
        if (!product) {
          throw new Error(`Product not found: ${productId}`);
        }
        
        const variant = product.variants.id(variantId);
        if (!variant) {
          throw new Error(`Variant not found: ${variantId}`);
        }
        
        if (variant.availableInventory < quantity) {
          throw new Error(`Insufficient inventory for ${product.name} - ${variant.name}`);
        }
        
        variant.reservedInventory += quantity;
        await product.save({ session });
      }
      
      await session.commitTransaction();
      return true;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Release stock reservation
  async releaseStock(tenantId, reservations) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      for (const reservation of reservations) {
        const { productId, variantId, quantity } = reservation;
        
        const product = await Product.findOne({
          _id: productId,
          tenantId
        }).session(session);
        
        if (product) {
          const variant = product.variants.id(variantId);
          if (variant) {
            variant.reservedInventory = Math.max(0, variant.reservedInventory - quantity);
            await product.save({ session });
          }
        }
      }
      
      await session.commitTransaction();
      return true;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Get low stock alerts
  async getLowStockAlerts(tenantId) {
    const products = await Product.find({
      tenantId,
      isActive: true,
      isDeleted: false
    });
    
    const alerts = [];
    
    products.forEach(product => {
      const lowStockVariants = product.getLowStockVariants();
      if (lowStockVariants.length > 0) {
        alerts.push({
          productId: product._id,
          productName: product.name,
          variants: lowStockVariants.map(v => ({
            variantId: v._id,
            name: v.name,
            currentStock: v.availableInventory,
            threshold: v.lowStockThreshold
          }))
        });
      }
    });
    
    return alerts;
  }

  // Soft delete product
  async softDeleteProduct(productId, tenantId, userId) {
    const product = await Product.findOne({
      _id: productId,
      tenantId,
      isDeleted: false
    });
    
    if (!product) {
      throw new Error('Product not found');
    }
    
    await product.softDelete(userId);
    logger.info(`Product soft deleted: ${productId} by user ${userId}`);
    return product;
  }

  // Restore product
  async restoreProduct(productId, tenantId) {
    const product = await Product.findOne({
      _id: productId,
      tenantId,
      isDeleted: true
    });
    
    if (!product) {
      throw new Error('Deleted product not found');
    }
    
    await product.restore();
    logger.info(`Product restored: ${productId}`);
    return product;
  }

  // Get product analytics
  async getProductAnalytics(tenantId, timeframe = '30d') {
    const days = parseInt(timeframe.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const [
      totalProducts,
      activeProducts,
      lowStockCount,
      topProducts
    ] = await Promise.all([
      Product.countDocuments({ tenantId, isDeleted: false }),
      Product.countDocuments({ tenantId, isActive: true, isDeleted: false }),
      Product.countDocuments({
        tenantId,
        isActive: true,
        isDeleted: false,
        'variants.availableInventory': { $lte: 10 }
      }),
      Product.find({
        tenantId,
        isActive: true,
        isDeleted: false,
        createdAt: { $gte: startDate }
      })
      .sort({ salesCount: -1 })
      .limit(5)
      .select('name salesCount')
    ]);
    
    return {
      totalProducts,
      activeProducts,
      lowStockCount,
      topProducts,
      timeframe
    };
  }
}

export default new ProductService();
