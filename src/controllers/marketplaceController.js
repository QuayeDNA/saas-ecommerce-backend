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

function requireDashboardAccess(req, res) {
  if (req.apiKey) {
    res.status(403).json({
      success: false,
      code: "FORBIDDEN",
      message: "This endpoint requires dashboard access. Use the BryteLinks dashboard to manage API keys and view usage analytics.",
    });
    return false;
  }
  return true;
}

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
          { scope: "orders:read", description: "Query orders (view order status and details)" },
          { scope: "orders:write", description: "Place orders via the API (deducts from wallet)" },
          { scope: "wallet:read", description: "Read wallet balance and check top-up status" },
          { scope: "wallet:topup", description: "Initiate wallet top-up via Paystack" },
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
          {
            method: "GET",
            path: "/api/marketplace/orders",
            description: "List orders (paginated). Query: { status, page, limit }",
            auth: true,
            scopes: ["orders:read"],
          },
          {
            method: "GET",
            path: "/api/marketplace/orders/:id",
            description: "Get a single order by ID",
            auth: true,
            scopes: ["orders:read"],
          },
          {
            method: "POST",
            path: "/api/marketplace/keys",
            description: "Create a new API key (dashboard only)",
            auth: false,
          },
          {
            method: "GET",
            path: "/api/marketplace/keys",
            description: "List all API keys (dashboard only)",
            auth: false,
          },
          {
            method: "GET",
            path: "/api/marketplace/keys/:id",
            description: "Get a single API key (dashboard only)",
            auth: false,
          },
          {
            method: "PATCH",
            path: "/api/marketplace/keys/:id",
            description: "Update API key label (dashboard only)",
            auth: false,
          },
          {
            method: "POST",
            path: "/api/marketplace/keys/:id/revoke",
            description: "Revoke an API key (dashboard only)",
            auth: false,
          },
          {
            method: "POST",
            path: "/api/marketplace/keys/:id/suspend",
            description: "Suspend an API key (dashboard only)",
            auth: false,
          },
          {
            method: "POST",
            path: "/api/marketplace/keys/:id/activate",
            description: "Activate a suspended API key (dashboard only)",
            auth: false,
          },
          {
            method: "POST",
            path: "/api/marketplace/keys/:id/regenerate",
            description: "Regenerate an API key (dashboard only)",
            auth: false,
          },
          {
            method: "PATCH",
            path: "/api/marketplace/keys/:id/expiry",
            description: "Set API key expiration (dashboard only)",
            auth: false,
          },
          {
            method: "PATCH",
            path: "/api/marketplace/keys/:id/permissions",
            description: "Update API key permissions (dashboard only)",
            auth: false,
          },
          {
            method: "GET",
            path: "/api/marketplace/usage/stats",
            description: "Get usage statistics (dashboard only)",
            auth: false,
          },
          {
            method: "GET",
            path: "/api/marketplace/usage/logs",
            description: "Get usage logs (dashboard only)",
            auth: false,
          },
          {
            method: "GET",
            path: "/api/marketplace/usage/daily-counts",
            description: "Get daily usage counts (dashboard only)",
            auth: false,
          },
          {
            method: "GET",
            path: "/api/marketplace/wallet/balance",
            description: "Get wallet balance and currency",
            auth: true,
            scopes: ["wallet:read"],
          },
          {
            method: "POST",
            path: "/api/marketplace/wallet/topup",
            description: "Initiate a wallet top-up via Paystack. Body: { amount }",
            auth: true,
            scopes: ["wallet:topup"],
          },
          {
            method: "GET",
            path: "/api/marketplace/wallet/topup/:reference",
            description: "Check the status of a top-up by reference",
            auth: true,
            scopes: ["wallet:read"],
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
    if (!requireDashboardAccess(req, res)) return;
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
    if (!requireDashboardAccess(req, res)) return;
    try {
      const keys = await apiKeyService.listAgentKeys(req.agentId);
      res.json({ success: true, data: keys });
    } catch (err) {
      logger.error(`[marketplace] listKeys: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

    async revokeKey(req, res) {
    if (!requireDashboardAccess(req, res)) return;
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
  // Agent Key Management (additional endpoints for agents)
  // =========================================================================

  async getKey(req, res) {
    if (!requireDashboardAccess(req, res)) return;
    try {
      const key = await apiKeyService.getKeyByIdAgent(req.params.id, req.agentId);

      if (!key) {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      res.json({
        success: true,
        data: key,
      });
    } catch (err) {
      logger.error(`[marketplace] getKey: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  async updateKeyLabel(req, res) {
    if (!requireDashboardAccess(req, res)) return;
    try {
      const { label } = req.body;
      if (!label || typeof label !== "string" || label.trim().length === 0) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Label is required",
        });
      }
      if (label.length > 50) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Label must be 50 characters or less",
        });
      }

      const key = await apiKeyService.updateKeyLabel(req.params.id, req.agentId, label.trim());

      notificationService.createInAppNotification(
        req.agentId,
        "API Key Updated",
        `Your API key "${key.label}" has been updated`,
        "success",
        { type: "api_update", navigationLink: "/agent/dashboard/api-marketplace" },
        "api",
      );

      res.json({
        success: true,
        message: "API key label updated successfully",
        data: { _id: key._id, label: key.label },
      });
    } catch (err) {
      if (err.message === "API key not found") {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: err.message,
        });
      }
      logger.error(`[marketplace] updateKeyLabel: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  async suspendKey(req, res) {
    if (!requireDashboardAccess(req, res)) return;
    try {
      const key = await apiKeyService.suspendKeyAgent(req.params.id, req.agentId);

      notificationService.createInAppNotification(
        req.agentId,
        "API Key Suspended",
        `Your API key "${key.label}" has been suspended`,
        "warning",
        { type: "api_update", navigationLink: "/agent/dashboard/api-marketplace" },
        "api",
      );

      res.json({
        success: true,
        message: "API key suspended successfully",
        data: { _id: key._id, keyPrefix: key.keyPrefix, status: key.status },
      });
    } catch (err) {
      if (err.message === "API key not found") {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: err.message,
        });
      }
      if (err.message.includes("already")) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: err.message,
        });
      }
      logger.error(`[marketplace] suspendKey: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  async activateKey(req, res) {
    if (!requireDashboardAccess(req, res)) return;
    try {
      const key = await apiKeyService.activateKeyAgent(req.params.id, req.agentId);

      notificationService.createInAppNotification(
        req.agentId,
        "API Key Activated",
        `Your API key "${key.label}" has been activated`,
        "success",
        { type: "api_update", navigationLink: "/agent/dashboard/api-marketplace" },
        "api",
      );

      res.json({
        success: true,
        message: "API key activated successfully",
        data: { _id: key._id, keyPrefix: key.keyPrefix, status: key.status },
      });
    } catch (err) {
      if (err.message === "API key not found") {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: err.message,
        });
      }
      if (err.message.includes("already")) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: err.message,
        });
      }
      logger.error(`[marketplace] activateKey: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  async regenerateKey(req, res) {
    if (!requireDashboardAccess(req, res)) return;
    try {
      const { rawKey, apiKey } = await apiKeyService.regenerateKey(req.agentId, req.params.id);

      notificationService.createInAppNotification(
        req.agentId,
        "API Key Regenerated",
        `Your API key has been regenerated. The new key is: ${apiKey.keyPrefix}...`,
        "warning",
        { type: "api_update", navigationLink: "/agent/dashboard/api-marketplace" },
        "api",
      );

      res.json({
        success: true,
        message: "API key regenerated successfully",
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
      if (err.message === "API key not found") {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: err.message,
        });
      }
      if (err.message.includes("already")) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: err.message,
        });
      }
      logger.error(`[marketplace] regenerateKey: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  async setKeyExpiration(req, res) {
    if (!requireDashboardAccess(req, res)) return;
    try {
      const { expiresAt } = req.body;
      if (!expiresAt) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "expiresAt is required",
        });
      }

      const key = await apiKeyService.setKeyExpiration(req.params.id, req.agentId, new Date(expiresAt));

      res.json({
        success: true,
        message: "API key expiration updated successfully",
        data: { _id: key._id, expiresAt: key.expiresAt },
      });
    } catch (err) {
      if (err.message === "API key not found") {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: err.message,
        });
      }
      logger.error(`[marketplace] setKeyExpiration: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  async updateKeyPermissions(req, res) {
    if (!requireDashboardAccess(req, res)) return;
    try {
      const { permissions } = req.body;
      if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "permissions is required and must be a non-empty array",
        });
      }

      const key = await apiKeyService.updateKeyPermissions(req.params.id, req.agentId, permissions);

      notificationService.createInAppNotification(
        req.agentId,
        "API Key Permissions Updated",
        `Your API key "${key.label}" permissions have been updated`,
        "success",
        { type: "api_update", navigationLink: "/agent/dashboard/api-marketplace" },
        "api",
      );

      res.json({
        success: true,
        message: "API key permissions updated successfully",
        data: { _id: key._id, permissions: key.permissions },
      });
    } catch (err) {
      if (err.message === "API key not found") {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: err.message,
        });
      }
      if (err.message.includes("Invalid permissions")) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: err.message,
        });
      }
      logger.error(`[marketplace] updateKeyPermissions: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
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

      // Trigger webhook delivery for order.placed event
      try {
        await this.triggerOrderWebhook(req.agentId, order, "order.placed");
      } catch (webhookError) {
        logger.warn(`[marketplace] Failed to trigger webhook for order ${order.orderNumber}: ${webhookError.message}`);
      }

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
  // Order Query Endpoints
  // =========================================================================

  async getOrders(req, res) {
    try {
      const { status, page = 1, limit = 50 } = req.query;
      const filter = { tenantId: req.agentId };

      if (status) {
        const statuses = status.split(",");
        filter.status = { $in: statuses };
      }

      const skip = (page - 1) * limit;

      const [orders, total] = await Promise.all([
        Order.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Math.min(parseInt(limit) || 50, 200))
          .lean(),
        Order.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: orders,
        meta: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: skip + parseInt(limit) < total,
        },
      });
    } catch (err) {
      logger.error(`[marketplace] getOrders: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  async getOrderById(req, res) {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({
          success: false,
          code: "INVALID_ID",
          message: "Invalid order ID",
        });
      }

      const order = await Order.findOne({
        _id: req.params.id,
        tenantId: req.agentId,
      }).lean();

      if (!order) {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      res.json({
        success: true,
        data: order,
      });
    } catch (err) {
      logger.error(`[marketplace] getOrderById: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  // =========================================================================
  // Webhook Delivery
  // =========================================================================

  async triggerOrderWebhook(agentId, order, event) {
    try {
      const WebhookEndpoint = (await import("../models/WebhookEndpoint.js")).default;
      const webhookService = (await import("../services/webhookService.js")).default;

      const webhooks = await WebhookEndpoint.find({ agentId, active: true });

      if (webhooks.length === 0) {
        return;
      }

      const payload = {
        event,
        timestamp: new Date().toISOString(),
        order: {
          id: order._id.toString(),
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          customerPhone: order.items[0]?.customerPhone || null,
          bundleName: order.items[0]?.packageDetails?.name || null,
          quantity: order.items[0]?.quantity || 1,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        },
        agentId: agentId.toString(),
      };

      for (const webhook of webhooks) {
        try {
          if (webhook.secret) {
            await webhookService.deliverEventWithRetry(webhook._id, event, payload);
          }
        } catch (error) {
          logger.warn(`[marketplace] Failed to deliver webhook to ${webhook.url}: ${error.message}`);
        }
      }
    } catch (err) {
      logger.error(`[marketplace] triggerOrderWebhook: ${err.message}`);
    }
  }

  // =========================================================================
  // Usage Analytics
  // =========================================================================

  async getUsageStats(req, res) {
    if (!requireDashboardAccess(req, res)) return;
    try {
      const stats = await apiUsageService.getStats(req.agentId);
      res.json({ success: true, data: stats });
    } catch (err) {
      logger.error(`[marketplace] getUsageStats: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getUsageLogs(req, res) {
    if (!requireDashboardAccess(req, res)) return;
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
    if (!requireDashboardAccess(req, res)) return;
    try {
      const days = Math.min(parseInt(req.query.days) || 7, 90);
      const results = await apiUsageService.getDailyCounts(req.agentId, days);
      res.json({ success: true, data: results });
    } catch (err) {
      logger.error(`[marketplace] getAgentDailyCounts: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  // =========================================================================
  // Per-Key Usage Analytics
  // =========================================================================

  async getPerKeyStats(req, res) {
    if (!requireDashboardAccess(req, res)) return;
    try {
      const stats = await apiUsageService.getPerKeyStats(req.agentId);
      res.json({
        success: true,
        data: stats,
      });
    } catch (err) {
      logger.error(`[marketplace] getPerKeyStats: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  // =========================================================================
  // Wallet Endpoints (for API consumers)
  // =========================================================================

  async getWalletBalance(req, res) {
    try {
      const user = await User.findById(req.agentId).select("walletBalance currency");
      if (!user) {
        return res.status(401).json({ success: false, code: "INVALID_KEY", message: "Authenticated user not found" });
      }
      res.json({
        success: true,
        data: {
          balance: user.walletBalance || 0,
          currency: user.currency || "GHS",
        },
      });
    } catch (err) {
      logger.error(`[marketplace] getWalletBalance: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async initiateTopup(req, res) {
    try {
      const { amount } = req.body;
      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "A valid amount is required" });
      }

      const walletService = (await import("../services/walletService.js")).default;

      const result = await walletService.initiatePaystackTopUp(req.agentId, parseFloat(amount), null);

      res.json({
        success: true,
        message: "Paystack checkout ready",
        data: {
          reference: result.reference,
          accessCode: result.accessCode,
          authorizationUrl: result.authorizationUrl,
          publicKey: result.publicKey,
          amount: result.amount,
          chargeAmount: result.chargeAmount,
          targetCreditAmount: result.targetCreditAmount,
          feesDelegate: result.feesDelegate,
        },
      });
    } catch (err) {
      logger.error(`[marketplace] initiateTopup: ${err.message}`);
      if (err.response?.status === 401 || /401/.test(err.message)) {
        return res.status(502).json({ success: false, code: "PAYSTACK_ERROR", message: "Payment gateway configuration error" });
      }
      res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: err.message });
    }
  }

  async getTopupStatus(req, res) {
    try {
      const { reference } = req.params;
      if (!reference) {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "Reference is required" });
      }

      const paystackService = (await import("../services/paystackService.js")).default;
      const payment = await paystackService.verifyTransaction(reference);

      res.json({
        success: true,
        data: {
          reference: payment.reference,
          status: payment.status,
          amount: payment.amount,
          credited: payment.credited || false,
          paidAt: payment.paidAt || null,
        },
      });
    } catch (err) {
      logger.error(`[marketplace] getTopupStatus: ${err.message}`);
      res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: err.message });
    }
  }
}

export default new MarketplaceController();
