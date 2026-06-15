// src/services/apiUsageService.js
import mongoose from "mongoose";
import ApiUsageLog from "../models/ApiUsageLog.js";
import logger from "../utils/logger.js";

class ApiUsageService {
  /**
   * Log an API request to the usage log.
   */
  async logRequest({ apiKeyId, agentId, method, path, statusCode, responseTimeMs, ip, userAgent }) {
    try {
      await ApiUsageLog.create({
        apiKeyId,
        agentId,
        method,
        path,
        statusCode,
        responseTimeMs,
        ip: ip || "",
        userAgent: userAgent || "",
        timestamp: new Date(),
      });
    } catch (err) {
      logger.error(`[ApiUsageService] Failed to log request: ${err.message}`);
    }
  }

  /**
   * Get usage stats for an agent: total requests today, error count, avg latency.
   */
  async getStats(agentId) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [stats] = await ApiUsageLog.aggregate([
      {
        $match: {
          agentId: mongoose.Types.ObjectId.isValid(agentId)
            ? new mongoose.Types.ObjectId(agentId)
            : agentId,
          timestamp: { $gte: todayStart },
        },
      },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          errorCount: {
            $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
          },
          avgLatency: { $avg: "$responseTimeMs" },
        },
      },
    ]);

    return {
      totalRequests: stats?.totalRequests || 0,
      errorCount: stats?.errorCount || 0,
      avgLatency: Math.round(stats?.avgLatency || 0),
      errorRate: stats?.totalRequests
        ? Number(((stats.errorCount / stats.totalRequests) * 100).toFixed(2))
        : 0,
    };
  }

  /**
   * Get recent usage logs for an agent with pagination.
   * Returns logs array + meta { total, page, limit, hasMore }.
   */
  async getLogs(agentId, limit = 50, skip = 0) {
    const [logs, total] = await Promise.all([
      ApiUsageLog.find({ agentId })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ApiUsageLog.countDocuments({ agentId }),
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

  // =========================================================================
  // Admin methods (cross-agent aggregation)
  // =========================================================================

  /**
   * Get usage stats across all agents (admin view).
   * Optionally filter by agentId.
   */
  async getAllStats(agentId = null) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const match = { timestamp: { $gte: todayStart } };
    if (agentId) match.agentId = mongoose.Types.ObjectId.isValid(agentId)
      ? new mongoose.Types.ObjectId(agentId)
      : agentId;

    const [stats] = await ApiUsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          errorCount: { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
          avgLatency: { $avg: "$responseTimeMs" },
        },
      },
    ]);

    return {
      totalRequests: stats?.totalRequests || 0,
      errorCount: stats?.errorCount || 0,
      avgLatency: Math.round(stats?.avgLatency || 0),
      errorRate: stats?.totalRequests
        ? Number(((stats.errorCount / stats.totalRequests) * 100).toFixed(2))
        : 0,
    };
  }

  /**
   * Get paginated usage logs across all agents (admin view).
   */
  async getAllLogs(limit = 50, skip = 0, agentId = null) {
    const filter = {};
    if (agentId) filter.agentId = agentId;

    const [logs, total] = await Promise.all([
      ApiUsageLog.find(filter)
        .populate("apiKeyId", "keyPrefix label")
        .populate("agentId", "name email")
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ApiUsageLog.countDocuments(filter),
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
   * Get per-agent usage summary for admin dashboard.
   * Supports pagination with skip/limit (or top N for backward compat).
   */
  async getAgentUsageSummary({ limit = 10, skip = 0, top } = {}) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // If `top` is provided, use simple limit (backward compat for top-N widget)
    if (top !== undefined) {
      const results = await ApiUsageLog.aggregate([
        { $match: { timestamp: { $gte: todayStart } } },
        {
          $group: {
            _id: "$agentId",
            totalRequests: { $sum: 1 },
            errorCount: { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
            avgLatency: { $avg: "$responseTimeMs" },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            pipeline: [
              { $project: { name: 1, email: 1, userType: 1, _id: 0 } },
            ],
            as: "agent",
          },
        },
        { $unwind: { path: "$agent", preserveNullAndEmptyArrays: true } },
        { $sort: { totalRequests: -1 } },
        { $limit: top },
      ]);
      return results;
    }

    // Paginated mode: use $facet for total + data
    const pipeline = [
      { $match: { timestamp: { $gte: todayStart } } },
      {
        $group: {
          _id: "$agentId",
          totalRequests: { $sum: 1 },
          errorCount: { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
          avgLatency: { $avg: "$responseTimeMs" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          pipeline: [
            { $project: { name: 1, email: 1, userType: 1, _id: 0 } },
          ],
          as: "agent",
        },
      },
      { $unwind: { path: "$agent", preserveNullAndEmptyArrays: true } },
      { $sort: { totalRequests: -1 } },
    ];

    const facetResults = await ApiUsageLog.aggregate([
      ...pipeline,
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const total = facetResults[0]?.metadata[0]?.total || 0;
    const data = facetResults[0]?.data || [];
    return { data, total };
  }

  /**
   * Get daily request counts across all agents (or per agent) over the last N days.
   */
  async getDailyCounts(agentId = null, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const match = { timestamp: { $gte: since } };
    if (agentId) match.agentId = mongoose.Types.ObjectId.isValid(agentId)
      ? new mongoose.Types.ObjectId(agentId)
      : agentId;

    const results = await ApiUsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
          },
          count: { $sum: 1 },
          avgLatency: { $avg: "$responseTimeMs" },
          errors: {
            $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return results;
  }
}

export default new ApiUsageService();
