// src/controllers/providerController.js
import providerService from '../services/providerService.js';
import logger from '../utils/logger.js';

class ProviderController {
  // Create provider (Admin/Super Admin only)
  async createProvider(req, res) {
    try {
      const { userId } = req.user;
      const providerData = {
        ...req.body,
        createdBy: userId
      };
      const provider = await providerService.createProvider(providerData);

      res.status(201).json({
        success: true,
        provider,
      });
    } catch (error) {
      logger.error(`Provider creation failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get providers with filtering (accessible to all users)
  async getProviders(req, res) {
    try {
      const filters = {
        search: req.query.search,
        isActive:
          req.query.isActive !== undefined
            ? req.query.isActive === "true"
            : true,
        includeDeleted: req.query.includeDeleted === "true",
      };

      const pagination = {
        page: parseInt(req.query.page) || 1,
        limit: Math.min(parseInt(req.query.limit) || 20, 100),
        sortBy: req.query.sortBy || "name",
        sortOrder: req.query.sortOrder === "desc" ? -1 : 1,
      };

      const result = await providerService.getProviders(
        filters,
        pagination
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.error(`Get providers failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch providers",
      });
    }
  }

  // Get public providers (no authentication required)
  async getPublicProviders(req, res) {
    try {
      const filters = {
        search: req.query.search,
        isActive: true, // Only active providers for public
        includeDeleted: false,
      };

      const pagination = {
        page: parseInt(req.query.page) || 1,
        limit: Math.min(parseInt(req.query.limit) || 20, 100),
        sortBy: req.query.sortBy || "name",
        sortOrder: req.query.sortOrder === "desc" ? -1 : 1,
      };

      const result = await providerService.getProviders(
        filters,
        pagination
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.error(`Get public providers failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch providers",
      });
    }
  }

  // Get provider by ID (accessible to all users)
  async getProviderById(req, res) {
    try {
      const { id } = req.params;

      const provider = await providerService.getProviderById(id);

      res.json({
        success: true,
        provider,
      });
    } catch (error) {
      logger.error(`Get provider by ID failed: ${error.message}`);
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update provider (Admin/Super Admin only)
  async updateProvider(req, res) {
    try {
      const { userId } = req.user;
      const { id } = req.params;

      const provider = await providerService.updateProvider(
        id,
        req.body,
        userId
      );

      res.json({
        success: true,
        message: "Provider updated successfully",
        provider,
      });
    } catch (error) {
      logger.error(`Provider update failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Soft delete provider (Admin/Super Admin only)
  async softDeleteProvider(req, res) {
    try {
      const { userId } = req.user;
      const { id } = req.params;

      const provider = await providerService.softDeleteProvider(
        id,
        userId
      );

      res.json({
        success: true,
        message: "Provider deleted successfully",
        provider,
      });
    } catch (error) {
      logger.error(`Provider deletion failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Restore provider (Admin/Super Admin only)
  async restoreProvider(req, res) {
    try {
      const { userId } = req.user;
      const { id } = req.params;

      const provider = await providerService.restoreProvider(
        id,
        userId
      );

      res.json({
        success: true,
        message: "Provider restored successfully",
        provider,
      });
    } catch (error) {
      logger.error(`Provider restoration failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get provider analytics (accessible to all users)
  async getProviderAnalytics(req, res) {
    try {
      const analytics = await providerService.getProviderAnalytics();

      res.json({
        success: true,
        analytics,
      });
    } catch (error) {
      logger.error(`Get provider analytics failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch provider analytics",
      });
    }
  }
}

export default new ProviderController();