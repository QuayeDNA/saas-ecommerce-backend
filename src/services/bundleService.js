// src/services/bundleService.js
import Bundle from '../models/Bundle.js';
import Package from '../models/Package.js';
import Provider from '../models/Provider.js';
import logger from '../utils/logger.js';

const bundleService = {
  // Get all bundles with filtering and pagination
  getAllBundles: async (options = {}) => {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        category,
        providerId,
        packageId,
        provider, // Add provider filter by code
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;

      const query = { isActive: true };

      // Add search filter
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { bundleCode: { $regex: search, $options: 'i' } }
        ];
      }

      // Add category filter
      if (category) {
        query.category = category;
      }

      // Add provider filter by ID
      if (providerId) {
        query.providerId = providerId;
      }

      // Add provider filter by code - filter by provider code
      if (provider) {
        // First find the provider by code, then filter bundles by that provider's ID
        const providerDoc = await Provider.findOne({ code: provider, isActive: true });
        if (providerDoc) {
          query.providerId = providerDoc._id;
        } else {
          // If provider not found, return empty result
          return {
            bundles: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 0,
              hasNext: false,
              hasPrev: false
            }
          };
        }
      }

      // Add package filter
      if (packageId) {
        query.packageId = packageId;
      }

      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const skip = (page - 1) * limit;

      const [bundles, total] = await Promise.all([
        Bundle.find(query)
          .populate('providerId', 'name logo code')
          .populate('packageId', 'name description')
          .sort(sortOptions)
          .skip(skip)
          .limit(limit)
          .lean(),
        Bundle.countDocuments(query)
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        bundles,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      logger.error('Error in getAllBundles:', error);
      throw error;
    }
  },

  // Get bundle by ID
  getBundleById: async (id) => {
    try {
      const bundle = await Bundle.findById(id)
        .populate('providerId', 'name logo code')
        .populate('packageId', 'name description')
        .lean();

      return bundle;
    } catch (error) {
      logger.error('Error in getBundleById:', error);
      throw error;
    }
  },

  // Get bundles by provider
  getBundlesByProvider: async (providerCode, options = {}) => {
    try {
      const { page = 1, limit = 10 } = options;
      const skip = (page - 1) * limit;

      // First find the provider by code
      const provider = await Provider.findOne({ code: providerCode, isActive: true });
      if (!provider) {
        return {
          bundles: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false
          }
        };
      }

      const [bundles, total] = await Promise.all([
        Bundle.find({ providerId: provider._id, isActive: true })
          .populate('packageId', 'name description')
          .populate('providerId', 'name logo code')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Bundle.countDocuments({ providerId: provider._id, isActive: true })
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        bundles,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      logger.error('Error in getBundlesByProvider:', error);
      throw error;
    }
  },

  // Get bundles by package
  getBundlesByPackage: async (packageId, options = {}) => {
    try {
      const { page = 1, limit = 10 } = options;
      const skip = (page - 1) * limit;

      const [bundles, total] = await Promise.all([
        Bundle.find({ packageId, isActive: true })
          .populate('providerId', 'name logo code')
          .sort({ price: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Bundle.countDocuments({ packageId, isActive: true })
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        bundles,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      logger.error('Error in getBundlesByPackage:', error);
      throw error;
    }
  },

  // Create bundle
  createBundle: async (bundleData) => {
    try {
      // Validate that provider and package exist
      const [provider, packageGroup] = await Promise.all([
        Provider.findById(bundleData.providerId),
        Package.findById(bundleData.packageId)
      ]);

      if (!provider) {
        throw new Error('Provider not found');
      }

      if (!packageGroup) {
        throw new Error('Package not found');
      }

      // Generate bundle code if not provided
      if (!bundleData.bundleCode) {
        bundleData.bundleCode = await generateBundleCode(bundleData.providerId);
      }

      const bundle = new Bundle(bundleData);
      await bundle.save();

      return bundle;
    } catch (error) {
      logger.error('Error in createBundle:', error);
      throw error;
    }
  },

  // Update bundle
  updateBundle: async (id, updateData) => {
    try {
      // Validate that provider and package exist if being updated
      if (updateData.providerId) {
        const provider = await Provider.findById(updateData.providerId);
        if (!provider) {
          throw new Error('Provider not found');
        }
      }

      if (updateData.packageId) {
        const packageGroup = await Package.findById(updateData.packageId);
        if (!packageGroup) {
          throw new Error('Package not found');
        }
      }

      const bundle = await Bundle.findByIdAndUpdate(
        id,
        { ...updateData, updatedAt: new Date() },
        { new: true, runValidators: true }
      ).populate('providerId', 'name logo')
       .populate('packageId', 'name description');

      return bundle;
    } catch (error) {
      logger.error('Error in updateBundle:', error);
      throw error;
    }
  },

  // Delete bundle
  deleteBundle: async (id) => {
    try {
      const bundle = await Bundle.findByIdAndDelete(id);
      return bundle;
    } catch (error) {
      logger.error('Error in deleteBundle:', error);
      throw error;
    }
  },

  // Bulk create bundles
  createBulkBundles: async (bundles) => {
    try {
      const results = {
        created: 0,
        failed: 0,
        errors: []
      };

      for (const bundleData of bundles) {
        try {
          await this.createBundle(bundleData);
          results.created++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            bundle: bundleData.name || 'Unknown',
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      logger.error('Error in createBulkBundles:', error);
      throw error;
    }
  },

  // Bulk update bundles
  updateBulkBundles: async (bundles) => {
    try {
      const results = {
        updated: 0,
        failed: 0,
        errors: []
      };

      for (const bundleData of bundles) {
        try {
          const { id, ...updateData } = bundleData;
          await this.updateBundle(id, updateData);
          results.updated++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            bundleId: bundleData.id,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      logger.error('Error in updateBulkBundles:', error);
      throw error;
    }
  },

  // Bulk delete bundles
  deleteBulkBundles: async (bundleIds) => {
    try {
      const results = {
        deleted: 0,
        failed: 0,
        errors: []
      };

      for (const id of bundleIds) {
        try {
          await this.deleteBundle(id);
          results.deleted++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            bundleId: id,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      logger.error('Error in deleteBulkBundles:', error);
      throw error;
    }
  },

  // Get bundle analytics
  getBundleAnalytics: async (period = '30d') => {
    try {
      const dateFilter = getDateFilter(period);

      const [
        totalBundles,
        activeBundles,
        totalValue,
        averagePrice,
        bundlesByProvider,
        bundlesByCategory
      ] = await Promise.all([
        Bundle.countDocuments({ createdAt: dateFilter }),
        Bundle.countDocuments({ isActive: true, createdAt: dateFilter }),
        Bundle.aggregate([
          { $match: { createdAt: dateFilter } },
          { $group: { _id: null, total: { $sum: '$price' } } }
        ]),
        Bundle.aggregate([
          { $match: { createdAt: dateFilter } },
          { $group: { _id: null, average: { $avg: '$price' } } }
        ]),
        Bundle.aggregate([
          { $match: { createdAt: dateFilter } },
          { $group: { _id: '$providerId', count: { $sum: 1 } } },
          { $lookup: { from: 'providers', localField: '_id', foreignField: '_id', as: 'provider' } },
          { $unwind: '$provider' },
          { $project: { providerName: '$provider.name', count: 1 } }
        ]),
        Bundle.aggregate([
          { $match: { createdAt: dateFilter, category: { $exists: true, $ne: null } } },
          { $group: { _id: '$category', count: { $sum: 1 } } }
        ])
      ]);

      return {
        totalBundles: totalBundles || 0,
        activeBundles: activeBundles || 0,
        totalValue: totalValue[0]?.total || 0,
        averagePrice: averagePrice[0]?.average || 0,
        bundlesByProvider: bundlesByProvider || [],
        bundlesByCategory: bundlesByCategory || []
      };
    } catch (error) {
      logger.error('Error in getBundleAnalytics:', error);
      throw error;
    }
  },

  // Get provider bundle analytics
  getProviderBundleAnalytics: async (providerId, period = '30d') => {
    try {
      const dateFilter = getDateFilter(period);

      const [
        totalBundles,
        activeBundles,
        totalValue,
        averagePrice,
        bundlesByCategory
      ] = await Promise.all([
        Bundle.countDocuments({ providerId, createdAt: dateFilter }),
        Bundle.countDocuments({ providerId, isActive: true, createdAt: dateFilter }),
        Bundle.aggregate([
          { $match: { providerId, createdAt: dateFilter } },
          { $group: { _id: null, total: { $sum: '$price' } } }
        ]),
        Bundle.aggregate([
          { $match: { providerId, createdAt: dateFilter } },
          { $group: { _id: null, average: { $avg: '$price' } } }
        ]),
        Bundle.aggregate([
          { $match: { providerId, createdAt: dateFilter, category: { $exists: true, $ne: null } } },
          { $group: { _id: '$category', count: { $sum: 1 } } }
        ])
      ]);

      return {
        totalBundles: totalBundles || 0,
        activeBundles: activeBundles || 0,
        totalValue: totalValue[0]?.total || 0,
        averagePrice: averagePrice[0]?.average || 0,
        bundlesByCategory: bundlesByCategory || []
      };
    } catch (error) {
      logger.error('Error in getProviderBundleAnalytics:', error);
      throw error;
    }
  }
};

// Helper function to generate bundle code
const generateBundleCode = async (providerId) => {
  const provider = await Provider.findById(providerId);
  const prefix = provider?.name?.substring(0, 3).toUpperCase() || 'BND';
  const timestamp = Date.now().toString().slice(-6);
  return `${prefix}${timestamp}`;
};

// Helper function to get date filter
const getDateFilter = (period) => {
  const now = new Date();
  let startDate;

  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case '1y':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return { $gte: startDate };
};

export default bundleService; 