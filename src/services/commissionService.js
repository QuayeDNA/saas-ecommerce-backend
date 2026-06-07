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
  async processDailyCommissions(dateStr) {
    const targetDate = dateStr
      ? new Date(dateStr + "T00:00:00.000Z")
      : new Date(new Date().toDateString());

    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const dateKey = startOfDay.toISOString().slice(0, 10);

    const settings = await Settings.getInstance();
    if (!settings.referralProgramEnabled) {
      logger.info(
        "[CommissionService] Referral program is disabled, skipping daily batch",
      );
      return { processed: 0, message: "Referral program is disabled", date: dateKey };
    }

    const minAmount = settings.minOrderAmountForCommission ?? 0;
    const rate = settings.referralCommissionPercent ?? 5.0;
    const cap = settings.referralCommissionCap ?? 0;

    // Step 1: group by (referrer, referredUser) — per-user daily totals
    const perUserGroups = await Order.aggregate([
      {
        $match: {
          status: "completed",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "creator",
        },
      },
      { $unwind: "$creator" },
      {
        $match: {
          "creator.referredBy": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: {
            referrer: "$creator.referredBy",
            referredUser: "$createdBy",
          },
          userTotal: { $sum: "$total" },
          userOrderCount: { $sum: 1 },
        },
      },
    ]);

    if (perUserGroups.length === 0) {
      logger.info(
        `[CommissionService] No eligible orders found for ${dateKey}`,
      );
      return { processed: 0, message: "No eligible orders found", date: dateKey };
    }

    // Step 2: per-referred-user min check + commission calc, aggregate by referrer
    const referrerMap = new Map();

    for (const group of perUserGroups) {
      const referrerId = group._id.referrer.toString();
      const userTotal = group.userTotal;

      if (minAmount > 0 && userTotal < minAmount) {
        logger.info(
          `[CommissionService] Referred user ${group._id.referredUser} total ${userTotal} below minimum ${minAmount}, skipping`,
        );
        continue;
      }

      const userCommission = (userTotal * rate) / 100;
      if (userCommission <= 0) continue;

      if (!referrerMap.has(referrerId)) {
        referrerMap.set(referrerId, {
          totalCommission: 0,
          totalOrders: 0,
          qualifiedUsers: 0,
          batchTotal: 0,
        });
      }

      const entry = referrerMap.get(referrerId);
      entry.totalCommission += userCommission;
      entry.totalOrders += group.userOrderCount;
      entry.qualifiedUsers++;
      entry.batchTotal += userTotal;
    }

    if (referrerMap.size === 0) {
      logger.info(
        `[CommissionService] No referrers met the minimum threshold for ${dateKey}`,
      );
      return { processed: 0, message: "No referrers met minimum threshold", date: dateKey };
    }

    // Check which referrers already have a Commission doc for this date
    const existingDocs = await Commission.find({
      date: dateKey,
      referrer: { $in: [...referrerMap.keys()].map(id => new mongoose.Types.ObjectId(id)) },
    }).select("referrer").lean();
    const existingReferrerSet = new Set(existingDocs.map(c => c.referrer.toString()));

    let credited = 0;
    let skipped = 0;

    for (const [referrerId, data] of referrerMap) {
      try {
        if (existingReferrerSet.has(referrerId)) {
          logger.info(`[CommissionService] Commission already exists for referrer ${referrerId} on ${dateKey}, skipping`);
          skipped++;
          continue;
        }

        // Step 3: apply cap per referrer for the day
        let amount = data.totalCommission;
        if (cap > 0 && amount > cap) {
          amount = cap;
        }

        // Step 4: create Commission record + credit commissionBalance
        await Commission.create({
          referrer: referrerId,
          date: dateKey,
          amount,
          rate,
          batchTotal: data.batchTotal,
          ordersCount: data.totalOrders,
          qualifiedUsersCount: data.qualifiedUsers,
          status: "credited",
          creditedAt: new Date(),
        });

        await User.findByIdAndUpdate(referrerId, {
          $inc: { commissionBalance: amount },
        });

        await logAuditAction({
          userId: referrerId,
          performedBy: referrerId,
          action: AUDIT_ACTIONS.REFERRAL_COMMISSION_CREDITED,
          category: AUDIT_CATEGORIES.REFERRAL,
          severity: AUDIT_SEVERITIES.INFO,
          description: `Daily commission of ${amount} credited to referrer ${referrerId} for ${dateKey}`,
          metadata: {
            referrerId,
            date: dateKey,
            amount,
            rate,
            batchTotal: data.batchTotal,
            ordersCount: data.totalOrders,
            qualifiedUsersCount: data.qualifiedUsers,
          },
          ip: null,
          userAgent: null,
        });

        try {
          const referrer = await User.findById(referrerId);
          await notificationService.createInAppNotification(
            referrerId.toString(),
            "Daily Commission Earned!",
            `You earned GHS ${amount.toFixed(2)} in commissions today (${dateKey}) from ${data.qualifiedUsers} referred user(s) who met the minimum order threshold. Current commission balance: GHS ${(referrer?.commissionBalance ?? 0).toFixed(2)}.`,
            "success",
            {
              type: "daily_commission",
              amount,
              date: dateKey,
              qualifiedUsers: data.qualifiedUsers,
              batchTotal: data.batchTotal,
            },
          );
        } catch (notifError) {
          logger.error(
            `[CommissionService] Failed to send daily commission notification: ${notifError.message}`,
          );
        }

        credited++;
      } catch (err) {
        logger.error(
          `[CommissionService] Error processing referrer ${referrerId}: ${err.message}`,
        );
        skipped++;
      }
    }

    logger.info(
      `[CommissionService] Daily batch for ${dateKey}: ${credited} credited, ${skipped} skipped`,
    );

    return {
      processed: credited,
      skipped,
      message: `Processed ${credited} commission(s) for ${dateKey}`,
      date: dateKey,
    };
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
