// src/services/webhookService.js
import crypto from "crypto";
import WebhookEndpoint from "../models/WebhookEndpoint.js";
import WebhookDeliveryLog from "../models/WebhookDeliveryLog.js";
import logger from "../utils/logger.js";

class WebhookService {
  /**
   * Generate a secure random secret for webhook signing.
   */
  generateSecret() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Create a new webhook endpoint for an agent.
   */
  async createWebhook(agentId, { url, events, description }) {
    const secret = this.generateSecret();
    const webhook = await WebhookEndpoint.create({
      agentId,
      url,
      secret,
      events,
      description,
    });

    logger.info(`Webhook created for agent ${agentId}: ${webhook._id}`);

    return {
      _id: webhook._id,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
      description: webhook.description,
      secret: webhook.secret, // Return secret only on creation
      createdAt: webhook.createdAt,
    };
  }

  /**
   * Get all webhook endpoints for an agent.
   */
  async getWebhooks(agentId) {
    return WebhookEndpoint.find({ agentId }).select("-secret").sort({ createdAt: -1 });
  }

  /**
   * Get a single webhook endpoint by ID for an agent.
   */
  async getWebhookById(webhookId, agentId) {
    return WebhookEndpoint.findOne({ _id: webhookId, agentId }).select("-secret");
  }

  /**
   * Update a webhook endpoint for an agent.
   */
  async updateWebhook(webhookId, agentId, updates) {
    const webhook = await WebhookEndpoint.findOneAndUpdate(
      { _id: webhookId, agentId },
      { $set: updates },
      { new: true, runValidators: true },
    ).select("-secret");

    if (!webhook) {
      throw new Error("Webhook not found");
    }

    logger.info(`Webhook updated: ${webhookId} (agent: ${agentId})`);
    return webhook;
  }

  /**
   * Delete a webhook endpoint for an agent.
   */
  async deleteWebhook(webhookId, agentId) {
    const webhook = await WebhookEndpoint.findOneAndDelete({ _id: webhookId, agentId });

    if (!webhook) {
      throw new Error("Webhook not found");
    }

    logger.info(`Webhook deleted: ${webhookId} (agent: ${agentId})`);
    return webhook;
  }

  /**
   * Deliver a webhook event.
   */
  async deliverEvent(webhookId, event, payload, attemptNumber = 1) {
    const webhook = await WebhookEndpoint.findById(webhookId).select("+secret");
    if (!webhook || !webhook.active) {
      logger.warn(`Cannot deliver webhook ${webhookId}: webhook not found or inactive`);
      return null;
    }

    const webhookLog = await WebhookDeliveryLog.create({
      webhookId,
      agentId: webhook.agentId,
      event,
      orderId: payload.orderId || null,
      payload,
      url: webhook.url,
      attemptNumber,
      success: false, // Will be updated after attempt
    });

    try {
      const headers = {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
      };

      if (webhook.secret) {
        const signature = crypto
          .createHmac("sha256", webhook.secret)
          .update(JSON.stringify(payload))
          .digest("hex");
        headers["X-Webhook-Signature"] = `sha256=${signature}`;
      }

      const response = await fetch(webhook.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeout: 10000, // 10 seconds
      });

      const responseBody = await response.text();
      let parsedResponse;

      try {
        parsedResponse = JSON.parse(responseBody);
      } catch {
        parsedResponse = responseBody;
      }

      const success = response.status >= 200 && response.status < 300;

      await WebhookDeliveryLog.findByIdAndUpdate(webhookLog._id, {
        statusCode: response.status,
        responseBody: parsedResponse,
        success,
        deliveredAt: new Date(),
      });

      if (success) {
        logger.info(`Webhook delivered successfully: ${webhookId} (${event})`);
      } else {
        logger.warn(`Webhook delivery failed: ${webhookId} (${event}) - Status: ${response.status}`);
      }

      return {
        success,
        statusCode: response.status,
        responseBody: parsedResponse,
        webhookLog,
      };
    } catch (error) {
      logger.error(`Webhook delivery error: ${webhookId} (${event}) - ${error.message}`);

      await WebhookDeliveryLog.findByIdAndUpdate(webhookLog._id, {
        statusCode: 0,
        responseBody: null,
        success: false,
        errorMessage: error.message,
        deliveredAt: new Date(),
      });

      return {
        success: false,
        error: error.message,
        webhookLog,
      };
    }
  }

  /**
   * Deliver webhook event with retry logic.
   */
  async deliverEventWithRetry(webhookId, event, payload, maxAttempts = 3) {
    let lastResult = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.deliverEvent(webhookId, event, payload, attempt);
      lastResult = result;

      if (result.success) {
        return result;
      }

      if (attempt < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return lastResult;
  }

  /**
   * Get webhook delivery logs for an agent.
   */
  async getDeliveryLogs(agentId, webhookId = null, event = null, limit = 50, skip = 0) {
    const filter = { agentId };
    if (webhookId) filter.webhookId = webhookId;
    if (event) filter.event = event;

    const [logs, total] = await Promise.all([
      WebhookDeliveryLog.find(filter)
        .populate("webhookId", "url events")
        .sort({ deliveredAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WebhookDeliveryLog.countDocuments(filter),
    ]);

    return {
      logs,
      meta: {
        total,
        page: Math.floor(skip / limit) + 1,
        limit,
        hasMore: skip + limit < total,
      },
    };
  }

  /**
   * Get all webhook endpoints across all agents (admin).
   */
  async getAllWebhooks({ agentId, page = 1, limit = 50 } = {}) {
    const filter = {};
    if (agentId) filter.agentId = agentId;

    const skip = (page - 1) * limit;

    const [webhooks, total] = await Promise.all([
      WebhookEndpoint.find(filter)
        .select("-secret")
        .populate("agentId", "_id name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WebhookEndpoint.countDocuments(filter),
    ]);

    return {
      webhooks,
      meta: {
        total,
        page,
        limit,
        hasMore: skip + limit < total,
      },
    };
  }

  /**
   * Get a single webhook by ID (admin — no agent scope).
   */
  async getWebhookByIdAdmin(webhookId) {
    return WebhookEndpoint.findById(webhookId)
      .populate("agentId", "_id name email")
      .lean();
  }

  /**
   * Test a webhook endpoint.
   */
  async testWebhook(webhookId, agentId) {
    const webhook = await WebhookEndpoint.findOne({ _id: webhookId, agentId }).select("+secret");
    if (!webhook) {
      throw new Error("Webhook not found");
    }

    const testPayload = {
      test: true,
      timestamp: new Date().toISOString(),
      webhookId: webhookId.toString(),
    };

    return this.deliverEventWithRetry(webhookId, "order.placed", testPayload);
  }
}

export default new WebhookService();
