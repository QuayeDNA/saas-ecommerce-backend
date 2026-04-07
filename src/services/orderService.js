// src/services/orderService.js
import Order from "../models/Order.js";
import Bundle from "../models/Bundle.js";
import User from "../models/User.js";
import walletService from "./walletService.js";
import notificationService from "./notificationService.js";
import pushNotificationService from "./pushNotificationService.js";
import duplicateOrderPreventionService from "./duplicateOrderPreventionService.js";
import commissionService from "./commissionService.js";
import websocketService from "./websocketService.js";
import AgentStorefront from "../models/AgentStorefront.js";
import storefrontService from "./storefrontService.js";
import EarningsTransaction from "../models/EarningsTransaction.js";
import earningsService from "./earningsService.js";
import mongoose from "mongoose";
import logger from "../utils/logger.js";
import { computeStorefrontProfit } from "../utils/storefrontProfit.js";
import { parseBulkOrderRow } from "../utils/parseBulkOrderRow.js";
import { saveOrderWithRetry } from "../utils/orderSaveHelper.js";
import { isBusinessUser } from "../utils/userTypeHelpers.js";
import { getPriceForUserType } from "../utils/pricingHelpers.js";

class OrderService {
  // ─── Navigation Helper ────────────────────────────────────────────────────────

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
      admin: { wallet: "/admin/wallet", orders: "/admin/orders" },
    };
    return routes[userType]?.[page] || `/${page}`;
  }

  // ─── Transaction Support ──────────────────────────────────────────────────────

  /**
   * Run `operation(session)` inside a MongoDB transaction when the deployment
   * supports it (replica set / Atlas). Gracefully falls back to no-session on
   * standalone MongoDB (local dev / Render free tier).
   *
   * CRITICAL: Only falls back for topology errors. All other errors (E11000,
   * validation, business logic) are re-thrown immediately — running the
   * operation twice would cause double wallet debits.
   */
  async executeWithTransaction(operation) {
    if (process.env.FORCE_NO_TRANSACTIONS === "true") {
      return operation(null);
    }

    const isTopologyError = (err) => {
      const msg = (err?.message || "").toLowerCase();
      const code = err?.code;
      if ([20, 61, 263].includes(code)) return true;
      return (
        msg.includes("transaction numbers are only allowed") ||
        msg.includes("replica set") ||
        msg.includes("transactions are not") ||
        msg.includes("does not support transactions") ||
        msg.includes("cannot use a session that is not in a transaction")
      );
    };

    let session = null;
    let sessionStarted = false;

    try {
      session = await mongoose.startSession();
      session.startTransaction();
      sessionStarted = true;

      const result = await operation(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session) {
        try {
          if (session.transaction?.state === "TRANSACTION_STARTED") {
            await session.abortTransaction();
          }
        } catch (abortErr) {
          logger.warn("Failed to abort transaction:", abortErr.message);
        }
      }

      if (!sessionStarted || isTopologyError(error)) {
        logger.warn(
          "MongoDB transactions not supported, running without session:",
          error.message,
        );
        try {
          return await operation(null);
        } catch (fallbackError) {
          logger.error("Fallback operation failed:", fallbackError.message);
          throw fallbackError;
        }
      }

      throw error;
    } finally {
      if (session) {
        try {
          session.endSession();
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ─── Storefront Profit Credit ─────────────────────────────────────────────────

  /**
   * Credits the agent's earningsBalance with the markup profit for a completed
   * storefront order. Must be called from EVERY path that sets a storefront
   * order to status:'completed'.
   *
   * IDEMPOTENCY — safe to call multiple times:
   *   Primary:   EarningsTransaction.findOne({ relatedOrder, type:'credit' })
   *   Secondary: order.metadata.profitCredited flag (avoids repeated DB queries)
   *
   * Never throws — earnings credit must never block order completion.
   *
   * @param {import('mongoose').Document} order  Populated order document
   */
  async _creditStorefrontProfit(order) {
    if (!order || order.orderType !== "storefront") return;
    if (order.status !== "completed") return;

    // Fast-path: already marked on in-memory document
    if (order.metadata?.profitCredited) return;

    const profitData = computeStorefrontProfit(order);
    const creditAmount = Number(profitData.profit) || 0;
    if (creditAmount <= 0) {
      logger.info(
        `[OrderService] _creditStorefrontProfit — zero profit, skipping`,
        {
          orderId: order._id,
          orderNumber: order.orderNumber,
        },
      );
      return;
    }

    try {
      // Primary idempotency: check the immutable ledger first
      const existingTxn = await EarningsTransaction.findOne({
        relatedOrder: order._id,
        type: "credit",
      });
      if (existingTxn) {
        // Keep flag in sync
        await Order.findByIdAndUpdate(order._id, {
          "metadata.profitCredited": true,
        }).catch(() => {});
        return;
      }

      // Resolve agentId via storefront (authoritative) then fall back to createdBy
      let agentId = order.createdBy;
      if (order.storefrontData?.storefrontId) {
        const sf = await AgentStorefront.findById(
          order.storefrontData.storefrontId,
        )
          .select("agentId")
          .lean();
        if (sf?.agentId) agentId = sf.agentId;
      }

      if (!agentId) {
        logger.error(
          `[OrderService] _creditStorefrontProfit — cannot resolve agentId`,
          {
            orderId: order._id,
            orderNumber: order.orderNumber,
          },
        );
        return;
      }

      const { user: updatedAgent } =
        await earningsService.creditStorefrontProfit({
          userId: agentId,
          amount: creditAmount,
          orderId: order._id,
          description: `Storefront profit — Order ${order.orderNumber}`,
          metadata: {
            source: "storefront_profit",
            orderNumber: order.orderNumber,
            storefrontId: order.storefrontData.storefrontId?.toString(),
            customerTotal: profitData.customerTotal,
            tierCost: profitData.tierCost,
            markup: profitData.totalMarkup,
            paystackFee: profitData.paystackFee,
            profit: creditAmount,
            itemCount: (order.storefrontData?.items || []).length,
          },
        });

      // Mark order to short-circuit future calls
      await Order.findByIdAndUpdate(order._id, {
        "metadata.profitCredited": true,
      }).catch(() => {});

      logger.info(
        `[OrderService] Credited GH₵${creditAmount.toFixed(2)} to agent ${agentId} ` +
          `for order ${order.orderNumber}. New balance: GH₵${updatedAgent.earningsBalance.toFixed(2)}`,
      );
    } catch (err) {
      // Never propagate — order completion must not be blocked by earnings credit
      logger.error(`[OrderService] _creditStorefrontProfit failed`, {
        orderId: order._id,
        orderNumber: order.orderNumber,
        error: err.message,
      });
    }
  }

  async _removeStorefrontProfit(
    order,
    reason = "storefront_refund",
    session = null,
  ) {
    if (!order || order.orderType !== "storefront")
      return { removed: false, amount: 0 };

    let agentId = order.createdBy;
    if (order.storefrontData?.storefrontId) {
      const sf = await AgentStorefront.findById(
        order.storefrontData.storefrontId,
      )
        .select("agentId")
        .lean();
      if (sf?.agentId) agentId = sf.agentId;
    }

    if (!agentId) {
      logger.error(
        "[OrderService] _removeStorefrontProfit — agentId not found",
        {
          orderId: order._id,
        },
      );
      return { removed: false, amount: 0 };
    }

    const reversal =
      await earningsService.removeStorefrontProfitCreditsForOrder({
        userId: agentId,
        orderId: order._id,
        session,
      });

    if (!reversal.removed) {
      if (order.metadata?.profitCredited) {
        order.metadata.profitCredited = false;
        order.metadata.profitReversedAt = new Date();
        order.metadata.profitReversedReason = reason;
        session ? await order.save({ session }) : await order.save();
      }
      return { removed: false, amount: 0 };
    }

    order.metadata = order.metadata || {};
    order.metadata.profitCredited = false;
    order.metadata.profitReversedAt = new Date();
    order.metadata.profitReversedReason = reason;
    session ? await order.save({ session }) : await order.save();

    logger.info("[OrderService] Storefront profit removed", {
      orderId: order._id,
      amount: reversal.amount,
      reason,
    });

    return { removed: true, amount: reversal.amount };
  }

  // ─── Create Single Order ──────────────────────────────────────────────────────

  async createSingleOrder(orderData, tenantId, userId) {
    if (!tenantId)
      throw new Error(
        "tenantId must be provided and cannot be null or undefined",
      );
    const tenantIdStr = tenantId.toString();

    const duplicateCheck =
      await duplicateOrderPreventionService.checkForDuplicates(
        orderData,
        userId,
        tenantIdStr,
        { forceOverride: orderData.forceOverride },
      );
    if (duplicateCheck.isDuplicate && !duplicateCheck.canProceed) {
      const error = new Error(duplicateCheck.message);
      error.code = "DUPLICATE_ORDER_DETECTED";
      error.duplicateInfo = duplicateCheck;
      throw error;
    }

    const result = await this.executeWithTransaction(async (session) => {
      const {
        packageGroupId,
        packageItemId,
        customerPhone,
        bundleSize,
        quantity = 1,
      } = orderData;

      const findBundle = (q) =>
        session
          ? Bundle.findOne(q)
              .populate("providerId", "name code")
              .session(session)
          : Bundle.findOne(q).populate("providerId", "name code");

      const bundle =
        (await findBundle({
          _id: packageItemId,
          packageId: packageGroupId,
          isActive: true,
          isDeleted: false,
        })) ||
        (await findBundle({
          _id: packageItemId,
          isActive: true,
          isDeleted: false,
        }));
      if (!bundle) throw new Error("Bundle not found or inactive");

      const user = session
        ? await User.findById(userId).session(session)
        : await User.findById(userId);
      if (!user) throw new Error("User not found");

      const userPrice = getPriceForUserType(bundle, user.userType);
      const orderTotal = userPrice * quantity;

      let orderStatus = "pending";
      let paymentStatus = "pending";

      if (user.walletBalance >= orderTotal) {
        const idempotencyKey = `single_order_${userId}_${customerPhone}_${Date.now()}`;
        await walletService.debitWallet(
          userId.toString(),
          orderTotal,
          `Payment for order (${customerPhone})`,
          null,
          { orderType: "single", idempotencyKey },
          session,
        );
        paymentStatus = "paid";
        if (user.userType === "super_admin") orderStatus = "confirmed";
        logger.info(
          `Wallet deducted GH₵${orderTotal.toFixed(2)} for new order (${customerPhone})`,
        );
      } else {
        orderStatus = "draft";
        paymentStatus = "pending";
        logger.info(
          `Order created as draft — insufficient balance. ` +
            `Required: GH₵${orderTotal.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}`,
        );
      }

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
              price: userPrice,
              dataVolume: bundle.dataVolume,
              validity: bundle.validity,
              provider: bundle.providerId?.code || bundle.providerId?.name,
            },
            quantity,
            unitPrice: userPrice,
            totalPrice: orderTotal,
            customerPhone,
            bundleSize: bundleSize
              ? { value: bundleSize.value, unit: bundleSize.unit || "GB" }
              : undefined,
          },
        ],
        paymentMethod: "wallet",
        status: orderStatus,
        paymentStatus,
      });

      await saveOrderWithRetry(order, session);
      logger.info(
        orderStatus === "draft"
          ? `Draft order created (insufficient balance). Required: GH₵${orderTotal.toFixed(2)}`
          : `Order created: ${order.orderNumber}`,
      );

      return {
        order: order.toObject(),
        user: user.toObject(),
        orderTotal,
        paymentStatus,
      };
    });

    // Notifications outside transaction
    try {
      console.log(
        "Notification code reached for order " + result.order.orderNumber,
      );
      const { order, user, orderTotal, paymentStatus } = result;
      const superAdmins = await User.find(
        { userType: { $in: ["super_admin", "admin"] } },
        "userType",
      );
      console.log("Found " + superAdmins.length + " admins");
      const superAdminIds = superAdmins.map((a) => a._id.toString());

      const creatorName = user.fullName || user.name || user.email;
      const creatorLabel = user.agentCode
        ? `${creatorName} (${user.agentCode})`
        : creatorName;

      for (const admin of superAdmins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          "New Order Created",
          `Order ${order.orderNumber} created by ${creatorLabel}. Amount: GH₵${orderTotal.toFixed(2)}`,
          "info",
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            amount: orderTotal,
            creatorName,
            creatorAgentCode: user.agentCode || null,
            type: "new_order_created",
            navigationLink: this.getNavigationLink(admin.userType, "orders"),
          },
        );
      }

      if (superAdminIds.length > 0) {
        console.log(
          "Broadcasting to " +
            superAdminIds.length +
            " admin WebSocket clients",
        );
        websocketService.broadcastOrderCreatedToAdmins(
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            status: order.status,
            paymentStatus,
            total: orderTotal,
            orderType: order.orderType,
            createdBy: {
              id: user._id,
              name: creatorName,
              email: user.email,
              agentCode: user.agentCode,
            },
            items: order.items,
            createdAt: order.createdAt,
          },
          superAdminIds,
        );
      } else {
        console.log("No admin IDs found for broadcasting");
      }

      await notificationService.createInAppNotification(
        userId.toString(),
        "Order Created Successfully",
        `Order ${order.orderNumber} ${paymentStatus === "paid" ? "created and paid" : "created as draft"}. GH₵${orderTotal.toFixed(2)} ${paymentStatus === "paid" ? "deducted" : "required"}.`,
        "info",
        {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          amount: orderTotal,
          paymentStatus,
          type: "order_created",
          navigationLink: this.getNavigationLink(user.userType, "orders"),
        },
      );

      try {
        await pushNotificationService.sendOrderStatusUpdate(
          userId.toString(),
          order,
          order.status,
        );
      } catch (pushErr) {
        logger.error(`Push notification failed: ${pushErr.message}`);
      }
    } catch (err) {
      console.error(`Order creation notification failed: ${err.message}`);
      logger.error(`Order creation notification failed: ${err.message}`);
    }

    return result.order;
  }

  // ─── Create Bulk Orders ───────────────────────────────────────────────────────

  async createBulkOrders({
    items,
    tenantId,
    userId,
    packageId,
    forceOverride = false,
  }) {
    if (!tenantId)
      throw new Error(
        "tenantId must be provided and cannot be null or undefined",
      );
    const tenantIdStr = tenantId.toString();

    const duplicateCheck =
      await duplicateOrderPreventionService.checkForDuplicates(
        { items, packageId, forceOverride },
        userId,
        tenantIdStr,
        { forceOverride },
      );
    if (duplicateCheck.isDuplicate && !duplicateCheck.canProceed) {
      const error = new Error(duplicateCheck.message);
      error.code = "DUPLICATE_ORDER_DETECTED";
      error.duplicateInfo = duplicateCheck;
      throw error;
    }

    const result = await this.executeWithTransaction(async (session) => {
      const createdOrders = [];
      const errors = [];
      const orderItems = [];

      const toObjectId = (id) =>
        id instanceof mongoose.Types.ObjectId
          ? id
          : new mongoose.Types.ObjectId(String(id));

      const tenantObjectId = toObjectId(tenantIdStr);
      const userObjectId = toObjectId(userId);

      // First pass: validate all items
      for (let i = 0; i < items.length; i++) {
        const parsed = parseBulkOrderRow(items[i]);
        if (parsed.error) {
          errors.push({ index: i, row: items[i], error: parsed.error });
          continue;
        }

        const bundle = session
          ? await Bundle.findOne({
              packageId,
              dataVolume: parsed.value.bundleSize.value,
              dataUnit: parsed.value.bundleSize.unit,
              isActive: true,
              isDeleted: false,
            })
              .populate("providerId", "name code")
              .session(session)
          : await Bundle.findOne({
              packageId,
              dataVolume: parsed.value.bundleSize.value,
              dataUnit: parsed.value.bundleSize.unit,
              isActive: true,
              isDeleted: false,
            }).populate("providerId", "name code");

        if (!bundle) {
          errors.push({
            index: i,
            row: items[i],
            error: "Bundle not found for specified volume/unit in this package",
          });
          continue;
        }
        orderItems.push({ index: i, bundle, parsed: parsed.value });
      }

      const user = session
        ? await User.findById(userId).session(session)
        : await User.findById(userId);
      if (!user) throw new Error("User not found");

      const totalOrderAmount = orderItems.reduce(
        (sum, item) => sum + getPriceForUserType(item.bundle, user.userType),
        0,
      );
      const canProcessAll = user.walletBalance >= totalOrderAmount;

      if (!canProcessAll) {
        logger.info(
          `Insufficient balance for bulk order. Required: GH₵${totalOrderAmount.toFixed(2)}, ` +
            `Available: GH₵${user.walletBalance.toFixed(2)}. Creating as drafts.`,
        );
      } else {
        const idempotencyKey = `bulk_order_${userId}_${orderItems.length}_${Date.now()}`;
        await walletService.debitWallet(
          userId.toString(),
          totalOrderAmount,
          `Bulk order payment for ${orderItems.length} items`,
          null,
          { orderType: "bulk", itemCount: orderItems.length, idempotencyKey },
          session,
        );
        logger.info(
          `Wallet deducted GH₵${totalOrderAmount.toFixed(2)} for bulk order (${orderItems.length} items)`,
        );
      }

      // Second pass: create orders
      for (const { bundle, parsed, index } of orderItems) {
        const userPrice = getPriceForUserType(bundle, user.userType);
        const orderStatus = canProcessAll
          ? user.userType === "super_admin"
            ? "confirmed"
            : "pending"
          : "draft";
        const paymentStatus = canProcessAll ? "paid" : "pending";

        try {
          const order = new Order({
            orderType: "single",
            tenantId: tenantObjectId,
            createdBy: userObjectId,
            items: [
              {
                packageGroup: bundle.packageId,
                packageItem: bundle._id,
                packageDetails: {
                  name: bundle.name,
                  code: bundle._id.toString(),
                  price: userPrice,
                  dataVolume: bundle.dataVolume,
                  validity: bundle.validity,
                  validityUnit: bundle.validityUnit,
                  provider: bundle.providerId?.code || bundle.providerId?.name,
                },
                quantity: 1,
                unitPrice: userPrice,
                totalPrice: userPrice,
                customerPhone: parsed.customerPhone,
                bundleSize: parsed.bundleSize,
                processingStatus: "pending",
              },
            ],
            status: orderStatus,
            paymentStatus,
          });
          await (session
            ? saveOrderWithRetry(order, session)
            : saveOrderWithRetry(order));
          createdOrders.push(order);
        } catch (err) {
          errors.push({ index, row: items[index], error: err.message });
        }
      }

      return {
        successCount: createdOrders.length,
        failedCount: errors.length,
        failedRecords: errors,
        orders: createdOrders.map((o) => o._id),
        totalAmount: totalOrderAmount,
        user: user.toObject(),
        orderCount: createdOrders.length,
      };
    });

    try {
      const { user, orderCount, totalAmount } = result;
      const superAdmins = await User.find(
        { userType: { $in: ["super_admin", "admin"] } },
        "userType",
      );
      const creatorName = user.fullName || user.name || user.email;
      const creatorLabel = user.agentCode
        ? `${creatorName} (${user.agentCode})`
        : creatorName;

      for (const admin of superAdmins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          "Bulk Order Created",
          `Bulk order with ${orderCount} items created by ${creatorLabel}. Total: GH₵${totalAmount.toFixed(2)}`,
          "info",
          {
            orderCount,
            totalAmount,
            creatorName,
            creatorAgentCode: user.agentCode || null,
            type: "bulk_order_created",
            navigationLink: this.getNavigationLink(admin.userType, "orders"),
          },
        );
      }
      await notificationService.createInAppNotification(
        userId.toString(),
        "Bulk Order Created Successfully",
        `Bulk order with ${orderCount} items created and paid. GH₵${totalAmount.toFixed(2)} deducted. Automatic refund for any failed orders.`,
        "info",
        {
          orderCount,
          totalAmount,
          type: "bulk_order_created",
          navigationLink: this.getNavigationLink(user.userType, "orders"),
        },
      );
    } catch (err) {
      logger.error(`Bulk order notification failed: ${err.message}`);
    }

    return {
      successCount: result.successCount,
      failedCount: result.failedCount,
      failedRecords: result.failedRecords,
      orders: result.orders,
      totalAmount: result.totalAmount,
    };
  }

  // ─── Get Orders ───────────────────────────────────────────────────────────────

  async getOrders(
    tenantId,
    filters = {},
    pagination = {},
    currentUserId = null,
  ) {
    try {
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
        receptionStatus,
        startDate,
        endDate,
        search,
        createdBy,
        provider,
        reported,
        excludeResolvedAfter3Days,
      } = filters;

      const query = tenantId ? { tenantId } : {};

      if (status) query.status = status;
      if (orderType) query.orderType = orderType;
      if (paymentStatus) query.paymentStatus = paymentStatus;
      if (receptionStatus) query.receptionStatus = receptionStatus;
      if (createdBy) query.createdBy = createdBy;
      if (reported !== undefined) query.reported = reported;

      if (excludeResolvedAfter3Days) {
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
        const twentyFourHoAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { receptionStatus: { $ne: "resolved" } },
            {
              receptionStatus: "resolved",
              resolvedAt: { $exists: true, $gte: tenMinAgo },
            },
            {
              receptionStatus: "resolved",
              resolvedAt: { $exists: false },
              updatedAt: { $gte: tenMinAgo },
            },
          ],
        });
        query.$and.push({
          $or: [
            { reported: { $ne: true } },
            { receptionStatus: "resolved" },
            {
              reported: true,
              receptionStatus: { $in: ["not_received", "checking"] },
              reportedAt: { $exists: true, $gte: twentyFourHoAgo },
            },
          ],
        });
      }

      if (status === "draft") {
        if (currentUserId) query.createdBy = currentUserId;
        else query.status = { $ne: "draft" };
      } else if (!status && currentUserId) {
        query.$or = [
          { status: { $nin: ["draft", "pending_payment"] } },
          { status: "draft", createdBy: currentUserId },
        ];
      } else if (!status) {
        query.status = { $nin: ["draft", "pending_payment"] };
      }

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      if (provider) query["items.packageDetails.provider"] = provider;

      if (search) {
        const searchConds = [
          { orderNumber: { $regex: search, $options: "i" } },
          { "customerInfo.name": { $regex: search, $options: "i" } },
          { "customerInfo.phone": { $regex: search, $options: "i" } },
          { "items.customerPhone": { $regex: search, $options: "i" } },
        ];
        if (query.$or) {
          const existing = query.$or;
          delete query.$or;
          query.$and = [
            ...(query.$and || []),
            { $or: existing },
            { $or: searchConds },
          ];
        } else {
          query.$or = searchConds;
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
    } catch (error) {
      logger.error(`Get orders error: ${error.message}`);
      throw new Error("Failed to get orders");
    }
  }

  // ─── Process Order Item ───────────────────────────────────────────────────────

  async processOrderItem(orderId, itemId, tenantId, userId) {
    return await this.executeWithTransaction(async (session) => {
      const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };
      const order = session
        ? await Order.findOne(query).session(session)
        : await Order.findOne(query);
      if (!order) throw new Error("Order not found");

      const item = order.items.id(itemId);
      if (!item) throw new Error("Order item not found");
      if (item.processingStatus !== "pending")
        throw new Error("Order item is not in pending status");

      item.processingStatus = "processing";
      item.processedBy = userId;
      session ? await order.save({ session }) : await order.save();

      let processedSuccessfully = false;
      try {
        await this.processMobileBundle(item);
        item.processingStatus = "completed";
        item.processedAt = new Date();
        processedSuccessfully = true;
      } catch (processingErr) {
        item.processingStatus = "failed";
        item.processingError = processingErr.message;
      }

      await order.updateStatus();
      session ? await order.save({ session }) : await order.save();

      logger.info(
        `Order ${order.orderNumber} → ${order.status} (success: ${processedSuccessfully})`,
      );

      // Refund on failure
      if (!processedSuccessfully && order.paymentStatus === "paid") {
        try {
          if (
            order.orderType === "storefront" &&
            order.storefrontData?.paymentMethod?.type === "paystack"
          ) {
            const refundAmount = Number(order.total) || 0;
            const refund = await storefrontService.refundPaystackOrder(
              order._id,
              {
                amount: refundAmount,
                reason: "order_failed",
              },
            );

            order.paymentStatus = "refunded";
            order.metadata = order.metadata || {};
            order.metadata.paystackRefund = {
              status: "success",
              reference: order.storefrontData?.paymentMethod?.reference,
              amount: refundAmount,
              reason: "order_failed",
              refundId: refund?.id || refund?.refund_id,
              refundedAt: new Date(),
            };

            await this._removeStorefrontProfit(order, "order_failed", session);
            session ? await order.save({ session }) : await order.save();

            logger.info(
              `Paystack refund initiated for failed storefront order ${order.orderNumber}`,
            );
          } else {
            const orderCreator = session
              ? await User.findById(order.createdBy).session(session)
              : await User.findById(order.createdBy);
            if (!orderCreator) throw new Error("Order creator not found");

            const refundAmount = order.items.reduce(
              (s, i) => s + i.totalPrice,
              0,
            );
            await walletService.creditWallet(
              order.createdBy.toString(),
              refundAmount,
              `Refund for failed order ${order.orderNumber}`,
              order._id,
              { orderType: order.orderType, refundReason: "order_failed" },
              session,
            );
            order.paymentStatus = "refunded";
            order.items.forEach((i) => {
              i.paymentStatus = "Refunded";
            });
            session ? await order.save({ session }) : await order.save();
            logger.info(
              `Refunded GH₵${refundAmount.toFixed(2)} for failed order ${order.orderNumber}`,
            );

            await notificationService.createInAppNotification(
              order.createdBy.toString(),
              "Order Refunded",
              `Order ${order.orderNumber} failed. GH₵${refundAmount.toFixed(2)} refunded to your wallet.`,
              "info",
              {
                orderId: order._id.toString(),
                orderNumber: order.orderNumber,
                refundAmount,
                type: "order_refund",
                navigationLink: this.getNavigationLink(
                  orderCreator.userType,
                  "wallet",
                ),
              },
            );
          }
        } catch (refundErr) {
          if (
            order.orderType === "storefront" &&
            order.storefrontData?.paymentMethod?.type === "paystack"
          ) {
            order.metadata = order.metadata || {};
            order.metadata.paystackRefund = {
              status: "failed",
              reference: order.storefrontData?.paymentMethod?.reference,
              amount: Number(order.total) || 0,
              reason: "order_failed",
              error: refundErr.message,
              failedAt: new Date(),
            };
            session ? await order.save({ session }) : await order.save();
          }
          logger.error(
            `Refund error for order ${order.orderNumber}: ${refundErr.message}`,
          );
        }
      }

      // Commission update (non-storefront business users)
      if (
        processedSuccessfully &&
        order.status === "completed" &&
        order.createdBy
      ) {
        try {
          const agent = await User.findById(order.createdBy);
          if (agent && isBusinessUser(agent.userType)) {
            await commissionService.updateCommissionRealTime(order._id);
          }
        } catch (commErr) {
          logger.error(
            `Commission update failed for order ${order._id}: ${commErr.message}`,
          );
        }
      }

      // Storefront profit credit — called here AND in markOrderCompleted to cover all paths
      if (
        processedSuccessfully &&
        order.status === "completed" &&
        order.orderType === "storefront"
      ) {
        await this._creditStorefrontProfit(order);
      }

      // Notifications
      try {
        const [orderCreator, processor, superAdmins] = await Promise.all([
          User.findById(order.createdBy),
          User.findById(userId),
          User.find({ userType: "super_admin" }, "userType"),
        ]);
        const processorName =
          processor?.fullName || processor?.email || "Admin";
        const statusLabel = processedSuccessfully ? "Completed" : "Failed";

        if (orderCreator) {
          await notificationService.createInAppNotification(
            orderCreator._id.toString(),
            "Order Processing Update",
            `Order ${order.orderNumber} processed by ${processorName}. Status: ${statusLabel}`,
            processedSuccessfully ? "success" : "error",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              status: order.status,
              type: "order_processing_update",
              navigationLink: this.getNavigationLink(
                orderCreator.userType,
                "orders",
              ),
            },
          );
        }
        for (const admin of superAdmins) {
          await notificationService.createInAppNotification(
            admin._id.toString(),
            "Order Processed",
            `Order ${order.orderNumber} processed by ${processorName}. Status: ${statusLabel}`,
            processedSuccessfully ? "success" : "error",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              status: order.status,
              type: "order_processed",
              navigationLink: this.getNavigationLink(admin.userType, "orders"),
            },
          );
        }
      } catch (notifErr) {
        logger.error(
          `Order processing notification failed: ${notifErr.message}`,
        );
      }

      return order;
    });
  }

  // ─── Process Bulk Order ───────────────────────────────────────────────────────

  async processBulkOrder(orderId, tenantId, userId) {
    const order = await Order.findOne({ _id: orderId, tenantId });
    if (!order) throw new Error("Order not found");
    if (order.orderType !== "bulk")
      throw new Error("Order is not a bulk order");

    const pendingItems = order.items.filter(
      (i) => i.processingStatus === "pending",
    );
    for (const item of pendingItems) {
      try {
        await this.processOrderItem(orderId, item._id, tenantId, userId);
      } catch (err) {
        logger.error(`Bulk order item failed: ${err.message}`);
      }
    }
    logger.info(`Bulk order processing completed: ${orderId}`);

    try {
      const [orderCreator, processor, superAdmins] = await Promise.all([
        User.findById(order.createdBy),
        User.findById(userId),
        User.find({ userType: "super_admin" }, "userType"),
      ]);
      const processorName = processor?.fullName || processor?.email || "Admin";
      if (orderCreator) {
        await notificationService.createInAppNotification(
          orderCreator._id.toString(),
          "Bulk Order Processing Update",
          `Bulk order ${order.orderNumber} processed by ${processorName}.`,
          "info",
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            type: "bulk_order_processing_update",
            navigationLink: this.getNavigationLink(
              orderCreator.userType,
              "orders",
            ),
          },
        );
      }
      for (const admin of superAdmins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          "Bulk Order Processing",
          `Bulk order ${order.orderNumber} processed by ${processorName}.`,
          "info",
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            type: "bulk_order_processing",
            navigationLink: this.getNavigationLink(admin.userType, "orders"),
          },
        );
      }
    } catch (err) {
      logger.error(`Bulk order notification failed: ${err.message}`);
    }

    return order;
  }

  // ─── Simulate Bundle Processing ───────────────────────────────────────────────

  /** Placeholder — replace with your real provider API integration. */
  async processMobileBundle(item) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (Math.random() < 0.1)
      throw new Error("Bundle activation failed — network error");
    logger.info(`Bundle processed for ${item.customerPhone}`);
  }

  // ─── Mark Order Completed (Admin direct path) ─────────────────────────────────

  /**
   * Used when an admin confirms a bundle was delivered via the provider dashboard
   * (i.e. not through processOrderItem). Ensures _creditStorefrontProfit is always
   * called regardless of how the order reaches 'completed' status.
   */
  async markOrderCompleted(orderId, adminId, tenantId = null) {
    const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };
    const order = await Order.findOne(query);
    if (!order) throw new Error("Order not found");

    // Even if already completed, run credit in case it was missed
    if (order.status === "completed") {
      if (order.orderType === "storefront")
        await this._creditStorefrontProfit(order);
      return order;
    }

    order.items.forEach((item) => {
      if (item.processingStatus !== "failed")
        item.processingStatus = "completed";
    });
    order.status = "completed";
    order.processedBy = adminId;
    await order.save();

    try {
      const agent = await User.findById(order.createdBy);
      if (agent && isBusinessUser(agent.userType)) {
        await commissionService.updateCommissionRealTime(order._id);
      }
    } catch (err) {
      logger.error(
        `Commission update failed for order ${order._id}: ${err.message}`,
      );
    }

    if (order.orderType === "storefront") {
      await this._creditStorefrontProfit(order);
    }

    return order;
  }

  // ─── Revenue & Analytics ──────────────────────────────────────────────────────

  async getMonthlyRevenue(userId, userType = "agent") {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    const match = {
      status: "completed",
      createdAt: { $gte: startOfMonth, $lte: endOfMonth },
    };
    if (isBusinessUser(userType))
      match.createdBy = new mongoose.Types.ObjectId(userId);
    const [result] = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          monthlyRevenue: { $sum: "$total" },
          orderCount: { $sum: 1 },
        },
      },
    ]);
    return {
      monthlyRevenue: result?.monthlyRevenue || 0,
      orderCount: result?.orderCount || 0,
      month: now.toLocaleString("default", { month: "long", year: "numeric" }),
    };
  }

  async getDailySpending(userId, userType = "agent") {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );
    const match = {
      status: "completed",
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    };
    if (isBusinessUser(userType))
      match.createdBy = new mongoose.Types.ObjectId(userId);
    const [result] = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          dailySpending: { $sum: "$total" },
          orderCount: { $sum: 1 },
        },
      },
    ]);
    return {
      dailySpending: result?.dailySpending || 0,
      orderCount: result?.orderCount || 0,
      date: now.toISOString().split("T")[0],
    };
  }

  async getOrderAnalytics(tenantId, timeframe = "30d") {
    try {
      const days =
        { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[timeframe] || 30;
      const endDate = new Date();
      const startDate = new Date(
        endDate.getTime() - days * 24 * 60 * 60 * 1000,
      );
      const [stats] = await Order.aggregate([
        { $match: { tenantId, createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            completedOrders: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            totalRevenue: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$total", 0] },
            },
            bulkOrders: {
              $sum: { $cond: [{ $eq: ["$orderType", "bulk"] }, 1, 0] },
            },
          },
        },
      ]);
      const completionRate =
        stats?.totalOrders > 0
          ? Math.round((stats.completedOrders / stats.totalOrders) * 10000) /
            100
          : 0;
      return {
        totalOrders: stats?.totalOrders || 0,
        completedOrders: stats?.completedOrders || 0,
        totalRevenue: stats?.totalRevenue || 0,
        bulkOrders: stats?.bulkOrders || 0,
        completionRate,
        timeframe,
      };
    } catch (error) {
      logger.error(`Get order analytics error: ${error.message}`);
      throw new Error("Failed to get order analytics");
    }
  }

  // ─── Draft Order Processing ───────────────────────────────────────────────────

  async processDraftOrders(userId, tenantId) {
    const result = await this.executeWithTransaction(async (session) => {
      const draftOrders = session
        ? await Order.find({
            createdBy: userId,
            tenantId,
            status: "draft",
          }).session(session)
        : await Order.find({ createdBy: userId, tenantId, status: "draft" });
      if (draftOrders.length === 0)
        return {
          processed: 0,
          message: "No draft orders found",
          totalAmount: 0,
        };

      const user = session
        ? await User.findById(userId).session(session)
        : await User.findById(userId);
      if (!user) throw new Error("User not found");

      const totalRequired = draftOrders.reduce(
        (sum, o) => sum + o.items.reduce((s, i) => s + i.totalPrice, 0),
        0,
      );
      if (user.walletBalance < totalRequired) {
        throw new Error(
          `Insufficient balance. Required: GH₵${totalRequired.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}`,
        );
      }

      let processed = 0;
      for (const order of draftOrders) {
        const orderTotal = order.items.reduce((s, i) => s + i.totalPrice, 0);
        await walletService.debitWallet(
          userId.toString(),
          orderTotal,
          `Payment for order ${order.orderNumber}`,
          order._id,
          { orderType: order.orderType },
          session,
        );
        order.status = "pending";
        order.paymentStatus = "paid";
        session ? await order.save({ session }) : await order.save();
        processed++;
      }
      logger.info(`Processed ${processed} draft orders for user ${userId}`);
      return {
        processed,
        message: `Successfully processed ${processed} draft orders`,
        totalAmount: totalRequired,
        user: user.toObject(),
      };
    });

    try {
      const { processed, totalAmount, user } = result;
      if (processed > 0) {
        await notificationService.createInAppNotification(
          userId.toString(),
          "Draft Orders Processed",
          `Successfully processed ${processed} draft orders. GH₵${totalAmount.toFixed(2)} deducted.`,
          "success",
          {
            processedCount: processed,
            totalAmount,
            type: "draft_orders_processed",
            navigationLink: this.getNavigationLink(user.userType, "orders"),
          },
        );
        const superAdmins = await User.find(
          { userType: "super_admin" },
          "userType",
        );
        for (const admin of superAdmins) {
          await notificationService.createInAppNotification(
            admin._id.toString(),
            "Draft Orders Processed",
            `User ${user.email} processed ${processed} draft orders. Total: GH₵${totalAmount.toFixed(2)}`,
            "info",
            {
              processedCount: processed,
              totalAmount,
              type: "draft_orders_processed",
              navigationLink: this.getNavigationLink(admin.userType, "orders"),
            },
          );
        }
      }
    } catch (err) {
      logger.error(`Draft orders notification failed: ${err.message}`);
    }

    return {
      processed: result.processed,
      message: result.message,
      totalAmount: result.totalAmount,
    };
  }

  async processSingleDraftOrder(orderId, userId, tenantId) {
    const result = await this.executeWithTransaction(async (session) => {
      const order = session
        ? await Order.findOne({
            _id: orderId,
            createdBy: userId,
            tenantId,
            status: "draft",
          }).session(session)
        : await Order.findOne({
            _id: orderId,
            createdBy: userId,
            tenantId,
            status: "draft",
          });
      if (!order) throw new Error("Draft order not found or already processed");

      const user = session
        ? await User.findById(userId).session(session)
        : await User.findById(userId);
      if (!user) throw new Error("User not found");

      const orderTotal = order.items.reduce((s, i) => s + i.totalPrice, 0);
      if (user.walletBalance < orderTotal)
        throw new Error(
          `Insufficient balance. Required: GH₵${orderTotal.toFixed(2)}, Available: GH₵${user.walletBalance.toFixed(2)}`,
        );

      await walletService.debitWallet(
        userId.toString(),
        orderTotal,
        `Payment for order ${order.orderNumber}`,
        order._id,
        { orderType: order.orderType },
        session,
      );
      order.status = "pending";
      order.paymentStatus = "paid";
      session ? await order.save({ session }) : await order.save();

      logger.info(
        `Processed single draft order ${order.orderNumber} for user ${userId}`,
      );
      return {
        processed: 1,
        message: `Draft order ${order.orderNumber} moved to pending`,
        totalAmount: orderTotal,
        order: order.toObject(),
        user: user.toObject(),
      };
    });

    try {
      await notificationService.createInAppNotification(
        userId.toString(),
        "Draft Order Processed",
        `Draft order ${result.order.orderNumber} moved to pending. GH₵${result.totalAmount.toFixed(2)} deducted.`,
        "success",
        {
          orderId: result.order._id.toString(),
          orderNumber: result.order.orderNumber,
          totalAmount: result.totalAmount,
          type: "draft_order_processed",
          navigationLink: this.getNavigationLink(
            result.user.userType,
            "orders",
          ),
        },
      );
    } catch (err) {
      logger.error(`Draft order notification failed: ${err.message}`);
    }

    return {
      processed: result.processed,
      message: result.message,
      totalAmount: result.totalAmount,
      order: result.order,
    };
  }

  // ─── Cancel Order ─────────────────────────────────────────────────────────────

  async cancelOrder(orderId, tenantId, userId, reason) {
    const result = await this.executeWithTransaction(async (session) => {
      const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };
      const order = session
        ? await Order.findOne(query).session(session)
        : await Order.findOne(query);
      if (!order) throw new Error("Order not found");

      if (!["pending", "confirmed", "draft"].includes(order.status)) {
        throw new Error("Order cannot be cancelled in current status");
      }

      if (order.status === "draft") {
        session
          ? await Order.deleteOne({ _id: orderId }).session(session)
          : await Order.deleteOne({ _id: orderId });
        logger.info(`Draft order deleted: ${order.orderNumber}`);
        return {
          ...order.toObject(),
          status: "deleted",
          isDraft: true,
          orderCreator: order.createdBy,
          deleter: userId,
        };
      }

      let refundAmount = 0;
      let refundMethod = null;
      const isStorefront = order.orderType === "storefront";

      console.log(
        "Cancelling order:",
        order.orderNumber,
        "Type:",
        order.orderType,
        "Status:",
        order.status,
        "Payment status:",
        order.paymentStatus,
      );

      if (
        !isStorefront &&
        order.paymentStatus === "paid" &&
        order.paymentMethod === "wallet" &&
        order.total > 0
      ) {
        try {
          const orderCreator = await User.findById(order.createdBy);
          if (!orderCreator) throw new Error("Order creator not found");
          refundAmount = order.total;
          refundMethod = "wallet";
          await walletService.creditWallet(
            order.createdBy.toString(),
            refundAmount,
            `Refund for cancelled order ${order.orderNumber}`,
            userId,
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              refundReason: reason || "Order cancelled",
              cancelledBy: userId,
            },
            session,
          );
          logger.info(
            `Refunded GH₵${refundAmount.toFixed(2)} for cancelled order ${order.orderNumber}`,
          );
        } catch (refundErr) {
          throw new Error(
            `Cancellation failed: Unable to process refund — ${refundErr.message}`,
          );
        }
      }

      if (
        isStorefront &&
        order.storefrontData?.paymentMethod?.type === "paystack"
      ) {
        console.log(
          "Processing Paystack refund for storefront order, reference:",
          order.storefrontData?.paymentMethod?.reference,
        );
        try {
          const refund = await storefrontService.refundPaystackOrder(
            order._id,
            {
              amount: Number(order.total) || 0,
              reason: "order_cancelled",
            },
          );
          refundAmount = Number(order.total) || 0;
          refundMethod = "paystack";
          order.metadata = order.metadata || {};
          order.metadata.paystackRefund = {
            status: "success",
            reference: order.storefrontData?.paymentMethod?.reference,
            amount: refundAmount,
            reason: "order_cancelled",
            refundId: refund?.id || refund?.refund_id,
            refundedAt: new Date(),
          };
          console.log("Paystack refund successful:", refund);
        } catch (err) {
          console.log("Paystack refund failed:", err.message);
          order.metadata = order.metadata || {};
          order.metadata.paystackRefund = {
            status: "failed",
            reference: order.storefrontData?.paymentMethod?.reference,
            amount: Number(order.total) || 0,
            reason: "order_cancelled",
            error: err.message,
            failedAt: new Date(),
          };
          logger.warn(
            `Paystack refund failed for order ${order.orderNumber}: ${err.message}`,
          );
        }
      } else if (isStorefront) {
        console.log(
          "Storefront order but not Paystack payment method:",
          order.storefrontData?.paymentMethod?.type,
        );
      }

      if (isStorefront) {
        await this._removeStorefrontProfit(order, "order_cancelled", session);
      }

      order.items.forEach((item) => {
        if (item.processingStatus === "pending")
          item.processingStatus = "cancelled";
      });
      order.status = "cancelled";
      order.paymentStatus = refundAmount > 0 ? "refunded" : order.paymentStatus;
      order.notes = reason || "Order cancelled";
      order.processedBy = userId;
      session ? await order.save({ session }) : await order.save();

      logger.info(
        `Order cancelled: ${order.orderNumber}${refundAmount > 0 ? ` with GH₵${refundAmount} refund` : ""}`,
      );
      return {
        order: order.toObject(),
        orderCreator: order.createdBy,
        canceller: userId,
        isDraft: false,
        refundAmount,
        refundMethod,
      };
    });

    try {
      const {
        order,
        orderCreator,
        canceller,
        isDraft,
        refundAmount,
        refundMethod,
      } = result;
      const [creatorUser, cancellerUser] = await Promise.all([
        User.findById(orderCreator),
        User.findById(canceller),
      ]);
      const cancellerName =
        cancellerUser?.fullName || cancellerUser?.email || "Admin";

      if (isDraft) {
        if (creatorUser) {
          await notificationService.createInAppNotification(
            creatorUser._id.toString(),
            "Draft Order Deleted",
            `Draft order ${order.orderNumber} deleted by ${cancellerName}.`,
            "info",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              type: "draft_order_deleted",
              navigationLink: this.getNavigationLink(
                creatorUser.userType,
                "orders",
              ),
            },
          );
        }
      } else {
        let msg = `Order ${order.orderNumber} cancelled by ${cancellerName}. Reason: ${reason || "No reason provided"}`;
        if (refundAmount > 0) {
          msg +=
            refundMethod === "paystack"
              ? `\n\nRefund: GH₵${refundAmount} sent back to the customer via Paystack.`
              : `\n\nRefund: GH₵${refundAmount} credited to your wallet.`;
        }
        if (creatorUser) {
          await notificationService.createInAppNotification(
            creatorUser._id.toString(),
            "Order Cancelled",
            msg,
            "error",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              cancelledBy: cancellerName,
              reason: reason || "No reason provided",
              refundAmount,
              type: "order_cancelled",
              navigationLink: this.getNavigationLink(
                creatorUser.userType,
                "orders",
              ),
            },
          );
        }
        const superAdmins = await User.find(
          { userType: "super_admin" },
          "userType",
        );
        for (const admin of superAdmins) {
          let adminMsg = `Order ${order.orderNumber} cancelled by ${cancellerName}. Reason: ${reason || "No reason provided"}`;
          if (refundAmount > 0) {
            adminMsg +=
              refundMethod === "paystack"
                ? `\n\nRefund: GH₵${refundAmount} sent back to the customer via Paystack.`
                : `\n\nRefund: GH₵${refundAmount} returned to user's wallet.`;
          }
          await notificationService.createInAppNotification(
            admin._id.toString(),
            "Order Cancelled",
            adminMsg,
            "warning",
            {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              cancelledBy: cancellerName,
              reason,
              refundAmount,
              type: "order_cancelled",
              navigationLink: this.getNavigationLink(admin.userType, "orders"),
            },
          );
        }

        // Notify agent for storefront orders
        if (isStorefront && order.storefrontData?.storefrontId) {
          const storefront = await AgentStorefront.findById(
            order.storefrontData.storefrontId,
          );
          if (storefront) {
            let agentMsg = `Storefront order ${order.orderNumber} cancelled by ${cancellerName}. Reason: ${reason || "No reason provided"}`;
            if (refundAmount > 0) {
              agentMsg += `\n\nCustomer refunded: GH₵${refundAmount} via ${refundMethod}.`;
            }
            await notificationService.createInAppNotification(
              storefront.agentId.toString(),
              "Storefront Order Cancelled",
              agentMsg,
              "warning",
              {
                orderId: order._id.toString(),
                orderNumber: order.orderNumber,
                cancelledBy: cancellerName,
                reason,
                refundAmount,
                type: "storefront_order_cancelled",
                navigationLink: "/agent/dashboard/storefront/orders",
              },
            );
          }
        }
      }
    } catch (err) {
      logger.error(`Order cancellation notification failed: ${err.message}`);
    }

    return result.order || result;
  }

  // ─── Report Order ─────────────────────────────────────────────────────────────

  async reportOrder(orderId, tenantId, userId, description) {
    const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };
    const order = await Order.findOne(query);
    if (!order) throw new Error("Order not found");
    if (order.status !== "completed")
      throw new Error("Can only report issues on completed orders");

    if (new Date(order.createdAt) < new Date(Date.now() - 2 * 60 * 60 * 1000)) {
      throw new Error("Cannot report issues on orders older than 2 hours");
    }

    const reporter = await User.findById(userId);
    if (!reporter) throw new Error("Reporter not found");

    order.receptionStatus = "not_received";
    order.reported = true;
    order.reportedAt = new Date();
    await order.save();

    const reportId = new mongoose.Types.ObjectId();
    logger.info(
      `Delivery issue reported: Order ${order.orderNumber} by ${reporter.fullName || reporter.email}`,
    );

    try {
      const superAdmins = await User.find({ userType: "super_admin" });
      for (const admin of superAdmins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          "Data Delivery Issue Reported",
          `${reporter.fullName || reporter.email} reported non-delivery for order ${order.orderNumber} (${order.items[0]?.customerPhone || "N/A"}). Issue: ${description}`,
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
          },
        );
      }
    } catch (err) {
      logger.error(`Delivery report notification failed: ${err.message}`);
    }

    return {
      order: order.toObject(),
      reportId: reportId.toString(),
      reporter: { id: userId, name: reporter.fullName || reporter.email },
    };
  }

  // ─── Order Lookup ─────────────────────────────────────────────────────────────

  async getOrderById(orderId, tenantId = null) {
    try {
      const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };
      return await Order.findOne(query)
        .populate("items.packageGroup", "name provider")
        .populate("createdBy", "fullName email")
        .populate("processedBy", "fullName email");
    } catch (error) {
      logger.error(`Get order by ID error: ${error.message}`);
      throw new Error("Failed to get order");
    }
  }

  // ─── Reception Status ─────────────────────────────────────────────────────────

  async updateReceptionStatus(
    orderId,
    receptionStatus,
    adminId,
    tenantId = null,
  ) {
    const validStatuses = ["not_received", "received", "checking", "resolved"];
    if (!validStatuses.includes(receptionStatus))
      throw new Error(`Invalid reception status: ${receptionStatus}`);

    const query = tenantId ? { _id: orderId, tenantId } : { _id: orderId };
    const order = await Order.findOne(query);
    if (!order) throw new Error("Order not found");
    if (order.status !== "completed")
      throw new Error("Can only update reception status on completed orders");

    const oldStatus = order.receptionStatus;
    order.receptionStatus = receptionStatus;
    if (receptionStatus === "resolved" && oldStatus !== "resolved")
      order.resolvedAt = new Date();
    order.updatedAt = new Date();
    await order.save();

    const admin = await User.findById(adminId);
    logger.info(
      `Reception status: Order ${order.orderNumber} → '${receptionStatus}' by ${admin?.fullName || adminId}`,
    );

    if (receptionStatus === "checking" || receptionStatus === "resolved") {
      try {
        const msg =
          receptionStatus === "checking"
            ? `We are investigating the delivery issue for order ${order.orderNumber}.`
            : `The delivery issue for order ${order.orderNumber} has been resolved. Thank you.`;
        await notificationService.createNotification(
          order.createdBy.toString(),
          receptionStatus === "checking"
            ? "Issue Investigation Started"
            : "Issue Resolved",
          msg,
          receptionStatus === "checking" ? "info" : "success",
          {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            receptionStatus,
            type: "reception_status_update",
          },
        );
      } catch (err) {
        logger.error(`Reception status notification failed: ${err.message}`);
      }
    }

    return order;
  }
}

export default new OrderService();
