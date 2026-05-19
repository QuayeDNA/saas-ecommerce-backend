import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import logger from "../utils/logger.js";
import websocketService from "./websocketService.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

function normalizePagination(pagination = {}) {
  const page = Math.max(parseInt(pagination.page || 1, 10), 1);
  const limit = Math.min(Math.max(parseInt(pagination.limit || 20, 10), 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

class AuditLogService {
  async logAction({
    userId,
    userType,
    action,
    category,
    resource = null,
    changes = null,
    metadata = {},
    severity = AUDIT_SEVERITIES.INFO,
    req = null,
    timestamp = null,
  }) {
    try {
      const reqUserId = req?.user?.userId || req?.user?._id;
      const reqUserType = req?.user?.userType;
      const resolvedUserId = toObjectId(userId || reqUserId);
      const resolvedUserType = userType || reqUserType || null;

      const log = await AuditLog.create({
        userId: resolvedUserId,
        userType: resolvedUserType,
        action,
        category,
        resource,
        changes,
        metadata,
        ipAddress: req?.ip || req?.headers?.["x-forwarded-for"] || null,
        userAgent: req?.headers?.["user-agent"] || null,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        severity,
      });

      websocketService.sendAuditLogToAdmins(log);

      return log;
    } catch (error) {
      logger.error(`[AuditLogService] logAction failed: ${error.message}`);
      return null;
    }
  }

  buildFilters(filters = {}) {
    const query = {};

    if (filters.userId) {
      const castedUserId = toObjectId(filters.userId);
      if (castedUserId) query.userId = castedUserId;
    }
    if (filters.userType) query.userType = filters.userType;
    if (filters.action) query.action = filters.action;
    if (filters.category) query.category = filters.category;
    if (filters.severity) query.severity = filters.severity;

    if (filters.startDate || filters.endDate) {
      query.timestamp = {};
      if (filters.startDate) query.timestamp.$gte = new Date(filters.startDate);
      if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
    }

    if (filters.search) {
      query.$or = [
        { action: { $regex: filters.search, $options: "i" } },
        { category: { $regex: filters.search, $options: "i" } },
        { userAgent: { $regex: filters.search, $options: "i" } },
        { ipAddress: { $regex: filters.search, $options: "i" } },
      ];
    }

    return query;
  }

  async getAuditLogs({ filters = {}, pagination = {} } = {}) {
    const { page, limit, skip } = normalizePagination(pagination);
    const query = this.buildFilters(filters);

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "fullName email userType"),
      AuditLog.countDocuments(query),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getUserActivityTimeline(userId, options = {}) {
    const { page, limit, skip } = normalizePagination(options);
    const query = {
      userId: toObjectId(userId),
    };

    if (options.startDate || options.endDate) {
      query.timestamp = {};
      if (options.startDate) query.timestamp.$gte = new Date(options.startDate);
      if (options.endDate) query.timestamp.$lte = new Date(options.endDate);
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
      AuditLog.countDocuments(query),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getRecentActivity(limit = 20) {
    const safeLimit = Math.min(Math.max(parseInt(limit || 20, 10), 1), 100);
    return AuditLog.find({})
      .sort({ timestamp: -1 })
      .limit(safeLimit)
      .populate("userId", "fullName email userType");
  }

  async getAuditStats(dateRange = {}) {
    const dateFilter = {};
    if (dateRange.startDate) dateFilter.$gte = new Date(dateRange.startDate);
    if (dateRange.endDate) dateFilter.$lte = new Date(dateRange.endDate);

    const matchStage =
      Object.keys(dateFilter).length > 0 ? { timestamp: dateFilter } : {};

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      totalLogs,
      byCategory,
      byAction,
      bySeverity,
      dailyTrend,
      recentCritical,
      topUsers,
    ] = await Promise.all([
      AuditLog.countDocuments(matchStage),
      AuditLog.aggregate([
        { $match: matchStage },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      AuditLog.aggregate([
        { $match: matchStage },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      AuditLog.aggregate([
        { $match: matchStage },
        { $group: { _id: "$severity", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      AuditLog.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              year: { $year: "$timestamp" },
              month: { $month: "$timestamp" },
              day: { $dayOfMonth: "$timestamp" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]),
      AuditLog.countDocuments({
        severity: "critical",
        timestamp: { $gte: twentyFourHoursAgo },
      }),
      AuditLog.aggregate([
        { $match: matchStage },
        { $group: { _id: "$userId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            userId: "$_id",
            userName: { $ifNull: ["$user.fullName", "Unknown"] },
            count: 1,
          },
        },
      ]),
    ]);

    return {
      totalLogs,
      byCategory,
      byAction,
      bySeverity,
      dailyTrend,
      recentCritical,
      topUsers,
    };
  }
}

export {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
};

export default new AuditLogService();
