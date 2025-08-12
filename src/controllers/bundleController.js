// src/controllers/bundleController.js
import bundleService from '../services/bundleService.js';
import logger from '../utils/logger.js';

const bundleController = {
  // Get all bundles (public)
  getAllBundles: async (req, res) => {
    try {
      const { page = 1, limit = 10, search, category, providerId, packageId, provider, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
      const userType = req.user?.userType || 'agent';
      
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
        userType
      });

      res.json({
        success: true,
        bundles: result.bundles,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Error getting all bundles:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get bundles'
      });
    }
  },

  // Get bundle by ID (public)
  getBundleById: async (req, res) => {
    try {
      const { id } = req.params;
      const bundle = await bundleService.getBundleById(id);
      
      if (!bundle) {
        return res.status(404).json({
          success: false,
          message: 'Bundle not found'
        });
      }

      res.json({
        success: true,
        data: bundle
      });
    } catch (error) {
      logger.error('Error getting bundle by ID:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get bundle'
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
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        bundles: result.bundles,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Error getting bundles by provider:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get bundles by provider'
      });
    }
  },

  // Get bundles by package (public)
  getBundlesByPackage: async (req, res) => {
    try {
      const { packageId } = req.params;
      const { page = 1, limit = 10 } = req.query;
      const userType = req.user?.userType || 'agent';
      
      const result = await bundleService.getBundlesByPackage(packageId, {
        page: parseInt(page),
        limit: parseInt(limit),
        userType
      });

      res.json({
        success: true,
        bundles: result.bundles,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Error getting bundles by package:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get bundles by package'
      });
    }
  },

  // Create bundle (admin only)
  createBundle: async (req, res) => {
    try {
      const bundleData = {
        ...req.body,
        tenantId: req.user.userId,
        createdBy: req.user.userId
      };
      
      const bundle = await bundleService.createBundle(bundleData);
      
      res.status(201).json({
        success: true,
        message: 'Bundle created successfully',
        data: bundle
      });
    } catch (error) {
      logger.error('Error creating bundle:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create bundle'
      });
    }
  },

  // Update bundle (admin only)
  updateBundle: async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = {
        ...req.body,
        updatedBy: req.user.userId
      };
      
      const bundle = await bundleService.updateBundle(id, updateData);
      
      if (!bundle) {
        return res.status(404).json({
          success: false,
          message: 'Bundle not found'
        });
      }

      res.json({
        success: true,
        message: 'Bundle updated successfully',
        data: bundle
      });
    } catch (error) {
      logger.error('Error updating bundle:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update bundle'
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
          message: 'Bundle not found'
        });
      }

      res.json({
        success: true,
        message: 'Bundle deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting bundle:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete bundle'
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
          errors: result.errors
        }
      });
    } catch (error) {
      logger.error('Error creating bulk bundles:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create bulk bundles'
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
          errors: result.errors
        }
      });
    } catch (error) {
      logger.error('Error updating bulk bundles:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update bulk bundles'
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
          errors: result.errors
        }
      });
    } catch (error) {
      logger.error('Error deleting bulk bundles:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete bulk bundles'
      });
    }
  },

  // Get bundle analytics (admin only)
  getBundleAnalytics: async (req, res) => {
    try {
      const { period = '30d' } = req.query;
      const analytics = await bundleService.getBundleAnalytics(period);
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error getting bundle analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get bundle analytics'
      });
    }
  },

  // Get provider bundle analytics (admin only)
  getProviderBundleAnalytics: async (req, res) => {
    try {
      const { providerId } = req.params;
      const { period = '30d' } = req.query;
      const analytics = await bundleService.getProviderBundleAnalytics(providerId, period);
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error getting provider bundle analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get provider bundle analytics'
      });
    }
  }
};

export default bundleController; 