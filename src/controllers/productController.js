// src/controllers/productController.js
import productService from "../services/productService.js";
import logger from "../utils/logger.js";

class ProductController {
  // Create product
  async createProduct(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const productData = {
        ...req.body,
        tenantId,
        createdBy: userId
      };
      const product = await productService.createProduct(productData);

      res.status(201).json({
        success: true,
        product,
      });
    } catch (error) {
      logger.error(`Product creation failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get products with filtering
  async getProducts(req, res) {
    try {
      const { tenantId } = req.user;
      const filters = {
        category: req.query.category,
        provider: req.query.provider,
        network: req.query.network,
        bundleType: req.query.bundleType,
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

      const result = await productService.getProducts(
        tenantId,
        filters,
        pagination
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.error(`Get products failed: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to fetch products",
      });
    }
  }

  // Bulk inventory update
  async bulkUpdateInventory(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { updates } = req.body;

      const results = await productService.bulkUpdateInventory(
        tenantId,
        updates,
        userId
      );

      res.json({
        success: true,
        message: `Updated ${results.length} variants`,
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

      await productService.reserveStock(tenantId, reservations);

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

  // Get low stock alerts
  async getLowStockAlerts(req, res) {
    try {
      const { tenantId } = req.user;
      const alerts = await productService.getLowStockAlerts(tenantId);

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

  // Soft delete product
  async softDeleteProduct(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      const product = await productService.softDeleteProduct(
        id,
        tenantId,
        userId
      );

      res.json({
        success: true,
        message: "Product deleted successfully",
        product,
      });
    } catch (error) {
      logger.error(`Product deletion failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get analytics
  async getAnalytics(req, res) {
    try {
      const { tenantId } = req.user;
      const { timeframe } = req.query;

      const analytics = await productService.getProductAnalytics(
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

  // Update product
  async updateProduct(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      const product = await productService.updateProduct(
        id,
        req.body,
        tenantId,
        userId
      );

      res.json({
        success: true,
        message: "Product updated successfully",
        product,
      });
    } catch (error) {
      logger.error(`Product update failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Restore product
  async restoreProduct(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      const product = await productService.restoreProduct(id, tenantId, userId);

      res.json({
        success: true,
        message: "Product restored successfully",
        product,
      });
    } catch (error) {
      logger.error(`Product restoration failed: ${error.message}`);
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

      await productService.releaseStock(tenantId, reservations);

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

  // Add variant
  async addVariant(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      const variant = await productService.addVariant(
        id,
        req.body,
        tenantId,
        userId
      );

      res.status(201).json({
        success: true,
        message: "Variant added successfully",
        variant,
      });
    } catch (error) {
      logger.error(`Add variant failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update variant
  async updateVariant(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id, variantId } = req.params;

      const variant = await productService.updateVariant(
        id,
        variantId,
        req.body,
        tenantId,
        userId
      );

      res.json({
        success: true,
        message: "Variant updated successfully",
        variant,
      });
    } catch (error) {
      logger.error(`Update variant failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Delete variant
  async deleteVariant(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id, variantId } = req.params;

      await productService.deleteVariant(id, variantId, tenantId, userId);

      res.json({
        success: true,
        message: "Variant deleted successfully",
      });
    } catch (error) {
      logger.error(`Delete variant failed: ${error.message}`);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

export default new ProductController();
