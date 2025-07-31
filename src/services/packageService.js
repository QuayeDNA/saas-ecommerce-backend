// src/services/packageService.js
import Package from '../models/Package.js';
import Provider from '../models/Provider.js';
import logger from '../utils/logger.js';

class PackageService {
  // Create a new package
  async createPackage(packageData) {
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

      const packageGroup = new Package(packageData);
      await packageGroup.save();
      
      logger.info(`Package created: ${packageGroup._id} by user ${packageData.createdBy}`);
      return packageGroup;
    } catch (error) {
      logger.error(`Package creation failed: ${error.message}`);
      throw error;
    }
  }

  // Get packages with filtering and pagination
  async getPackages(filters = {}, pagination = {}) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = pagination;
    const { search, provider, category, isActive, includeDeleted = false } = filters;
    
    const query = {};
    
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
    
    const [packages, total] = await Promise.all([
      Package.find(query)
        .populate('createdBy', 'fullName email')
        .populate('updatedBy', 'fullName email')
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .sort({ [sortBy]: sortOrder }),
      Package.countDocuments(query)
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
  }

  // Get single package by ID
  async getPackageById(packageId) {
    const packageGroup = await Package.findOne({
      _id: packageId,
      isDeleted: false
    }).populate('createdBy', 'fullName email')
      .populate('updatedBy', 'fullName email');
    
    if (!packageGroup) {
      throw new Error('Package not found');
    }
    
    return packageGroup;
  }

  // Update package
  async updatePackage(packageId, updateData, tenantId, userId) {
    // For super admins, don't filter by tenantId
    const query = {
      _id: packageId,
      isDeleted: false
    };
    
    // Only filter by tenantId for non-super admin users
    if (tenantId) {
      query.tenantId = tenantId;
    }
    
    const packageGroup = await Package.findOne(query);
    
    if (!packageGroup) {
      throw new Error('Package not found');
    }
    
    // Validate provider if being updated
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
    
    updateData.updatedBy = userId;
    Object.assign(packageGroup, updateData);
    await packageGroup.save();
    
    logger.info(`Package updated: ${packageId} by user ${userId}`);
    return packageGroup;
  }

  // Soft delete package
  async deletePackage(packageId, tenantId, userId) {
    // For super admins, don't filter by tenantId
    const query = {
      _id: packageId,
      isDeleted: false
    };
    
    // Only filter by tenantId for non-super admin users
    if (tenantId) {
      query.tenantId = tenantId;
    }
    
    const packageGroup = await Package.findOne(query);
    
    if (!packageGroup) {
      throw new Error('Package not found');
    }
    
    await packageGroup.softDelete(userId);
    logger.info(`Package deleted: ${packageId} by user ${userId}`);
    return packageGroup;
  }

  // Restore package
  async restorePackage(packageId, tenantId, userId) {
    // For super admins, don't filter by tenantId
    const query = {
      _id: packageId,
      isDeleted: true
    };
    
    // Only filter by tenantId for non-super admin users
    if (tenantId) {
      query.tenantId = tenantId;
    }
    
    const packageGroup = await Package.findOne(query);
    
    if (!packageGroup) {
      throw new Error('Package not found');
    }
    
    await packageGroup.restore();
    logger.info(`Package restored: ${packageId} by user ${userId}`);
    return packageGroup;
  }

  // Get packages by provider
  async getPackagesByProvider(provider) {
    return await Package.find({
      provider,
      isActive: true,
      isDeleted: false
    }).populate('createdBy', 'fullName email');
  }

  // Get packages by category
  async getPackagesByCategory(category) {
    return await Package.find({
      category,
      isActive: true,
      isDeleted: false
    }).populate('createdBy', 'fullName email');
  }

  // Get package statistics
  async getPackageStats() {
    const stats = await Package.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          totalPackages: { $sum: 1 },
          activePackages: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          providerStats: {
            $push: {
              provider: '$provider',
              category: '$category',
              isActive: '$isActive'
            }
          }
        }
      }
    ]);
    
    if (stats.length === 0) {
      return {
        totalPackages: 0,
        activePackages: 0,
        providerStats: []
      };
    }
    
    const result = stats[0];
    
    // Group by provider
    const providerGroups = {};
    result.providerStats.forEach(stat => {
      if (!providerGroups[stat.provider]) {
        providerGroups[stat.provider] = { total: 0, active: 0 };
      }
      providerGroups[stat.provider].total++;
      if (stat.isActive) providerGroups[stat.provider].active++;
    });
    
    result.providerStats = Object.entries(providerGroups).map(([provider, counts]) => ({
      provider,
      totalPackages: counts.total,
      activePackages: counts.active
    }));
    
    return result;
  }
}

export default new PackageService();
