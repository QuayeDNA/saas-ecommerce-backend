// src/controllers/storefrontController.js
import storefrontService from '../services/storefrontService.js';
import logger from '../utils/logger.js';

class StorefrontController {
  // Create storefront (Agent only)
  async createStorefront(req, res) {
    try {
      const { tenantId } = req.user;
      const storefront = await storefrontService.createStorefront(req.body, tenantId);
      
      res.status(201).json({
        success: true,
        storefront
      });
    } catch (error) {
      logger.error(`Storefront creation failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Update storefront (Agent only)
  async updateStorefront(req, res) {
    try {
      const { tenantId } = req.user;
      const storefront = await storefrontService.updateStorefront(tenantId, req.body);
      
      res.json({
        success: true,
        storefront
      });
    } catch (error) {
      logger.error(`Storefront update failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Get agent's storefront (Agent only)
  async getStorefront(req, res) {
    try {
      const { tenantId } = req.user;
      const storefront = await storefrontService.getStorefront(tenantId);
      
      if (!storefront) {
        return res.status(404).json({
          success: false,
          message: 'Storefront not found'
        });
      }
      
      res.json({
        success: true,
        storefront
      });
    } catch (error) {
      logger.error(`Get storefront failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch storefront'
      });
    }
  }
  
  // Get public storefront by slug (Public)
  async getPublicStorefront(req, res) {
    try {
      const { slug } = req.params;
      const storefront = await storefrontService.getPublicStorefront(slug);
      
      res.json({
        success: true,
        storefront
      });
    } catch (error) {
      logger.error(`Get public storefront failed: ${error.message}`);
      res.status(404).json({
        success: false,
        message: 'Storefront not found'
      });
    }
  }
  
  // Get storefront products (Public)
  async getStorefrontProducts(req, res) {
    try {
      const { slug } = req.params;
      const filters = {
        category: req.query.category,
        provider: req.query.provider,
        search: req.query.search,
        minPrice: req.query.minPrice ? parseFloat(req.query.minPrice) : undefined,
        maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice) : undefined
      };
      
      const pagination = {
        page: parseInt(req.query.page) || 1,
        limit: Math.min(parseInt(req.query.limit) || 20, 50),
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder === 'asc' ? 1 : -1
      };
      
      const result = await storefrontService.getStorefrontProducts(slug, filters, pagination);
      
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      logger.error(`Get storefront products failed: ${error.message}`);
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Create order from storefront (Public)
  async createStorefrontOrder(req, res) {
    try {
      const { slug } = req.params;
      const order = await storefrontService.createStorefrontOrder(slug, req.body);
      
      res.status(201).json({
        success: true,
        order: {
          orderNumber: order.orderNumber,
          total: order.total,
          status: order.status,
          items: order.items.length
        },
        message: 'Order created successfully. The store owner will process your order soon.'
      });
    } catch (error) {
      logger.error(`Storefront order creation failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  
  // Get storefront analytics (Agent only)
  async getStorefrontAnalytics(req, res) {
    try {
      const { tenantId } = req.user;
      const { timeframe } = req.query;
      
      const analytics = await storefrontService.getStorefrontAnalytics(tenantId, timeframe);
      
      res.json({
        success: true,
        analytics
      });
    } catch (error) {
      logger.error(`Get storefront analytics failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch analytics'
      });
    }
  }
  
  // Check slug availability (Agent only)
  async checkSlugAvailability(req, res) {
    try {
      const { slug } = req.params;
      const { tenantId } = req.user;
      
      const isAvailable = await storefrontService.checkSlugAvailability(slug, tenantId);
      
      res.json({
        success: true,
        available: isAvailable
      });
    } catch (error) {
      logger.error(`Check slug availability failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to check slug availability'
      });
    }
  }
  
  // Toggle storefront status (Agent only)
  async toggleStorefrontStatus(req, res) {
    try {
      const { tenantId } = req.user;
      const storefront = await storefrontService.toggleStorefrontStatus(tenantId);
      
      res.json({
        success: true,
        storefront,
        message: `Storefront ${storefront.isActive ? 'activated' : 'deactivated'} successfully`
      });
    } catch (error) {
      logger.error(`Toggle storefront status failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
}

export default new StorefrontController();
