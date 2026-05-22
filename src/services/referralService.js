import mongoose from "mongoose";
import User from "../models/User.js";
import Commission from "../models/Commission.js";
import Order from "../models/Order.js";
import logger from "../utils/logger.js";

class ReferralService {
  async getDashboard(userId) {
    const user = await User.findById(userId).select(
      "referralCode commissionBalance walletBalance fullName",
    );
    if (!user) throw new Error("User not found");

    const [referredCount, activeReferredCount, commissionAgg] =
      await Promise.all([
        User.countDocuments({ referredBy: userId }),
        Order.distinct("createdBy", {
          createdBy: {
            $in: await User.find({ referredBy: userId }).distinct("_id"),
          },
          status: "completed",
        }),
        Commission.aggregate([
          { $match: { referrer: new mongoose.Types.ObjectId(userId) } },
          {
            $group: {
              _id: null,
              totalEarned: {
                $sum: { $cond: [{ $eq: ["$status", "credited"] }, "$amount", 0] },
              },
              pendingAmount: {
                $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] },
              },
            },
          },
        ]),
      ]);

    const proto = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = process.env.FRONTEND_URL || `${proto}://localhost:5173`;
    const shareLink = `${host}/register?ref=${user.referralCode}`;

    const earnings = commissionAgg[0] || { totalEarned: 0, pendingAmount: 0 };

    return {
      referralCode: user.referralCode,
      shareLink,
      totalReferred: referredCount,
      activeReferred: activeReferredCount.length,
      totalCommissionsEarned: earnings.totalEarned,
      pendingCommissions: earnings.pendingAmount,
      commissionBalance: user.commissionBalance,
      walletBalance: user.walletBalance,
    };
  }

  async getLeaderboard(timeframe = "all-time", limit = 20) {
    const match = { status: "credited" };

    if (timeframe !== "all-time") {
      const now = new Date();
      let startDate;
      if (timeframe === "this-month") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (timeframe === "this-quarter") {
        const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), quarterStartMonth, 1);
      } else if (timeframe === "this-week") {
        const day = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - day);
        startDate.setHours(0, 0, 0, 0);
      }
      if (startDate) match.createdAt = { $gte: startDate };
    }

    const leaderboard = await Commission.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$referrer",
          commissionsEarned: { $sum: "$amount" },
          totalOrders: { $sum: "$ordersCount" },
          totalReferred: { $sum: "$qualifiedUsersCount" },
          batchCount: { $sum: 1 },
        },
      },
      { $sort: { commissionsEarned: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "referrer",
        },
      },
      { $unwind: "$referrer" },
      {
        $project: {
          _id: 0,
          referrerId: "$referrer._id",
          fullName: "$referrer.fullName",
          referralCode: "$referrer.referralCode",
          commissionsEarned: 1,
          totalOrders: 1,
          totalReferred: 1,
          batchCount: 1,
        },
      },
    ]);

    return leaderboard;
  }

  async getReferralTree(userId, depth = 2) {
    const buildLevel = async (parentId, remainingDepth) => {
      if (remainingDepth <= 0) return [];

      const children = await User.find({ referredBy: parentId })
        .select("_id fullName email phone referralCode")
        .lean();

      const result = [];
      for (const child of children) {
        const grandChildren = await buildLevel(child._id, remainingDepth - 1);
        result.push({ user: child, children: grandChildren });
      }
      return result;
    };

    return buildLevel(userId, depth);
  }

  async getAdminStats() {
    const referrerUserIds = await User.find({
      referredBy: { $exists: true, $ne: null },
    }).distinct("referredBy");

    const totalReferrers = referrerUserIds.length;

    const allReferredUserIds = await User.find({
      referredBy: { $exists: true, $ne: null },
    }).distinct("_id");

    const [commissionAgg, referredUserCount, referredWithOrdersCount] =
      await Promise.all([
        Commission.aggregate([
          { $match: { status: "credited" } },
          {
            $group: {
              _id: null,
              totalCommissionsPaid: { $sum: "$amount" },
              totalOrdersFromReferrals: { $sum: "$ordersCount" },
              totalBatches: { $sum: 1 },
              uniqueReferrers: { $addToSet: "$referrer" },
            },
          },
        ]),
        User.countDocuments({ referredBy: { $exists: true, $ne: null } }),
        Order.distinct("createdBy", {
          createdBy: { $in: allReferredUserIds },
        }),
      ]);

    const commissionData = commissionAgg[0] || {
      totalCommissionsPaid: 0,
      totalOrdersFromReferrals: 0,
      totalBatches: 0,
      uniqueReferrers: [],
    };

    const activeReferrers = commissionData.uniqueReferrers?.length || 0;
    const referredWithOrders = referredWithOrdersCount.length;
    const conversionRate =
      referredUserCount > 0 ? referredWithOrders / referredUserCount : 0;

    return {
      totalReferrers,
      activeReferrers,
      totalCommissionsPaid: commissionData.totalCommissionsPaid,
      totalOrdersFromReferrals: commissionData.totalOrdersFromReferrals,
      totalBatches: commissionData.totalBatches,
      totalReferred: referredUserCount,
      referredWithOrders,
      referralConversionRate: Math.round(conversionRate * 10000) / 100,
    };
  }

  async getAdminUsers(filters = {}, pagination = {}) {
    const { search, status, sortBy = "createdAt", sortOrder = -1 } = filters;
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const query = {
      referredBy: { $exists: true, $ne: null },
    };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { referralCode: { $regex: search, $options: "i" } },
      ];
    }

    if (status) {
      query.status = status;
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select("fullName email phone referralCode referredBy status createdAt walletBalance commissionBalance")
        .populate("referredBy", "fullName email referralCode")
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    const userIds = users.map((u) => u._id);

    const commissionStats = await Commission.aggregate([
      { $match: { referrer: { $in: userIds } } },
      {
        $group: {
          _id: "$referrer",
          totalEarned: {
            $sum: { $cond: [{ $eq: ["$status", "credited"] }, "$amount", 0] },
          },
          totalOrders: { $sum: "$ordersCount" },
          batchCount: { $sum: 1 },
        },
      },
    ]);

    const statsMap = {};
    for (const s of commissionStats) {
      statsMap[s._id.toString()] = s;
    }

    const enriched = users.map((u) => {
      const stats = statsMap[u._id.toString()] || {
        totalEarned: 0,
        totalOrders: 0,
        batchCount: 0,
      };
      return {
        ...u,
        commissionStats: {
          totalEarned: stats.totalEarned,
          totalOrders: stats.totalOrders,
          batchCount: stats.batchCount,
        },
      };
    });

    return {
      users: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }
}

export default new ReferralService();
