// src/services/orderService.js
import Order from "../models/Order.js";
import Bundle from "../models/Bundle.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import walletService from "./walletService.js";
import notificationService from "./notificationService.js";
import pushNotificationService from "./pushNotificationService.js";
import duplicateOrderPreventionService from "./duplicateOrderPreventionService.js";
import commissionService from "./commissionService.js";
import mongoose from "mongoose";
import logger from "../utils/logger.js";
import { parseBulkOrderRow } from "../utils/parseBulkOrderRow.js";
import {
  saveOrderWithRetry,
  isDuplicateKeyError,
} from "../utils/orderSaveHelper.js";
import { isBusinessUser } from "../utils/userTypeHelpers.js";
import { getPriceForUserType } from "../utils/pricingHelpers.js";

class OrderService {
  /**
   * Get the correct navigation link based on user type
   * @param {string} userType - User type (agent, super_admin, etc.)
   * @param {string} page - Page to navigate to (wallet, orders, etc.)
   * @returns {string} Navigation link
   */
  getNavigationLink(userType, page) {
    const routes = {
      agent: {
        wallet: "/agent/dashboard/wallet",
        orders: "/agent/dashboard/orders",
      },
      super_admin: {
        wallet: "/superadmin/wallet",
        orders: "/superadmin/orders",
      },
      admin: {
        wallet: "/admin/wallet",
        orders: "/admin/orders",
      },
    };

    return routes[userType]?.[page] || `/${page}`;
  }

  // Check if MongoDB supports transactions (replica set or sharded cluster)
  async supportsTransactions() {
    try {
      const adminDb = mongoose.connection.db.admin();
      const result = await adminDb.command({ replSetGetStatus: 1 });
      return result.ok === 1;
    } catch (error) {
      // If replSetGetStatus fails, we're probably on a standalone instance
      logger.info(
        "MongoDB transactions not supported (standalone instance)",
        error.message
      );
      return false;
    }
  }

  // More robust transaction support check for production
  async checkTransactionSupport() {
    try {
      // Try to start a session and transaction to see if it works
      const session = await mongoose.startSession();
      session.startTransaction();
      await session.abortTransaction();
      session.endSession();
      logger.info("MongoDB transactions are supported");
      return true;
    } catch (error) {
      logger.info("MongoDB transactions not supported:", error.message);
      return false;
    }
  }

  // Test transaction support and log results
  async testTransactionSupport() {
    logger.info("Testing MongoDB transaction support...");
    const supportsTransactions = await this.checkTransactionSupport();

    if (supportsTransactions) {
      logger.info("✅ MongoDB transactions are supported and working");
    } else {
      logger.info(
        "⚠️ MongoDB transactions are not supported, will use fallback mode"
      );
    }

    return supportsTransactions;
  }

  // Execute operation with or without transactions - more robust for production
  async executeWithTransaction(operation) {
    // Check if we're in production and should avoid transactions
    const isProduction = process.env.NODE_ENV === "production";
    const forceNoTransactions = process.env.FORCE_NO_TRANSACTIONS === "true";

    if (isProduction && forceNoTransactions) {
      logger.info("Forcing non-transactional execution in production");
      return await operation(null);
    }

    try {
      // Try to use transactions first
      const session = await mongoose.startSession();

      try {
        session.startTransaction();
        logger.debug("Transaction started successfully");

        const result = await operation(session);
        await session.commitTransaction();
        logger.debug("Transaction committed successfully");
        return result;
      } catch (error) {
        logger.error("Error during transaction execution:", error.message);

        // More robust transaction abort handling
        try {
          if (
            session.transaction &&
            session.transaction.state === "TRANSACTION_STARTED"
          ) {
            await session.abortTransaction();
            logger.debug("Transaction aborted successfully");
          } else {
            logger.debug("Transaction already committed or not started");
          }
        } catch (abortError) {
          logger.warn("Failed to abort transaction:", abortError.message);
          // Don't throw abort errors, just log them
        }

        throw error;
      } finally {
        try {
          session.endSession();
          logger.debug("Session ended successfully");
        } catch (endError) {
          logger.warn("Failed to end session:", endError.message);
          // Don't throw session end errors, just log them
        }
      }
    } catch (transactionError) {
      // If transaction fails, fall back to non-transactional execution
      logger.warn(
        "Transaction failed, falling back to non-transactional execution:",
        transactionError.message
      );
      logger.warn(
        "This is normal for standalone MongoDB instances or when transactions are not supported"
      );

      try {
        return await operation(null);
      } catch (fallbackError) {
        logger.error("Fallback operation also failed:", fallbackError.message);
        throw fallbackError;
      }
    }
  }

  // Create single order
  async createSingleOrder(orderData, tenantId, userId) {
    // Validate tenantId
    if (!tenantId) {
      throw new Error(
        "tenantId must be provided and cannot be null or undefined"
      );
    }

    // Ensure tenantId is a string
    const tenantIdStr = tenantId.toString();

    // Check for duplicate orders first (outside transaction for better performance)
    const duplicateCheck =
      await duplicateOrderPreventionService.checkForDuplicates(
        orderData,
        userId,
        tenantIdStr,
        { forceOverride: orderData.forceOverride }
      );

    if (duplicateCheck.isDuplicate && !duplicateCheck.canProceed) {
      // Throw error with duplicate information for frontend handling
      const error = new Error(duplicateCheck.message);
      error.code = "DUPLICATE_ORDER_DETECTED";
      error.duplicateInfo = duplicateCheck;
      throw error;
    }

    // Execute the main transaction
    const result = await this.executeWithTransaction(async (session) => {
      const {
        packageGroupId,
        packageItemId,
        customerPhone,
        bundleSize,
        quantity = 1,
      } = orderData;

      // Get bundle details with provider info - try without tenantId first
      let bundle = session
        ? await Bundle.findOne({
            _id: packageItemId,
            packageId: packageGroupId,
            isActive: true,
            isDeleted: false,
          })
            .populate("providerId", "name code")
            .session(session)
        : await Bundle.findOne({
            _id: packageItemId,
            packageId: packageGroupId,
            isActive: true,
            isDeleted: false,
          }).populate("providerId", "name code");

      if (!bundle) {
        // Fallback: try to find bundle by ID only
        bundle = session
          ? await Bundle.findOne({
              _id: packageItemId,
              isActive: true,
              isDeleted: false,
            })
              .populate("providerId", "name code")
              .session(session)
          : await Bundle.findOne({
              _id: packageItemId,
              isActive: true,
              isDeleted: false,
            }).populate("providerId", "name code");
      }

      if (!bundle) {
        throw new Error("Bundle not found or inactive");
      }

      // Get user to determine pricing
      const user = session
        ? await User.findById(userId).session(session)
        : await User.findById(userId);

      if (!user) {
        throw new Error("User not found");
      }

      // Calculate order total using user-specific pricing
      const userPrice = getPriceForUserType(bundle, user.userType);
      const orderTotal = userPrice * quantity;

      // Determine order status based on wallet balance and user type
      let orderStatus = "pending"; // Default to pending for agents
      let paymentStatus = "pending";
      let walletDeducted = false;

      if (user.walletBalance >= orderTotal) {
        // Sufficient balance - deduct wallet
        if (session) {
          const newBalance = user.walletBalance - orderTotal;

          // Use atomic update to avoid tenantId validation issues
          await User.findByIdAndUpdate(
            userId,
            { $inc: { walletBalance: -orderTotal } },
            { session, new: false }
          );

          // Update local user object for consistency
          user.walletBalance = newBalance;

          // Record wallet transaction
          const transaction = new WalletTransaction({
            user: userId,
            type: "debit",
            amount: orderTotal,
            balanceAfter: newBalance,
            description: `Payment for order - ${bundle.name} for ${customerPhone}`,
            metadata: { orderType: "single" },
          });
          await transaction.save({ session });
        } else {
          await walletService.debitWallet(
            userId.toString(),
            orderTotal,
            `Payment for order - ${bundle.name} for ${customerPhone}`,
            null,
            { orderType: "single" }
          );
        }
        walletDeducted = true;
        paymentStatus = "paid";

        // Only set status to confirmed for super admins, agents stay pending
        if (user.userType === "super_admin") {
          orderStatus = "confirmed";
        }
      } else {
        // Insufficient balance - create as draft
        orderStatus = "draft";
        paymentStatus = "pending";
      }

      // Create order
      const order = new Order({
        orderType: "single",
        tenantId: tenantIdStr,
        createdBy: userId,
        items: [
          {
            packageGroup: bundle.packageId,
            packageItem: packageItemId,
            packageDetails: {
              name: bundle.name,
              code: bundle._id.toString(),
              price: userPrice, // Use user-specific price
              dataVolume: bundle.dataVolume,
              validity: bundle.validity,
              provider: bundle.providerId?.code || bundle.providerId?.name,
            },
            quantity,
            unitPrice: userPrice, // Use user-specific price
            totalPrice: orderTotal,
            customerPhone,
            bundleSize: bundleSize
              ? {
                  value: bundleSize.value,
                  unit: bundleSize.unit || "GB",
                }
              : undefined,
          },
        ],
        paymentMethod: "wallet",
        status: orderStatus,
        paymentStatus: paymentStatus,
        // The pre-save hook will calculate subtotal, total, and generate orderNumber
      });

      try {
        await saveOrderWithRetry(order, session);
      } catch (error) {
        // If order creation fails and wallet was deducted, refund the amount
        if (walletDeducted) {
          try {
            if (session) {
              const newBalance = user.walletBalance + orderTotal;

              // Use atomic update to avoid tenantId validation issues
              await User.findByIdAndUpdate(
                userId,
                { $inc: { walletBalance: orderTotal } },
                { session, new: false }
              );

              // Update local user object for consistency
              user.walletBalance = newBalance;

              // Record refund transaction
              const refundTransaction = new WalletTransaction({
                user: userId,
                type: "credit",
                amount: orderTotal,
                balanceAfter: newBalance,
                description: `Refund for failed order creation - ${bundle.name} for ${customerPhone}`,
                metadata: { orderType: "single", refund: true },
              });
              await refundTransaction.save({ session });
            } else {
              await walletService.creditWallet(
                userId.toString(),
                orderTotal,
                `Refund for failed order creation - ${bundle.name} for ${customerPhone}`,
                null,
                { orderType: "single", refund: true }
              );
            }
            logger.info(
              `Refunded GH₵${orderTotal.toFixed(2)} for failed order creation`
            );
          } catch (refundError) {
            logger.error(
              `Failed to refund wallet for failed order creation: ${refundError.message}`
            );
          }
        }
        throw error;
      }

      const statusMessage = walletDeducted
        ? `Order created successfully: ${order.orderNumber}`
        : `Order created as draft due to insufficient wallet balance. Required: GH₵${orderTotal.toFixed(
            2
          )}, Available: GH₵${user.walletBalance.toFixed(2)}`;

      logger.info(statusMessage);

      return {
        order: order.toObject(),
        user: user.toObject(),
        orderTotal,
        walletDeducted,
        paymentStatus,
      };
    });

    // Send notifications outside the transaction to avoid commit/abort issues
    try {
      const { order, user, orderTotal, walletDeducted, paymentStatus } = result;

      // Notify super admins about new order
      const superAdmins = await User.find(
        { userType: "super_admin" },
        "userType"
      );
      for (const admin of superAdmins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          "New Order Created",
          `Order ${order.orderNumber} has been created by ${
            user.agentCode || user.name || "User"
          }. Amount: GH₵${orderTotal.toFixed(2)}`,
          "info",
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            amount: orderTotal,
            agentCode: user.agentCode || user.email,
            type: "new_order_created",
            navigationLink: this.getNavigationLink(admin.userType, "orders"),
          }
        );
      }

      // Notify the order creator about their order
      await notificationService.createInAppNotification(
        userId.toString(),
        "Order Created Successfully",
        `Your order ${order.orderNumber} has been created. ${
          walletDeducted
            ? "Payment processed from wallet."
            : "Payment pending - insufficient wallet balance."
        }`,
        walletDeducted ? "success" : "warning",
        {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          amount: orderTotal,
          paymentStatus: paymentStatus,
          type: "order_created",
          navigationLink: this.getNavigationLink(user.userType, "orders"),
        }
      );

      // Send push notification to user
      try {
        await pushNotificationService.sendOrderStatusUpdate(
          userId.toString(),
          order,
          order.status
        );
      } catch (pushError) {
        logger.error(
          `Failed to send push notification for order creation: ${pushError.message}`
        );
      }
    } catch (error) {
      logger.error(
        `Failed to send order creation notification: ${error.message}`
      );
    }

    return result.order;
  }

  // Create bulk order (new logic)
  async createBulkOrders({
    items,
    tenantId,
    userId,
    packageId,
    forceOverride = false,
  }) {
    // Check for duplicate orders first (outside transaction for better performance)
    const bulkOrderData = { items, packageId, forceOverride };
    const duplicateCheck =
      await duplicateOrderPreventionService.checkForDuplicates(
        bulkOrderData,
        userId,
        tenantId,
        { forceOverride }
      );

    if (duplicateCheck.isDuplicate && !duplicateCheck.canProceed) {
      // Throw error with duplicate information for frontend handling
      const error = new Error(duplicateCheck.message);
      error.code = "DUPLICATE_ORDER_DETECTED";
      error.duplicateInfo = duplicateCheck;
      throw error;
    }

    // Execute the main transaction
    const result = await this.executeWithTransaction(async (session) => {
      const createdOrders = [];
      const errors = [];
      let totalOrderAmount = 0;
      const orderItems = [];

      // Ensure tenantId and userId are ObjectId instances
      const getObjectId = (id) => {
        if (typeof id === "string") return new mongoose.Types.ObjectId(id);
        if (id instanceof mongoose.Types.ObjectId) return id;
        // fallback: try to convert
        return new mongoose.Types.ObjectId(String(id));
      };
      const tenantObjectId = getObjectId(tenantId);
      const userObjectId = getObjectId(userId);

      // First pass: validate all items and calculate total
      for (let i = 0; i < items.length; i++) {
        const row = items[i];
        const parsed = parseBulkOrderRow(row);
        if (parsed.error) {
          errors.push({ index: i, row, error: parsed.error });
          continue;
        }

        // Look up the correct bundle (packageItem) within the specific package (packageGroup)
        const bundle = session
          ? await Bundle.findOne({
              packageId: packageId,
              dataVolume: parsed.value.bundleSize.value,
              dataUnit: parsed.value.bundleSize.unit,
              isActive: true,
              isDeleted: false,
            })
              .populate("providerId", "name code")
              .session(session)
          : await Bundle.findOne({
              packageId: packageId,
              dataVolume: parsed.value.bundleSize.value,
              dataUnit: parsed.value.bundleSize.unit,
              isActive: true,
              isDeleted: false,
            }).populate("providerId", "name code");

        if (!bundle) {
          errors.push({
            index: i,
            row,
            error:
              "Bundle not found for specified data volume and unit in this package",
          });
          continue;
        }

        orderItems.push({
          index: i,
          row,
          bundle,
          parsed: parsed.value,
        });
      }

      // Check wallet balance and get user info first to determine pricing
      const user = session
        ? await User.findById(userId).session(session)
        : await User.findById(userId);

      if (!user) {
        throw new Error("User not found");
      }

      // Calculate total order amount using user-specific pricing
      totalOrderAmount = 0; // Reset the total amount
      for (const item of orderItems) {
        const userPrice = getPriceForUserType(item.bundle, user.userType);
        totalOrderAmount += userPrice;
      }

      // Determine if we can process all orders or need to create as drafts
      let canProcessAll = user.walletBalance >= totalOrderAmount;
      let walletDeducted = false;

      if (canProcessAll) {
        // Deduct wallet for all orders
        if (session) {
          const newBalance = user.walletBalance - totalOrderAmount;

          // Use atomic update to avoid tenantId validation issues
          await User.findByIdAndUpdate(
            userId,
            { $inc: { walletBalance: -totalOrderAmount } },
            { session, new: false }
          );

          // Update local user object for consistency
          user.walletBalance = newBalance;

          // Record wallet transaction
          const transaction = new WalletTransaction({
            user: userId,
            type: "debit",
            amount: totalOrderAmount,
            balanceAfter: user.walletBalance,
            description: `Bulk order payment for ${orderItems.length} items`,
            metadata: { orderType: "bulk", itemCount: orderItems.length },
          });
          await transaction.save({ session });
        } else {
          await walletService.debitWallet(
            userId.toString(),
            totalOrderAmount,
            `Bulk order payment for ${orderItems.length} items`,
            null,
            { orderType: "bulk", itemCount: orderItems.length }
          );
        }
        walletDeducted = true;
      }

      // Second pass: create orders
      for (const item of orderItems) {
        const { bundle, parsed, index, row } = item;
        const packageGroup = bundle.packageId;

        try {
          // Get user-specific price for this bundle
          const userPrice = getPriceForUserType(bundle, user.userType);

          // Determine order status based on user type and wallet balance
          let orderStatus = "pending"; // Default to pending for agents
          const paymentStatus = canProcessAll ? "paid" : "pending";

          if (canProcessAll) {
            // Only set status to confirmed for super admins, agents stay pending
            if (user.userType === "super_admin") {
              orderStatus = "confirmed";
            }
          } else {
            orderStatus = "draft";
          }

          const order = new Order({
            orderType: "single",
            tenantId: tenantObjectId,
            createdBy: userObjectId,
            items: [
              {
                packageGroup,
                packageItem: bundle._id,
                packageDetails: {
                  name: bundle.name,
                  code: bundle._id.toString(),
                  price: userPrice, // Use user-specific price
                  dataVolume: bundle.dataVolume,
                  validity: bundle.validity,
                  validityUnit: bundle.validityUnit,
                  provider: bundle.providerId?.code || bundle.providerId?.name,
                },
                quantity: 1,
                unitPrice: userPrice, // Use user-specific price
                totalPrice: userPrice, // Use user-specific price
                customerPhone: parsed.customerPhone,
                bundleSize: parsed.bundleSize,
                processingStatus: "pending",
              },
            ],
            status: orderStatus,
            paymentStatus: paymentStatus,
          });

          if (session) {
            await saveOrderWithRetry(order, session);
          } else {
            await saveOrderWithRetry(order);
          }

          createdOrders.push(order);
        } catch (err) {
          errors.push({ index, row, error: err.message });
        }
      }

      const statusMessage = walletDeducted
        ? `Bulk order created successfully: ${createdOrders.length} orders`
        : `Bulk order created as drafts due to insufficient wallet balance. Required: GH₵${totalOrderAmount.toFixed(
            2
          )}, Available: GH₵${user.walletBalance.toFixed(2)}`;

      logger.info(statusMessage);

      return {
        successCount: createdOrders.length,
        failedCount: errors.length,
        failedRecords: errors,
        orders: createdOrders.map((o) => o._id),
        totalAmount: totalOrderAmount,
        walletDeducted,
        user: user.toObject(), // Pass user data for notifications
        orderCount: createdOrders.length,
      };
    });

    // Send notifications outside the transaction to avoid commit/abort issues
    try {
      const { user, orderCount, totalAmount, walletDeducted } = result;

      // Notify super admins about bulk order
      const superAdmins = await User.find(
        { userType: "super_admin" },
        "userType"
      );
      for (const admin of superAdmins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          "Bulk Order Created",
          `Bulk order with ${orderCount} items has been created by ${
            user.agentCode || user.name || "User"
          }. Total amount: GH₵${totalAmount.toFixed(2)}`,
          "info",
          {
            orderCount: orderCount,
            totalAmount: totalAmount,
            agentCode: user.agentCode || user.email,
            type: "bulk_order_created",
            navigationLink: this.getNavigationLink(admin.userType, "orders"),
          }
        );
      }

      // Notify the order creator about their bulk order
      await notificationService.createInAppNotification(
        userId.toString(),
        "Bulk Order Created Successfully",
        `Your bulk order with ${orderCount} items has been created. ${
          walletDeducted
            ? "Payment processed from wallet."
            : "Payment pending - insufficient wallet balance."
        }`,
        walletDeducted ? "success" : "warning",
        {
          orderCount: orderCount,
          totalAmount: totalAmount,
          paymentStatus: walletDeducted ? "paid" : "pending",
          type: "bulk_order_created",
          navigationLink: this.getNavigationLink(user.userType, "orders"),
        }
      );
    } catch (error) {
      logger.error(
        `Failed to send bulk order creation notification: ${error.message}`
      );
    }

    return {
      successCount: result.successCount,
      failedCount: result.failedCount,
      failedRecords: result.failedRecords,
      orders: result.orders,
      totalAmount: result.totalAmount,
      walletDeducted: result.walletDeducted,
    };
  }

  // Get orders with filtering
  async getOrders(
    tenantId,
    filters = {},
    pagination = {},
    currentUserId = null
  ) {
    const {
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = -1,
    } = pagination;
    const {
      status,
      orderType,
      paymentStatus,
      startDate,
      endDate,
      search,
      createdBy,
      provider,
    } = filters;

    // For super admins (tenantId is null), don't filter by tenant
    // For regular users, filter by their tenant
    const query = tenantId ? { tenantId } : {};

    if (status) query.status = status;
    if (orderType) query.orderType = orderType;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (createdBy) query.createdBy = createdBy;

    // Restrict draft orders to only the creator (agents can only see their own drafts)
    if (status === "draft") {
      // If specifically filtering for drafts, only show user's own drafts
      if (currentUserId) {
        query.createdBy = currentUserId;
      } else {
        // If no currentUserId (super admin), don't show any drafts
        query.status = { $ne: "draft" };
      }
    } else if (!status && currentUserId) {
      // If no specific status filter and user is not super admin, exclude draft orders from other users
      query.$or = [{ status: { $ne: "draft" } }, { createdBy: currentUserId }];
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Add provider filter - filter by package provider
    if (provider) {
      query["items.packageDetails.provider"] = provider;
    }

    if (search) {
      const searchConditions = [
        { orderNumber: { $regex: search, $options: "i" } },
        { "customerInfo.name": { $regex: search, $options: "i" } },
        { "customerInfo.phone": { $regex: search, $options: "i" } },
        { "items.customerPhone": { $regex: search, $options: "i" } },
      ];

      // If we already have an $or condition (from draft restrictions), combine them
      if (query.$or) {
        // We need to combine the existing $or with search conditions
        // This is complex, so we'll use $and to combine both conditions
        const existingOr = query.$or;
        delete query.$or;
        query.$and = [{ $or: existingOr }, { $or: searchConditions }];
      } else {
        query.$or = searchConditions;
      }
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("items.packageGroup", "name provider")
        .populate("createdBy", "fullName email")
        .populate("processedBy", "fullName email")
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .sort({ [sortBy]: sortOrder }),
      Order.countDocuments(query),
    ]);

    return {
      orders,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
        limit: Number(limit),
      },
    };
  }

  // Process order item
  async processOrderItem(orderId, itemId, tenantId, userId) {
    return await this.executeWithTransaction(async (session) => {
      // For super admins (tenantId is null), don't filter by tenant
      // For regular users, filter by their tenant
      const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };

      const order = session
        ? await Order.findOne(query).session(session)
        : await Order.findOne(query);

      if (!order) {
        throw new Error("Order not found");
      }

      const item = order.items.id(itemId);
      if (!item) {
        throw new Error("Order item not found");
      }

      if (item.processingStatus !== "pending") {
        throw new Error("Order item is not in pending status");
      }

      item.processingStatus = "processing";
      item.processedBy = userId;

      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }

      // Simulate bundle processing (replace with actual API integration)
      let processedSuccessfully = false;
      try {
        await this.processMobileBundle(item);
        // Mark as completed - wallet was already checked and deducted when order was created
        item.paymentStatus = "Done";
        item.processingStatus = "completed";
        item.processedAt = new Date();
        processedSuccessfully = true;
      } catch (processingError) {
        item.processingStatus = "failed";
        item.processingError = processingError.message;
      }

      // Update order status
      await order.updateStatus();
      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }

      // Calculate commission if order is completed and created by a business user
      if (
        processedSuccessfully &&
        order.status === "completed" &&
        order.createdBy
      ) {
        try {
          const agent = await User.findById(order.createdBy);
          if (agent && isBusinessUser(agent.userType)) {
            // Calculate commission for the current month
            const currentDate = new Date();
            const startOfMonth = new Date(
              currentDate.getFullYear(),
              currentDate.getMonth(),
              1
            );
            const endOfMonth = new Date(
              currentDate.getFullYear(),
              currentDate.getMonth() + 1,
              0,
              23,
              59,
              59,
              999
            );

            // Check if commission record already exists for this agent and month
            const existingCommission = await mongoose.connection.db
              .collection("commissionrecords")
              .findOne({
                agentId: order.createdBy,
                tenantId: order.tenantId,
                period: "monthly",
                periodStart: startOfMonth,
                periodEnd: endOfMonth,
              });

            if (!existingCommission) {
              // Calculate commission for this order's month
              const calculation = await commissionService.calculateCommission(
                order.createdBy,
                order.tenantId,
                startOfMonth,
                endOfMonth
              );

              // Create commission record
              await commissionService.createCommissionRecord({
                ...calculation,
                period: "monthly",
                periodStart: startOfMonth,
                periodEnd: endOfMonth,
              });

              logger.info(
                `Commission record created for agent ${
                  agent.fullName
                } for ${currentDate.toLocaleString("default", {
                  month: "long",
                  year: "numeric",
                })}`
              );
            }
          }
        } catch (commissionError) {
          logger.error(
            `Failed to calculate commission for order ${order._id}: ${commissionError.message}`
          );
          // Don't fail the order processing if commission calculation fails
        }
      }

      // Send notification for order processing
      try {
        const orderCreator = await User.findById(order.createdBy);
        const processor = await User.findById(userId);

        if (orderCreator) {
          await notificationService.createInAppNotification(
            orderCreator._id.toString(),
            "Order Processing Update",
            `Your order ${order.orderNumber} is being processed by ${
              processor?.fullName || processor?.email || "Admin"
            }. Status: ${processedSuccessfully ? "Completed" : "Failed"}`,
            processedSuccessfully ? "success" : "error",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              status: processedSuccessfully ? "completed" : "failed",
              processedBy: processor?.fullName || processor?.email,
              type: "order_processing_update",
              navigationLink: this.getNavigationLink(
                orderCreator.userType,
                "orders"
              ),
            }
          );
        }

        // Notify super admins about order processing
        const superAdmins = await User.find(
          { userType: "super_admin" },
          "userType"
        );
        for (const admin of superAdmins) {
          await notificationService.createInAppNotification(
            admin._id.toString(),
            "Order Processed",
            `Order ${order.orderNumber} has been processed by ${
              processor?.fullName || processor?.email || "Admin"
            }. Status: ${processedSuccessfully ? "Completed" : "Failed"}`,
            processedSuccessfully ? "success" : "error",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              status: processedSuccessfully ? "completed" : "failed",
              processedBy: processor?.fullName || processor?.email,
              type: "order_processed",
              navigationLink: this.getNavigationLink(admin.userType, "orders"),
            }
          );
        }
      } catch (error) {
        logger.error(
          `Failed to send order processing notification: ${error.message}`
        );
      }

      return order;
    });
  }

  // Process bulk order
  async processBulkOrder(orderId, tenantId, userId) {
    const order = await Order.findOne({
      _id: orderId,
      tenantId,
    });

    if (!order) {
      throw new Error("Order not found");
    }

    if (order.orderType !== "bulk") {
      throw new Error("Order is not a bulk order");
    }

    // Process all pending items in the bulk order
    const pendingItems = order.items.filter(
      (item) => item.processingStatus === "pending"
    );

    for (const item of pendingItems) {
      try {
        await this.processOrderItem(orderId, item._id, tenantId, userId);
      } catch (error) {
        logger.error(`Failed to process bulk order item: ${error.message}`);
        // Continue processing other items
      }
    }

    logger.info(`Bulk order processing completed: ${orderId}`);

    // Send notification for bulk order processing
    try {
      const orderCreator = await User.findById(order.createdBy);
      const processor = await User.findById(userId);

      if (orderCreator) {
        await notificationService.createInAppNotification(
          orderCreator._id.toString(),
          "Bulk Order Processing Update",
          `Your bulk order ${order.orderNumber} is being processed by ${
            processor?.fullName || processor?.email || "Admin"
          }.`,
          "info",
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            processedBy: processor?.fullName || processor?.email,
            type: "bulk_order_processing_update",
            navigationLink: this.getNavigationLink(
              orderCreator.userType,
              "orders"
            ),
          }
        );
      }

      // Notify super admins about bulk order processing
      const superAdmins = await User.find(
        { userType: "super_admin" },
        "userType"
      );
      for (const admin of superAdmins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          "Bulk Order Processing",
          `Bulk order ${order.orderNumber} is being processed by ${
            processor?.fullName || processor?.email || "Admin"
          }.`,
          "info",
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            processedBy: processor?.fullName || processor?.email,
            type: "bulk_order_processing",
            navigationLink: this.getNavigationLink(admin.userType, "orders"),
          }
        );
      }
    } catch (error) {
      logger.error(
        `Failed to send bulk order processing notification: ${error.message}`
      );
    }

    return order;
  }

  // Simulate mobile bundle processing
  async processMobileBundle(item) {
    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Simulate random success/failure (90% success rate)
    const success = Math.random() > 0.1;

    if (!success) {
      throw new Error("Bundle activation failed - network error");
    }

    logger.info(`Bundle processed successfully for ${item.customerPhone}`);
  }

  // Get monthly revenue for user
  async getMonthlyRevenue(userId, userType = "agent") {
    const currentDate = new Date();
    const startOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1
    );
    const endOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    let matchCondition = {
      status: "completed",
      createdAt: { $gte: startOfMonth, $lte: endOfMonth },
    };

    // For business users, filter by orders they created (createdBy field)
    if (isBusinessUser(userType)) {
      matchCondition.createdBy = new mongoose.Types.ObjectId(userId);
    }
    // For super admin, get all orders (no additional filter needed)

    const result = await Order.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: null,
          monthlyRevenue: { $sum: "$total" },
          orderCount: { $sum: 1 },
        },
      },
    ]);

    return {
      monthlyRevenue: result[0]?.monthlyRevenue || 0,
      orderCount: result[0]?.orderCount || 0,
      month: currentDate.toLocaleString("default", {
        month: "long",
        year: "numeric",
      }),
    };
  }

  // Get daily spending for user (today's completed orders)
  async getDailySpending(userId, userType = "agent") {
    const currentDate = new Date();
    const startOfDay = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate()
    );
    const endOfDay = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate(),
      23,
      59,
      59,
      999
    );

    let matchCondition = {
      status: "completed",
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    };

    // For business users, filter by orders they created (createdBy field)
    if (isBusinessUser(userType)) {
      matchCondition.createdBy = new mongoose.Types.ObjectId(userId);
    }
    // For super admin, get all orders (no additional filter needed)

    const result = await Order.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: null,
          dailySpending: { $sum: "$total" },
          orderCount: { $sum: 1 },
        },
      },
    ]);

    return {
      dailySpending: result[0]?.dailySpending || 0,
      orderCount: result[0]?.orderCount || 0,
      date: currentDate.toISOString().split("T")[0],
    };
  }

  // Get order analytics
  async getOrderAnalytics(tenantId, timeframe = "30d") {
    // Convert timeframe to date
    const endDate = new Date();
    let startDate;

    switch (timeframe) {
      case "7d":
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "365d":
        startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const stats = await Order.aggregate([
      {
        $match: {
          tenantId: tenantId,
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          completedOrders: {
            $sum: { $cond: ["$status", 1, 0] },
          },
          totalRevenue: { $sum: "$total" },
          bulkOrders: {
            $sum: { $cond: [{ $eq: ["$orderType", "bulk"] }, 1, 0] },
          },
        },
      },
    ]);

    if (stats.length === 0) {
      return {
        totalOrders: 0,
        completedOrders: 0,
        totalRevenue: 0,
        bulkOrders: 0,
        completionRate: 0,
        timeframe,
      };
    }

    const result = stats[0];
    const completionRate =
      result.totalOrders > 0
        ? (result.completedOrders / result.totalOrders) * 100
        : 0;

    return {
      totalOrders: result.totalOrders,
      completedOrders: result.completedOrders,
      totalRevenue: result.totalRevenue,
      bulkOrders: result.bulkOrders,
      completionRate: Math.round(completionRate * 100) / 100,
      timeframe,
    };
  }

  // Process draft orders when wallet is topped up
  async processDraftOrders(userId, tenantId) {
    // Execute the main transaction
    const result = await this.executeWithTransaction(async (session) => {
      // Get all draft orders for the user
      const draftOrders = session
        ? await Order.find({
            createdBy: userId,
            tenantId,
            status: "draft",
          }).session(session)
        : await Order.find({
            createdBy: userId,
            tenantId,
            status: "draft",
          });

      if (draftOrders.length === 0) {
        return { processed: 0, message: "No draft orders found" };
      }

      // Get user's current wallet balance
      const user = session
        ? await User.findById(userId).session(session)
        : await User.findById(userId);

      if (!user) {
        throw new Error("User not found");
      }

      let totalRequired = 0;
      const processableOrders = [];

      // Calculate total required for all draft orders
      for (const order of draftOrders) {
        const orderTotal = order.items.reduce(
          (sum, item) => sum + item.totalPrice,
          0
        );
        totalRequired += orderTotal;
        processableOrders.push({ order, orderTotal });
      }

      // Check if user has sufficient balance
      if (user.walletBalance < totalRequired) {
        throw new Error(
          `Insufficient wallet balance to process all draft orders. Required: GH₵${totalRequired.toFixed(
            2
          )}, Available: GH₵${user.walletBalance.toFixed(2)}`
        );
      }

      // Process all draft orders
      let processedCount = 0;
      for (const { order, orderTotal } of processableOrders) {
        // Deduct wallet for this order
        if (session) {
          const newBalance = user.walletBalance - orderTotal;

          // Use atomic update to avoid tenantId validation issues
          await User.findByIdAndUpdate(
            userId,
            { $inc: { walletBalance: -orderTotal } },
            { session, new: false }
          );

          // Update local user object for consistency
          user.walletBalance = newBalance;

          // Record wallet transaction
          const transaction = new WalletTransaction({
            user: userId,
            type: "debit",
            amount: orderTotal,
            balanceAfter: newBalance,
            description: `Payment for draft order ${order.orderNumber}`,
            relatedOrder: order._id,
            metadata: { orderType: "draft_processing" },
          });
          await transaction.save({ session });
        } else {
          await walletService.debitWallet(
            userId.toString(),
            orderTotal,
            `Payment for draft order ${order.orderNumber}`,
            order._id,
            { orderType: "draft_processing" }
          );
        }

        // Update order status
        order.status = "pending"; // Changed from 'confirmed' to 'pending' for agents
        order.paymentStatus = "paid";

        if (session) {
          await order.save({ session });
        } else {
          await order.save();
        }

        processedCount++;
      }

      logger.info(
        `Processed ${processedCount} draft orders for user ${userId}`
      );

      return {
        processed: processedCount,
        message: `Successfully processed ${processedCount} draft orders`,
        totalAmount: totalRequired,
        user: user.toObject(),
      };
    });

    // Send notifications outside the transaction to avoid commit/abort issues
    try {
      const { processed, totalAmount, user } = result;

      if (processed > 0) {
        await notificationService.createInAppNotification(
          userId.toString(),
          "Draft Orders Processed",
          `Successfully processed ${processed} draft orders. Total amount: GH₵${totalAmount.toFixed(
            2
          )}`,
          "success",
          {
            processedCount: processed,
            totalAmount: totalAmount,
            type: "draft_orders_processed",
            navigationLink: this.getNavigationLink(user.userType, "orders"),
          }
        );

        // Notify super admins about draft order processing
        const superAdmins = await User.find(
          { userType: "super_admin" },
          "userType"
        );
        for (const admin of superAdmins) {
          await notificationService.createInAppNotification(
            admin._id.toString(),
            "Draft Orders Processed",
            `User ${
              user.email || user.name || "User"
            } processed ${processed} draft orders. Total amount: GH₵${totalAmount.toFixed(
              2
            )}`,
            "info",
            {
              processedCount: processed,
              totalAmount: totalAmount,
              userEmail: user.email,
              type: "draft_orders_processed",
              navigationLink: this.getNavigationLink(admin.userType, "orders"),
            }
          );
        }
      }
    } catch (error) {
      logger.error(
        `Failed to send draft order processing notification: ${error.message}`
      );
    }

    return {
      processed: result.processed,
      message: result.message,
      totalAmount: result.totalAmount,
    };
  }

  // Cancel order
  async cancelOrder(orderId, tenantId, userId, reason) {
    // Execute the main transaction
    const result = await this.executeWithTransaction(async (session) => {
      // For super admins (tenantId is null), don't filter by tenant
      // For regular users, filter by their tenant
      const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };

      const order = session
        ? await Order.findOne(query).session(session)
        : await Order.findOne(query);

      if (!order) {
        throw new Error("Order not found");
      }

      // Allow cancellation of pending, confirmed, and draft orders
      if (!["pending", "confirmed", "draft"].includes(order.status)) {
        throw new Error("Order cannot be cancelled in current status");
      }

      // For draft orders, permanently delete instead of just cancelling
      if (order.status === "draft") {
        if (session) {
          await Order.deleteOne({ _id: orderId }).session(session);
        } else {
          await Order.deleteOne({ _id: orderId });
        }

        logger.info(`Draft order deleted: ${order.orderNumber}`);

        return {
          ...order.toObject(),
          status: "deleted",
          isDraft: true,
          orderCreator: order.createdBy,
          deleter: userId,
        };
      }

      // Handle wallet refund for paid orders
      let refundAmount = 0;
      let refundTransaction = null;

      if (
        order.paymentStatus === "paid" &&
        order.paymentMethod === "wallet" &&
        order.total > 0
      ) {
        try {
          // Get the order creator
          const orderCreator = await User.findById(order.createdBy);
          if (!orderCreator) {
            throw new Error("Order creator not found");
          }

          refundAmount = order.total;

          // Refund the amount to the user's wallet
          refundTransaction = await walletService.creditWallet(
            order.createdBy.toString(),
            refundAmount,
            `Refund for cancelled order ${order.orderNumber}`,
            userId, // approvedBy
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              refundReason: reason || "Order cancelled",
              cancelledBy: userId,
            }
          );

          logger.info(
            `Wallet refund processed for order ${order.orderNumber}: ${refundAmount} GH₵ refunded to user ${order.createdBy}`
          );
        } catch (refundError) {
          logger.error(
            `Failed to process wallet refund for order ${order.orderNumber}: ${refundError.message}`
          );
          throw new Error(
            `Order cancellation failed: Unable to process refund - ${refundError.message}`
          );
        }
      }

      // Update item statuses
      for (const item of order.items) {
        if (item.processingStatus === "pending") {
          item.processingStatus = "cancelled";
        }
      }

      order.status = "cancelled";
      order.paymentStatus = refundAmount > 0 ? "refunded" : order.paymentStatus;
      order.notes = reason || "Order cancelled";
      order.processedBy = userId;

      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }

      logger.info(
        `Order cancelled: ${order.orderNumber}${
          refundAmount > 0 ? ` with ${refundAmount} GH₵ refund` : ""
        }`
      );

      return {
        order: order.toObject(),
        orderCreator: order.createdBy,
        canceller: userId,
        isDraft: false,
        refundAmount,
        refundTransaction,
      };
    });

    // Send notifications outside the transaction to avoid commit/abort issues
    try {
      const {
        order,
        orderCreator,
        canceller,
        isDraft,
        refundAmount,
        refundTransaction,
      } = result;

      if (isDraft) {
        // Send notification for draft order deletion
        const orderCreatorUser = await User.findById(orderCreator);
        const deleterUser = await User.findById(result.deleter);

        if (orderCreatorUser) {
          await notificationService.createInAppNotification(
            orderCreatorUser._id.toString(),
            "Draft Order Deleted",
            `Your draft order ${order.orderNumber} has been deleted by ${
              deleterUser?.fullName || deleterUser?.email || "Admin"
            }.`,
            "info",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              deletedBy: deleterUser?.fullName || deleterUser?.email,
              type: "draft_order_deleted",
              navigationLink: this.getNavigationLink(
                orderCreatorUser.userType,
                "orders"
              ),
            }
          );
        }
      } else {
        // Send notification for order cancellation
        const orderCreatorUser = await User.findById(orderCreator);
        const cancellerUser = await User.findById(canceller);

        let notificationMessage = `Your order ${
          order.orderNumber
        } has been cancelled by ${
          cancellerUser?.fullName || cancellerUser?.email || "Admin"
        }. Reason: ${reason || "No reason provided"}`;

        // Add refund information to the notification
        if (refundAmount > 0) {
          notificationMessage += `\n\n💰 Refund: GH₵${refundAmount} has been credited back to your wallet.`;
        }

        if (orderCreatorUser) {
          await notificationService.createInAppNotification(
            orderCreatorUser._id.toString(),
            "Order Cancelled",
            notificationMessage,
            "error",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              cancelledBy: cancellerUser?.fullName || cancellerUser?.email,
              reason: reason || "No reason provided",
              refundAmount,
              type: "order_cancelled",
              navigationLink: this.getNavigationLink(
                orderCreatorUser.userType,
                "orders"
              ),
            }
          );
        }

        // Notify super admins about order cancellation
        const superAdmins = await User.find(
          { userType: "super_admin" },
          "userType"
        );
        for (const admin of superAdmins) {
          let adminMessage = `Order ${
            order.orderNumber
          } has been cancelled by ${
            cancellerUser?.fullName || cancellerUser?.email || "Admin"
          }. Reason: ${reason || "No reason provided"}`;

          if (refundAmount > 0) {
            adminMessage += `\n\n💰 Refund: GH₵${refundAmount} has been refunded to the user's wallet.`;
          }

          await notificationService.createInAppNotification(
            admin._id.toString(),
            "Order Cancelled",
            adminMessage,
            "warning",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              cancelledBy: cancellerUser?.fullName || cancellerUser?.email,
              reason: reason || "No reason provided",
              refundAmount,
              type: "order_cancelled",
              navigationLink: this.getNavigationLink(admin.userType, "orders"),
            }
          );
        }
      }
    } catch (error) {
      logger.error(
        `Failed to send order cancellation notification: ${error.message}`
      );
    }

    return result.order || result;
  }

  // Report data delivery issue
  async reportOrder(orderId, tenantId, userId, description) {
    // Find the order
    const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };
    const order = await Order.findOne(query);

    if (!order) {
      throw new Error("Order not found");
    }

    // Only allow reporting on completed orders
    if (order.status !== "completed") {
      throw new Error("Can only report issues on completed orders");
    }

    // Check if order is older than 3 days
    const orderDate = new Date(order.createdAt);
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    if (orderDate < threeDaysAgo) {
      throw new Error("Cannot report issues on orders older than 3 days");
    }

    // Get the reporter user info
    const reporter = await User.findById(userId);
    if (!reporter) {
      throw new Error("Reporter not found");
    }

    // Create a report record (you might want to create a separate Report model for this)
    const reportId = new mongoose.Types.ObjectId();

    // Log the report
    logger.info(
      `Data delivery issue reported: Order ${order.orderNumber} by user ${
        reporter.fullName || reporter.email
      }`
    );

    // Send notification to super admin
    try {
      // Find super admin users
      const superAdmins = await User.find({ userType: "super_admin" });

      for (const admin of superAdmins) {
        await notificationService.createNotification(
          admin._id.toString(),
          "Data Delivery Issue Reported",
          `User ${
            reporter.fullName || reporter.email
          } reported that data was not delivered for order ${
            order.orderNumber
          } (${order.items[0]?.customerPhone || "N/A"}). Issue: ${description}`,
          "warning",
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            phoneNumber: order.items[0]?.customerPhone || "N/A",
            reporterName: reporter.fullName || reporter.email,
            reporterId: userId,
            description,
            reportId: reportId.toString(),
            type: "data_delivery_report",
            navigationLink: this.getNavigationLink(admin.userType, "orders"),
          }
        );
      }
    } catch (error) {
      logger.error(
        `Failed to send data delivery report notification: ${error.message}`
      );
    }

    return {
      order: order.toObject(),
      reportId: reportId.toString(),
      reporter: {
        id: userId,
        name: reporter.fullName || reporter.email,
      },
    };
  }
}

export default new OrderService();
