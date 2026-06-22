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

const ACTION_LABELS = {
  "auth.login": "Login",
  "auth.logout": "Logout",
  "auth.register": "Account Registration",
  "auth.password_change": "Password Change",
  "auth.password_reset": "Password Reset",
  "auth.pin_setup": "PIN Setup",
  "auth.failed_login": "Failed Login Attempt",
  "user.created": "User Created",
  "user.updated": "User Updated",
  "user.status_changed": "Status Changed",
  "user.deleted": "User Deleted",
  "user.impersonated": "User Impersonated",
  "order.created": "Order Created",
  "order.status_updated": "Order Status Updated",
  "order.cancelled": "Order Cancelled",
  "order.reported": "Order Reported",
  "order.bulk_processed": "Bulk Order Processed",
  "wallet.topup_requested": "Top-Up Requested",
  "wallet.topup_approved": "Top-Up Approved",
  "wallet.topup_rejected": "Top-Up Rejected",
  "wallet.credited": "Wallet Credited",
  "wallet.debited": "Wallet Debited",
  "wallet.paystack_initiated": "Paystack Payment Initiated",
  "wallet.paystack_verified": "Paystack Payment Verified",
  "storefront.created": "Storefront Created",
  "storefront.updated": "Storefront Updated",
  "storefront.pricing_updated": "Pricing Updated",
  "storefront.approved": "Storefront Approved",
  "storefront.suspended": "Storefront Suspended",
  "storefront.order_created": "Storefront Order Created",
  "storefront.payment_verified": "Payment Verified",
  "payout.requested": "Payout Requested",
  "payout.approved": "Payout Approved",
  "payout.rejected": "Payout Rejected",
  "payout.completed": "Payout Completed",
  "payout.failed": "Payout Failed",
  "settings.updated": "Settings Updated",
  "bundle.created": "Bundle Created",
  "bundle.updated": "Bundle Updated",
  "bundle.deleted": "Bundle Deleted",
  "referral.commission_calculated": "Commission Calculated",
  "referral.commission_credited": "Commission Credited",
  "referral.commission_cancelled": "Commission Cancelled",
  "referral.commission_withdrawn": "Commission Withdrawn",
};

const CATEGORY_LABELS = {
  auth: "Authentication",
  user: "User Management",
  order: "Orders",
  wallet: "Wallet",
  storefront: "Storefront",
  payout: "Payouts",
  settings: "Settings",
  bundle: "Bundles",
  referral: "Referral",
  api_key: "API Key Management",
};

function getActionLabel(action) {
  return ACTION_LABELS[action] || action.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category;
}

function generateDescription(log) {
  const { action, metadata = {} } = log;

  const DESCRIPTIONS = {
    "auth.login": "User logged in successfully",
    "auth.logout": "User logged out",
    "auth.register": "User registered a new account",
    "auth.password_change": "User changed their password",
    "auth.password_reset": "User reset their password",
    "auth.pin_setup": "User set up their transaction PIN",
    "auth.failed_login": "User unsuccessfully logged in",
    "user.created": "User account was created",
    "user.updated": "User profile was updated",
    "user.status_changed": "User account status was changed",
    "user.deleted": "User account was deleted",
    "user.impersonated": "User account was accessed by an admin",
    "order.created": "User placed a new order",
    "order.status_updated": "Order status was updated",
    "order.cancelled": "User cancelled an order",
    "order.reported": "User reported an issue with an order",
    "order.bulk_processed": "Bulk order processing was completed",
    "wallet.topup_requested": "User requested a wallet top up",
    "wallet.topup_approved": "Wallet top up request was approved",
    "wallet.topup_rejected": "Wallet top up request was rejected",
    "wallet.credited": "Wallet was credited",
    "wallet.debited": "Wallet was debited",
    "wallet.paystack_initiated": "User initiated a Paystack payment",
    "wallet.paystack_verified": "Paystack payment was verified successfully",
    "storefront.created": "User created a storefront",
    "storefront.updated": "User updated their storefront",
    "storefront.pricing_updated": "Storefront pricing was updated",
    "storefront.approved": "Storefront was approved",
    "storefront.suspended": "Storefront was suspended",
    "storefront.order_created": "A storefront order was placed",
    "storefront.payment_verified": "Storefront payment was verified",
    "payout.requested": "User requested a payout",
    "payout.approved": "Payout request was approved",
    "payout.rejected": "Payout request was rejected",
    "payout.completed": "Payout was completed successfully",
    "payout.failed": "Payout failed",
    "settings.updated": "User updated their settings",
    "bundle.created": "A new bundle was created",
    "bundle.updated": "A bundle was updated",
    "bundle.deleted": "A bundle was deleted",
    "referral.commission_calculated": "Referral commission was calculated",
    "referral.commission_credited": "Referral commission was credited",
    "referral.commission_cancelled": "Referral commission was cancelled",
    "referral.commission_withdrawn": "Referral commission was withdrawn",
  };

  let desc = DESCRIPTIONS[action] || getActionLabel(action);

  if (metadata.amount) {
    const unit = metadata.unit || metadata.currency || "";
    const amountStr = `${metadata.amount}${unit ? " " + unit : ""}`;

    if (action === "wallet.topup_requested") {
      desc = `User requested ${amountStr} wallet top up`;
    } else if (action === "wallet.topup_approved") {
      desc = `Wallet top up of ${amountStr} was approved`;
    } else if (action === "wallet.topup_rejected") {
      desc = `Wallet top up of ${amountStr} was rejected`;
    } else if (action === "wallet.credited") {
      desc = `Wallet was credited with ${amountStr}`;
    } else if (action === "wallet.debited") {
      desc = `Wallet was debited by ${amountStr}`;
    } else if (["payout.requested", "payout.approved", "payout.rejected", "payout.completed", "payout.failed"].includes(action)) {
      desc = desc.replace(/a payout/, `a payout of ${amountStr}`);
    }
  }

  if (metadata.method) {
    desc += ` via ${metadata.method}`;
  } else if (metadata.source) {
    desc += ` via ${metadata.source}`;
  }

  if (metadata.storefrontName) {
    if (action === "storefront.created") {
      desc = `User created a storefront "${metadata.storefrontName}"`;
    } else if (action.startsWith("storefront.")) {
      desc += ` for "${metadata.storefrontName}"`;
    }
  }

  if (log.changes && log.changes.after && log.changes.after.status && action === "order.status_updated") {
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
