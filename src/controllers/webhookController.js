// src/controllers/webhookController.js
import webhookService from "../services/webhookService.js";
import logger from "../utils/logger.js";

class WebhookController {
  /**
   * Create a new webhook endpoint.
   */
  async createWebhook(req, res) {
    try {
      const { url, events, description } = req.body;

      if (!url || typeof url !== "string") {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Webhook URL is required",
        });
      }

      const webhook = await webhookService.createWebhook(req.agentId, {
        url,
        events,
        description,
      });

      res.status(201).json({
        success: true,
        message: "Webhook endpoint created successfully",
        data: webhook,
      });
    } catch (err) {
      logger.error(`[webhook] createWebhook: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  /**
   * Get all webhook endpoints for the agent.
   */
  async getWebhooks(req, res) {
    try {
      const webhooks = await webhookService.getWebhooks(req.agentId);
      res.json({
        success: true,
        data: webhooks,
      });
    } catch (err) {
      logger.error(`[webhook] getWebhooks: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  /**
   * Get a single webhook endpoint.
   */
  async getWebhook(req, res) {
    try {
      const webhook = await webhookService.getWebhookById(req.params.id, req.agentId);

      if (!webhook) {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: "Webhook endpoint not found",
        });
      }

      res.json({
        success: true,
        data: webhook,
      });
    } catch (err) {
      logger.error(`[webhook] getWebhook: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  /**
   * Update a webhook endpoint.
   */
  async updateWebhook(req, res) {
    try {
      const updates = req.body;
      const webhook = await webhookService.updateWebhook(req.params.id, req.agentId, updates);

      if (!webhook) {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: "Webhook endpoint not found",
        });
      }

      res.json({
        success: true,
        message: "Webhook endpoint updated successfully",
        data: webhook,
      });
    } catch (err) {
      logger.error(`[webhook] updateWebhook: ${err.message}`);
      if (err.message === "Webhook not found") {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: err.message,
        });
      }
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  /**
   * Delete a webhook endpoint.
   */
  async deleteWebhook(req, res) {
    try {
      const webhook = await webhookService.deleteWebhook(req.params.id, req.agentId);

      if (!webhook) {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: "Webhook endpoint not found",
        });
      }

      res.json({
        success: true,
        message: "Webhook endpoint deleted successfully",
        data: { _id: webhook._id },
      });
    } catch (err) {
      logger.error(`[webhook] deleteWebhook: ${err.message}`);
      if (err.message === "Webhook not found") {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          message: err.message,
        });
      }
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  /**
   * Test a webhook endpoint.
   */
  async testWebhook(req, res) {
    try {
      const result = await webhookService.testWebhook(req.params.id, req.agentId);

      res.json({
        success: true,
        message: "Webhook test completed",
        data: {
          success: result.success,
          statusCode: result.statusCode,
          responseBody: result.responseBody,
          error: result.error,
        },
      });
    } catch (err) {
      logger.error(`[webhook] testWebhook: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }

  /**
   * Get webhook delivery logs.
   */
  async getDeliveryLogs(req, res) {
    try {
      const { webhookId, event, limit = 50, page = 1 } = req.query;
      const skip = (page - 1) * limit;

      const result = await webhookService.getDeliveryLogs(
        req.agentId,
        webhookId || null,
        event || null,
        Math.min(parseInt(limit) || 50, 200),
        skip,
      );

      res.json({
        success: true,
        data: result.logs,
        meta: result.meta,
      });
    } catch (err) {
      logger.error(`[webhook] getDeliveryLogs: ${err.message}`);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
    }
  }
}

export default new WebhookController();
