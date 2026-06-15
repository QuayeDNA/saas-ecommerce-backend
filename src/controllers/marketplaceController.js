// src/controllers/marketplaceController.js
import mongoose from "mongoose";
import logger from "../utils/logger.js";
import storefrontService from "../services/storefrontService.js";
import bundleService from "../services/bundleService.js";
import packageService from "../services/packageService.js";
import apiKeyService from "../services/apiKeyService.js";
import apiUsageService from "../services/apiUsageService.js";
import notificationService from "../services/notificationService.js";
import Bundle from "../models/Bundle.js";
import User from "../models/User.js";
import Order from "../models/Order.js";
import walletService from "../services/walletService.js";
import { getPriceForUserType } from "../utils/pricingHelpers.js";

class MarketplaceController {
  // =========================================================================
  // API Metadata (no auth — describes the API itself)
  // =========================================================================

  async getApiMetadata(req, res) {
    res.json({
      success: true,
      data: {
        name: "BryteLinks Marketplace API",
        version: "1.0.0",
        baseUrl: `${req.protocol}://${req.get("host")}/api/marketplace`,
        authType: "Bearer token (bl_live_...)",
        rateLimit: "2,000 requests per minute per API key",
        permissionScopes: [
          { scope: "packages:read", description: "List and view packages" },
          { scope: "bundles:read", description: "List and view bundles with storefront pricing" },
          { scope: "storefront:read", description: "View storefront settings" },
          { scope: "orders:write", description: "Place orders via the API (deducts from wallet)" },
        ],
        endpoints: [
          {
            method: "GET",
            path: "/api/marketplace",
            description: "API metadata and documentation",
            auth: false,
          },
          {
            method: "GET",
            path: "/api/marketplace/packages",
            description: "List all available packages",
            auth: true,
            scopes: ["packages:read"],
          },
          {
            method: "GET",
            path: "/api/marketplace/packages/:id",
            description: "Get a single package by ID",
            auth: true,
            scopes: ["packages:read"],
          },
          {
            method: "GET",
            path: "/api/marketplace/bundles",
            description: "List bundles with your storefront pricing",
            auth: true,
            scopes: ["bundles:read"],
          },
          {
            method: "GET",
            path: "/api/marketplace/bundles/:id",
            description: "Get a single bundle by ID",
            auth: true,
            scopes: ["bundles:read"],
          },
          {
            method: "GET",
            path: "/api/marketplace/storefront",
            description: "Get your storefront settings",
            auth: true,
            scopes: ["storefront:read"],
          },
          {
            method: "POST",
            path: "/api/marketplace/orders",
            description: "Place an order (deducts from wallet). Body: { bundleId, customerPhone, quantity }",
            auth: true,
            scopes: ["orders:write"],
          },
        ],
        errorCodes: [
          { code: "MISSING_AUTH", status: 401, description: "No Authorization header provided" },
          { code: "INVALID_KEY", status: 401, description: "API key is not valid or not found" },
          { code: "KEY_REVOKED", status: 401, description: "API key has been revoked" },
          { code: "KEY_SUSPENDED", status: 401, description: "API key has been suspended" },
          { code: "RATE_LIMITED", status: 429, description: "Rate limit exceeded" },
          { code: "FORBIDDEN_SCOPE", status: 403, description: "API key lacks required permission scope" },
          { code: "NOT_FOUND", status: 404, description: "Requested resource not found" },
          { code: "INVALID_ID", status: 400, description: "Invalid resource ID format" },
          { code: "VALIDATION_ERROR", status: 400, description: "Request validation failed" },
          { code: "INSUFFICIENT_BALANCE", status: 402, description: "Wallet balance is too low to complete the order" },
          { code: "INTERNAL_ERROR", status: 500, description: "Internal server error" },
        ],
      },
    });
  }

  // =========================================================================
  // Data Endpoints (delegate to existing services)
  // =========================================================================

  async getPackages(req, res) {
    try {
      const result = await packageService.getPackages({}, {});
      res.json({ success: true, data: result.packages || [] });
    } catch (err) {
      logger.error(`[marketplace] getPackages: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getPackageById(req, res) {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, code: "INVALID_ID", message: "Invalid package ID" });
      }
      const pkg = await packageService.getPackageById(req.params.id);
      res.json({ success: true, data: pkg });
    } catch (err) {
      if (err.message === "Package not found") {
        return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Package not found" });
      }
      logger.error(`[marketplace] getPackageById: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getBundles(req, res) {
    try {
      const bundles = await storefrontService.getAgentBundlesForPricing(req.agentId);
      res.json({ success: true, data: bundles });
    } catch (err) {
      logger.error(`[marketplace] getBundles: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getBundleById(req, res) {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, code: "INVALID_ID", message: "Invalid bundle ID" });
      }
      const bundle = await bundleService.getBundleById(req.params.id, "agent");
      if (!bundle) {
        return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Bundle not found" });
      }
      res.json({ success: true, data: bundle });
    } catch (err) {
      logger.error(`[marketplace] getBundleById: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getStorefront(req, res) {
    try {
      const storefront = await storefrontService.getAgentStorefront(req.agentId);
      if (!storefront) {
        return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Storefront not found. Create one first." });
      }
      res.json({ success: true, data: storefront });
    } catch (err) {
      logger.error(`[marketplace] getStorefront: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  // =========================================================================
  // API Key Management
  // =========================================================================

  async createKey(req, res) {
    try {
      const { label } = req.body;
      if (!label || typeof label !== "string" || label.trim().length === 0) {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "Label is required" });
      }
      if (label.length > 50) {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "Label must be 50 characters or less" });
      }

      const { rawKey, apiKey } = await apiKeyService.generateKey(
        req.agentId,
        label.trim(),
      );

      notificationService.createInAppNotification(
        req.agentId,
        "API Key Created",
        `Your API key "${apiKey.label}" was created successfully`,
        "success",
        { type: "api_update", navigationLink: "/agent/dashboard/api-marketplace" },
        "api",
      );

      res.status(201).json({
        success: true,
        message: "API key created successfully",
        data: {
          _id: apiKey._id,
          label: apiKey.label,
          keyPrefix: apiKey.keyPrefix,
          key: rawKey,
          permissions: apiKey.permissions,
          status: apiKey.status,
          createdAt: apiKey.createdAt,
        },
      });
    } catch (err) {
      logger.error(`[marketplace] createKey: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async listKeys(req, res) {
    try {
      const keys = await apiKeyService.listAgentKeys(req.agentId);
      res.json({ success: true, data: keys });
    } catch (err) {
      logger.error(`[marketplace] listKeys: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async revokeKey(req, res) {
    try {
      const key = await apiKeyService.revokeKey(req.params.id, req.agentId);

      notificationService.createInAppNotification(
        req.agentId,
        "API Key Revoked",
        `Your API key "${key.label}" has been revoked`,
        "warning",
        { type: "api_update", navigationLink: "/agent/dashboard/api-marketplace" },
        "api",
      );

      res.json({
        success: true,
        message: "API key revoked successfully",
        data: { _id: key._id, keyPrefix: key.keyPrefix, status: key.status },
      });
    } catch (err) {
      if (err.message === "API key not found") {
        return res.status(404).json({ success: false, code: "NOT_FOUND", message: err.message });
      }
      if (err.message === "API key is already revoked") {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: err.message });
      }
      logger.error(`[marketplace] revokeKey: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  // =========================================================================
  // Order Placement (via API key — wallet deduction)
  // =========================================================================

  async createOrder(req, res) {
    try {
      const { bundleId, customerPhone, quantity = 1 } = req.body;

      if (!bundleId) {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "bundleId is required", hint: "Provide the bundle ID from GET /api/marketplace/bundles" });
      }
      if (!customerPhone || typeof customerPhone !== "string") {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "customerPhone is required", hint: "Provide a valid phone number for the end customer" });
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "quantity must be an integer between 1 and 100" });
      }

      const bundle = await Bundle.findOne({ _id: bundleId, isActive: true, isDeleted: false })
        .populate("providerId", "name code")
        .populate("packageId", "name");
      if (!bundle) {
        return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Bundle not found or inactive", hint: "Verify the bundleId from GET /api/marketplace/bundles" });
      }

      const user = await User.findById(req.agentId);
      if (!user) {
        return res.status(401).json({ success: false, code: "INVALID_KEY", message: "Authenticated user not found" });
      }

      const unitPrice = getPriceForUserType(bundle, user.userType);
      const orderTotal = unitPrice * quantity;

      if (user.walletBalance < orderTotal) {
        return res.status(402).json({
          success: false,
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient wallet balance",
          hint: `Required: GH₵${orderTotal.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}. Top up your wallet via the dashboard.`,
        });
      }

      const idempotencyKey = `marketplace_order_${req.agentId}_${bundleId}_${customerPhone}_${Date.now()}`;
      await walletService.debitWallet(
        req.agentId,
        orderTotal,
        `API order: ${bundle.name} for ${customerPhone}`,
        null,
        { orderType: "marketplace_api", idempotencyKey },
      );

      const order = new Order({
        orderType: "single",
        tenantId: req.agentId,
        createdBy: req.agentId,
        paymentMethod: "wallet",
        status: "pending",
        paymentStatus: "paid",
        items: [{
          packageGroup: bundle.packageId?._id || bundle.packageId,
          packageItem: bundle._id,
          packageDetails: {
            name: bundle.name,
            code: bundle._id.toString(),
            price: unitPrice,
            dataVolume: bundle.dataVolume,
            validity: bundle.validity,
            validityUnit: bundle.validityUnit,
            provider: bundle.providerId?.code || bundle.providerId?.name,
          },
          quantity,
          unitPrice,
          totalPrice: orderTotal,
          customerPhone,
        }],
      });

      await order.save();

      notificationService.createInAppNotification(
        req.agentId,
        "Order Placed via API",
        `Order ${order.orderNumber}: ${bundle.name} × ${quantity} for ${customerPhone} — GH₵${orderTotal.toFixed(2)}`,
        "success",
        { type: "api_update", orderId: order._id.toString(), orderNumber: order.orderNumber, navigationLink: "/agent/dashboard/orders" },
        "api",
      );

      res.status(201).json({
        success: true,
        message: "Order placed successfully",
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          bundle: bundle.name,
          quantity,
          customerPhone,
          total: orderTotal,
          status: order.status,
          paymentStatus: order.paymentStatus,
        },
      });
    } catch (err) {
      if (err.message?.startsWith("Insufficient wallet balance")) {
        return res.status(402).json({ success: false, code: "INSUFFICIENT_BALANCE", message: err.message, hint: "Top up your wallet via the dashboard and try again." });
      }
      logger.error(`[marketplace] createOrder: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  // =========================================================================
  // Usage Analytics
  // =========================================================================

  async getUsageStats(req, res) {
    try {
      const stats = await apiUsageService.getStats(req.agentId);
      res.json({ success: true, data: stats });
    } catch (err) {
      logger.error(`[marketplace] getUsageStats: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getUsageLogs(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const skip = (page - 1) * limit;
      const result = await apiUsageService.getLogs(req.agentId, limit, skip);
      res.json({ success: true, data: result.logs, meta: result.meta });
    } catch (err) {
      logger.error(`[marketplace] getUsageLogs: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getAgentDailyCounts(req, res) {
    try {
      const days = Math.min(parseInt(req.query.days) || 7, 90);
      const results = await apiUsageService.getDailyCounts(req.agentId, days);
      res.json({ success: true, data: results });
    } catch (err) {
      logger.error(`[marketplace] getAgentDailyCounts: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }
}

export default new MarketplaceController();
