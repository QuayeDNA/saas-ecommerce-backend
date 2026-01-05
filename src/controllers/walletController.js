// src/controllers/walletController.js
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import walletService from "../services/walletService.js";
import websocketService from "../services/websocketService.js";
import logger from "../utils/logger.js";
import { isBusinessUser } from "../utils/userTypeHelpers.js";

class WalletController {
  /**
   * Get wallet balance and recent transactions
   */
  async getWalletInfo(req, res) {
    try {
      const userId = req.user.userId;
      // Removed excessive debug logging
      // Get user with wallet balance
      const user = await User.findById(userId).select("walletBalance");
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Get recent transactions (last 10)
      let recentTransactions = [];
      try {
        // First try without population to see if the basic query works
        let basicTransactions = await WalletTransaction.find({ user: userId })
          .sort({ createdAt: -1 })
          .limit(10);

        // Now try to populate each transaction individually to handle any population errors
        recentTransactions = [];
        for (const tx of basicTransactions) {
          try {
            const populatedTx = await tx.populate([
              { path: "approvedBy", select: "fullName" },
              { path: "relatedOrder", select: "orderNumber" },
            ]);
            recentTransactions.push(populatedTx);
          } catch (populateError) {
            logger.warn(
              `[getWalletInfo] Failed to populate recent transaction ${tx._id}: ${populateError.message}`
            );
            // Add the transaction without population
            recentTransactions.push(tx);
          }
        }

        if (!Array.isArray(recentTransactions)) {
          recentTransactions = [];
        }
      } catch (txError) {
        logger.warn(
          `[getWalletInfo] Failed to get recent transactions: ${txError.message}`
        );
        logger.error(txError.stack);
        recentTransactions = [];
      }

      res.json({
        success: true,
        wallet: {
          balance: user.walletBalance || 0,
          recentTransactions: recentTransactions,
        },
      });
    } catch (error) {
      logger.error(`Get wallet info error: ${error.message}`);
      logger.error(error.stack);
      res.status(500).json({
        success: false,
        message: "Failed to get wallet information",
      });
    }
  }

  /**
   * Get transaction history with pagination
   */
  async getTransactionHistory(req, res) {
    try {
      const userId = req.user.userId;
      const { page = 1, limit = 20, type, startDate, endDate } = req.query;
      logger.debug(
        `[getTransactionHistory] userId: ${userId}, page: ${page}, limit: ${limit}, type: ${type}, startDate: ${startDate}, endDate: ${endDate}`
      );
      // Build filter
      const filter = {};
      if (type && ["credit", "debit"].includes(type)) {
        filter.type = type;
      }
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) {
          filter.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          filter.createdAt.$lte = new Date(endDate);
        }
      }
      // Get transactions with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      let transactions = [];
      try {
        // First try without population to see if the basic query works
        let basicTransactions = await WalletTransaction.find({
          user: userId,
          ...filter,
        })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit));

        logger.debug(
          `[getTransactionHistory] Basic transactions found: ${basicTransactions.length}`
        );

        // Now try to populate each transaction individually to handle any population errors
        transactions = [];
        for (const tx of basicTransactions) {
          try {
            const populatedTx = await tx.populate([
              { path: "approvedBy", select: "fullName email" },
              { path: "relatedOrder", select: "orderNumber" },
            ]);
            transactions.push(populatedTx);
          } catch (populateError) {
            logger.warn(
              `[getTransactionHistory] Failed to populate transaction ${tx._id}: ${populateError.message}`
            );
            // Add the transaction without population
            transactions.push(tx);
          }
        }

        logger.debug(
          `[getTransactionHistory] Final transactions count: ${transactions.length}`
        );
        if (!Array.isArray(transactions)) {
          logger.debug(
            `[getTransactionHistory] transactions is not an array, setting to []`
          );
          transactions = [];
        }
      } catch (txError) {
        logger.warn(
          `[getTransactionHistory] Failed to get transaction history: ${txError.message}`
        );
        logger.error(txError.stack);
        transactions = [];
      }
      const totalCount = await WalletTransaction.countDocuments({
        user: userId,
        ...filter,
      }).catch((err) => 0);
      logger.debug(
        `[getTransactionHistory] Sending response: transactions.length=${transactions.length}, totalCount=${totalCount}`
      );
      res.json({
        success: true,
        transactions: transactions,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / parseInt(limit)),
        },
      });
    } catch (error) {
      logger.error(`Get transaction history error: ${error.message}`);
      logger.error(error.stack);
      res.status(500).json({
        success: false,
        message: "Failed to get transaction history",
      });
    }
  }

  /**
   * Check if user has a pending top-up request
   */
  async checkPendingTopUpRequest(req, res) {
    try {
      const userId = req.user.userId;

      // Check for existing pending top-up request
      const pendingRequest = await WalletTransaction.findOne({
        user: userId,
        type: "credit",
        status: "pending",
      });

      res.status(200).json({
        success: true,
        hasPendingRequest: !!pendingRequest,
      });
    } catch (error) {
      logger.error(`Check pending top-up request error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to check pending request status",
      });
    }
  }

  /**
   * Request wallet top-up (for agents)
   */
  async requestWalletTopUp(req, res) {
    try {
      const userId = req.user.userId;
      const { amount, description } = req.body;

      // Create top-up request
      const transaction = await walletService.createTopUpRequest(
        userId,
        parseFloat(amount),
        description
      );

      res.status(201).json({
        success: true,
        message: "Top-up request created successfully",
        transaction,
      });
    } catch (error) {
      logger.error(`Request wallet top-up error: ${error.message}`);
      res.status(error.message.includes("not found") ? 404 : 400).json({
        success: false,
        message: error.message || "Failed to create top-up request",
      });
    }
  }

  /**
   * Top up a wallet (admin/super_admin only)
   */
  async topUpWallet(req, res) {
    try {
      const adminId = req.user.userId;
      const { userId, amount, description } = req.body;

      // Credit the user's wallet
      const transaction = await walletService.creditWallet(
        userId,
        parseFloat(amount),
        description || "Wallet top-up by admin",
        adminId,
        { adminAction: true }
      );

      // Get updated wallet info for WebSocket update
      const user = await User.findById(userId).select("walletBalance");
      const recentTransactions = await WalletTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate([
          { path: "approvedBy", select: "fullName" },
          { path: "relatedOrder", select: "orderNumber" },
        ]);

      // Emit WebSocket wallet update to the user with message
      websocketService.sendToUser(userId, {
        type: "wallet_update",
        userId: userId,
        balance: user.walletBalance || 0,
        recentTransactions: recentTransactions,
        message: `Your wallet has been credited with GH₵${amount}. New balance: GH₵${
          user.walletBalance || 0
        }`,
      });

      res.json({
        success: true,
        message: "Wallet topped up successfully",
        transaction,
      });
    } catch (error) {
      logger.error(`Top up wallet error: ${error.message}`);
      res.status(error.message.includes("not found") ? 404 : 400).json({
        success: false,
        message: error.message || "Failed to top up wallet",
      });
    }
  }

  /**
   * Process a top-up request (approve/reject) (admin/super_admin only)
   */
  async processTopUpRequest(req, res) {
    try {
      const adminId = req.user.userId;
      const { transactionId } = req.params;
      const { approve } = req.body;

      // Process the request
      const transaction = await walletService.processTopUpRequest(
        transactionId,
        !!approve,
        adminId
      );

      // If approved, send WebSocket update to the user
      if (approve && transaction.user) {
        const user = await User.findById(transaction.user).select(
          "walletBalance"
        );
        const recentTransactions = await WalletTransaction.find({
          user: transaction.user,
        })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate([
            { path: "approvedBy", select: "fullName" },
            { path: "relatedOrder", select: "orderNumber" },
          ]);

        // Emit WebSocket wallet update to the user with message
        websocketService.sendToUser(transaction.user.toString(), {
          type: "wallet_update",
          userId: transaction.user.toString(),
          balance: user.walletBalance || 0,
          recentTransactions: recentTransactions,
          message: `Your top-up request for GH₵${
            transaction.amount
          } has been approved. New balance: GH₵${user.walletBalance || 0}`,
        });
      }

      res.json({
        success: true,
        message: approve
          ? "Top-up request approved"
          : "Top-up request rejected",
        transaction,
      });
    } catch (error) {
      logger.error(`Process top-up request error: ${error.message}`);
      res.status(error.message.includes("not found") ? 404 : 400).json({
        success: false,
        message: error.message || "Failed to process top-up request",
      });
    }
  }

  /**
   * Get pending top-up requests (admin/super_admin only)
   */
  async getPendingTopUpRequests(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const userType = req.user.userType;

      // Build filter based on user type
      let filter = { status: "pending" };

      // If business user (admin), only show requests from their customers
      if (isBusinessUser(userType)) {
        const tenantId = req.user.userId;

        // Get all users belonging to this tenant
        const tenantUsers = await User.find({ tenantId }).select("_id");
        const userIds = tenantUsers.map((user) => user._id);

        filter.user = { $in: userIds };
      }

      // Get pending requests with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const requests = await WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("user", "fullName email phone userType agentCode");

      const totalCount = await WalletTransaction.countDocuments(filter);

      res.json({
        success: true,
        requests,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / parseInt(limit)),
        },
      });
    } catch (error) {
      logger.error(`Get pending top-up requests error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get pending top-up requests",
      });
    }
  }

  /**
   * Get wallet analytics (admin/super_admin only)
   */
  async getWalletAnalytics(req, res) {
    try {
      const userType = req.user.userType;
      const userId = req.user.userId;

      // For business users, only get analytics for their customers
      const tenantId = isBusinessUser(userType) ? userId : null;

      // Build filter
      const filter = {};
      const { startDate, endDate } = req.query;
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) {
          filter.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          filter.createdAt.$lte = new Date(endDate);
        }
      }

      const analytics = await walletService.getWalletAnalytics(
        tenantId,
        filter
      );

      res.json({
        success: true,
        analytics,
      });
    } catch (error) {
      logger.error(`Get wallet analytics error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to get wallet analytics",
      });
    }
  }

  /**
   * Admin: Debit a user's wallet
   */
  async adminDebitWallet(req, res) {
    try {
      const { userId, amount, description } = req.body;
      const adminId = req.user.userId;

      logger.debug(
        `[adminDebitWallet] Admin ${adminId} debiting ${amount} from user ${userId}`
      );

      if (!userId || !amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid request. User ID and positive amount are required.",
        });
      }

      // Check if user exists
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if user has sufficient balance
      if (user.walletBalance < amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Required: GH₵${amount}, Available: GH₵${user.walletBalance}`,
        });
      }

      // Perform debit operation
      const transaction = await walletService.debitWallet(
        userId,
        amount,
        description || `Wallet debit by admin`,
        null,
        { debitedBy: adminId }
      );

      // Get updated user info
      const updatedUser = await User.findById(userId).select(
        "walletBalance fullName email"
      );

      // Send WebSocket notification to the user
      try {
        websocketService.sendToUser(userId, {
          type: "wallet_update",
          userId: userId,
          balance: updatedUser.walletBalance,
          message: `Your wallet has been debited by GH₵${amount}. New balance: GH₵${updatedUser.walletBalance}`,
        });
      } catch (wsError) {
        logger.warn(
          `[adminDebitWallet] Failed to send WebSocket notification: ${wsError.message}`
        );
      }

      logger.info(
        `[adminDebitWallet] Successfully debited ${amount} from user ${userId}. New balance: ${updatedUser.walletBalance}`
      );

      res.json({
        success: true,
        message: `Successfully debited GH₵${amount} from ${updatedUser.fullName}'s wallet`,
        transaction: transaction,
        user: updatedUser,
      });
    } catch (error) {
      logger.error(`[adminDebitWallet] Error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to debit wallet",
      });
    }
  }

  /**
   * Get all wallet transactions performed by admin (super_admin only)
   */
  async getAdminTransactions(req, res) {
    try {
      const adminId = req.user.userId;
      const {
        page = 1,
        limit = 20,
        type,
        startDate,
        endDate,
        userId,
      } = req.query;

      logger.debug(
        `[getAdminTransactions] Admin ${adminId} fetching transactions: page=${page}, limit=${limit}, type=${type}, startDate=${startDate}, endDate=${endDate}, userId=${userId}`
      );

      // Build filter - find transactions where admin was involved
      const filter = {
        $or: [
          { approvedBy: adminId }, // Transactions approved by this admin (top-ups from requests)
          { "metadata.debitedBy": adminId }, // Transactions debited by this admin
          { "metadata.adminAction": true, approvedBy: adminId }, // Direct admin credits
        ],
      };

      // Add additional filters
      if (type && ["credit", "debit"].includes(type)) {
        filter.type = type;
      }

      if (userId) {
        filter.user = userId;
      }

      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) {
          filter.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          filter.createdAt.$lte = new Date(endDate);
        }
      }

      // Get transactions with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      let transactions = [];
      try {
        // First try without population to see if the basic query works
        let basicTransactions = await WalletTransaction.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit));

        logger.debug(
          `[getAdminTransactions] Basic transactions found: ${basicTransactions.length}`
        );

        // Now try to populate each transaction individually to handle any population errors
        transactions = [];
        for (const tx of basicTransactions) {
          try {
            const populatedTx = await tx.populate([
              {
                path: "user",
                select: "fullName email phone userType agentCode",
              },
              { path: "approvedBy", select: "fullName email" },
              { path: "relatedOrder", select: "orderNumber" },
            ]);
            transactions.push(populatedTx);
          } catch (populateError) {
            logger.warn(
              `[getAdminTransactions] Failed to populate transaction ${tx._id}: ${populateError.message}`
            );
            // Add the transaction without population
            transactions.push(tx);
          }
        }

        logger.debug(
          `[getAdminTransactions] Final transactions count: ${transactions.length}`
        );
        if (!Array.isArray(transactions)) {
          logger.debug(
            `[getAdminTransactions] transactions is not an array, setting to []`
          );
          transactions = [];
        }
      } catch (txError) {
        logger.warn(
          `[getAdminTransactions] Failed to get admin transactions: ${txError.message}`
        );
        logger.error(txError.stack);
        transactions = [];
      }

      const totalCount = await WalletTransaction.countDocuments(filter).catch(
        (err) => 0
      );

      logger.debug(
        `[getAdminTransactions] Sending response: transactions.length=${transactions.length}, totalCount=${totalCount}`
      );

      res.json({
        success: true,
        transactions: transactions,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / parseInt(limit)),
        },
      });
    } catch (error) {
      logger.error(`Get admin transactions error: ${error.message}`);
      logger.error(error.stack);
      res.status(500).json({
        success: false,
        message: "Failed to get admin transactions",
      });
    }
  }
}

export default new WalletController();
