// src/controllers/packageController.js
import packageService from '../services/packageService.js';
import logger from '../utils/logger.js';

class PackageController {
  // Create package group
  async createPackageGroup(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const packageData = {
        ...req.body,
        tenantId,
        createdBy: userId
      };
      const packageGroup = await packageService.createPackageGroup(packageData);

      res.status(201).json({
        success: true,
        package: packageGroup,
      });
    } catch (error) {
      logger.error(`Package group creation failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get packages with filtering
  async getPackageGroups(req, res) {
    try {
      const { tenantId } = req.user;
      const filters = {
        provider: req.query.provider,
        minDataVolume: req.query.minDataVolume,
        maxDataVolume: req.query.maxDataVolume,
        minValidity: req.query.minValidity,
        maxValidity: req.query.maxValidity,
        minPrice: req.query.minPrice
          ? parseFloat(req.query.minPrice)
          : undefined,
        maxPrice: req.query.maxPrice
          ? parseFloat(req.query.maxPrice)
          : undefined,
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
        sortBy: req.query.sortBy || "createdAt",
        sortOrder: req.query.sortOrder === "asc" ? 1 : -1,
      };

      const result = await packageService.getPackageGroups(
        tenantId,
        filters,
        pagination
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.error(`Get packages failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch packages",
      });
    }
  }

  // Update package group
  async updatePackageGroup(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      const packageGroup = await packageService.updatePackageGroup(
        id,
        req.body,
        tenantId,
        userId
      );

      res.json({
        success: true,
        message: "Package group updated successfully",
        package: packageGroup,
      });
    } catch (error) {
      logger.error(`Package group update failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Soft delete package group
  async softDeletePackageGroup(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      const packageGroup = await packageService.softDeletePackageGroup(
        id,
        tenantId,
        userId
      );

      res.json({
        success: true,
        message: "Package group deleted successfully",
        package: packageGroup,
      });
    } catch (error) {
      logger.error(`Package group deletion failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Restore package group
  async restorePackageGroup(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      const packageGroup = await packageService.restorePackageGroup(
        id,
        tenantId,
        userId
      );

      res.json({
        success: true,
        message: "Package group restored successfully",
        package: packageGroup,
      });
    } catch (error) {
      logger.error(`Package group restoration failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Add package item
  async addPackageItem(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      const packageGroup = await packageService.addPackageItem(
        id,
        req.body,
        tenantId,
        userId
      );

      res.status(201).json({
        success: true,
        message: "Package item added successfully",
        package: packageGroup,
      });
    } catch (error) {
      logger.error(`Add package item failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update package item
  async updatePackageItem(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id, itemId } = req.params;

      const packageGroup = await packageService.updatePackageItem(
        id,
        itemId,
        req.body,
        tenantId,
        userId
      );

      res.json({
        success: true,
        message: "Package item updated successfully",
        package: packageGroup,
      });
    } catch (error) {
      logger.error(`Update package item failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Delete package item
  async deletePackageItem(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id, itemId } = req.params;

      const packageGroup = await packageService.deletePackageItem(
        id,
        itemId,
        tenantId,
        userId
      );

      res.json({
        success: true,
        message: "Package item deleted successfully",
        package: packageGroup,
      });
    } catch (error) {
      logger.error(`Delete package item failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Bulk inventory update
  async bulkUpdateInventory(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { updates } = req.body;

      const results = await packageService.bulkUpdateInventory(
        tenantId,
        updates,
        userId
      );

      res.json({
        success: true,
        message: `Updated ${results.length} package items`,
        results,
      });
    } catch (error) {
      logger.error(`Bulk inventory update failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Reserve stock
  async reserveStock(req, res) {
    try {
      const { tenantId } = req.user;
      const { reservations } = req.body;

      await packageService.reserveStock(tenantId, reservations);

      res.json({
        success: true,
        message: "Stock reserved successfully",
      });
    } catch (error) {
      logger.error(`Stock reservation failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Release stock
  async releaseStock(req, res) {
    try {
      const { tenantId } = req.user;
      const { reservations } = req.body;

      await packageService.releaseStock(tenantId, reservations);

      res.json({
        success: true,
        message: "Stock released successfully",
      });
    } catch (error) {
      logger.error(`Stock release failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get low stock alerts
  async getLowStockAlerts(req, res) {
    try {
      const { tenantId } = req.user;
      const alerts = await packageService.getLowStockAlerts(tenantId);

      res.json({
        success: true,
        alerts,
        count: alerts.length,
      });
    } catch (error) {
      logger.error(`Get low stock alerts failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch low stock alerts",
      });
    }
  }

  // Get analytics
  async getAnalytics(req, res) {
    try {
      const { tenantId } = req.user;
      const { timeframe } = req.query;

      const analytics = await packageService.getPackageAnalytics(
        tenantId,
        timeframe
      );

      res.json({
        success: true,
        analytics,
      });
    } catch (error) {
      logger.error(`Get analytics failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch analytics",
      });
    }
  }
}

export default new PackageController();
