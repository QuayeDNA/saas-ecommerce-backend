import mongoose from "mongoose";
import Commission from "../models/Commission.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import Settings from "../models/Settings.js";
import notificationService from "./notificationService.js";
import websocketService from "./websocketService.js";
import logger from "../utils/logger.js";
import { logAuditAction } from "../utils/auditLogger.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

class CommissionService {
  async creditOrderCommission(orderId) {
    const order = await Order.findById(orderId);
    if (!order) {
      logger.warn(`[CommissionService] Order ${orderId} not found`);
      return null;
    }

    if (order.status !== "completed") {
      logger.warn(
        `[CommissionService] Order ${orderId} status is ${order.status}, not completed`,
      );
      return null;
    }

    // Early idempotency check — avoids Settings/User lookups on duplicate calls
    const alreadyCredited = await Commission.exists({ order: orderId });
    if (alreadyCredited) return null;

    const settings = await Settings.getInstance();
    if (!settings.referralProgramEnabled) {
      logger.info(
        "[CommissionService] Referral program disabled, skipping commission",
      );
      return null;
    }

    const rate = settings.referralCommissionPercent ?? 5.0;

    const creator = await User.findById(order.createdBy);
    if (!creator || !creator.referredBy) {
      return null;
    }

    const amount = (order.total * rate) / 100;
    if (amount <= 0) return null;

    const dateKey = order.createdAt.toISOString().slice(0, 10);

    try {
      await Commission.create({
        referrer: creator.referredBy,
        order: order._id,
        amount,
        rate,
        date: dateKey,
        status: "credited",
        creditedAt: new Date(),
      });

      await User.findByIdAndUpdate(creator.referredBy, {
        $inc: { commissionBalance: amount },
      });

      const referrer = await User.findById(creator.referredBy);

      await logAuditAction({
        userId: creator.referredBy,
        performedBy: creator.referredBy,
        action: AUDIT_ACTIONS.REFERRAL_COMMISSION_CREDITED,
        category: AUDIT_CATEGORIES.REFERRAL,
        severity: AUDIT_SEVERITIES.INFO,
        description: `Commission of ${amount} credited to referrer for order ${order._id}`,
        metadata: {
          referrer: creator.referredBy,
          order: order._id,
          amount,
          rate,
          orderTotal: order.total,
        },
        ip: null,
        userAgent: null,
      });

      try {
        await notificationService.createInAppNotification(
          creator.referredBy.toString(),
          "Commission Earned!",
          `You earned GHS ${amount.toFixed(2)} commission from an order by your referral. Current commission balance: GHS ${(referrer?.commissionBalance ?? 0).toFixed(2)}.`,
          "success",
          {
            type: "order_commission",
            amount,
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
          },
        );
      } catch (notifError) {
        logger.error(
          `[CommissionService] Failed to send commission notification: ${notifError.message}`,
        );
      }

      try {
        websocketService.sendWalletUpdateToUser(
          creator.referredBy.toString(),
          {
            commissionBalance: referrer?.commissionBalance ?? amount,
          },
        );
      } catch (wsError) {
        logger.error(
          `[CommissionService] Failed to send wallet update: ${wsError.message}`,
        );
      }

      logger.info(
        `[CommissionService] Commission of ${amount} credited to referrer ${creator.referredBy} for order ${order._id}`,
      );

      return { referrer: creator.referredBy, amount, order: order._id };
    } catch (err) {
      if (err.code === 11000) {
        logger.debug(
          `[CommissionService] Commission already exists for order ${order._id} (race condition), skipping`,
        );
        return null;
      }
      logger.error(
        `[CommissionService] Error crediting commission for order ${order._id}: ${err.message}`,
      );
      throw err;
    }
  }

  async withdrawCommission(userId, amount) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    if (amount <= 0) {
      throw new Error("Amount must be greater than zero");
    }
    if (user.commissionBalance < amount) {
      throw new Error("Insufficient commission balance");
    }

    user.commissionBalance -= amount;
    user.walletBalance += amount;
    await user.save();

    const reference = `CMW${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    await WalletTransaction.create({
      user: userId,
      type: "credit",
      amount,
      balanceAfter: user.walletBalance,
      description: "Commission withdrawal — transferred from commission wallet",
      status: "completed",
      reference,
      metadata: { type: "commission_withdrawal" },
    });

    await logAuditAction({
      userId,
      performedBy: userId,
      action: AUDIT_ACTIONS.REFERRAL_COMMISSION_WITHDRAWN,
      category: AUDIT_CATEGORIES.REFERRAL,
      severity: AUDIT_SEVERITIES.INFO,
      description: `Commission withdrawal of ${amount} transferred to main wallet`,
      metadata: {
        amount,
        commissionBalanceAfter: user.commissionBalance,
        walletBalanceAfter: user.walletBalance,
      },
      ip: null,
      userAgent: null,
    });

    try {
      await notificationService.createInAppNotification(
        userId.toString(),
        "Commission Withdrawn",
        `GHS ${amount.toFixed(2)} transferred from commission wallet to main wallet. New commission balance: GHS ${user.commissionBalance.toFixed(2)}.`,
        "success",
        {
          type: "commission_withdrawal",
          amount,
          commissionBalance: user.commissionBalance,
          walletBalance: user.walletBalance,
        },
      );
    } catch (notifError) {
      logger.error(
        `[CommissionService] Failed to send withdrawal notification: ${notifError.message}`,
      );
    }

    try {
      websocketService.sendWalletUpdateToUser(userId.toString(), {
        balance: user.walletBalance,
        commissionBalance: user.commissionBalance,
      });
    } catch (wsError) {
      logger.error(
        `[CommissionService] Failed to send wallet update: ${wsError.message}`,
      );
    }

    return {
      amount,
      commissionBalance: user.commissionBalance,
      walletBalance: user.walletBalance,
    };
  }

  async getCommissionBalance(userId) {
    const user = await User.findById(userId).select("commissionBalance walletBalance");
    if (!user) {
      throw new Error("User not found");
    }
    return {
      commissionBalance: user.commissionBalance,
      walletBalance: user.walletBalance,
    };
  }

  async getUserCommissions(userId, filters = {}, pagination = {}) {
    try {
      const isAdmin = filters.isAdmin;
      const query = {};
      if (userId) query.referrer = userId;

      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }

      const page = pagination.page || 1;
      const limit = pagination.limit || 20;
      const skip = (page - 1) * limit;

      let commissionsQuery = Commission.find(query)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit);

      if (isAdmin) {
        commissionsQuery = commissionsQuery.populate("referrer", "fullName email agentCode");
      }

      const [commissions, total] = await Promise.all([
        commissionsQuery,
        Commission.countDocuments(query),
      ]);

      return {
        commissions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error(
        `[CommissionService] Error getting user commissions: ${error.message}`,
      );
      throw error;
    }
  }

  async getCommissionStats(userId) {
    try {
      const [aggregation] = await Commission.aggregate([
        { $match: { referrer: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            totalCommissions: { $sum: 1 },
            totalEarned: {
              $sum: { $cond: [{ $eq: ["$status", "credited"] }, "$amount", 0] },
            },
            creditedCount: {
              $sum: { $cond: [{ $eq: ["$status", "credited"] }, 1, 0] },
            },
          },
        },
      ]);

      return {
        totalCommissions: aggregation?.totalCommissions || 0,
        totalEarned: aggregation?.totalEarned || 0,
        totalPending: 0,
        pendingCount: 0,
        creditedCount: aggregation?.creditedCount || 0,
      };
    } catch (error) {
      logger.error(
        `[CommissionService] Error getting commission stats: ${error.message}`,
      );
      throw error;
    }
  }

  async cancelCommission(commissionId, adminId) {
    try {
      const commission = await Commission.findById(commissionId);
      if (!commission) {
        throw new Error("Commission not found");
      }

      if (commission.status === "cancelled") {
        throw new Error("Commission is already cancelled");
      }

      if (commission.status === "credited") {
        await User.findByIdAndUpdate(commission.referrer, {
          $inc: { commissionBalance: -commission.amount },
        });
      }

      commission.status = "cancelled";
      commission.cancelledAt = new Date();
      await commission.save();

      await logAuditAction({
        userId: commission.referrer,
        performedBy: adminId,
        action: AUDIT_ACTIONS.REFERRAL_COMMISSION_CANCELLED,
        category: AUDIT_CATEGORIES.REFERRAL,
        severity: AUDIT_SEVERITIES.WARNING,
        description: `Commission ${commission._id} cancelled by admin`,
        metadata: {
          commissionId: commission._id,
          referrerId: commission.referrer,
          orderId: commission.order,
          date: commission.date,
          amount: commission.amount,
          previousStatus: commission.status,
        },
        ip: null,
        userAgent: null,
      });

      return commission;
    } catch (error) {
      logger.error(
        `[CommissionService] Error cancelling commission ${commissionId}: ${error.message}`,
      );
      throw error;
    }
  }

  async getWithdrawalHistory(userId, pagination = {}) {
    try {
      const page = pagination.page || 1;
      const limit = pagination.limit || 20;
      const skip = (page - 1) * limit;

      const query = {
        "metadata.type": "commission_withdrawal",
      };
      if (userId) query.user = userId;

      let txQuery = WalletTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      if (pagination.isAdmin) {
        txQuery = txQuery.populate("user", "fullName email");
      }

      const [transactions, total] = await Promise.all([
        txQuery.lean(),
        WalletTransaction.countDocuments(query),
      ]);

      return {
        withdrawals: transactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error(
        `[CommissionService] Error getting withdrawal history: ${error.message}`,
      );
      throw error;
    }
  }
}

export default new CommissionService();
