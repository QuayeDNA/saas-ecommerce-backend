// src/controllers/packageController.js
import packageService from '../services/packageService.js';
import logger from '../utils/logger.js';

class PackageController {
  // Create package
  async createPackage(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const packageData = {
        ...req.body,
        tenantId,
        createdBy: userId
      };
      const packageGroup = await packageService.createPackage(packageData);

      res.status(201).json({
        success: true,
        data: packageGroup,
      });
    } catch (error) {
      logger.error(`Package creation failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get packages
  async getPackages(req, res) {
    try {
      const filters = {
        search: req.query.search,
        provider: req.query.provider,
        category: req.query.category,
        isActive: req.query.isActive,
        includeDeleted: req.query.includeDeleted === 'true'
      };
      
      const pagination = {
        page: parseInt(req.query.page) || 1,
        limit: Math.min(parseInt(req.query.limit) || 20, 100),
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder === 'asc' ? 1 : -1
      };
      
      const result = await packageService.getPackages(filters, pagination);
      
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      logger.error(`Get packages failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch packages'
      });
    }
  }

  // Get single package
  async getPackage(req, res) {
    try {
      const { id } = req.params;
      
      const packageGroup = await packageService.getPackageById(id);
      
      res.json({
        success: true,
        data: packageGroup
      });
    } catch (error) {
      logger.error(`Get package failed: ${error.message}`);
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  }

  // Update package
  async updatePackage(req, res) {
    try {
      const { tenantId, userId, userType } = req.user;
      const { id } = req.params;
      
      // For super admins, don't pass tenantId
      const effectiveTenantId = userType === 'super_admin' ? null : tenantId;
      
      const packageGroup = await packageService.updatePackage(id, req.body, effectiveTenantId, userId);
      
      res.json({
        success: true,
        data: packageGroup
      });
    } catch (error) {
      logger.error(`Update package failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Delete package
  async deletePackage(req, res) {
    try {
      const { tenantId, userId, userType } = req.user;
      const { id } = req.params;
      
      // For super admins, don't pass tenantId
      const effectiveTenantId = userType === 'super_admin' ? null : tenantId;
      
      await packageService.deletePackage(id, effectiveTenantId, userId);
      
      res.json({
        success: true,
        message: 'Package deleted successfully'
      });
    } catch (error) {
      logger.error(`Delete package failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Restore package
  async restorePackage(req, res) {
    try {
      const { tenantId, userId, userType } = req.user;
      const { id } = req.params;
      
      // For super admins, don't pass tenantId
      const effectiveTenantId = userType === 'super_admin' ? null : tenantId;
      
      const packageGroup = await packageService.restorePackage(id, effectiveTenantId, userId);
      
      res.json({
        success: true,
        data: packageGroup,
        message: 'Package restored successfully'
      });
    } catch (error) {
      logger.error(`Restore package failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get packages by provider
  async getPackagesByProvider(req, res) {
    try {
      const { provider } = req.params;
      
      const packages = await packageService.getPackagesByProvider(provider);
      
      res.json({
        success: true,
        packages
      });
    } catch (error) {
      logger.error(`Get packages by provider failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch packages'
      });
    }
  }

  // Get packages by category
  async getPackagesByCategory(req, res) {
    try {
      const { category } = req.params;
      
      const packages = await packageService.getPackagesByCategory(category);
      
      res.json({
        success: true,
        packages
      });
    } catch (error) {
      logger.error(`Get packages by category failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch packages'
      });
    }
  }

  // Get package statistics
  async getPackageStats(req, res) {
    try {
      const stats = await packageService.getPackageStats();
      
      res.json({
        success: true,
        stats
      });
    } catch (error) {
      logger.error(`Get package stats failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch package statistics'
      });
    }
  }
}

export default new PackageController();
