// src/services/apiKeyService.js
import bcrypt from "bcrypt";
import crypto from "crypto";
import ApiKey from "../models/ApiKey.js";
import logger from "../utils/logger.js";

const SALT_ROUNDS = 10;
const KEY_BYTES = 32;
const PREFIX = ApiKey.API_KEY_PREFIX;

class ApiKeyService {
  /**
   * Generate a new API key for an agent.
   * Returns { rawKey, apiKey } where rawKey is shown once and apiKey is the saved document.
   */
  async generateKey(agentId, label, permissions) {
    const rawKey = PREFIX + crypto.randomBytes(KEY_BYTES).toString("hex");
    const keyHash = await bcrypt.hash(rawKey, SALT_ROUNDS);
    const keyPrefix = rawKey.substring(0, PREFIX.length + 8);

    const resolvedPermissions =
      permissions && permissions.length > 0
        ? permissions
        : [...ApiKey.VALID_PERMISSIONS];

    const apiKey = await ApiKey.create({
      agentId,
      label,
      keyHash,
      keyPrefix,
      permissions: resolvedPermissions,
    });

    logger.info(`API key created for agent ${agentId}: ${keyPrefix}...`);

    return { rawKey, apiKey };
  }

  /**
   * Validate a raw API key string.
   * Returns the ApiKey document if valid, null otherwise.
   */
  async validateKey(rawKey) {
    if (!rawKey || typeof rawKey !== "string") return null;

    const prefix = rawKey.substring(0, PREFIX.length);
    if (prefix !== PREFIX) return null;

    const allKeys = await ApiKey.find({ status: "active" }).lean();

    for (const key of allKeys) {
      const match = await bcrypt.compare(rawKey, key.keyHash);
      if (match) {
        if (key.expiresAt && key.expiresAt < new Date()) {
          logger.warn(`Expired API key used: ${key.keyPrefix}...`);
          return null;
        }
        return key;
      }
    }

    return null;
  }

  /**
   * Revoke an API key by its ID. Only the owning agent can revoke.
   */
  async revokeKey(keyId, agentId) {
    const key = await ApiKey.findOne({ _id: keyId, agentId });
    if (!key) throw new Error("API key not found");
    if (key.status === "revoked") throw new Error("API key is already revoked");

    key.status = "revoked";
    await key.save();

    logger.info(`API key revoked: ${key.keyPrefix}... (agent: ${agentId})`);
    return key;
  }

  /**
   * List all API keys for an agent (excluding the hash).
   */
  async listAgentKeys(agentId) {
    return ApiKey.find({ agentId })
      .select("-keyHash")
      .sort({ createdAt: -1 });
  }

  /**
   * Get a single API key by ID for an agent.
   */
  async getKeyById(keyId, agentId) {
    const filter = { _id: keyId };
    if (agentId) filter.agentId = agentId;
    return ApiKey.findOne(filter).select("-keyHash");
  }

  /**
   * Get a single API key by ID (admin — no agent scope).
   */
  async getKeyByIdAdmin(keyId) {
    return ApiKey.findById(keyId)
      .select("-keyHash")
      .populate("agentId", "name email userType");
  }

  /**
   * Update last used timestamp for a key.
   */
  async touchKey(keyId) {
    await ApiKey.findByIdAndUpdate(keyId, { lastUsedAt: new Date() });
  }

  // =========================================================================
  // Admin methods (super_admin operations across all agents)
  // =========================================================================

  /**
   * List all API keys across all agents with optional filters.
   * Admin-only — bypasses agent scoping.
   */
  async listAllKeys({ status, agentId, search, page = 1, limit = 50 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (agentId) filter.agentId = agentId;
    if (search) {
      filter.$or = [
        { label: { $regex: search, $options: "i" } },
        { keyPrefix: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const [keys, total] = await Promise.all([
      ApiKey.find(filter)
        .select("-keyHash")
        .populate("agentId", "name email userType")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ApiKey.countDocuments(filter),
    ]);

    return {
      keys,
      meta: {
        total,
        page,
        limit,
        hasMore: skip + limit < total,
      },
    };
  }

  /**
   * Suspend an API key (admin operation — no agent scope check).
   */
  async suspendKey(keyId) {
    const key = await ApiKey.findById(keyId);
    if (!key) throw new Error("API key not found");
    if (key.status === "revoked") throw new Error("Cannot suspend a revoked key");
    if (key.status === "suspended") throw new Error("API key is already suspended");

    key.status = "suspended";
    await key.save();
    logger.info(`API key suspended by admin: ${key.keyPrefix}...`);
    return key;
  }

  /**
   * Activate a suspended API key (admin operation).
   */
  async activateKey(keyId) {
    const key = await ApiKey.findById(keyId);
    if (!key) throw new Error("API key not found");
    if (key.status === "revoked") throw new Error("Cannot activate a revoked key");
    if (key.status === "active") throw new Error("API key is already active");

    key.status = "active";
    await key.save();
    logger.info(`API key activated by admin: ${key.keyPrefix}...`);
    return key;
  }

  /**
   * Revoke any API key by ID (admin operation — no agent scope check).
   */
  async revokeKeyById(keyId) {
    const key = await ApiKey.findById(keyId);
    if (!key) throw new Error("API key not found");
    if (key.status === "revoked") throw new Error("API key is already revoked");

    key.status = "revoked";
    await key.save();
    logger.info(`API key revoked by admin: ${key.keyPrefix}...`);
    return key;
  }

  /**
   * Get aggregate key stats for admin dashboard.
   */
  async getAggregateStats() {
    const [total, active, suspended, revoked] = await Promise.all([
      ApiKey.countDocuments(),
      ApiKey.countDocuments({ status: "active" }),
      ApiKey.countDocuments({ status: "suspended" }),
      ApiKey.countDocuments({ status: "revoked" }),
    ]);

    return { total, active, suspended, revoked };
  }

  /**
   * Revoke all active/suspended keys for a given agent (admin operation).
   * Returns the count of keys revoked.
   */
  async revokeAllAgentKeys(agentId) {
    const result = await ApiKey.updateMany(
      { agentId, status: { $in: ["active", "suspended"] } },
      { $set: { status: "revoked" } },
    );
    logger.info(`All API keys revoked for agent ${agentId}: ${result.modifiedCount} keys`);
    return result.modifiedCount;
  }
}

export default new ApiKeyService();
