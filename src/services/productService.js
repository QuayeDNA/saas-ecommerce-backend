// src/services/productService.js
import Product from '../models/Product.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

class ProductService {
  // Create product
  async createProduct(productData) {
    try {
      // Auto-generate SKUs if not provided
      if (productData.variants) {
        productData.variants = productData.variants.map((variant, index) => ({
          ...variant,
          sku: variant.sku || `${productData.provider || 'GEN'}-${Date.now()}-${index + 1}`
        }));
      }

      const product = new Product(productData);
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
    try {
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
    } catch (error) {
      logger.error(`Get products failed: ${error.message}`);
      throw error;
    }
  }

  // Update product with audit trail
  async updateProduct(id, updateData, tenantId, userId) {
    try {
      const product = await Product.findOneAndUpdate(
        { 
          _id: id, 
          tenantId, 
          isDeleted: false 
        },
        {
          ...updateData,
          updatedBy: userId
        },
        { new: true }
      );
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

  // Bulk operations
  async bulkUpdateInventory(tenantId, updates, userId) {
    try {
      const results = [];
      for (const update of updates) {
        const { productId, variantId, inventory } = update;
        const product = await Product.findOne({
          _id: productId,
          tenantId,
          isDeleted: false
        });
        if (!product) {
          throw new Error(`Product not found: ${productId}`);
        }
        const variant = product.variants.id(variantId);
        if (!variant) {
          throw new Error(`Variant not found: ${variantId}`);
        }
        variant.inventory = inventory;
        product.updatedBy = userId;
        await product.save();
        results.push({
          productId,
          variantId,
          oldInventory: variant.inventory,
          newInventory: inventory
        });
      }
      logger.info(`Bulk inventory update completed by user ${userId}`);
      return results;
    } catch (error) {
      logger.error(`Bulk inventory update failed: ${error.message}`);
      throw error;
    }
  }

  // Stock reservation system
  async reserveStock(tenantId, reservations) {
    try {
      for (const reservation of reservations) {
        const { productId, variantId, quantity } = reservation;
        const product = await Product.findOne({
          _id: productId,
          tenantId,
          isDeleted: false
        });
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
        await product.save();
      }
      return true;
    } catch (error) {
      logger.error(`Stock reservation failed: ${error.message}`);
      throw error;
    }
  }

  // Release stock reservation
  async releaseStock(tenantId, reservations) {
    try {
      for (const reservation of reservations) {
        const { productId, variantId, quantity } = reservation;
        const product = await Product.findOne({
          _id: productId,
          tenantId
        });
        if (product) {
          const variant = product.variants.id(variantId);
          if (variant) {
            variant.reservedInventory = Math.max(0, variant.reservedInventory - quantity);
            await product.save();
          }
        }
      }
      return true;
    } catch (error) {
      logger.error(`Stock release failed: ${error.message}`);
      throw error;
    }
  }

  // Get low stock alerts
  async getLowStockAlerts(tenantId) {
    try {
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
    } catch (error) {
      logger.error(`Get low stock alerts failed: ${error.message}`);
      throw error;
    }
  }

  // Soft delete product
  async softDeleteProduct(id, tenantId, userId) {
    try {
      const product = await Product.findOneAndUpdate(
        {
          _id: id,
          tenantId,
          isDeleted: false
        },
        {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: userId
        },
        { new: true }
      );
      if (!product) {
        throw new Error('Product not found');
      }
      logger.info(`Product soft deleted: ${id} by user ${userId}`);
      return product;
    } catch (error) {
      logger.error(`Product deletion failed: ${error.message}`);
      throw error;
    }
  }

  // Restore product
  async restoreProduct(id, tenantId, userId) {
    try {
      const product = await Product.findOneAndUpdate(
        {
          _id: id,
          tenantId,
          isDeleted: true
        },
        {
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          updatedBy: userId
        },
        { new: true }
      );
      if (!product) {
        throw new Error('Deleted product not found');
      }
      logger.info(`Product restored: ${id}`);
      return product;
    } catch (error) {
      logger.error(`Product restoration failed: ${error.message}`);
      throw error;
    }
  }

  // Get product analytics
  async getProductAnalytics(tenantId, timeframe = '30d') {
    try {
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
    } catch (error) {
      logger.error(`Get analytics failed: ${error.message}`);
      throw error;
    }
  }

  // Add variant to product
  async addVariant(productId, variantData, tenantId, userId) {
    try {
      const product = await Product.findOne({
        _id: productId,
        tenantId,
        isDeleted: false
      });
      if (!product) {
        throw new Error('Product not found');
      }
      // Generate SKU if not provided
      if (!variantData.sku) {
        variantData.sku = `${product.provider || 'GEN'}-${Date.now()}-${product.variants.length + 1}`;
      }
      product.variants.push(variantData);
      product.updatedBy = userId;
      await product.save();
      const newVariant = product.variants[product.variants.length - 1];
      logger.info(`Variant added to product ${productId} by user ${userId}`);
      return newVariant;
    } catch (error) {
      logger.error(`Add variant failed: ${error.message}`);
      throw error;
    }
  }

  // Update variant
  async updateVariant(productId, variantId, updateData, tenantId, userId) {
    try {
      const product = await Product.findOne({
        _id: productId,
        tenantId,
        isDeleted: false
      });
      if (!product) {
        throw new Error('Product not found');
      }
      const variant = product.variants.id(variantId);
      if (!variant) {
        throw new Error('Variant not found');
      }
      Object.assign(variant, updateData);
      product.updatedBy = userId;
      await product.save();
      logger.info(`Variant updated in product ${productId} by user ${userId}`);
      return variant;
    } catch (error) {
      logger.error(`Update variant failed: ${error.message}`);
      throw error;
    }
  }

  // Delete variant
  async deleteVariant(productId, variantId, tenantId, userId) {
    try {
      const product = await Product.findOne({
        _id: productId,
        tenantId,
        isDeleted: false
      });
      if (!product) {
        throw new Error('Product not found');
      }
      const variant = product.variants.id(variantId);
      if (!variant) {
        throw new Error('Variant not found');
      }
      variant.isDeleted = true;
      variant.deletedAt = new Date();
      variant.deletedBy = userId;
      product.updatedBy = userId;
      await product.save();
      logger.info(`Variant deleted from product ${productId} by user ${userId}`);
      return true;
    } catch (error) {
      logger.error(`Delete variant failed: ${error.message}`);
      throw error;
    }
  }
}

export default new ProductService();