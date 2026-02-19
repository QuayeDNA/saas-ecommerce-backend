// src/services/walletService.js
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
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
   * Initialize Paystack wallet top-up (creates pending WalletTransaction + initializes Paystack)
   */
  async initiatePaystackTopUp(userId, amount, returnUrl = null) {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error('User not found');
      if (amount <= 0) throw new Error('Amount must be greater than zero');

      // Prevent multiple pending paystack top-ups
      const existingPending = await WalletTransaction.findOne({
        user: userId,
        type: 'credit',
        status: 'pending',
        'metadata.paystack': { $exists: true },
      });

      if (existingPending) {
        const hoursSince = (Date.now() - new Date(existingPending.createdAt)) / (1000 * 60 * 60);
        if (hoursSince < 24) {
          throw new Error('You have a pending Paystack top-up. Please complete or wait for it to expire.');
        }
        existingPending.status = 'rejected';
        existingPending.description = `${existingPending.description} - expired`; 
        await existingPending.save();
      }

      const reference = `wallet_${userId}_${Date.now()}`;
      const amountPesewas = (await import('../services/paystackService.js')).default.convertToPesewas(amount);

      // Try to ensure a Paystack Customer exists (this lets Paystack's hosted widget show the customer's name)
      try {
        if (user.email && user.fullName) {
          const [first_name, ...rest] = (user.fullName || '').trim().split(/\s+/);
          const last_name = rest.join(' ') || undefined;
          await (await import('../services/paystackService.js')).default.createCustomer({
            email: user.email,
            first_name,
            last_name,
          });
        }
      } catch (custErr) {
        // Non-fatal — proceed to initialize transaction even if customer creation fails
        logger.warn(`createCustomer for Paystack failed for user ${userId}: ${custErr.message}`);
      }

      // Initialize Paystack
      const paystackData = await (await import('../services/paystackService.js')).default.initializeTransaction({
        email: user.email || `${user._id}@noemail.local`,
        amount: amountPesewas,
        reference,
        currency: 'GHS',
        callback_url: returnUrl || `${process.env.FRONTEND_URL || ''}/wallet/topup/callback`,
        // pass user's full name in metadata (already present) and include it in description so Paystack's hosted/redirect page can surface the name
        metadata: { userId: userId.toString(), type: 'wallet_topup', userName: user.fullName },
        channels: ['card', 'mobile_money', 'bank_transfer']
      });

      const transaction = new WalletTransaction({
        user: userId,
        type: 'credit',
        amount,
        balanceAfter: user.walletBalance + amount,
        // include user's full name in description so Paystack checkout shows a recognizable label instead of only email
        description: `Wallet top-up for ${user.fullName} (Paystack)`,
        status: 'pending',
        reference,
        metadata: {
          paystack: {
            reference,
            authorization_url: paystackData.authorization_url,
            access_code: paystackData.access_code,
            gateway: 'paystack',
            currency: 'GHS'
          },
          requestedAt: new Date()
        }
      });

      await transaction.save();

      return {
        transaction,
        authorizationUrl: paystackData.authorization_url,
        reference,
        accessCode: paystackData.access_code
      };
    } catch (error) {
      logger.error(`initiatePaystackTopUp error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process Paystack webhook for wallet top-up (idempotent)
   */
  async processPaystackWebhook(webhookEvent) {
    try {
      const { data } = webhookEvent;
      const reference = data.reference;
      const metadata = data.metadata || {};

      if (metadata.type !== 'wallet_topup') return { processed: false, reason: 'not_wallet_topup' };

      // Atomically claim the pending WalletTransaction for processing to avoid double-credit
      const claimedTx = await WalletTransaction.findOneAndUpdate(
        { reference, status: 'pending' },
        { $set: { status: 'processing', 'metadata.paystack.processingAt': new Date() } },
        { new: true }
      );

      let tx = claimedTx;

      if (!tx) {
        // Check if already completed
        const completed = await WalletTransaction.findOne({ reference, status: 'completed' });
        if (completed) return { processed: false, duplicate: true };

        // Check if another worker is already processing it
        const inProgress = await WalletTransaction.findOne({ reference, status: 'processing' });
        if (inProgress) return { processed: false, reason: 'already_processing' };

        throw new Error(`WalletTransaction not found for reference ${reference}`);
      }

      // Amount validation (Paystack amount is in smallest unit)
      const expectedPesewas = (await import('../services/paystackService.js')).default.convertToPesewas(tx.amount);
      if (Number(data.amount) !== Number(expectedPesewas)) {
        tx.metadata = tx.metadata || {};
        tx.metadata.paystack = tx.metadata.paystack || {};
        tx.metadata.paystack.amountMismatch = true;
        tx.metadata.paystack.expectedAmount = expectedPesewas;
        tx.metadata.paystack.receivedAmount = data.amount;
        tx.description = `${tx.description} - AMOUNT MISMATCH - REQUIRES_MANUAL_REVIEW`;
        // Revert status so admins can retry/inspect
        tx.status = 'pending';
        await tx.save();
        // TODO: notify admins
        return { processed: false, reason: 'amount_mismatch' };
      }

      // Atomically credit user's wallet to avoid race conditions
      const updatedUser = await User.findByIdAndUpdate(
        tx.user,
        { $inc: { walletBalance: tx.amount } },
        { new: true, runValidators: false }
      );

      if (!updatedUser) {
        // revert transaction back to pending so it can be investigated
        tx.status = 'pending';
        await tx.save();
        throw new Error('User not found for wallet top-up');
      }

      tx.status = 'completed';
      tx.balanceAfter = updatedUser.walletBalance;
      tx.metadata = tx.metadata || {};
      tx.metadata.paystack = tx.metadata.paystack || {};
      tx.metadata.paystack.transactionId = data.id;
      tx.metadata.paystack.channel = data.channel;
      tx.metadata.paystack.paidAt = data.paid_at || new Date();
      tx.metadata.paystack.processedAt = new Date();
      tx.description = `Wallet top-up via Paystack (${data.channel})`;

      await tx.save();

      // Reconcile any other pending top-up requests for the same user + amount
      try {
        const otherPending = await WalletTransaction.find({
          user: user._id,
          type: 'credit',
          status: 'pending',
          amount: tx.amount,
          _id: { $ne: tx._id },
          'metadata.paystack': { $exists: false }
        });

        if (otherPending && otherPending.length > 0) {
          logger.info(`[WalletService] Reconciling ${otherPending.length} pending request(s) for user ${user._id} after Paystack success`, { reference });
          for (const pendingTx of otherPending) {
            pendingTx.status = 'completed';
            pendingTx.balanceAfter = user.walletBalance; // reflect actual new balance
            pendingTx.description = `${pendingTx.description} - Auto-completed (reconciled via Paystack)`;
            pendingTx.metadata = pendingTx.metadata || {};
            pendingTx.metadata.reconciled = {
              by: 'paystack_webhook',
              reference,
              reconciledAt: new Date()
            };
            // Do NOT change user.walletBalance again (already credited above)
            await pendingTx.save();

            // Notify user about auto-approval of their manual request
            try {
              await notificationService.sendWalletTopUpApprovalNotification(pendingTx.user.toString(), pendingTx.amount, 'system');
            } catch (notifErr) {
              logger.warn(`Failed to send reconciliation notification for transaction ${pendingTx._id}: ${notifErr.message}`);
            }
          }
        }
      } catch (reconErr) {
        logger.warn(`Failed to reconcile other pending requests: ${reconErr.message}`);
      }

      // Emit websocket update for the paystack transaction
      try {
        const recentTransactions = await WalletTransaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(10).populate([
          { path: 'approvedBy', select: 'fullName' },
          { path: 'relatedOrder', select: 'orderNumber' }
        ]);

        websocketService.sendToUser(user._id.toString(), {
          type: 'wallet_update',
          userId: user._id.toString(),
          balance: user.walletBalance,
          recentTransactions,
          message: `Your wallet has been credited with GH₵${tx.amount}. New balance: GH₵${user.walletBalance}`
        });
      } catch (wsErr) {
        logger.warn(`WebSocket wallet update failed: ${wsErr.message}`);
      }

      return { processed: true, transaction: tx, user };
    } catch (err) {
      logger.error(`processPaystackWebhook error: ${err.message}`);
      throw err;
    }
  }
}

export default new WalletService();
