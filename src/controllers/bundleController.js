// src/controllers/bundleController.js
import bundleService from "../services/bundleService.js";
import logger from "../utils/logger.js";

const bundleController = {
  // Get all bundles (public)
  getAllBundles: async (req, res) => {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        category,
        providerId,
        packageId,
        provider,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;
      const userType = req.user?.userType || "agent";

      const result = await bundleService.getAllBundles({
        page: parseInt(page),
        limit: parseInt(limit),
        search,
        category,
        providerId,
        packageId,
        provider,
        sortBy,
        sortOrder,
        userType,
      });

      res.json({
        success: true,
        bundles: result.bundles,
        pagination: result.pagination,
      });
    } catch (error) {
      logger.error("Error getting all bundles:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get bundles",
      });
    }
  },

  // Get bundle by ID (public)
  getBundleById: async (req, res) => {
    try {
      const { id } = req.params;
      const userType = req.user?.userType || "agent";
      const bundle = await bundleService.getBundleById(id, userType);

      if (!bundle) {
        return res.status(404).json({
          success: false,
          message: "Bundle not found",
        });
      }

      res.json({
        success: true,
        data: bundle,
      });
    } catch (error) {
      logger.error("Error getting bundle by ID:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get bundle",
      });
    }
  },

  // Get bundles by provider (public)
  getBundlesByProvider: async (req, res) => {
    try {
      const { providerId } = req.params; // This is actually the provider code
      const { page = 1, limit = 10 } = req.query;

      const result = await bundleService.getBundlesByProvider(providerId, {
        page: parseInt(page),
        limit: parseInt(limit),
      });

      res.json({
        success: true,
        bundles: result.bundles,
        pagination: result.pagination,
      });
    } catch (error) {
      logger.error("Error getting bundles by provider:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get bundles by provider",
      });
    }
  },

  // Get bundles by package (public)
  getBundlesByPackage: async (req, res) => {
    try {
      const { packageId } = req.params;
      const { page = 1, limit = 10 } = req.query;
      const userType = req.user?.userType || "agent";

      const result = await bundleService.getBundlesByPackage(packageId, {
        page: parseInt(page),
        limit: parseInt(limit),
        userType,
      });

      res.json({
        success: true,
        bundles: result.bundles,
        pagination: result.pagination,
      });
    } catch (error) {
      logger.error("Error getting bundles by package:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get bundles by package",
      });
    }
  },

  // Create bundle (admin only)
  createBundle: async (req, res) => {
    try {
      const bundleData = {
        ...req.body,
        tenantId: req.user.userId,
        createdBy: req.user.userId,
      };

      const bundle = await bundleService.createBundle(bundleData);

      res.status(201).json({
        success: true,
        message: "Bundle created successfully",
        data: bundle,
      });
    } catch (error) {
      logger.error("Error creating bundle:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create bundle",
      });
    }
  },

  // Update bundle (admin only)
  updateBundle: async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = {
        ...req.body,
        updatedBy: req.user.userId,
      };

      const bundle = await bundleService.updateBundle(id, updateData);

      if (!bundle) {
        return res.status(404).json({
          success: false,
          message: "Bundle not found",
        });
      }

      res.json({
        success: true,
        message: "Bundle updated successfully",
        data: bundle,
      });
    } catch (error) {
      logger.error("Error updating bundle:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to update bundle",
      });
    }
  },

  // Delete bundle (admin only)
  deleteBundle: async (req, res) => {
    try {
      const { id } = req.params;
      const result = await bundleService.deleteBundle(id);

      if (!result) {
        return res.status(404).json({
          success: false,
          message: "Bundle not found",
        });
      }

      res.json({
        success: true,
        message: "Bundle deleted successfully",
      });
    } catch (error) {
      logger.error("Error deleting bundle:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete bundle",
      });
    }
  },

  // Bulk create bundles (admin only)
  createBulkBundles: async (req, res) => {
    try {
      const { bundles } = req.body;
      const result = await bundleService.createBulkBundles(bundles);

      res.status(201).json({
        success: true,
        message: `${result.created} bundles created successfully`,
        data: {
          created: result.created,
          failed: result.failed,
          errors: result.errors,
        },
      });
    } catch (error) {
      logger.error("Error creating bulk bundles:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create bulk bundles",
      });
    }
  },

  // Bulk update bundles (admin only)
  updateBulkBundles: async (req, res) => {
    try {
      const { bundles } = req.body;
      const result = await bundleService.updateBulkBundles(bundles);

      res.json({
        success: true,
        message: `${result.updated} bundles updated successfully`,
        data: {
          updated: result.updated,
          failed: result.failed,
          errors: result.errors,
        },
      });
    } catch (error) {
      logger.error("Error updating bulk bundles:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update bulk bundles",
      });
    }
  },

  // Bulk delete bundles (admin only)
  deleteBulkBundles: async (req, res) => {
    try {
      const { bundleIds } = req.body;
      const result = await bundleService.deleteBulkBundles(bundleIds);

      res.json({
        success: true,
        message: `${result.deleted} bundles deleted successfully`,
        data: {
          deleted: result.deleted,
          failed: result.failed,
          errors: result.errors,
        },
      });
    } catch (error) {
      logger.error("Error deleting bulk bundles:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete bulk bundles",
      });
    }
  },

  // Get bundle analytics (admin only)
  getBundleAnalytics: async (req, res) => {
    try {
      const { period = "30d" } = req.query;
      const analytics = await bundleService.getBundleAnalytics(period);

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      logger.error("Error getting bundle analytics:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get bundle analytics",
      });
    }
  },

  // Get provider bundle analytics (admin only)
  getProviderBundleAnalytics: async (req, res) => {
    try {
      const { providerId } = req.params;
      const { period = "30d" } = req.query;
      const analytics = await bundleService.getProviderBundleAnalytics(
        providerId,
        period
      );

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      logger.error("Error getting provider bundle analytics:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get provider bundle analytics",
      });
    }
  },

  // Get bundle pricing tiers (super admin only)
  getBundlePricing: async (req, res) => {
    try {
      const { id } = req.params;
      const bundle = await bundleService.getBundleById(id);

      if (!bundle) {
        return res.status(404).json({
          success: false,
          message: "Bundle not found",
        });
      }

      res.json({
        success: true,
        data: {
          bundleId: bundle._id,
          name: bundle.name,
          basePrice: bundle.price,
          pricingTiers: bundle.pricingTiers || {},
          lastUpdated: bundle.updatedAt,
        },
      });
    } catch (error) {
      logger.error("Error getting bundle pricing:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get bundle pricing",
      });
    }
  },

  // Update bundle pricing tiers (super admin only)
  updateBundlePricing: async (req, res) => {
    try {
      const { id } = req.params;
      const { pricingTiers } = req.body;

      // Validate pricing tiers structure
      const validUserTypes = [
        "agent",
        "super_agent",
        "dealer",
        "super_dealer",
        "default",
      ];
      const invalidUserTypes = Object.keys(pricingTiers || {}).filter(
        (userType) => !validUserTypes.includes(userType)
      );

      if (invalidUserTypes.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid user types: ${invalidUserTypes.join(
            ", "
          )}. Valid types are: ${validUserTypes.join(", ")}`,
        });
      }

      // Validate pricing values are positive numbers
      for (const [userType, price] of Object.entries(pricingTiers || {})) {
        if (typeof price !== "number" || price < 0) {
          return res.status(400).json({
            success: false,
            message: `Invalid price for ${userType}: must be a positive number`,
          });
        }
      }

      const bundle = await bundleService.updateBundlePricing(id, pricingTiers);

      if (!bundle) {
        return res.status(404).json({
          success: false,
          message: "Bundle not found",
        });
      }

      res.json({
        success: true,
        message: "Bundle pricing updated successfully",
        data: {
          bundleId: bundle._id,
          name: bundle.name,
          basePrice: bundle.price,
          pricingTiers: bundle.pricingTiers,
          lastUpdated: bundle.updatedAt,
        },
      });
    } catch (error) {
      logger.error("Error updating bundle pricing:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to update bundle pricing",
      });
    }
  },

  // Bulk update pricing for multiple bundles (super admin only)
  bulkUpdatePricing: async (req, res) => {
    try {
      const { updates } = req.body; // Array of { bundleId, pricingTiers }

      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Updates array is required and must not be empty",
        });
      }

      const validUserTypes = [
        "agent",
        "super_agent",
        "dealer",
        "super_dealer",
        "default",
      ];
      const results = [];
      const errors = [];

      for (const update of updates) {
        try {
          const { bundleId, pricingTiers } = update;

          if (!bundleId || !pricingTiers) {
            errors.push({
              bundleId: bundleId || "unknown",
              error: "Bundle ID and pricing tiers are required",
            });
            continue;
          }

          // Validate user types
          const invalidUserTypes = Object.keys(pricingTiers).filter(
            (userType) => !validUserTypes.includes(userType)
          );

          if (invalidUserTypes.length > 0) {
            errors.push({
              bundleId,
              error: `Invalid user types: ${invalidUserTypes.join(", ")}`,
            });
            continue;
          }

          // Validate pricing values
          let hasInvalidPrice = false;
          for (const [userType, price] of Object.entries(pricingTiers)) {
            if (typeof price !== "number" || price < 0) {
              errors.push({
                bundleId,
                error: `Invalid price for ${userType}: must be a positive number`,
              });
              hasInvalidPrice = true;
              break;
            }
          }

          if (hasInvalidPrice) continue;

          const bundle = await bundleService.updateBundlePricing(
            bundleId,
            pricingTiers
          );

          if (bundle) {
            results.push({
              bundleId: bundle._id,
              name: bundle.name,
              status: "updated",
              pricingTiers: bundle.pricingTiers,
            });
          } else {
            errors.push({
              bundleId,
              error: "Bundle not found",
            });
          }
        } catch (updateError) {
          errors.push({
            bundleId: update.bundleId || "unknown",
            error: updateError.message,
          });
        }
      }

      res.json({
        success: true,
        message: `Bulk pricing update completed. ${results.length} successful, ${errors.length} failed.`,
        data: {
          successful: results,
          failed: errors,
          summary: {
            total: updates.length,
            successful: results.length,
            failed: errors.length,
          },
        },
      });
    } catch (error) {
      logger.error("Error in bulk pricing update:", error);
      res.status(500).json({
        success: false,
        message: "Failed to perform bulk pricing update",
      });
    }
  },
};

export default bundleController;
