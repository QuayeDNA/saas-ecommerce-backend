// src/services/packageService.js
import PackageGroup from '../models/Product.js';
import Provider from '../models/Provider.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

class PackageService {
  // Create a new package group
  async createPackageGroup(packageData) {
    try {
      // Validate provider exists and is active
      const providerExists = await Provider.exists({ 
        code: packageData.provider,
        isDeleted: false,
        isActive: true
      });
      
      if (!providerExists) {
        throw new Error(`Provider ${packageData.provider} does not exist or is inactive`);
      }
      
      // Generate unique codes for package items if not provided
      if (packageData.packageItems) {
        packageData.packageItems = packageData.packageItems.map((item, index) => {
          if (!item.code) {
            const timestamp = Date.now();
            const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            const baseCode = packageData.provider + '-' + 
                            (packageData.name.substring(0, 3).toUpperCase()) + '-' + 
                            item.dataVolume + 'GB-' + 
                            item.validity + 'D';
            item.code = baseCode + '-' + timestamp + '-' + randomSuffix + '-' + index;
          }
          return item;
        });
      }

      const packageGroup = new PackageGroup(packageData);
      await packageGroup.save();
      
      logger.info(`Package group created: ${packageGroup._id} by user ${packageData.createdBy}`);
      return packageGroup;
    } catch (error) {
      logger.error(`Package group creation failed: ${error.message}`);
      throw error;
    }
  }

  // Get package groups with filtering
  async getPackageGroups(tenantId, filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = pagination;
      const {
        provider,
        search,
        isActive = true,
        includeDeleted = false,
        minDataVolume,
        maxDataVolume,
        minValidity,
        maxValidity,
        minPrice,
        maxPrice
      } = filters;
      
      const query = { tenantId };
      
      // Apply filters
      if (!includeDeleted) {
        query.isDeleted = false;
      }
      
      if (isActive !== undefined) {
        query.isActive = isActive;
      }
      
      if (provider) {
        query.provider = provider;
      }
      
      // Package item level filtering
      const itemFilters = [];
      
      if (minDataVolume !== undefined || maxDataVolume !== undefined) {
        const dataVolumeFilter = {};
        if (minDataVolume !== undefined) dataVolumeFilter.$gte = parseFloat(minDataVolume);
        if (maxDataVolume !== undefined) dataVolumeFilter.$lte = parseFloat(maxDataVolume);
        itemFilters.push({ 'packageItems.dataVolume': dataVolumeFilter });
      }
      
      if (minValidity !== undefined || maxValidity !== undefined) {
        const validityFilter = {};
        if (minValidity !== undefined) validityFilter.$gte = parseInt(minValidity);
        if (maxValidity !== undefined) validityFilter.$lte = parseInt(maxValidity);
        itemFilters.push({ 'packageItems.validity': validityFilter });
      }
      
      if (minPrice !== undefined || maxPrice !== undefined) {
        const priceFilter = {};
        if (minPrice !== undefined) priceFilter.$gte = parseFloat(minPrice);
        if (maxPrice !== undefined) priceFilter.$lte = parseFloat(maxPrice);
        itemFilters.push({ 'packageItems.price': priceFilter });
      }
      
      if (itemFilters.length > 0) {
        query.$and = itemFilters;
      }
      
      // Text search
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { 'packageItems.name': { $regex: search, $options: 'i' } },
          { 'packageItems.description': { $regex: search, $options: 'i' } },
          { tags: { $regex: search, $options: 'i' } }
        ];
      }
      
      const [packages, total] = await Promise.all([
        PackageGroup.find(query)
          .populate('createdBy', 'fullName email')
          .populate('updatedBy', 'fullName email')
          .skip((page - 1) * limit)
          .limit(Number(limit))
          .sort({ [sortBy]: sortOrder }),
        PackageGroup.countDocuments(query)
      ]);
      
      return {
        packages,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / limit),
          limit: Number(limit)
        }
      };
    } catch (error) {
      logger.error(`Get package groups failed: ${error.message}`);
      throw error;
    }
  }

  // Get all package groups matching a query (raw, no pagination)
  async getPackageGroupsRaw(query = {}) {
    try {
      return await PackageGroup.find(query)
        .populate('createdBy', 'fullName email')
        .populate('updatedBy', 'fullName email');
    } catch (error) {
      logger.error(`getPackageGroupsRaw failed: ${error.message}`);
      throw error;
    }
  }

  // Update package group
  async updatePackageGroup(id, updateData, tenantId, userId) {
    try {
      // If updating provider, validate it exists and is active
      if (updateData.provider) {
        const providerExists = await Provider.exists({ 
          code: updateData.provider,
          isDeleted: false,
          isActive: true
        });
        
        if (!providerExists) {
          throw new Error(`Provider ${updateData.provider} does not exist or is inactive`);
        }
      }
      
      const packageGroup = await PackageGroup.findOneAndUpdate(
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
      
      if (!packageGroup) {
        throw new Error('Package group not found or you do not have permission to update it');
      }
      
      logger.info(`Package group updated: ${id} by user ${userId}`);
      return packageGroup;
    } catch (error) {
      logger.error(`Package group update failed: ${error.message}`);
      throw error;
    }
  }

  // Soft delete package group
  async softDeletePackageGroup(id, tenantId, userId) {
    try {
      const packageGroup = await PackageGroup.findOne({ 
        _id: id, 
        tenantId, 
        isDeleted: false 
      });
      
      if (!packageGroup) {
        throw new Error('Package group not found or already deleted');
      }
      
      await packageGroup.softDelete(userId);
      
      logger.info(`Package group deleted: ${id} by user ${userId}`);
      return packageGroup;
    } catch (error) {
      logger.error(`Package group deletion failed: ${error.message}`);
      throw error;
    }
  }

  // Restore package group
  async restorePackageGroup(id, tenantId, userId) {
    try {
      const packageGroup = await PackageGroup.findOne({ 
        _id: id, 
        tenantId, 
        isDeleted: true 
      });
      
      if (!packageGroup) {
        throw new Error('Package group not found or not deleted');
      }
      
      await packageGroup.restore();
      packageGroup.updatedBy = userId;
      await packageGroup.save();
      
      logger.info(`Package group restored: ${id} by user ${userId}`);
      return packageGroup;
    } catch (error) {
      logger.error(`Package group restoration failed: ${error.message}`);
      throw error;
    }
  }

  // Add package item to package group
  async addPackageItem(packageGroupId, itemData, tenantId, userId) {
    try {
      // Generate code if not provided
      if (!itemData.code) {
        const packageGroup = await PackageGroup.findById(packageGroupId);
        if (!packageGroup) {
          throw new Error('Package group not found');
        }
        
        const timestamp = Date.now();
        const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        itemData.code = packageGroup.provider + '-' + 
                        (packageGroup.name.substring(0, 3).toUpperCase()) + '-' + 
                        itemData.dataVolume + 'GB-' + 
                        itemData.validity + 'D' + '-' + 
                        timestamp + '-' + randomSuffix;
      }
      
      const updatedPackage = await PackageGroup.findOneAndUpdate(
        { _id: packageGroupId, tenantId },
        { 
          $push: { packageItems: itemData },
          updatedBy: userId
        },
        { new: true }
      );
      
      if (!updatedPackage) {
        throw new Error('Package group not found or you do not have permission to update it');
      }
      
      logger.info(`Package item added to ${packageGroupId} by user ${userId}`);
      return updatedPackage;
    } catch (error) {
      logger.error(`Add package item failed: ${error.message}`);
      throw error;
    }
  }

  // Update package item
  async updatePackageItem(packageGroupId, itemId, updateData, tenantId, userId) {
    try {
      // Build update query for specific array element
      const updateQuery = {};
      Object.keys(updateData).forEach(key => {
        updateQuery[`packageItems.$.${key}`] = updateData[key];
      });
      updateQuery.updatedBy = userId;
      
      const updatedPackage = await PackageGroup.findOneAndUpdate(
        { 
          _id: packageGroupId, 
          tenantId,
          'packageItems._id': itemId
        },
        { $set: updateQuery },
        { new: true }
      );
      
      if (!updatedPackage) {
        throw new Error('Package or package item not found');
      }
      
      logger.info(`Package item ${itemId} updated by user ${userId}`);
      return updatedPackage;
    } catch (error) {
      logger.error(`Update package item failed: ${error.message}`);
      throw error;
    }
  }

  // Delete package item
  async deletePackageItem(packageGroupId, itemId, tenantId, userId) {
    try {
      const updatedPackage = await PackageGroup.findOneAndUpdate(
        { _id: packageGroupId, tenantId },
        { 
          $pull: { packageItems: { _id: itemId } },
          updatedBy: userId
        },
        { new: true }
      );
      
      if (!updatedPackage) {
        throw new Error('Package group not found or you do not have permission to update it');
      }
      
      logger.info(`Package item ${itemId} removed from ${packageGroupId} by user ${userId}`);
      return updatedPackage;
    } catch (error) {
      logger.error(`Delete package item failed: ${error.message}`);
      throw error;
    }
  }

  // Bulk inventory update
  async bulkUpdateInventory(tenantId, updates, userId) {
    try {
      const results = [];
      
      for (const update of updates) {
        const { packageGroupId, itemId, inventory } = update;
        
        // Update specific package item inventory
        const result = await PackageGroup.findOneAndUpdate(
          { 
            _id: packageGroupId,
            tenantId,
            'packageItems._id': itemId
          },
          { 
            $set: { 
              'packageItems.$.inventory': inventory,
              updatedBy: userId
            } 
          },
          { new: true }
        );
        
        if (!result) {
          throw new Error(`Package group ${packageGroupId} or item ${itemId} not found`);
        }
        
        // Get the updated package item
        const updatedItem = result.packageItems.find(item => 
          item._id.toString() === itemId.toString()
        );
        
        results.push({
          packageGroupId,
          itemId,
          inventory: updatedItem.inventory,
          name: updatedItem.name
        });
      }
      
      logger.info(`Bulk inventory update completed by user ${userId}`);
      return results;
    } catch (error) {
      logger.error(`Bulk inventory update failed: ${error.message}`);
      throw error;
    }
  }

  // Reserve stock
  async reserveStock(tenantId, reservations) {
    try {
      for (const reservation of reservations) {
        const { packageGroupId, itemId, quantity } = reservation;
        
        const packageGroup = await PackageGroup.findOne({ 
          _id: packageGroupId, 
          tenantId,
          'packageItems._id': itemId
        });
        
        if (!packageGroup) {
          throw new Error(`Package group ${packageGroupId} or item ${itemId} not found`);
        }
        
        const packageItem = packageGroup.packageItems.find(item => 
          item._id.toString() === itemId.toString()
        );
        
        if (!packageItem) {
          throw new Error(`Package item ${itemId} not found in package group ${packageGroupId}`);
        }
        
        if (packageItem.availableInventory < quantity) {
          throw new Error(`Insufficient inventory for package item ${itemId}. Available: ${packageItem.availableInventory}, Requested: ${quantity}`);
        }
        
        packageItem.reservedInventory += quantity;
        await packageGroup.save();
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
        const { packageGroupId, itemId, quantity } = reservation;
        
        const packageGroup = await PackageGroup.findOne({ 
          _id: packageGroupId, 
          tenantId,
          'packageItems._id': itemId
        });
        
        if (!packageGroup) {
          throw new Error(`Package group ${packageGroupId} or item ${itemId} not found`);
        }
        
        const packageItem = packageGroup.packageItems.find(item => 
          item._id.toString() === itemId.toString()
        );
        
        if (!packageItem) {
          throw new Error(`Package item ${itemId} not found in package group ${packageGroupId}`);
        }
        
        packageItem.reservedInventory = Math.max(0, packageItem.reservedInventory - quantity);
        await packageGroup.save();
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
      const packages = await PackageGroup.find({ 
        tenantId,
        isDeleted: false,
        isActive: true
      });
      
      const alerts = [];
      
      for (const pkg of packages) {
        const lowStockItems = pkg.getLowStockItems();
        
        if (lowStockItems.length > 0) {
          alerts.push({
            packageGroupId: pkg._id,
            packageName: pkg.name,
            provider: pkg.provider,
            lowStockItems: lowStockItems.map(item => ({
              itemId: item._id,
              name: item.name,
              inventory: item.inventory,
              reserved: item.reservedInventory,
              available: item.availableInventory,
              threshold: item.lowStockThreshold
            }))
          });
        }
      }
      
      return alerts;
    } catch (error) {
      logger.error(`Get low stock alerts failed: ${error.message}`);
      throw error;
    }
  }

  // Get package analytics
  async getPackageAnalytics(tenantId, timeframe = '30d') {
    try {
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
      
      // Get packages with their sales count
      const packages = await PackageGroup.find({ 
        tenantId,
        isDeleted: false
      }).sort({ salesCount: -1 });
      
      // Calculate top providers, packages, and package items
      const providerStats = {};
      const packageStats = {};
      const packageItemStats = [];
      
      packages.forEach(pkg => {
        // Provider stats
        if (!providerStats[pkg.provider]) {
          providerStats[pkg.provider] = {
            sales: 0,
            views: 0
          };
        }
        providerStats[pkg.provider].sales += pkg.salesCount || 0;
        providerStats[pkg.provider].views += pkg.viewCount || 0;
        
        // Package stats
        packageStats[pkg._id] = {
          _id: pkg._id,
          name: pkg.name,
          provider: pkg.provider,
          sales: pkg.salesCount || 0,
          views: pkg.viewCount || 0
        };
        
        // Package item stats
        pkg.packageItems.forEach(item => {
          if (item.isActive && !item.isDeleted) {
            packageItemStats.push({
              packageGroupId: pkg._id,
              packageGroupName: pkg.name,
              itemId: item._id,
              name: item.name,
              code: item.code,
              price: item.price,
              dataVolume: item.dataVolume,
              validity: item.validity,
              inventory: item.inventory,
              provider: pkg.provider
            });
          }
        });
      });
      
      // Sort stats
      const topProviders = Object.entries(providerStats)
        .map(([provider, stats]) => ({ provider, ...stats }))
        .sort((a, b) => b.sales - a.sales);
      
      const topPackages = Object.values(packageStats)
        .sort((a, b) => b.sales - a.sales);
      
      return {
        summary: {
          totalPackages: packages.length,
          totalPackageItems: packageItemStats.length,
          totalProviders: topProviders.length
        },
        topProviders: topProviders.slice(0, 5),
        topPackages: topPackages.slice(0, 10),
        recentPackages: packages
          .filter(p => p.createdAt >= startDate)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 5)
          .map(p => ({
            _id: p._id,
            name: p.name,
            provider: p.provider,
            createdAt: p.createdAt
          }))
      };
    } catch (error) {
      logger.error(`Get package analytics failed: ${error.message}`);
      throw error;
    }
  }
}

export default new PackageService();
