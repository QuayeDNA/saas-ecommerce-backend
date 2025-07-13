// src/services/productService.js
import Package from '../models/Package.js';
import logger from '../utils/logger.js';

class ProductService {
  // Create product
  async createProduct(productData) {
    try {
      // Generate SKU for variants if not provided
      if (productData.variants) {
        productData.variants = productData.variants.map((variant, index) => ({
          ...variant,
          sku: variant.sku || `${productData.provider || 'GEN'}-${Date.now()}-${index + 1}`
        }));
      }

      const product = new Package(productData);
      await product.save();
      logger.info(`Product created: ${product._id} by user ${productData.createdBy}`);
      return product;
    } catch (error) {
      logger.error(`Product creation failed: ${error.message}`);
      throw error;
    }
  }

  // Get products with advanced filtering
  async getProducts(tenantId, filters = {}, pagination = {}) {
      const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = pagination;
      const {
      search, 
      provider, 
        category,
        minPrice,
        maxPrice,
      isActive, 
        includeDeleted = false
      } = filters;
      
      const query = { tenantId };
      
    if (!includeDeleted) {
      query.isDeleted = false;
    }
    
    if (provider) query.provider = provider;
    if (category) query.category = category;
    if (isActive !== undefined) query.isActive = isActive;
    
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
        ];
      }
      
      const [products, total] = await Promise.all([
      Package.find(query)
          .populate('createdBy', 'fullName email')
          .populate('updatedBy', 'fullName email')
          .skip((page - 1) * limit)
          .limit(Number(limit))
          .sort({ [sortBy]: sortOrder }),
      Package.countDocuments(query)
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
  async updateProduct(id, updateData, tenantId, userId) {
    try {
      const product = await Package.findOneAndUpdate(
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

      if (!product) {
        throw new Error('Product not found');
      }

      logger.info(`Product updated: ${id} by user ${userId}`);
      return product;
    } catch (error) {
      logger.error(`Product update failed: ${error.message}`);
      throw error;
    }
  }

  // Bulk update inventory
  async bulkUpdateInventory(updates, tenantId, userId) {
    const session = await Package.startSession();
    session.startTransaction();

    try {
      for (const update of updates) {
        const { productId, variantId, inventory } = update;
        const product = await Package.findOne({
          _id: productId,
          tenantId,
          isDeleted: false
        }).session(session);

        if (!product) {
          throw new Error(`Product not found: ${productId}`);
        }

        if (variantId && product.variants) {
        const variant = product.variants.id(variantId);
          if (variant) {
            variant.inventory = inventory;
          }
        }

        product.updatedBy = userId;
        await product.save({ session });
      }

      await session.commitTransaction();
      logger.info(`Bulk inventory update completed for ${updates.length} products`);
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Bulk inventory update failed: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Reserve inventory
  async reserveInventory(reservations, tenantId) {
    const session = await Package.startSession();
    session.startTransaction();

    try {
      for (const reservation of reservations) {
        const { productId, variantId, quantity } = reservation;
        const product = await Package.findOne({
          _id: productId,
          tenantId,
          isDeleted: false
        }).session(session);

        if (!product) {
          throw new Error(`Product not found: ${productId}`);
        }

        if (variantId && product.variants) {
        const variant = product.variants.id(variantId);
        if (!variant) {
            throw new Error(`Product variant not found: ${variantId}`);
        }
          if (variant.inventory < quantity) {
          throw new Error(`Insufficient inventory for ${product.name} - ${variant.name}`);
          }
          variant.inventory -= quantity;
        }

        await product.save({ session });
      }

      await session.commitTransaction();
      logger.info(`Inventory reservation completed for ${reservations.length} items`);
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Inventory reservation failed: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Release reserved inventory
  async releaseInventory(reservations, tenantId) {
    const session = await Package.startSession();
    session.startTransaction();

    try {
      for (const reservation of reservations) {
        const { productId, variantId, quantity } = reservation;
        const product = await Package.findOne({
          _id: productId,
          tenantId,
          isDeleted: false
        }).session(session);

        if (!product) {
          throw new Error(`Product not found: ${productId}`);
        }

        if (variantId && product.variants) {
          const variant = product.variants.id(variantId);
          if (variant) {
            variant.inventory += quantity;
          }
        }

        await product.save({ session });
      }

      await session.commitTransaction();
      logger.info(`Inventory release completed for ${reservations.length} items`);
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Inventory release failed: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Delete product (soft delete)
  async deleteProduct(id, tenantId, userId) {
    try {
      const product = await Package.findOne({
        _id: id,
        tenantId,
        isDeleted: false
      });
      
      if (!product) {
        throw new Error('Product not found');
      }

      await product.softDelete(userId);
      logger.info(`Product deleted: ${id} by user ${userId}`);
      return product;
    } catch (error) {
      logger.error(`Product deletion failed: ${error.message}`);
      throw error;
    }
  }

  // Restore product
  async restoreProduct(id, tenantId, userId) {
    try {
      const product = await Package.findOne({
          _id: id,
          tenantId,
          isDeleted: true
      });

      if (!product) {
        throw new Error('Product not found');
      }

      await product.restore();
      logger.info(`Product restored: ${id} by user ${userId}`);
      return product;
    } catch (error) {
      logger.error(`Product restoration failed: ${error.message}`);
      throw error;
    }
  }

  // Get product analytics
  async getProductAnalytics(tenantId, timeframe = '30d') {
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

    const stats = await Package.aggregate([
      {
        $match: {
          tenantId: tenantId,
          isDeleted: false,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          activeProducts: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          providerStats: {
            $push: {
              provider: '$provider',
              isActive: '$isActive'
            }
          }
        }
      }
    ]);

    if (stats.length === 0) {
      return {
        totalProducts: 0,
        activeProducts: 0,
        providerStats: [],
        timeframe
      };
    }

    const result = stats[0];
    
    // Group by provider
    const providerGroups = {};
    result.providerStats.forEach(stat => {
      if (!providerGroups[stat.provider]) {
        providerGroups[stat.provider] = { 
          productCount: 0, 
          activeCount: 0
        };
      }
      providerGroups[stat.provider].productCount++;
      if (stat.isActive) providerGroups[stat.provider].activeCount++;
    });
    
    result.providerStats = Object.entries(providerGroups).map(([provider, data]) => ({
      provider,
      productCount: data.productCount,
      activeCount: data.activeCount
    }));

    return {
      totalProducts: result.totalProducts,
      activeProducts: result.activeProducts,
      providerStats: result.providerStats,
      timeframe
    };
  }
}

export default new ProductService();