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

function dayFilterToDateRange(dayFilter) {
  if (!dayFilter || dayFilter === "all") return null;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (dayFilter) {
    case "today":
      return { start, end };
    case "yesterday":
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      return { start, end };
    case "2daysago":
      start.setDate(start.getDate() - 2);
      end.setDate(end.getDate() - 2);
      return { start, end };
    default:
      return null;
  }
}

function formatTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const ACTION_LABELS = {};

const CATEGORY_LABELS = {};

function getActionLabel(action) {
  return ACTION_LABELS[action] || action.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category;
}

function generateDescription(log) {
  const { action, metadata = {} } = log;

  const DESCRIPTIONS = {
    "Login": "User logged in successfully",
    "Logout": "User logged out",
    "Account Registration": "User registered a new account",
    "Password Change": "User changed their password",
    "Password Reset": "User reset their password",
    "PIN Setup": "User set up their transaction PIN",
    "Failed Login Attempt": "User unsuccessfully logged in",
    "User Created": "User account was created",
    "User Updated": "User profile was updated",
    "Status Changed": "User account status was changed",
    "User Deleted": "User account was deleted",
    "User Impersonated": "User account was accessed by an admin",
    "Order Created": "User placed a new order",
    "Order Status Updated": "Order status was updated",
    "Order Cancelled": "User cancelled an order",
    "Order Reported": "User reported an issue with an order",
    "Bulk Order Processed": "Bulk order processing was completed",
    "Wallet Top-up Requested": "User requested a wallet top up",
    "Wallet Top-up Approved": "Wallet top up request was approved",
    "Wallet Top-up Rejected": "Wallet top up request was rejected",
    "Wallet Credited": "Wallet was credited",
    "Wallet Debited": "Wallet was debited",
    "Paystack Payment Initiated": "User initiated a Paystack payment",
    "Paystack Payment Verified": "Paystack payment was verified successfully",
    "Storefront Created": "User created a storefront",
    "Storefront Updated": "User updated their storefront",
    "Pricing Updated": "Storefront pricing was updated",
    "Storefront Approved": "Storefront was approved",
    "Storefront Suspended": "Storefront was suspended",
    "Storefront Order Created": "A storefront order was placed",
    "Payment Verified": "Storefront payment was verified",
    "Payout Requested": "User requested a payout",
    "Payout Approved": "Payout request was approved",
    "Payout Rejected": "Payout request was rejected",
    "Payout Completed": "Payout was completed successfully",
    "Payout Failed": "Payout failed",
    "Settings Updated": "User updated their settings",
    "Bundle Created": "A new bundle was created",
    "Bundle Updated": "A bundle was updated",
    "Bundle Deleted": "A bundle was deleted",
    "Commission Calculated": "Referral commission was calculated",
    "Commission Credited": "Referral commission was credited",
    "Commission Cancelled": "Referral commission was cancelled",
    "Commission Withdrawn": "Referral commission was withdrawn",
  };

  let desc = DESCRIPTIONS[action] || action;

  if (metadata.amount) {
    const unit = metadata.unit || metadata.currency || "";
    const amountStr = `${metadata.amount}${unit ? " " + unit : ""}`;

    if (action === "Wallet Top-up Requested") {
      desc = `User requested ${amountStr} wallet top up`;
    } else if (action === "Wallet Top-up Approved") {
      desc = `Wallet top up of ${amountStr} was approved`;
    } else if (action === "Wallet Top-up Rejected") {
      desc = `Wallet top up of ${amountStr} was rejected`;
    } else if (action === "Wallet Credited") {
      desc = `Wallet was credited with ${amountStr}`;
    } else if (action === "Wallet Debited") {
      desc = `Wallet was debited by ${amountStr}`;
    } else if (["Payout Requested", "Payout Approved", "Payout Rejected", "Payout Completed", "Payout Failed"].includes(action)) {
      desc = desc.replace(/a payout/, `a payout of ${amountStr}`);
    }
  }

  if (metadata.method) {
    desc += ` via ${metadata.method}`;
  } else if (metadata.source) {
    desc += ` via ${metadata.source}`;
  }

  if (metadata.storefrontName) {
    if (action === "Storefront Created") {
      desc = `User created a storefront "${metadata.storefrontName}"`;
    } else if (action === "Storefront Updated" || action === "Storefront Approved" || action === "Storefront Suspended" || action === "Pricing Updated") {
      desc += ` for "${metadata.storefrontName}"`;
    }
  }

  if (log.changes && log.changes.after && log.changes.after.status && action === "Order Status Updated") {
    desc = `Order status changed to "${log.changes.after.status}"`;
  }

  return desc;
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

    const range = dayFilterToDateRange(options.dayFilter);
    const effectiveStart = options.startDate || range?.start;
    const effectiveEnd = options.endDate || range?.end;

    if (effectiveStart || effectiveEnd) {
      query.timestamp = {};
      if (effectiveStart) query.timestamp.$gte = new Date(effectiveStart);
      if (effectiveEnd) query.timestamp.$lte = new Date(effectiveEnd);
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "fullName email userType"),
      AuditLog.countDocuments(query),
    ]);

    const formattedLogs = logs.map((log) => {
      const user =
        log.userId && typeof log.userId === "object"
          ? { fullName: log.userId.fullName || "", email: log.userId.email || "" }
          : { fullName: "", email: "" };

      return {
        _id: log._id,
        user,
        action: getActionLabel(log.action),
        category: getCategoryLabel(log.category),
        severity: log.severity,
        time: formatTime(log.timestamp),
        date: formatDate(log.timestamp),
        timestamp: log.timestamp,
        description: generateDescription(log),
        raw: {
          metadata: log.metadata || {},
          changes: log.changes || null,
          resource: log.resource || null,
          ipAddress: log.ipAddress || "",
          userAgent: log.userAgent || "",
        },
      };
    });

    return {
      logs: formattedLogs,
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
