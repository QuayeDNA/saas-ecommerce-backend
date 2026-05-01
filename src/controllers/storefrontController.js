// src/controllers/storefrontController.js
import storefrontService from "../services/storefrontService.js";
import paystackService from "../services/paystackService.js";
import { initializePaystackCheckout } from "../utils/paystackHelpers.js";
import { validationResult } from "express-validator";
import logger from "../utils/logger.js";
import Order from "../models/Order.js";
import PaystackVerificationTask from "../models/PaystackVerificationTask.js";

// ─── Small helpers ────────────────────────────────────────────────────────────

function validationGuard(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorsArray = errors.array().map((error) => ({
      type: "field",
      value: error.value,
      msg: error.msg,
      path: error.param || error.path,
      location: error.location,
    }));
    const firstErrorMsg = errorsArray[0]?.msg || "Validation failed";
    res
      .status(400)
      .json({ success: false, message: firstErrorMsg, errors: errorsArray });
    return false;
  }
  return true;
}

function serverError(res, message) {
  return res.status(500).json({ success: false, message });
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

// ─── Controller ───────────────────────────────────────────────────────────────

class StorefrontController {
  // =========================================================================
  // Public Endpoints (No Authentication)
  // =========================================================================

  /**
   * GET /api/storefront/:businessName
   */
  async getPublicStorefront(req, res) {
    try {
      const data = await storefrontService.getPublicStorefront(
        req.params.businessName,
      );
      res.json({ success: true, data });
    } catch (err) {
      logger.error(`[getPublicStorefront] ${err.message}`);
      res.status(404).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/storefront/:businessName/order
   *
   * Creates the order then — depending on paymentMethod.type:
   *   paystack      → initializes Paystack checkout and returns authorizationUrl
   *   mobile_money  → returns order with pending_payment status; agent verifies manually
   *   bank_transfer → same as mobile_money
   */
  async createStorefrontOrder(req, res) {
    try {
      if (!validationGuard(req, res)) return;

      const { businessName } = req.params;
      const orderData = req.body;

      logger.info(`[createStorefrontOrder] ${businessName}`, {
        items: orderData.items?.length,
        customer: orderData.customerInfo?.name,
        paymentType: orderData.paymentMethod?.type,
      });

      const order = await storefrontService.createStorefrontOrder(
        businessName,
        orderData,
      );

      // ── Paystack inline checkout ─────────────────────────────────────────────
      if (orderData.paymentMethod?.type === "paystack") {
        // Guard: check admin toggle for storefront Paystack payments
        try {
          const settingsSvc = (await import("../services/settingsService.js"))
            .default;
          const apiSettings = await settingsSvc.getApiSettings();
          if (!apiSettings.paystackStorefrontEnabled) {
            return badRequest(
              res,
              "Paystack payments are currently disabled for storefronts.",
            );
          }
        } catch (settingsErr) {
          logger.warn(
            `[createStorefrontOrder] Could not verify paystackStorefrontEnabled: ${settingsErr.message}`,
          );
        }

        const rawCustomerEmail = order.storefrontData.customerInfo?.email;
        const customerPhone = (
          order.storefrontData.customerInfo?.phone || ""
        ).replace(/\D/g, "");
        const customerEmail =
          rawCustomerEmail ||
          `customer-${customerPhone}@storefront.brytelink.com`;

        await paystackService.ensureKeys().catch((e) =>
          logger.warn("[createStorefrontOrder] ensureKeys failed", {
            message: e.message,
          }),
        );

        // Reference encodes the order ID so we can look it up without needing metadata
        const reference = `storefront_${order._id}`;
        const amountPesewas = paystackService.convertToPesewas(
          order.total || 0,
        );

        // Callback URL: optional public backend → redirect → frontend
        const frontendBase = (
          process.env.FRONTEND_URL || "http://localhost:5173"
        ).replace(/\/$/, "");
        const publicBase = process.env.PUBLIC_URL
          ? process.env.PUBLIC_URL.replace(/\/$/, "")
          : null;
        const callbackUrl = publicBase
          ? `${publicBase}/wallet/topup/callback`
          : `${frontendBase}/storefront/callback`;

        const init = await initializePaystackCheckout({
          email: customerEmail,
          amountPesewas,
          reference,
          callbackUrl,
          metadata: {
            // orderId in metadata is kept for backward compatibility with old webhook handlers
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            storefrontId: order.storefrontData.storefrontId?.toString(),
          },
        });

        // Build response – include fee breakdown when fees were delegated
        const responseData = {
          orderId: order._id,
          orderNumber: order.orderNumber,
          total: order.total, // amount charged (may include fees)
          subtotal: order.subtotal ?? order.total, // base product price
          status: order.status,
          paymentMethod: "paystack",
          paystack: {
            authorizationUrl: init.authorization_url,
            reference,
            accessCode: init.access_code,
          },
        };

        // Attach fee breakdown if fees were delegated to customer
        if (order.storefrontData?.feeBreakdown) {
          responseData.feeBreakdown = order.storefrontData.feeBreakdown;
        }

        return res.status(201).json({
          success: true,
          message: "Order created. Paystack checkout initialized.",
          data: responseData,
        });
      }

      // ── Mobile Money / Bank Transfer (manual) ────────────────────────────────
      const paymentTypeLabel =
        orderData.paymentMethod?.type === "mobile_money"
          ? "Mobile Money"
          : "Bank Transfer";
      return res.status(201).json({
        success: true,
        message: `Order placed! Please complete your ${paymentTypeLabel} payment and the store owner will verify it.`,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          total: order.total,
          subtotal: order.subtotal ?? order.total,
          status: order.status,
          paymentMethod: orderData.paymentMethod?.type,
          instructions:
            "Send the exact amount and provide your transaction reference to the store owner for verification.",
        },
      });
    } catch (err) {
      logger.error(`[createStorefrontOrder] ${err.message}`);
      res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/storefront/paystack/verify?reference=storefront_<orderId>
   *
   * Called by the frontend after the Paystack inline modal closes successfully.
   * This is the critical path that was BROKEN before — the frontend was hitting
   * /api/wallet/paystack/verify which knows nothing about storefront orders.
   *
   * Flow:
   *  1. Verify with Paystack API that the transaction actually succeeded.
   *  2. Call storefrontService.processPaystackPayment() which:
   *       - Extracts orderId from the reference
   *       - Checks idempotency (already processed → 200)
   *       - Validates amount
   *       - Credits agent wallet & records transactions
   *       - Sets order status: pending_payment → pending (enters admin queue)
   *  3. Return the updated order so the frontend can show a success state.
   */
  async verifyPaystackTransaction(req, res) {
    try {
      const reference = (req.query.reference || req.body.reference || "")
        .toString()
        .trim();
      if (!reference) return badRequest(res, "reference is required");

      // Only handle storefront references here — other references go to /api/wallet/paystack/verify
      if (!reference.startsWith("storefront_")) {
        return badRequest(
          res,
          "This endpoint only handles storefront payment references",
        );
      }

      await paystackService.ensureKeys().catch((e) =>
        logger.warn("[SF verifyPaystackTransaction] ensureKeys failed", {
          message: e.message,
        }),
      );

      // ── Step 1: Confirm with Paystack that payment succeeded ─────────────────
      let paystackData;
      try {
        paystackData = await paystackService.verifyTransaction(reference);
      } catch (err) {
        logger.error(
          `[SF verifyPaystackTransaction] Paystack API error: ${err.message}`,
        );
        return res.status(502).json({
          success: false,
          message: "Could not verify payment with Paystack. Try again.",
        });
      }

      if (!paystackData || paystackData.status !== "success") {
        return badRequest(
          res,
          "Paystack transaction not successful. Payment may have been cancelled or failed.",
        );
      }

      // ── Step 2: Process & update the order ───────────────────────────────────
      const result =
        await storefrontService.processPaystackPayment(paystackData);

      if (result.duplicate) {
        // Mark any background retry task done so the job doesn't keep re-processing.
        try {
          await PaystackVerificationTask.findOneAndUpdate(
            { reference },
            { status: "done", lastError: null },
            { new: true },
          );
        } catch {
          // ignore
        }

        // Idempotency: already processed — fetch the order and return success
        const orderId = reference.replace("storefront_", "");
        const order = await Order.findById(orderId).lean();
        return res.json({
          success: true,
          message: "Payment already confirmed — your order is being processed.",
          data: {
            orderId: order?._id,
            orderNumber: order?.orderNumber,
            status: order?.status,
            paymentStatus: order?.paymentStatus,
          },
        });
      }

      if (!result.processed) {
        logger.warn(
          "[SF verifyPaystackTransaction] processPaystackPayment returned unprocessed",
          { reason: result.reason, reference },
        );
        return res.status(400).json({
          success: false,
          message: `Payment could not be processed: ${result.reason || "unknown error"}`,
        });
      }

      // Ensure any background task is marked done so it doesn't retry unnecessarily.
      try {
        await PaystackVerificationTask.findOneAndUpdate(
          { reference },
          { status: "done", lastError: null },
          { new: true },
        );
      } catch {
        // ignore
      }

      // ── Step 3: Return confirmed order to frontend ────────────────────────────
      return res.json({
        success: true,
        message: "Payment confirmed! Your order is now queued for processing.",
        data: {
          orderId: result.order._id,
          orderNumber: result.order.orderNumber,
          status: result.order.status,
          paymentStatus: result.order.paymentStatus,
          total: result.order.total,
        },
      });
    } catch (err) {
      logger.error(`[SF verifyPaystackTransaction] ${err.message}`);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // =========================================================================
  // Agent Endpoints (Authentication Required)
  // =========================================================================

  async createStorefront(req, res) {
    try {
      if (!validationGuard(req, res)) return;
      const storefront = await storefrontService.createStorefront(
        req.user.userId,
        req.body,
      );
      const message = storefront.isApproved
        ? "Storefront created and auto-approved. Your store is now live."
        : "Storefront created. Awaiting admin approval.";
      res.status(201).json({ success: true, message, data: storefront });
    } catch (err) {
      logger.error(`[createStorefront] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async getAgentStorefront(req, res) {
    try {
      const storefront = await storefrontService.getAgentStorefront(
        req.user.userId,
      );
      if (!storefront)
        return res
          .status(404)
          .json({ success: false, message: "No storefront found" });

      if (storefront.suspendedByAdmin) {
        return res.json({
          success: true,
          data: storefront,
          suspended: true,
          suspensionMessage: `Your storefront has been suspended by an administrator.${storefront.suspensionReason ? ` Reason: ${storefront.suspensionReason}` : ""} Contact support.`,
        });
      }

      res.json({ success: true, data: storefront });
    } catch (err) {
      logger.error(`[getAgentStorefront] ${err.message}`);
      serverError(res, "Internal server error");
    }
  }

  async updateStorefront(req, res) {
    try {
      if (!validationGuard(req, res)) return;
      const sf = await storefrontService.getAgentStorefront(req.user.userId);
      if (!sf)
        return res
          .status(404)
          .json({ success: false, message: "Storefront not found" });
      const updated = await storefrontService.updateStorefront(
        sf._id,
        req.body,
        req.user.userId,
      );
      res.json({
        success: true,
        message: "Storefront updated successfully",
        data: updated,
      });
    } catch (err) {
      logger.error(`[updateStorefront] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async createPaystackSubaccount(req, res) {
    try {
      const result = await storefrontService.createPaystackSubaccount(
        req.user.userId,
      );
      res.json({
        success: true,
        message: "Paystack subaccount created",
        data: result,
      });
    } catch (err) {
      logger.error(`[createPaystackSubaccount] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async deactivateStorefront(req, res) {
    try {
      const sf = await storefrontService.getAgentStorefront(req.user.userId);
      if (!sf)
        return res
          .status(404)
          .json({ success: false, message: "Storefront not found" });
      await storefrontService.deactivateStorefront(sf._id, req.user.userId);
      res.json({
        success: true,
        message: "Storefront deactivated. Reactivate anytime.",
      });
    } catch (err) {
      logger.error(`[deactivateStorefront] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async reactivateStorefront(req, res) {
    try {
      const sf = await storefrontService.getAgentStorefront(req.user.userId);
      if (!sf)
        return res
          .status(404)
          .json({ success: false, message: "Storefront not found" });
      const updated = await storefrontService.reactivateStorefront(
        sf._id,
        req.user.userId,
      );
      res.json({
        success: true,
        message: "Storefront reactivated. Your store is now live!",
        data: updated,
      });
    } catch (err) {
      logger.error(`[reactivateStorefront] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async deleteStorefront(req, res) {
    try {
      const sf = await storefrontService.getAgentStorefront(req.user.userId);
      if (!sf)
        return res
          .status(404)
          .json({ success: false, message: "Storefront not found" });
      await storefrontService.deleteStorefront(sf._id, req.user.userId);
      res.json({ success: true, message: "Storefront deleted successfully" });
    } catch (err) {
      logger.error(`[deleteStorefront] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  // ── Pricing & Bundles ─────────────────────────────────────────────────────

  async getAvailableBundles(req, res) {
    try {
      const bundles = await storefrontService.getAgentBundlesForPricing(
        req.user.userId,
      );
      res.json({ success: true, data: bundles });
    } catch (err) {
      logger.error(`[getAvailableBundles] ${err.message}`);
      serverError(res, "Internal server error");
    }
  }

  async getCurrentPricing(req, res) {
    try {
      const sf = await storefrontService.getAgentStorefront(req.user.userId);
      if (!sf)
        return res
          .status(404)
          .json({ success: false, message: "Storefront not found" });
      const pricing = await storefrontService.getStorefrontPricing(sf._id);
      res.json({ success: true, data: pricing });
    } catch (err) {
      logger.error(`[getCurrentPricing] ${err.message}`);
      serverError(res, "Internal server error");
    }
  }

  async setPricing(req, res) {
    try {
      if (!validationGuard(req, res)) return;
      const sf = await storefrontService.getAgentStorefront(req.user.userId);
      if (!sf)
        return res
          .status(404)
          .json({ success: false, message: "Storefront not found" });
      const results = await storefrontService.setPricing(
        sf._id,
        req.body.pricing,
      );
      res.json({
        success: true,
        message: `Pricing updated: ${results.created} created, ${results.updated} updated`,
        data: results,
      });
    } catch (err) {
      logger.error(`[setPricing] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async toggleBundles(req, res) {
    try {
      if (!validationGuard(req, res)) return;
      const sf = await storefrontService.getAgentStorefront(req.user.userId);
      if (!sf)
        return res
          .status(404)
          .json({ success: false, message: "Storefront not found" });
      const results = await storefrontService.toggleBundles(
        sf._id,
        req.body.bundles,
        req.user.userId,
      );
      res.json({
        success: true,
        message: `Bundles updated: ${results.enabled} enabled, ${results.disabled} disabled`,
        data: results,
      });
    } catch (err) {
      logger.error(`[toggleBundles] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  // ── Order Management ──────────────────────────────────────────────────────

  async getStorefrontOrders(req, res) {
    try {
      const { status, limit = 50, offset = 0 } = req.query;
      const sf = await storefrontService.getAgentStorefront(req.user.userId);
      if (!sf)
        return res
          .status(404)
          .json({ success: false, message: "Storefront not found" });

      const filters = {};
      if (status) filters.status = status;

      const { orders, total } = await storefrontService.getStorefrontOrders(
        sf._id,
        filters,
        { limit: parseInt(limit), offset: parseInt(offset) },
      );
      res.json({
        success: true,
        data: {
          orders,
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (err) {
      logger.error(`[getStorefrontOrders] ${err.message}`);
      serverError(res, "Internal server error");
    }
  }

  /**
   * PUT /api/storefront/agent/storefront/orders/:orderId/verify
   * Agent manually verifies a mobile money / bank transfer payment.
   * Paystack orders are verified automatically — this endpoint rejects them.
   */
  async verifyPayment(req, res) {
    try {
      const order = await storefrontService.verifyManualPayment(
        req.params.orderId,
        { notes: req.body.notes },
        req.user.userId,
      );
      res.json({
        success: true,
        message: "Payment verified. Order queued for admin processing.",
        data: order,
      });
    } catch (err) {
      logger.error(`[verifyPayment] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async rejectOrder(req, res) {
    try {
      const order = await storefrontService.rejectOrder(
        req.params.orderId,
        req.body.reason,
        req.user.userId,
      );
      res.json({ success: true, message: "Order rejected", data: order });
    } catch (err) {
      logger.error(`[rejectOrder] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async getEarnings(req, res) {
    try {
      const { page, limit } = req.query;
      const earnings = await storefrontService.getStorefrontEarnings(
        req.user.userId,
        { page, limit },
      );
      res.json({ success: true, data: earnings });
    } catch (err) {
      logger.error(`[getEarnings] ${err.message}`);
      serverError(res, "Internal server error");
    }
  }

  async getDashboardData(req, res) {
    try {
      const dashboardData = await storefrontService.getStorefrontDashboardData(
        req.user.userId,
      );
      res.json({ success: true, data: dashboardData });
    } catch (err) {
      logger.error(`[getDashboardData] ${err.message}`);
      serverError(res, "Internal server error");
    }
  }

  // =========================================================================
  // Admin Endpoints (Super Admin)
  // =========================================================================

  async getAllStorefronts(req, res) {
    try {
      const { status, search, limit = 20, offset = 0 } = req.query;
      const { storefronts, total } = await storefrontService.getAllStorefronts(
        { status, search },
        { limit: parseInt(limit), offset: parseInt(offset) },
      );
      res.json({
        success: true,
        data: {
          storefronts,
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (err) {
      logger.error(`[getAllStorefronts] ${err.message}`);
      serverError(res, "Internal server error");
    }
  }

  async getAdminStats(req, res) {
    try {
      const stats = await storefrontService.getAdminStorefrontStats();
      res.json({ success: true, data: stats });
    } catch (err) {
      logger.error(`[getAdminStats] ${err.message}`);
      serverError(res, "Internal server error");
    }
  }

  async getAdminStorefrontById(req, res) {
    try {
      const detail = await storefrontService.getAdminStorefrontById(
        req.params.storefrontId,
      );
      res.json({ success: true, data: detail });
    } catch (err) {
      logger.error(`[getAdminStorefrontById] ${err.message}`);
      if (err.message === "Storefront not found") {
        return res.status(404).json({ success: false, message: err.message });
      }
      serverError(res, "Internal server error");
    }
  }

  async approveStorefront(req, res) {
    try {
      const storefront = await storefrontService.approveStorefront(
        req.params.storefrontId,
        req.user.userId,
      );
      res.json({
        success: true,
        message: "Storefront approved successfully",
        data: storefront,
      });
    } catch (err) {
      logger.error(`[approveStorefront] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async adminSuspendStorefront(req, res) {
    try {
      const storefront = await storefrontService.adminSuspendStorefront(
        req.params.storefrontId,
        req.user.userId,
        req.body.reason,
      );
      res.json({
        success: true,
        message: "Storefront suspended successfully",
        data: storefront,
      });
    } catch (err) {
      logger.error(`[adminSuspendStorefront] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async adminUnsuspendStorefront(req, res) {
    try {
      const storefront = await storefrontService.adminUnsuspendStorefront(
        req.params.storefrontId,
        req.user.userId,
      );
      res.json({
        success: true,
        message: "Storefront unsuspended. Store is now live.",
        data: storefront,
      });
    } catch (err) {
      logger.error(`[adminUnsuspendStorefront] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async adminDeleteStorefront(req, res) {
    try {
      await storefrontService.adminDeleteStorefront(
        req.params.storefrontId,
        req.user.userId,
        req.body.reason,
      );
      res.json({
        success: true,
        message: "Storefront deleted. Agent notified.",
      });
    } catch (err) {
      logger.error(`[adminDeleteStorefront] ${err.message}`);
      badRequest(res, err.message);
    }
  }

  async toggleAutoApprove(req, res) {
    try {
      if (typeof req.body.enabled !== "boolean") {
        return badRequest(res, "enabled must be a boolean");
      }
      const result = await storefrontService.toggleAutoApprove(
        req.body.enabled,
      );
      res.json({
        success: true,
        message: `Auto-approve ${result.autoApproveStorefronts ? "enabled" : "disabled"}`,
        data: result,
      });
    } catch (err) {
      logger.error(`[toggleAutoApprove] ${err.message}`);
      serverError(res, "Internal server error");
    }
  }

  /**
   * GET /api/storefront/:businessName/orders/track?ref=<orderId|storefront_orderId>
   * Public — returns sanitised order status only.
   */
  async trackPublicOrder(req, res) {
    try {
      const { businessName } = req.params;
      const { ref } = req.query;
      if (!ref)
        return res
          .status(400)
          .json({ success: false, message: "ref query parameter is required" });
      const data = await storefrontService.trackPublicOrder(
        businessName,
        ref.trim(),
      );
      res.json({ success: true, data });
    } catch (err) {
      logger.error(`[trackPublicOrder] ${err.message}`);
      const status = ["Order not found", "Store not found"].includes(
        err.message,
      )
        ? 404
        : 400;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/storefront/discover/random
   * Returns a handful of random active storefronts for the public landing page.
   * No authentication required.
   */
  async getRandomStorefronts(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 6, 12);
      const data = await storefrontService.getRandomStorefronts(limit);
      res.json({ success: true, data });
    } catch (err) {
      logger.error(`[getRandomStorefronts] ${err.message}`);
      res
        .status(500)
        .json({ success: false, message: "Failed to load storefronts" });
    }
  }
}

export default new StorefrontController();
