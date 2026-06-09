import EarningsTransaction from "../models/EarningsTransaction.js";
import WalletTransaction from "../models/WalletTransaction.js";
import PayoutRequest from "../models/PayoutRequest.js";
import User from "../models/User.js";

const STOREFRONT_PROFIT_SOURCES = [
  "storefront_profit",
  "storefront_order_completed",
];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getQueryOptions(session) {
  return session ? { session } : {};
}

function normalizePagination(page, limit) {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
  return { pageNum, limitNum };
}

class EarningsService {
  buildStorefrontProfitCreditMatch(userId) {
    return {
      user: userId,
      type: "credit",
      $or: [
        {
          "metadata.source": { $in: STOREFRONT_PROFIT_SOURCES },
        },
        {
          $and: [
            { relatedOrder: { $exists: true, $ne: null } },
            {
              description: { $regex: "^Storefront profit", $options: "i" },
            },
          ],
        },
      ],
    };
  }

  async getBalance(userId, session = null) {
    const user = await User.findById(
      userId,
      "earningsBalance",
      getQueryOptions(session),
    );

    if (!user) {
      throw new Error("User not found");
    }

    return toNumber(user.earningsBalance);
  }

  async creditStorefrontProfit({
    userId,
    amount,
    orderId,
    description,
    metadata = {},
    session = null,
  }) {
    const creditAmount = toNumber(amount);
    if (creditAmount <= 0) {
      throw new Error("Credit amount must be greater than zero");
    }

    const updateOptions = session
      ? { session, new: true, runValidators: false }
      : { new: true, runValidators: false };

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { earningsBalance: creditAmount } },
      updateOptions,
    );

    if (!user) {
      throw new Error("User not found");
    }

    const txData = {
      user: userId,
      type: "credit",
      amount: creditAmount,
      balanceAfter: toNumber(user.earningsBalance),
      description: description || "Storefront profit credit",
      relatedOrder: orderId || undefined,
      metadata: {
        ...metadata,
        source: metadata.source || "storefront_profit",
      },
    };

    let transaction;
    if (session) {
      [transaction] = await EarningsTransaction.create([txData], { session });
    } else {
      transaction = await EarningsTransaction.create(txData);
    }

    return { user, transaction };
  }

  async debitForPayout({
    userId,
    amount,
    payoutId,
    description,
    metadata = {},
    session = null,
  }) {
    const debitAmount = toNumber(amount);
    if (debitAmount <= 0) {
      throw new Error("Debit amount must be greater than zero");
    }

    const updateOptions = session
      ? { session, new: true, runValidators: false }
      : { new: true, runValidators: false };

    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        earningsBalance: { $gte: debitAmount },
      },
      {
        $inc: { earningsBalance: -debitAmount },
      },
      updateOptions,
    );

    if (!user) {
      throw new Error("Insufficient earnings balance");
    }

    const txData = {
      user: userId,
      type: "debit",
      amount: debitAmount,
      balanceAfter: toNumber(user.earningsBalance),
      description: description || "Payout request debit",
      relatedPayout: payoutId || undefined,
      metadata: {
        ...metadata,
        source: metadata.source || "payout_requested",
      },
    };

    let transaction;
    if (session) {
      [transaction] = await EarningsTransaction.create([txData], { session });
    } else {
      transaction = await EarningsTransaction.create(txData);
    }

    return { user, transaction };
  }

  async refundPayout({
    userId,
    amount,
    payoutId,
    description,
    metadata = {},
    session = null,
  }) {
    const refundAmount = toNumber(amount);
    if (refundAmount <= 0) {
      throw new Error("Refund amount must be greater than zero");
    }

    const updateOptions = session
      ? { session, new: true, runValidators: false }
      : { new: true, runValidators: false };

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { earningsBalance: refundAmount } },
      updateOptions,
    );

    if (!user) {
      throw new Error("User not found");
    }

    const txData = {
      user: userId,
      type: "credit",
      amount: refundAmount,
      balanceAfter: toNumber(user.earningsBalance),
      description: description || "Payout refund",
      relatedPayout: payoutId || undefined,
      metadata: {
        ...metadata,
        source: metadata.source || "payout_refunded",
      },
    };

    let transaction;
    if (session) {
      [transaction] = await EarningsTransaction.create([txData], { session });
    } else {
      transaction = await EarningsTransaction.create(txData);
    }

    return { user, transaction };
  }

  async convertToWallet({ userId, amount, session = null }) {
    const transferAmount = toNumber(amount);
    if (transferAmount <= 0) {
      throw new Error("Amount must be greater than zero");
    }

    const getOpts = session ? { session } : {};
    const updateOpts = session
      ? { session, new: true, runValidators: false }
      : { new: true, runValidators: false };

    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        earningsBalance: { $gte: transferAmount },
      },
      { $inc: { earningsBalance: -transferAmount } },
      updateOpts,
    );

    if (!user) {
      throw new Error("Insufficient earnings balance");
    }

    const earningsBalanceAfter = toNumber(user.earningsBalance);

    await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: transferAmount } },
      updateOpts,
    );

    const updatedUser = session
      ? await User.findById(userId, null, { session })
      : await User.findById(userId);

    const walletBalanceAfter = toNumber(updatedUser.walletBalance);

    const reference = `ECW${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const earningsTxData = {
      user: userId,
      type: "debit",
      amount: transferAmount,
      balanceAfter: earningsBalanceAfter,
      description: "Converted to wallet balance",
      metadata: { source: "converted_to_wallet", reference },
    };

    const walletTxData = {
      user: userId,
      type: "credit",
      amount: transferAmount,
      balanceAfter: walletBalanceAfter,
      description: "Earnings converted to wallet",
      status: "completed",
      reference,
      metadata: { type: "earnings_conversion" },
    };

    let earningsTransaction;
    let walletTransaction;
    if (session) {
      [earningsTransaction] = await EarningsTransaction.create([earningsTxData], { session });
      [walletTransaction] = await WalletTransaction.create([walletTxData], { session });
    } else {
      earningsTransaction = await EarningsTransaction.create(earningsTxData);
      walletTransaction = await WalletTransaction.create(walletTxData);
    }

    return {
      earningsBalance: earningsBalanceAfter,
      walletBalance: walletBalanceAfter,
      amount: transferAmount,
      earningsTransaction,
      walletTransaction,
      reference,
    };
  }

  async getStorefrontProfitForRange(userId, { startDate, endDate } = {}) {
    const match = this.buildStorefrontProfitCreditMatch(userId);
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lt = new Date(endDate);
    }

    const [agg] = await EarningsTransaction.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    return toNumber(agg?.total);
  }

  async removeStorefrontProfitCreditsForOrder({
    userId,
    orderId,
    session = null,
  }) {
    if (!orderId) {
      return { removed: false, amount: 0, count: 0 };
    }

    const match = this.buildStorefrontProfitCreditMatch(userId);
    match.relatedOrder = orderId;

    const options = getQueryOptions(session);
    const credits = await EarningsTransaction.find(match, null, options);
    if (!credits.length) {
      return { removed: false, amount: 0, count: 0 };
    }

    const amount = credits.reduce((sum, tx) => sum + toNumber(tx.amount), 0);
    if (amount <= 0) {
      return { removed: false, amount: 0, count: credits.length };
    }

    const updateOptions = session
      ? { session, new: true, runValidators: false }
      : { new: true, runValidators: false };

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { earningsBalance: -amount } },
      updateOptions,
    );

    if (!user) {
      throw new Error("User not found");
    }

    await EarningsTransaction.deleteMany(
      { _id: { $in: credits.map((tx) => tx._id) } },
      options,
    );

    return {
      removed: true,
      amount,
      count: credits.length,
      balanceAfter: toNumber(user.earningsBalance),
    };
  }

  async getSummary(
    userId,
    {
      recentLimit = 20,
      includePagination = false,
      page = 1,
      limit = 20,
      includeRecentTransactions = true,
    } = {},
  ) {
    const user = await User.findById(userId).select("earningsBalance");
    if (!user) throw new Error("User not found");

    const [totalEarned, completedWithdrawn] = await Promise.all([
      this.getStorefrontProfitForRange(user._id),
      PayoutRequest.aggregate([
        { $match: { user: user._id, status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const summary = {
      availableBalance: toNumber(user.earningsBalance),
      totalEarned,
      totalWithdrawn: Math.abs(toNumber(completedWithdrawn?.[0]?.total)),
      recentTransactions: [],
    };

    if (includeRecentTransactions) {
      const recent = await EarningsTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Number(recentLimit) || 20))
        .lean();
      summary.recentTransactions = recent;
    }

    if (includePagination) {
      const { pageNum, limitNum } = normalizePagination(page, limit);
      const total = await EarningsTransaction.countDocuments({ user: userId });
      const transactions = await EarningsTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean();

      summary.transactions = transactions;
      summary.pagination = {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      };
    }

    return summary;
  }
}

export { STOREFRONT_PROFIT_SOURCES };
export default new EarningsService();
