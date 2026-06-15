import logger from "../utils/logger.js";
import apiKeyService from "../services/apiKeyService.js";
import apiUsageService from "../services/apiUsageService.js";
import apiRateLimiter from "../services/apiRateLimiter.js";
import notificationService from "../services/notificationService.js";

class AdminMarketplaceController {
  // =========================================================================
  // Key Management (admin — all agents)
  // =========================================================================

  async listAllKeys(req, res) {
    try {
      const { status, agentId, search, page, limit } = req.query;
      const result = await apiKeyService.listAllKeys({
        status,
        agentId,
        search,
        page: parseInt(page) || 1,
        limit: Math.min(parseInt(limit) || 50, 200),
      });

      const minimal = result.keys.map((key) => ({
        _id: key._id,
        agent: key.agentId
          ? {
              _id: key.agentId._id || key.agentId,
              name: key.agentId.name || null,
              email: key.agentId.email || null,
              userType: key.agentId.userType || null,
            }
          : null,
        label: key.label,
        keyPrefix: key.keyPrefix,
        status: key.status,
        createdAt: key.createdAt,
      }));

      res.json({ success: true, data: minimal, meta: result.meta });
    } catch (err) {
      logger.error(`[adminMarketplace] listAllKeys: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getKeyById(req, res) {
    try {
      const key = await apiKeyService.getKeyByIdAdmin(req.params.id);
      if (!key) {
        return res.status(404).json({ success: false, code: "NOT_FOUND", message: "API key not found" });
      }
      res.json({ success: true, data: key });
    } catch (err) {
      logger.error(`[adminMarketplace] getKeyById: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async revokeKey(req, res) {
    try {
      const key = await apiKeyService.revokeKeyById(req.params.id);

      notificationService.createInAppNotification(
        key.agentId,
        "API Key Revoked",
        `Your API key "${key.label}" has been revoked by an admin`,
        "error",
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
      logger.error(`[adminMarketplace] revokeKey: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async suspendKey(req, res) {
    try {
      const key = await apiKeyService.suspendKey(req.params.id);

      notificationService.createInAppNotification(
        key.agentId,
        "API Key Suspended",
        `Your API key "${key.label}" has been suspended by an admin`,
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
        return res.status(404).json({ success: false, code: "NOT_FOUND", message: err.message });
      }
      if (err.message.includes("already") || err.message.includes("Cannot")) {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: err.message });
      }
      logger.error(`[adminMarketplace] suspendKey: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async activateKey(req, res) {
    try {
      const key = await apiKeyService.activateKey(req.params.id);

      notificationService.createInAppNotification(
        key.agentId,
        "API Key Reactivated",
        `Your API key "${key.label}" has been reactivated by an admin`,
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
        return res.status(404).json({ success: false, code: "NOT_FOUND", message: err.message });
      }
      if (err.message.includes("already") || err.message.includes("Cannot")) {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: err.message });
      }
      logger.error(`[adminMarketplace] activateKey: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  // =========================================================================
  // Usage Analytics (admin — cross-agent)
  // =========================================================================

  async getAggregateStats(req, res) {
    try {
      const { agentId } = req.query;
      const [usageStats, keyStats] = await Promise.all([
        apiUsageService.getAllStats(agentId || null),
        agentId ? null : apiKeyService.getAggregateStats(),
      ]);
      res.json({
        success: true,
        data: {
          usage: usageStats,
          keys: keyStats || null,
        },
      });
    } catch (err) {
      logger.error(`[adminMarketplace] getAggregateStats: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getUsageLogs(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const skip = (page - 1) * limit;
      const { agentId } = req.query;
      const result = await apiUsageService.getAllLogs(limit, skip, agentId || null);
      res.json({ success: true, data: result.logs, meta: result.meta });
    } catch (err) {
      logger.error(`[adminMarketplace] getUsageLogs: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getAgentUsageSummary(req, res) {
    try {
      const topN = parseInt(req.query.top);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const skip = (page - 1) * limit;

      if (topN) {
        const results = await apiUsageService.getAgentUsageSummary({ top: Math.min(topN, 50) });
        return res.json({ success: true, data: results });
      }

      const { data, total } = await apiUsageService.getAgentUsageSummary({ limit, skip });
      const totalPages = Math.ceil(total / limit);
      res.json({
        success: true,
        data,
        meta: { total, page, limit, hasMore: page < totalPages },
      });
    } catch (err) {
      logger.error(`[adminMarketplace] getAgentUsageSummary: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  async getDailyCounts(req, res) {
    try {
      const days = Math.min(parseInt(req.query.days) || 30, 365);
      const { agentId } = req.query;
      const results = await apiUsageService.getDailyCounts(agentId || null, days);
      res.json({ success: true, data: results });
    } catch (err) {
      logger.error(`[adminMarketplace] getDailyCounts: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }

  // =========================================================================
  // Rate Limit Configuration
  // =========================================================================

  async getRateLimitConfig(req, res) {
    res.json({
      success: true,
      data: {
        defaultLimit: apiRateLimiter._defaultLimit,
        windowMs: apiRateLimiter._windowMs,
        description: `Rate limit is configured per API key. Default: ${apiRateLimiter._defaultLimit.toLocaleString()} requests per ${(apiRateLimiter._windowMs / 1000).toLocaleString()}-second window.`,
      },
    });
  }

  async updateRateLimitConfig(req, res) {
    try {
      const { defaultLimit, windowMs } = req.body;

      if (defaultLimit === undefined && windowMs === undefined) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Provide at least one of: defaultLimit, windowMs",
        });
      }

      apiRateLimiter.updateConfig({ defaultLimit, windowMs });

      logger.info(`[adminMarketplace] Rate limit config updated: defaultLimit=${apiRateLimiter._defaultLimit}, windowMs=${apiRateLimiter._windowMs}`);

      res.json({
        success: true,
        message: "Rate limit configuration updated",
        data: {
          defaultLimit: apiRateLimiter._defaultLimit,
          windowMs: apiRateLimiter._windowMs,
        },
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: err.message,
      });
    }
  }

  async revokeAllAgentKeys(req, res) {
    try {
      const { agentId } = req.params;
      if (!agentId) {
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "agentId is required" });
      }

      const count = await apiKeyService.revokeAllAgentKeys(agentId);

      notificationService.createInAppNotification(
        agentId,
        "API Keys Revoked",
        `All your API keys have been revoked by an admin`,
        "error",
        { type: "api_update", navigationLink: "/agent/dashboard/api-marketplace" },
        "api",
      );

      res.json({
        success: true,
        message: `${count} API key(s) revoked for agent`,
        data: { revokedCount: count },
      });
    } catch (err) {
      logger.error(`[adminMarketplace] revokeAllAgentKeys: ${err.message}`);
      res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
    }
  }
}

export default new AdminMarketplaceController();
