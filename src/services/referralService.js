import mongoose from "mongoose";
import User from "../models/User.js";
import Commission from "../models/Commission.js";
import Order from "../models/Order.js";

class ReferralService {
  async getDashboard(userId) {
    const user = await User.findById(userId).select(
      "referralCode commissionBalance walletBalance fullName",
    );
    if (!user) throw new Error("User not found");

    const [referredCount, activeReferredCount, commissionAgg] =
      await Promise.all([
        User.countDocuments({ referredBy: userId }),
        Order.aggregate([
          { $match: { status: "completed" } },
          {
            $lookup: {
              from: "users",
              localField: "createdBy",
              foreignField: "_id",
              as: "creator",
            },
          },
          { $unwind: "$creator" },
          { $match: { "creator.referredBy": new mongoose.Types.ObjectId(userId) } },
          { $group: { _id: "$createdBy" } },
        ]),
        Commission.aggregate([
          { $match: { referrer: new mongoose.Types.ObjectId(userId) } },
          {
            $group: {
              _id: null,
              totalEarned: {
                $sum: { $cond: [{ $eq: ["$status", "credited"] }, "$amount", 0] },
              },
            },
          },
        ]),
      ]);

    const proto = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = process.env.FRONTEND_URL || `${proto}://localhost:5173`;
    const shareLink = `${host}/register?ref=${user.referralCode}`;

    const earnings = commissionAgg[0] || { totalEarned: 0 };

    return {
      referralCode: user.referralCode,
      shareLink,
      totalReferred: referredCount,
      activeReferred: activeReferredCount.length,
      totalCommissionsEarned: earnings.totalEarned,
      pendingCommissions: 0,
      commissionBalance: user.commissionBalance,
      walletBalance: user.walletBalance,
    };
  }

  async getLeaderboard(timeframe = "all-time", page = 1, limit = 20) {
    const match = {};

    if (timeframe !== "all-time" && timeframe !== "all") {
      const now = new Date();
      let startDate;
      if (timeframe === "this-month" || timeframe === "monthly") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (timeframe === "this-quarter") {
        const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), quarterStartMonth, 1);
      } else if (timeframe === "this-week" || timeframe === "weekly") {
        const day = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - day);
        startDate.setHours(0, 0, 0, 0);
      }
      if (startDate) match.createdAt = { $gte: startDate };
    }

    const allReferrerIds = await User.distinct("referredBy", {
      referredBy: { $exists: true, $ne: null },
    });

    if (allReferrerIds.length === 0) {
      return { entries: [], pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
    }

    const [referralCounts, commissionAgg] = await Promise.all([
      User.aggregate([
        { $match: { referredBy: { $in: allReferrerIds } } },
        { $group: { _id: "$referredBy", count: { $sum: 1 } } },
      ]),
      Commission.aggregate([
        { $match: { referrer: { $in: allReferrerIds }, status: "credited", ...match } },
        {
          $group: {
            _id: "$referrer",
            commissionsEarned: { $sum: "$amount" },
            totalOrders: { $sum: "$ordersCount" },
            batchCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const countMap = {};
    for (const r of referralCounts) {
      countMap[r._id.toString()] = r.count;
    }

    const commissionMap = {};
    for (const c of commissionAgg) {
      commissionMap[c._id.toString()] = c;
    }

    const referrerUsers = await User.find({ _id: { $in: allReferrerIds } })
      .select("fullName referralCode")
      .lean();

    let entries = referrerUsers
      .map((u) => ({
        referrerId: u._id,
        fullName: u.fullName,
        referralCode: u.referralCode,
        commissionsEarned: commissionMap[u._id.toString()]?.commissionsEarned || 0,
        totalOrders: commissionMap[u._id.toString()]?.totalOrders || 0,
        totalReferred: countMap[u._id.toString()] || 0,
        batchCount: commissionMap[u._id.toString()]?.batchCount || 0,
      }))
      .filter((e) => e.totalReferred > 0);

    entries.sort((a, b) => b.totalReferred - a.totalReferred);

    const total = entries.length;
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;
    const paginated = entries.slice(skip, skip + limit);

    return {
      entries: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async getReferralTree(userId, depth = 2) {
    const [result] = await User.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(userId) } },
      {
        $graphLookup: {
          from: "users",
          startWith: "$_id",
          connectFromField: "_id",
          connectToField: "referredBy",
          maxDepth: depth - 1,
          depthField: "level",
          as: "descendants",
        },
      },
      {
        $project: {
          descendants: {
            _id: 1,
            fullName: 1,
            email: 1,
            phone: 1,
            referralCode: 1,
            createdAt: 1,
            referredBy: 1,
            level: 1,
          },
        },
      },
    ]);

    if (!result) return [];

    const descendants = result.descendants || [];

    const allDescendantIds = descendants.map((d) => d._id);
    const orderCounts = await Order.aggregate([
      { $match: { createdBy: { $in: allDescendantIds } } },
      { $group: { _id: "$createdBy", count: { $sum: 1 } } },
    ]);
    const orderMap = {};
    for (const o of orderCounts) {
      orderMap[o._id.toString()] = o.count;
    }

    const injectOrders = (nodes) =>
      nodes.map((d) => ({
        user: {
          _id: d._id,
          fullName: d.fullName,
          email: d.email,
          phone: d.phone,
          referralCode: d.referralCode,
          createdAt: d.createdAt,
          totalOrders: orderMap[d._id.toString()] || 0,
        },
        children: [],
      }));

    const buildTree = (parentId, currentDepth) => {
      if (currentDepth >= depth) return [];
      return descendants
        .filter((d) => d.referredBy && d.referredBy.toString() === parentId.toString())
        .map((d) => ({
          user: {
            _id: d._id,
            fullName: d.fullName,
            email: d.email,
            phone: d.phone,
            referralCode: d.referralCode,
            createdAt: d.createdAt,
            totalOrders: orderMap[d._id.toString()] || 0,
          },
          children: buildTree(d._id, currentDepth + 1),
        }));
    };

    const tree = buildTree(userId, 0);
    if (tree.length === 0) return [];

    return tree;
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
        .select("fullName email phone referralCode referredBy status createdAt")
        .populate("referredBy", "fullName email referralCode")
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    const userIds = users.map((u) => u._id);
    const orderCounts = await Order.aggregate([
      { $match: { createdBy: { $in: userIds } } },
      { $group: { _id: "$createdBy", count: { $sum: 1 } } },
    ]);
    const orderCountMap = {};
    for (const o of orderCounts) {
      orderCountMap[o._id.toString()] = o.count;
    }

    const enriched = users.map((u) => ({
      ...u,
      orderCount: orderCountMap[u._id.toString()] || 0,
    }));

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

  async getAdminUserDetail(userId) {
    const user = await User.findById(userId)
      .select("fullName email phone referralCode referredBy status createdAt walletBalance commissionBalance")
      .populate("referredBy", "fullName email referralCode")
      .lean();
    if (!user) throw new Error("User not found");

    const [referralCount, orderStats, commissionStats] = await Promise.all([
      User.countDocuments({ referredBy: userId }),
      Order.aggregate([
        { $match: { createdBy: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalValue: { $sum: "$total" },
            lastOrderDate: { $max: "$createdAt" },
          },
        },
      ]),
      Commission.aggregate([
        { $match: { referrer: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            totalEarned: {
              $sum: { $cond: [{ $eq: ["$status", "credited"] }, "$amount", 0] },
            },
            batchCount: { $sum: 1 },
            totalCommissionOrders: { $sum: "$ordersCount" },
          },
        },
      ]),
    ]);

    const orders = orderStats[0] || {
      totalOrders: 0, totalValue: 0, lastOrderDate: null,
    };
    const commissions = commissionStats[0] || {
      totalEarned: 0, batchCount: 0, totalCommissionOrders: 0,
    };

    return {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      referralCode: user.referralCode,
      referredBy: user.referredBy || null,
      status: user.status,
      createdAt: user.createdAt,
      walletBalance: user.walletBalance || 0,
      commissionBalance: user.commissionBalance || 0,
      totalReferred: referralCount,
      orderStats: {
        totalOrders: orders.totalOrders,
        totalOrderValue: orders.totalValue,
        lastOrderDate: orders.lastOrderDate,
      },
      commissionAsReferrer: {
        totalEarned: commissions.totalEarned,
        totalOrders: commissions.totalCommissionOrders,
        batchCount: commissions.batchCount,
      },
    };
  }
}

export default new ReferralService();
