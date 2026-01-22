// src/services/walletService.js
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import crypto from 'crypto';
import logger from "../utils/logger.js";
import notificationService from "./notificationService.js";
import websocketService from "./websocketService.js";
import { canHaveWallet } from "../utils/userTypeHelpers.js";

class WalletService {
  /**
   * Credit a user's wallet
   * @param {string} userId - The user ID
   * @param {number} amount - Amount to credit
   * @param {string} description - Transaction description
   * @param {string|null} approvedBy - Admin ID who approved the credit
   * @param {object} metadata - Additional transaction metadata
   * @returns {Promise<object>} Transaction object
   */
  async creditWallet(
    userId,
    amount,
    description,
    approvedBy = null,
    metadata = {}
  ) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Validate amount
      if (amount <= 0) {
        throw new Error("Credit amount must be greater than zero");
      }

      // Update wallet balance
      user.walletBalance += amount;
      await user.save({ validateBeforeSave: false });

      // Record transaction
      const transaction = new WalletTransaction({
        user: userId,
        type: "credit",
        amount,
        balanceAfter: user.walletBalance,
        description,
        approvedBy,
        metadata,
      });

      await transaction.save();
      logger.info(
        `Wallet credited: ${amount} GH₵ for user ${userId}. New balance: ${user.walletBalance} GH₵`
      );

      // Send WebSocket update
      try {
        const recentTransactions = await WalletTransaction.find({
          user: userId,
        })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate([
            { path: "approvedBy", select: "fullName" },
            { path: "relatedOrder", select: "orderNumber" },
          ]);

        websocketService.sendToUser(userId, {
          type: "wallet_update",
          userId: userId,
          balance: user.walletBalance,
          recentTransactions: recentTransactions,
          message: `Your wallet has been credited with GH₵${amount}. New balance: GH₵${user.walletBalance}`,
        });
      } catch (wsError) {
        logger.warn(
          `Failed to send WebSocket update for credit: ${wsError.message}`
        );
      }

      return transaction;
    } catch (error) {
      logger.error(`Wallet credit error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Debit a user's wallet
   * @param {string} userId - The user ID
   * @param {number} amount - Amount to debit
   * @param {string} description - Transaction description
   * @param {string|null} relatedOrder - Related order ID
   * @param {object} metadata - Additional transaction metadata
   * @returns {Promise<object>} Transaction object
   */
  async debitWallet(
    userId,
    amount,
    description,
    relatedOrder = null,
    metadata = {}
  ) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Validate amount and check sufficient balance
      if (amount <= 0) {
        throw new Error("Debit amount must be greater than zero");
      }

      if (user.walletBalance < amount) {
        throw new Error(
          `Insufficient wallet balance. Required: GH₵${amount}, Available: GH₵${user.walletBalance}`
        );
      }

      // Update wallet balance
      user.walletBalance -= amount;
      await user.save({ validateBeforeSave: false });

      // Record transaction
      const transaction = new WalletTransaction({
        user: userId,
        type: "debit",
        amount,
        balanceAfter: user.walletBalance,
        description,
        relatedOrder,
        metadata,
      });

      await transaction.save();
      logger.info(
        `Wallet debited: ${amount} GH₵ for user ${userId}. New balance: ${user.walletBalance} GH₵`
      );

      // Send WebSocket update
      try {
        const recentTransactions = await WalletTransaction.find({
          user: userId,
        })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate([
            { path: "approvedBy", select: "fullName" },
            { path: "relatedOrder", select: "orderNumber" },
          ]);

        websocketService.sendToUser(userId, {
          type: "wallet_update",
          userId: userId,
          balance: user.walletBalance,
          recentTransactions: recentTransactions,
          message: `Your wallet has been debited by GH₵${amount}. New balance: GH₵${user.walletBalance}`,
        });
      } catch (wsError) {
        logger.warn(
          `Failed to send WebSocket update for debit: ${wsError.message}`
        );
      }

      return transaction;
    } catch (error) {
      logger.error(`Wallet debit error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get transaction history for a user
   * @param {string} userId - The user ID
   * @param {object} filter - Filter criteria
   * @returns {Promise<Array>} List of transactions
   */
  async getTransactionHistory(userId, filter = {}) {
    try {
      const query = { user: userId, ...filter };
      const transactions = await WalletTransaction.find(query)
        .sort({ createdAt: -1 })
        .populate("approvedBy", "fullName email")
        .populate("relatedOrder", "orderNumber");

      // Ensure we always return an array
      if (!Array.isArray(transactions)) {
        return [];
      }

      return transactions;
    } catch (error) {
      logger.error(`Get transaction history error: ${error.message}`);
      return []; // Return empty array instead of throwing
    }
  }

  /**
   * Create a wallet top-up request
   * @param {string} userId - The user ID
   * @param {number} amount - Amount requested
   * @param {string} description - Reason for top-up
   * @returns {Promise<object>} Transaction request object
   */
  async createTopUpRequest(userId, amount, description) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Check for existing pending top-up request
      const existingPendingRequest = await WalletTransaction.findOne({
        user: userId,
        type: "credit",
        status: "pending",
      });

      if (existingPendingRequest) {
        throw new Error(
          "You already have a pending top-up request. Please wait for it to be processed before making a new request."
        );
      }

      // Validate amount
      if (amount <= 0) {
        throw new Error("Top-up amount must be greater than zero");
      }

      // Create pending transaction request
      const transaction = new WalletTransaction({
        user: userId,
        type: "credit",
        amount,
        balanceAfter: user.walletBalance + amount, // Projected balance
        description,
        status: "pending",
        metadata: { requestedAt: new Date() },
      });

      await transaction.save();
      logger.info(
        `Wallet top-up request created: ${amount} GH₵ for user ${userId}`
      );

      return transaction;
    } catch (error) {
      logger.error(`Create top-up request error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Approve or reject a top-up request
   * @param {string} transactionId - The transaction ID
   * @param {boolean} approve - Whether to approve or reject
   * @param {string} adminId - ID of admin approving/rejecting
   * @returns {Promise<object>} Updated transaction
   */
  async processTopUpRequest(transactionId, approve, adminId) {
    try {
      const transaction = await WalletTransaction.findById(transactionId);
      if (!transaction) {
        throw new Error("Transaction not found");
      }

      if (transaction.status !== "pending") {
        throw new Error(
          `Transaction is already ${transaction.status}. Only pending transactions can be processed.`
        );
      }

      if (approve) {
        // Get user
        const user = await User.findById(transaction.user);
        if (!user) {
          throw new Error("User not found");
        }

        // Credit the wallet
        user.walletBalance += transaction.amount;
        await user.save({ validateBeforeSave: false });

        // Update transaction
        transaction.status = "completed";
        transaction.approvedBy = adminId;
        transaction.balanceAfter = user.walletBalance;
        transaction.description = `${transaction.description} - Approved by admin`;

        logger.info(
          `Wallet top-up approved: ${transaction.amount} GH₵ for user ${transaction.user}. New balance: ${user.walletBalance} GH₵`
        );

        // Send WebSocket update for approval
        try {
          const recentTransactions = await WalletTransaction.find({
            user: transaction.user,
          })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate([
              { path: "approvedBy", select: "fullName" },
              { path: "relatedOrder", select: "orderNumber" },
            ]);

          websocketService.sendToUser(transaction.user.toString(), {
            type: "wallet_update",
            userId: transaction.user.toString(),
            balance: user.walletBalance,
            recentTransactions: recentTransactions,
            message: `Your top-up request for GH₵${transaction.amount} has been approved. New balance: GH₵${user.walletBalance}`,
          });
        } catch (wsError) {
          logger.warn(
            `Failed to send WebSocket update for top-up approval: ${wsError.message}`
          );
        }
      } else {
        // Reject the transaction
        transaction.status = "rejected";
        transaction.approvedBy = adminId;
        transaction.description = `${transaction.description} - Rejected by admin`;
        // Keep the original balanceAfter to show what was requested
        // But mark it clearly as rejected

        logger.info(
          `Wallet top-up rejected: ${transaction.amount} GH₵ for user ${transaction.user}`
        );

        // Send WebSocket update for rejection
        try {
          const user = await User.findById(transaction.user);
          const recentTransactions = await WalletTransaction.find({
            user: transaction.user,
          })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate([
              { path: "approvedBy", select: "fullName" },
              { path: "relatedOrder", select: "orderNumber" },
            ]);

          websocketService.sendToUser(transaction.user.toString(), {
            type: "wallet_update",
            userId: transaction.user.toString(),
            balance: user.walletBalance,
            recentTransactions: recentTransactions,
            message: `Your top-up request for GH₵${transaction.amount} has been rejected.`,
          });
        } catch (wsError) {
          logger.warn(
            `Failed to send WebSocket update for top-up rejection: ${wsError.message}`
          );
        }
      }

      await transaction.save();

      // Send notification based on approval status
      if (approve) {
        await notificationService.sendWalletTopUpApprovalNotification(
          transaction.user.toString(),
          transaction.amount,
          adminId
        );
      } else {
        await notificationService.sendWalletTopUpRejectionNotification(
          transaction.user.toString(),
          transaction.amount,
          "Request rejected by administrator",
          adminId
        );
      }

      return transaction;
    } catch (error) {
      logger.error(`Process top-up request error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize wallet for a new agent
   * @param {string} userId - The user ID
   * @returns {Promise<object>} Transaction object
   */
  async initializeAgentWallet(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      if (!canHaveWallet(user.userType)) {
        throw new Error("Only business user wallets can be initialized");
      }

      // Check if wallet is already initialized
      if (user.walletBalance > 0) {
        throw new Error("Wallet already initialized");
      }

      const initialAmount = 0; // 100 GH₵
      user.walletBalance = initialAmount;
      await user.save({ validateBeforeSave: false });

      // Record transaction
      const transaction = new WalletTransaction({
        user: userId,
        type: "credit",
        amount: initialAmount,
        balanceAfter: initialAmount,
        description: "Initial wallet balance for new agent",
      });

      await transaction.save();
      logger.info(
        `Agent wallet initialized with ${initialAmount} GH₵ for user ${userId}`
      );

      return transaction;
    } catch (error) {
      logger.error(`Initialize agent wallet error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get wallet analytics for a tenant or all users
   * @param {string|null} tenantId - Tenant ID (null for super admin to get all)
   * @param {object} filter - Filter criteria
   * @returns {Promise<object>} Analytics object
   */
  async getWalletAnalytics(tenantId = null, filter = {}) {
    try {
      let userQuery = {};
      if (tenantId) {
        userQuery = { tenantId };
      }

      // Overall stats
      const totalUsers = await User.countDocuments(userQuery);
      const usersWithBalance = await User.countDocuments({
        ...userQuery,
        walletBalance: { $gt: 0 },
      });

      // Get sum of all wallet balances
      const walletAggregation = await User.aggregate([
        { $match: { ...userQuery } },
        {
          $group: {
            _id: null,
            totalBalance: { $sum: "$walletBalance" },
            avgBalance: { $avg: "$walletBalance" },
            maxBalance: { $max: "$walletBalance" },
          },
        },
      ]);

      // Transaction statistics
      let txnQuery = {};
      if (tenantId) {
        // Get all users for this tenant
        const tenantUsers = await User.find(userQuery).select("_id");
        const userIds = tenantUsers.map((user) => user._id);
        txnQuery = { user: { $in: userIds } };
      }

      const txnStats = await WalletTransaction.aggregate([
        { $match: { ...txnQuery, ...filter } },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            total: { $sum: "$amount" },
          },
        },
      ]);

      // Organize transaction stats
      const txnStatsFormatted = {
        credit: { count: 0, total: 0 },
        debit: { count: 0, total: 0 },
      };

      txnStats.forEach((stat) => {
        if (stat._id) {
          txnStatsFormatted[stat._id] = {
            count: stat.count,
            total: stat.total,
          };
        }
      });

      // Pending requests count
      const pendingRequests = await WalletTransaction.countDocuments({
        ...txnQuery,
        status: "pending",
      });

      return {
        users: {
          total: totalUsers,
          withBalance: usersWithBalance,
          withoutBalance: totalUsers - usersWithBalance,
        },
        balance:
          walletAggregation.length > 0
            ? {
                total: walletAggregation[0].totalBalance || 0,
                average: walletAggregation[0].avgBalance || 0,
                highest: walletAggregation[0].maxBalance || 0,
              }
            : {
                total: 0,
                average: 0,
                highest: 0,
              },
        transactions: {
          credits: txnStatsFormatted.credit,
          debits: txnStatsFormatted.debit,
          pendingRequests,
        },
      };
    } catch (error) {
      logger.error(`Get wallet analytics error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initiate instant topup via MTN Mobile Money
   * @param {string} userId - The user ID
   * @param {number} amount - Amount to topup
   * @param {string} phoneNumber - Agent's phone number for payment
   * @returns {Promise<object>} Transaction object with MTN reference
   */
  async initiateInstantTopup(userId, amount, phoneNumber) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Validate amount
      if (amount <= 0) {
        throw new Error("Topup amount must be greater than zero");
      }

      // Check daily limit (e.g., 1000 GHS per day)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const dailyTopups = await WalletTransaction.aggregate([
        { $match: { user: user._id, type: 'instant_topup', createdAt: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);

      const dailyTotal = dailyTopups.length > 0 ? dailyTopups[0].total : 0;
      if (dailyTotal + amount > 1000) {
        throw new Error("Daily topup limit exceeded. Maximum 1000 GHS per day.");
      }

      // Import MTN service
      const mtnService = (await import('./mtnMobileMoneyService.js')).default;

      // Validate phone number
      if (!mtnService.validatePhoneNumber(phoneNumber)) {
        throw new Error("Invalid MTN phone number format");
      }

      // Generate unique reference ID
      const referenceId = `topup_${userId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // Create pending transaction
      const transaction = new WalletTransaction({
        user: userId,
        type: "instant_topup",
        amount,
        balanceAfter: user.walletBalance, // Will be updated on success
        description: `Instant topup via MTN Mobile Money (${phoneNumber})`,
        status: "pending",
        metadata: {
          phoneNumber,
          mtnReferenceId: referenceId,
          initiatedAt: new Date()
        },
      });

      await transaction.save();

      // Initiate MTN payment request
      await mtnService.requestToPay(phoneNumber, amount, referenceId);

      logger.info(`Instant topup initiated: ${amount} GHS for user ${userId}, reference: ${referenceId}`);

      return {
        transaction,
        referenceId,
        message: "Topup request sent to your phone. Please approve the payment."
      };
    } catch (error) {
      logger.error(`Initiate instant topup error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Complete instant topup (called from webhook)
   * @param {string} referenceId - MTN reference ID
   * @param {string} status - Payment status from MTN
   */
  async completeInstantTopup(referenceId, status) {
    try {
      const transaction = await WalletTransaction.findOne({
        'metadata.mtnReferenceId': referenceId,
        type: 'instant_topup'
      });

      if (!transaction) {
        logger.warn(`Transaction not found for MTN reference: ${referenceId}`);
        return;
      }

      if (transaction.status !== 'pending') {
        logger.warn(`Transaction ${transaction._id} already processed`);
        return;
      }

      const user = await User.findById(transaction.user);
      if (!user) {
        throw new Error("User not found");
      }

      if (status === 'SUCCESSFUL') {
        // Credit the wallet
        user.walletBalance += transaction.amount;
        await user.save({ validateBeforeSave: false });

        // Update transaction
        transaction.status = 'completed';
        transaction.balanceAfter = user.walletBalance;
        transaction.metadata.completedAt = new Date();

        logger.info(`Instant topup completed: ${transaction.amount} GHS for user ${transaction.user}`);

        // Send WebSocket update
        try {
          const recentTransactions = await WalletTransaction.find({
            user: transaction.user,
          })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate([
              { path: "approvedBy", select: "fullName" },
              { path: "relatedOrder", select: "orderNumber" },
            ]);

          websocketService.sendToUser(transaction.user.toString(), {
            type: "wallet_update",
            userId: transaction.user.toString(),
            balance: user.walletBalance,
            recentTransactions: recentTransactions,
            message: `Instant topup of GH₵${transaction.amount} completed. New balance: GH₵${user.walletBalance}`,
          });
        } catch (wsError) {
          logger.warn(`Failed to send WebSocket update for instant topup: ${wsError.message}`);
        }

        // Send notification
        await notificationService.sendWalletTopUpApprovalNotification(
          transaction.user.toString(),
          transaction.amount,
          null // No admin for instant topup
        );
      } else if (status === 'FAILED' || status === 'REJECTED') {
        // Failed payment
        transaction.status = 'failed';
        transaction.metadata.failureReason = status;
        logger.info(`Instant topup failed: ${referenceId}, status: ${status}`);
      } else if (status === 'PENDING') {
        // Still pending, don't update yet
        logger.info(`Instant topup still pending: ${referenceId}`);
        return;
      } else {
        // Unknown status, log for investigation
        logger.warn(`Unknown MTN status received: ${status} for reference: ${referenceId}`);
        return;
      }

      await transaction.save();
    } catch (error) {
      logger.error(`Complete instant topup error: ${error.message}`);
      throw error;
    }
  }
}

export default new WalletService();
