// src/services/bundleService.js
import Bundle from "../models/Bundle.js";
import Package from "../models/Package.js";
import Provider from "../models/Provider.js";
import logger from "../utils/logger.js";
import { enhanceBundleWithPricing } from "../utils/pricingHelpers.js";
import mongoose from "mongoose";

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
        sortBy = "createdAt",
        sortOrder = "desc",
        userType = "agent", // Add user type for security
      } = options;

      const query = {};

      // Note: Removed isActive filter to allow all users to see both active and inactive bundles
      // Frontend will handle role-based filtering and UI restrictions

      // Add search filter
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { bundleCode: { $regex: search, $options: "i" } },
        ];
      }

      // Add category filter
      if (category) {
        query.category = category;
      }

      // Add provider filter by ID - ensure it's a valid ObjectId
      if (providerId) {
        if (mongoose.Types.ObjectId.isValid(providerId)) {
          query.providerId = providerId;
        } else {
          // If invalid ObjectId, return empty result
          return {
            bundles: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 0,
              hasNext: false,
              hasPrev: false,
            },
          };
        }
      }

      // Add provider filter by code - filter by provider code
      if (provider) {
        // First find the provider by code, then filter bundles by that provider's ID
        const providerDoc = await Provider.findOne({
          code: provider,
          isActive: true,
        });
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
              hasPrev: false,
            },
          };
        }
      }

      // Add package filter
      if (packageId) {
        query.packageId = packageId;
      }

      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

      const skip = (page - 1) * limit;

      const [bundles, total] = await Promise.all([
        Bundle.find(query)
          .populate("providerId", "name logo code")
          .populate("packageId", "name description")
          .sort(sortOptions)
          .skip(skip)
          .limit(limit)
          .lean(),
        Bundle.countDocuments(query),
      ]);

      // Filter sensitive data based on user type and enhance with pricing
      const filteredBundles = bundles.map((bundle) => {
        // Enhance bundle with user-specific pricing
        const enhancedBundle = enhanceBundleWithPricing(bundle, userType);

        const baseBundle = {
          _id: enhancedBundle._id,
          name: enhancedBundle.name,
          description: enhancedBundle.description,
          dataVolume: enhancedBundle.dataVolume,
          dataUnit: enhancedBundle.dataUnit,
          validity: enhancedBundle.validity,
          validityUnit: enhancedBundle.validityUnit,
          price: enhancedBundle.price,
          userPrice: enhancedBundle.userPrice, // User-specific price
          currency: enhancedBundle.currency,
          features: enhancedBundle.features,
          isActive: enhancedBundle.isActive,
          bundleCode: enhancedBundle.bundleCode,
          category: enhancedBundle.category,
          tags: enhancedBundle.tags,
          // AFA-specific fields
          requiresGhanaCard: enhancedBundle.requiresGhanaCard,
          afaRequirements: enhancedBundle.afaRequirements,
          packageId: enhancedBundle.packageId,
          providerId: enhancedBundle.providerId,
          createdAt: enhancedBundle.createdAt,
          updatedAt: enhancedBundle.updatedAt,
          formattedDataVolume: enhancedBundle.formattedDataVolume,
          formattedValidity: enhancedBundle.formattedValidity,
          isAvailable: enhancedBundle.isAvailable,
        };

        // Only include sensitive fields for admin users
        if (userType === "admin" || userType === "super_admin") {
          return {
            ...baseBundle,
            pricingTiers: enhancedBundle.pricingTiers, // Include pricing tiers for admins
            pricingSummary: enhancedBundle.pricingSummary, // Include pricing summary for admins
            tenantId: enhancedBundle.tenantId,
            createdBy: enhancedBundle.createdBy,
            updatedBy: enhancedBundle.updatedBy,
            isDeleted: enhancedBundle.isDeleted,
            deletedAt: enhancedBundle.deletedAt,
            deletedBy: enhancedBundle.deletedBy,
          };
        }

        return baseBundle;
      });

      const totalPages = Math.ceil(total / limit);

      return {
        bundles: filteredBundles,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error("Error in getAllBundles:", error);
      throw error;
    }
  },

  // Get bundle by ID
  getBundleById: async (id, userType = "agent") => {
    try {
      const bundle = await Bundle.findById(id)
        .populate("providerId", "name logo code")
        .populate("packageId", "name description")
        .lean();

      if (!bundle) {
        return null;
      }

      // Enhance with user-specific pricing
      return enhanceBundleWithPricing(bundle, userType);
    } catch (error) {
      logger.error("Error in getBundleById:", error);
      throw error;
    }
  },

  // Get bundles by provider
  getBundlesByProvider: async (providerCode, options = {}) => {
    try {
      const { page = 1, limit = 10 } = options;
      const skip = (page - 1) * limit;

      // First find the provider by code
      const provider = await Provider.findOne({
        code: providerCode,
        isActive: true,
      });
      if (!provider) {
        return {
          bundles: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false,
          },
        };
      }

      const [bundles, total] = await Promise.all([
        Bundle.find({ providerId: provider._id, isActive: true })
          .populate("packageId", "name description")
          .populate("providerId", "name logo code")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Bundle.countDocuments({ providerId: provider._id, isActive: true }),
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
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error("Error in getBundlesByProvider:", error);
      throw error;
    }
  },

  // Get bundles by package
  getBundlesByPackage: async (packageId, options = {}) => {
    try {
      const { page = 1, limit = 10, userType = "agent" } = options;
      const skip = (page - 1) * limit;

      // Build query - return all bundles (both active and inactive)
      // Frontend will handle role-based filtering and UI restrictions
      const query = { packageId };

      const [bundles, total] = await Promise.all([
        Bundle.find(query)
          .populate("providerId", "name logo code")
          .sort({ dataVolume: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Bundle.countDocuments(query),
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
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error("Error in getBundlesByPackage:", error);
      throw error;
    }
  },

  // Create bundle
  createBundle: async (bundleData) => {
    try {
      // Handle providerCode - convert to providerId if provided
      if (bundleData.providerCode && !bundleData.providerId) {
        const provider = await Provider.findOne({
          code: bundleData.providerCode,
          isActive: true,
        });
        if (!provider) {
          throw new Error("Provider not found with the provided code");
        }
        bundleData.providerId = provider._id;
        delete bundleData.providerCode;
      }

      // Convert providerId to ObjectId if it's a string
      if (bundleData.providerId && typeof bundleData.providerId === "string") {
        if (!mongoose.Types.ObjectId.isValid(bundleData.providerId)) {
          throw new Error("Invalid providerId format");
        }
        bundleData.providerId = new mongoose.Types.ObjectId(
          bundleData.providerId
        );
      }

      // Validate that provider and package exist
      const [provider, packageGroup] = await Promise.all([
        Provider.findById(bundleData.providerId),
        Package.findById(bundleData.packageId),
      ]);

      if (!provider) {
        throw new Error("Provider not found");
      }

      if (!packageGroup) {
        throw new Error("Package not found");
      }

      // Validate required fields based on provider type
      if (provider.code !== 'AFA') {
        // For non-AFA bundles, data fields are required
        if (bundleData.dataVolume === undefined || bundleData.dataVolume === null) {
          throw new Error("Data volume is required for this bundle type");
        }
        if (bundleData.validity === undefined || bundleData.validity === null) {
          throw new Error("Validity is required for this bundle type");
        }
      }

      // Generate bundle code if not provided
      if (!bundleData.bundleCode) {
        bundleData.bundleCode = await generateBundleCode(bundleData.providerId);
      }

      const bundle = new Bundle(bundleData);
      await bundle.save();

      // Populate and return filtered data
      const populatedBundle = await Bundle.findById(bundle._id)
        .populate("providerId", "name logo code")
        .populate("packageId", "name description");

      // Return filtered data for security
      const filteredBundle = {
        _id: populatedBundle._id,
        name: populatedBundle.name,
        description: populatedBundle.description,
        dataVolume: populatedBundle.dataVolume,
        dataUnit: populatedBundle.dataUnit,
        validity: populatedBundle.validity,
        validityUnit: populatedBundle.validityUnit,
        price: populatedBundle.price,
        currency: populatedBundle.currency,
        features: populatedBundle.features,
        isActive: populatedBundle.isActive,
        bundleCode: populatedBundle.bundleCode,
        category: populatedBundle.category,
        tags: populatedBundle.tags,
        // AFA-specific fields
        requiresGhanaCard: populatedBundle.requiresGhanaCard,
        afaRequirements: populatedBundle.afaRequirements,
        packageId: populatedBundle.packageId,
        providerId: populatedBundle.providerId,
        createdAt: populatedBundle.createdAt,
        updatedAt: populatedBundle.updatedAt,
        formattedDataVolume: populatedBundle.formattedDataVolume,
        formattedValidity: populatedBundle.formattedValidity,
        isAvailable: populatedBundle.isAvailable,
      };

      return filteredBundle;
    } catch (error) {
      logger.error("Error in createBundle:", error);
      throw error;
    }
  },

  // Update bundle
  updateBundle: async (id, updateData) => {
    try {
      // Handle providerCode - convert to providerId if provided
      if (updateData.providerCode && !updateData.providerId) {
        const provider = await Provider.findOne({
          code: updateData.providerCode,
          isActive: true,
        });
        if (!provider) {
          throw new Error("Provider not found with the provided code");
        }
        updateData.providerId = provider._id;
        delete updateData.providerCode;
      }

      // Convert providerId to ObjectId if it's a string
      if (updateData.providerId && typeof updateData.providerId === "string") {
        // Handle case where providerId might be "[object Object]" or invalid
        if (
          updateData.providerId === "[object Object]" ||
          !mongoose.Types.ObjectId.isValid(updateData.providerId)
        ) {
          throw new Error(
            "Invalid providerId format. Please provide a valid provider ID."
          );
        }
        updateData.providerId = new mongoose.Types.ObjectId(
          updateData.providerId
        );
      }

      // Validate that provider and package exist if being updated
      if (updateData.providerId) {
        const provider = await Provider.findById(updateData.providerId);
        if (!provider) {
          throw new Error("Provider not found");
        }
      }

      if (updateData.packageId) {
        const packageGroup = await Package.findById(updateData.packageId);
        if (!packageGroup) {
          throw new Error("Package not found");
        }
      }

      // Get current bundle to check provider type for validation
      const currentBundle = await Bundle.findById(id).populate('providerId', 'code');
      if (!currentBundle) {
        throw new Error("Bundle not found");
      }

      // Determine provider code (use updated provider if provided, otherwise current)
      const providerCode = updateData.providerId
        ? (await Provider.findById(updateData.providerId)).code
        : currentBundle.providerId?.code;

      // Validate required fields based on provider type
      if (providerCode !== 'AFA') {
        // For non-AFA bundles, data fields are required
        if (updateData.dataVolume !== undefined && (updateData.dataVolume === null || updateData.dataVolume === '')) {
          throw new Error("Data volume cannot be empty for this bundle type");
        }
        if (updateData.validity !== undefined && (updateData.validity === null || updateData.validity === '')) {
          throw new Error("Validity cannot be empty for this bundle type");
        }
      }

      const bundle = await Bundle.findByIdAndUpdate(
        id,
        { ...updateData, updatedAt: new Date() },
        { new: true, runValidators: true }
      )
        .populate("providerId", "name logo code")
        .populate("packageId", "name description");

      if (!bundle) {
        throw new Error("Bundle not found");
      }

      // Return filtered data for security
      const filteredBundle = {
        _id: bundle._id,
        name: bundle.name,
        description: bundle.description,
        dataVolume: bundle.dataVolume,
        dataUnit: bundle.dataUnit,
        validity: bundle.validity,
        validityUnit: bundle.validityUnit,
        price: bundle.price,
        currency: bundle.currency,
        features: bundle.features,
        isActive: bundle.isActive,
        bundleCode: bundle.bundleCode,
        category: bundle.category,
        tags: bundle.tags,
        // AFA-specific fields
        requiresGhanaCard: bundle.requiresGhanaCard,
        afaRequirements: bundle.afaRequirements,
        packageId: bundle.packageId,
        providerId: bundle.providerId,
        createdAt: bundle.createdAt,
        updatedAt: bundle.updatedAt,
        formattedDataVolume: bundle.formattedDataVolume,
        formattedValidity: bundle.formattedValidity,
        isAvailable: bundle.isAvailable,
      };

      return filteredBundle;
    } catch (error) {
      logger.error("Error in updateBundle:", error);
      throw error;
    }
  },

  // Delete bundle
  deleteBundle: async (id) => {
    try {
      const bundle = await Bundle.findByIdAndDelete(id);
      return bundle;
    } catch (error) {
      logger.error("Error in deleteBundle:", error);
      throw error;
    }
  },

  // Bulk create bundles
  createBulkBundles: async (bundles) => {
    try {
      const results = {
        created: 0,
        failed: 0,
        errors: [],
      };

      for (const bundleData of bundles) {
        try {
          await this.createBundle(bundleData);
          results.created++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            bundle: bundleData.name || "Unknown",
            error: error.message,
          });
        }
      }

      return results;
    } catch (error) {
      logger.error("Error in createBulkBundles:", error);
      throw error;
    }
  },

  // Bulk update bundles
  updateBulkBundles: async (bundles) => {
    try {
      const results = {
        updated: 0,
        failed: 0,
        errors: [],
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
            error: error.message,
          });
        }
      }

      return results;
    } catch (error) {
      logger.error("Error in updateBulkBundles:", error);
      throw error;
    }
  },

  // Bulk delete bundles
  deleteBulkBundles: async (bundleIds) => {
    try {
      const results = {
        deleted: 0,
        failed: 0,
        errors: [],
      };

      for (const id of bundleIds) {
        try {
          await this.deleteBundle(id);
          results.deleted++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            bundleId: id,
            error: error.message,
          });
        }
      }

      return results;
    } catch (error) {
      logger.error("Error in deleteBulkBundles:", error);
      throw error;
    }
  },

  // Get bundle analytics
  getBundleAnalytics: async (period = "30d") => {
    try {
      const dateFilter = getDateFilter(period);

      const [
        totalBundles,
        activeBundles,
        totalValue,
        averagePrice,
        bundlesByProvider,
        bundlesByCategory,
      ] = await Promise.all([
        Bundle.countDocuments({ createdAt: dateFilter }),
        Bundle.countDocuments({ isActive: true, createdAt: dateFilter }),
        Bundle.aggregate([
          { $match: { createdAt: dateFilter } },
          { $group: { _id: null, total: { $sum: "$price" } } },
        ]),
        Bundle.aggregate([
          { $match: { createdAt: dateFilter } },
          { $group: { _id: null, average: { $avg: "$price" } } },
        ]),
        Bundle.aggregate([
          { $match: { createdAt: dateFilter } },
          { $group: { _id: "$providerId", count: { $sum: 1 } } },
          {
            $lookup: {
              from: "providers",
              localField: "_id",
              foreignField: "_id",
              as: "provider",
            },
          },
          { $unwind: "$provider" },
          { $project: { providerName: "$provider.name", count: 1 } },
        ]),
        Bundle.aggregate([
          {
            $match: {
              createdAt: dateFilter,
              category: { $exists: true, $ne: null },
            },
          },
          { $group: { _id: "$category", count: { $sum: 1 } } },
        ]),
      ]);

      return {
        totalBundles: totalBundles || 0,
        activeBundles: activeBundles || 0,
        totalValue: totalValue[0]?.total || 0,
        averagePrice: averagePrice[0]?.average || 0,
        bundlesByProvider: bundlesByProvider || [],
        bundlesByCategory: bundlesByCategory || [],
      };
    } catch (error) {
      logger.error("Error in getBundleAnalytics:", error);
      throw error;
    }
  },

  // Get provider bundle analytics
  getProviderBundleAnalytics: async (providerId, period = "30d") => {
    try {
      const dateFilter = getDateFilter(period);

      const [
        totalBundles,
        activeBundles,
        totalValue,
        averagePrice,
        bundlesByCategory,
      ] = await Promise.all([
        Bundle.countDocuments({ providerId, createdAt: dateFilter }),
        Bundle.countDocuments({
          providerId,
          isActive: true,
          createdAt: dateFilter,
        }),
        Bundle.aggregate([
          { $match: { providerId, createdAt: dateFilter } },
          { $group: { _id: null, total: { $sum: "$price" } } },
        ]),
        Bundle.aggregate([
          { $match: { providerId, createdAt: dateFilter } },
          { $group: { _id: null, average: { $avg: "$price" } } },
        ]),
        Bundle.aggregate([
          {
            $match: {
              providerId,
              createdAt: dateFilter,
              category: { $exists: true, $ne: null },
            },
          },
          { $group: { _id: "$category", count: { $sum: 1 } } },
        ]),
      ]);

      return {
        totalBundles: totalBundles || 0,
        activeBundles: activeBundles || 0,
        totalValue: totalValue[0]?.total || 0,
        averagePrice: averagePrice[0]?.average || 0,
        bundlesByCategory: bundlesByCategory || [],
      };
    } catch (error) {
      logger.error("Error in getProviderBundleAnalytics:", error);
      throw error;
    }
  },

  // Update bundle pricing tiers
  updateBundlePricing: async (bundleId, pricingTiers) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(bundleId)) {
        throw new Error("Invalid bundle ID");
      }

      const bundle = await Bundle.findById(bundleId);
      if (!bundle) {
        return null;
      }

      // Use the model's method for updating pricing tiers
      await bundle.updatePricingTiers(pricingTiers);

      return bundle;
    } catch (error) {
      logger.error("Error updating bundle pricing:", error);
      throw error;
    }
  },
};

// Helper function to generate bundle code
const generateBundleCode = async (providerId) => {
  const provider = await Provider.findById(providerId);
  const prefix = provider?.name?.substring(0, 3).toUpperCase() || "BND";
  const timestamp = Date.now().toString().slice(-6);
  return `${prefix}${timestamp}`;
};

// Helper function to get date filter
const getDateFilter = (period) => {
  const now = new Date();
  let startDate;

  switch (period) {
    case "7d":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "90d":
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "1y":
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return { $gte: startDate };
};

export default bundleService;
