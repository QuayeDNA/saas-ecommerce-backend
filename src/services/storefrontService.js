// src/services/storefrontService.js
import AgentStorefront from '../models/AgentStorefront.js';
import StorefrontPricing from '../models/StorefrontPricing.js';
import Bundle from '../models/Bundle.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Settings from '../models/Settings.js';
import walletService from './walletService.js';
import notificationService from './notificationService.js';
import paystackService from './paystackService.js';
import { calculateStorefrontSplit, getFeeConfig, calculateChargeWithFees } from '../utils/paystackHelpers.js';
import logger from '../utils/logger.js';
import websocketService from './websocketService.js';

class StorefrontService {

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Extract the MongoDB Order._id string from a Paystack reference.
   * Storefron references always follow the pattern: storefront_<orderId>
   */
  _orderIdFromReference(reference) {
    if (!reference) return null;
    if (reference.startsWith('storefront_')) {
      return reference.replace('storefront_', '');
    }
    return null;
  }

  /**
   * Send a real-time notification to an agent's connected browser when their
   * storefront receives a payment. Fails silently — must never break finances.
   */
  async _notifyAgent(agentId, orderId, orderNumber, amount) {
    try {
      websocketService.sendToUser(agentId.toString(), {
        type: 'storefront_order_paid',
        orderId: orderId.toString(),
        orderNumber,
        amount,
        message: `Storefront order ${orderNumber} has been paid (GH₵${amount.toFixed(2)}).`,
      });
    } catch (err) {
      logger.warn(`[StorefrontService] WebSocket notify failed for agent ${agentId}: ${err.message}`);
    }
  }

  // =========================================================================
  // Storefront CRUD
  // =========================================================================

  async createStorefront(userId, storefrontData) {
    const existing = await AgentStorefront.findOne({ agentId: userId });
    if (existing) throw new Error('You already have a storefront');

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    if (!user.isActive) throw new Error('Your account is not active');

    const settings = await Settings.getInstance();
    const autoApprove = settings.autoApproveStorefronts || false;

    const storefront = new AgentStorefront({
      agentId: userId,
      ...storefrontData,
      isApproved: autoApprove,
      isActive: autoApprove,
      ...(autoApprove ? { approvedAt: new Date() } : {}),
    });

    const saved = await storefront.save();

    try {
      const admins = await User.find({ userType: 'super_admin', isActive: true }).select('_id');
      for (const admin of admins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          'New Storefront Created',
          `${user.fullName} created storefront "${storefrontData.displayName}"${autoApprove ? ' (auto-approved)' : ' — awaiting approval'}`,
          'info',
          { type: 'storefront_created', storefrontId: saved._id }
        );
      }
    } catch (err) {
      logger.error('[StorefrontService] Storefront creation notification failed:', err);
    }

    return saved;
  }

  async getAgentStorefront(userId) {
    return AgentStorefront.findOne({ agentId: userId }).populate('agentId', 'fullName userType');
  }

  async updateStorefront(storefrontId, updateData, userId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) throw new Error('Storefront not found');
    if (userId && storefront.agentId.toString() !== userId.toString()) throw new Error('Not authorized to update this storefront');
    if (storefront.suspendedByAdmin) throw new Error('Your storefront has been suspended. Contact support.');

    // Block sensitive fields from being changed directly
    delete updateData.isActive;
    delete updateData.isApproved;
    delete updateData.suspendedByAdmin;
    delete updateData.agentId;

    Object.assign(storefront, updateData);
    return storefront.save();
  }

  async deactivateStorefront(storefrontId, userId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) throw new Error('Storefront not found');
    if (userId && storefront.agentId.toString() !== userId.toString()) throw new Error('Not authorized');
    if (storefront.suspendedByAdmin) throw new Error('Your storefront has been suspended. Contact support.');
    storefront.isActive = false;
    return storefront.save();
  }

  async reactivateStorefront(storefrontId, userId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) throw new Error('Storefront not found');
    if (userId && storefront.agentId.toString() !== userId.toString()) throw new Error('Not authorized');
    if (storefront.suspendedByAdmin) throw new Error('Your storefront has been suspended. Contact support.');
    if (!storefront.isApproved) throw new Error('Your storefront has not been approved yet');
    storefront.isActive = true;
    return storefront.save();
  }

  async createPaystackSubaccount(userId) {
    const storefront = await AgentStorefront.findOne({ agentId: userId });
    if (!storefront) throw new Error('Storefront not found');

    const bankMethod = (storefront.paymentMethods || []).find(
      pm => pm.type === 'bank_transfer' && pm.isActive && pm.details?.bank && pm.details?.account && pm.details?.name
    );
    if (!bankMethod) {
      throw new Error('Add an active bank transfer payment method with account details before creating a Paystack subaccount');
    }

    const agent = await User.findById(userId).select('fullName email phone');
    const payload = {
      business_name: storefront.displayName || storefront.businessName,
      settlement_bank: bankMethod.details.bank,
      account_number: bankMethod.details.account,
      percentage_charge: 0,
      primary_contact_name: agent?.fullName || bankMethod.details.name,
      primary_contact_email: agent?.email || '',
      primary_contact_phone: agent?.phone || storefront.contactInfo?.phone || '',
    };

    const ps = (await import('./paystackService.js')).default;
    const sub = await ps.createSubaccount(payload);
    storefront.paystackSubaccountId = sub.subaccount_code || sub.subaccountCode || sub.id;
    await storefront.save();
    return { storefront, subaccount: sub };
  }

  async deleteStorefront(storefrontId, userId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) throw new Error('Storefront not found');
    if (userId && storefront.agentId.toString() !== userId.toString()) throw new Error('Not authorized');

    const active = await Order.countDocuments({
      orderType: 'storefront',
      'storefrontData.storefrontId': storefrontId,
      status: { $in: ['pending', 'confirmed', 'processing'] },
    });
    if (active > 0) throw new Error(`Cannot delete storefront with ${active} active order(s). Complete or cancel them first.`);

    await StorefrontPricing.deleteMany({ storefrontId });
    await AgentStorefront.findByIdAndDelete(storefrontId);
    return { deleted: true };
  }

  // =========================================================================
  // Bundle & Pricing
  // =========================================================================

  async getAgentBundlesForPricing(userId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const storefront = await AgentStorefront.findOne({ agentId: userId });

    const bundles = await Bundle.find({ isActive: true })
      .populate('providerId', 'name code logo')
      .populate('packageId', 'name');

    const pricingMap = new Map();
    if (storefront) {
      const existing = await StorefrontPricing.find({ storefrontId: storefront._id });
      for (const p of existing) pricingMap.set(p.bundleId.toString(), p);
    }

    return bundles.map(bundle => {
      const tierPrice = bundle.getPriceForUserType(user.userType);
      const ep = pricingMap.get(bundle._id.toString());
      return {
        _id: bundle._id,
        name: bundle.name,
        description: bundle.description,
        dataVolume: bundle.dataVolume,
        dataUnit: bundle.dataUnit,
        validity: bundle.validity,
        validityUnit: bundle.validityUnit,
        category: bundle.category,
        bundleCode: bundle.bundleCode,
        provider: bundle.providerId ? { _id: bundle.providerId._id, name: bundle.providerId.name, code: bundle.providerId.code } : null,
        packageName: bundle.packageId?.name || null,
        tierPrice,
        customPrice: ep?.hasCustomPrice ? ep.customPrice : null,
        markup: ep?.hasCustomPrice ? ep.markup : null,
        isEnabled: ep?.isActive || false,
      };
    });
  }

  async setPricing(storefrontId, pricingData) {
    const storefront = await AgentStorefront.findById(storefrontId).populate('agentId');
    if (!storefront) throw new Error('Storefront not found');

    const results = { updated: 0, created: 0 };

    for (const { bundleId, customPrice } of pricingData) {
      const bundle = await Bundle.findById(bundleId);
      if (!bundle) throw new Error(`Bundle not found: ${bundleId}`);
      if (!bundle.isActive) throw new Error(`Bundle not active: ${bundleId}`);

      const tierPrice = bundle.getPriceForUserType(storefront.agentId.userType);
      if (!tierPrice) throw new Error(`Bundle not available for your account type: ${bundle.name}`);

      const hasCustomPrice = customPrice !== undefined && customPrice !== null;
      const finalPrice = hasCustomPrice ? customPrice : tierPrice;

      if (hasCustomPrice && customPrice < tierPrice) {
        throw new Error(`Custom price cannot be less than tier price (${tierPrice}) for: ${bundle.name}`);
      }

      const existing = await StorefrontPricing.findOne({ storefrontId, bundleId });
      if (existing) {
        existing.tierPrice = tierPrice;
        existing.customPrice = finalPrice;
        existing.markup = finalPrice - tierPrice;
        existing.markupPercentage = tierPrice > 0 ? ((finalPrice - tierPrice) / tierPrice) * 100 : 0;
        existing.hasCustomPrice = hasCustomPrice;
        existing.isActive = true;
        await existing.save();
        results.updated++;
      } else {
        await StorefrontPricing.create({
          storefrontId, bundleId, tierPrice, customPrice: finalPrice,
          markup: finalPrice - tierPrice,
          markupPercentage: tierPrice > 0 ? ((finalPrice - tierPrice) / tierPrice) * 100 : 0,
          hasCustomPrice, isActive: true,
        });
        results.created++;
      }
    }

    return results;
  }

  async toggleBundles(storefrontId, bundleUpdates, userId) {
    const storefront = await AgentStorefront.findById(storefrontId).populate('agentId');
    if (!storefront) throw new Error('Storefront not found');
    if (storefront.agentId._id.toString() !== userId.toString()) throw new Error('Not authorized');

    const results = { enabled: 0, disabled: 0 };

    for (const { bundleId, isEnabled } of bundleUpdates) {
      const bundle = await Bundle.findById(bundleId);
      if (!bundle) continue;
      const tierPrice = bundle.getPriceForUserType(storefront.agentId.userType);

      if (isEnabled) {
        await StorefrontPricing.findOneAndUpdate(
          { storefrontId, bundleId },
          {
            $setOnInsert: { tierPrice, customPrice: tierPrice, markup: 0, markupPercentage: 0, hasCustomPrice: false },
            isActive: true,
          },
          { upsert: true, new: true }
        );
        results.enabled++;
      } else {
        await StorefrontPricing.findOneAndUpdate({ storefrontId, bundleId }, { isActive: false });
        results.disabled++;
      }
    }

    return results;
  }

  async getStorefrontPricing(storefrontId) {
    return StorefrontPricing.find({ storefrontId })
      .populate({
        path: 'bundleId',
        select: 'name description dataVolume dataUnit validity validityUnit category bundleCode providerId isActive',
        populate: { path: 'providerId', select: 'name code' },
      })
      .sort({ isActive: -1, createdAt: -1 });
  }

  // =========================================================================
  // Public Storefront
  // =========================================================================

  async getPublicStorefront(businessName) {
    const storefront = await AgentStorefront.findPublicStore(businessName);
    if (!storefront) throw new Error('Storefront not found or not available');


    const allPricing = await StorefrontPricing.find({ storefrontId: storefront._id });
    const pricingMap = new Map();
    for (const p of allPricing) pricingMap.set(p.bundleId.toString(), p);

    const allBundles = await Bundle.find({ isActive: true, isDeleted: { $ne: true } })
      .select('name description dataVolume dataUnit validity validityUnit category providerId packageId pricingTiers price requiresGhanaCard afaRequirements')
      .populate('providerId', 'name code logo')
      .populate('packageId', 'name category')
      .lean();

    const bundles = [];
    const providersMap = new Map();

    for (const bundle of allBundles) {
      const pricing = pricingMap.get(bundle._id.toString());

      // Only include the bundle if the agent has explicitly enabled it. New
      // storefronts start with *no* pricing records at all, so the absence of a
      // pricing entry should be treated as "disabled".  This guarantees that
      // customers never see bundles the agent didn't opt into. System-level
      // activity is already enforced by the initial query above (`isActive: true`),
      // so here we only need to consider the store-specific flag.
      if (!pricing || !pricing.isActive) continue;

      const price = pricing.hasCustomPrice
        ? pricing.customPrice
        : pricing.tierPrice;

      const publicBundle = {
        _id: bundle._id,
        name: bundle.name,
        description: bundle.description,
        dataVolume: bundle.dataVolume,
        dataUnit: bundle.dataUnit,
        validity: bundle.validity,
        validityUnit: bundle.validityUnit,
        category: bundle.category,
        provider: bundle.providerId?.code || 'Unknown',
        providerName: bundle.providerId?.name || bundle.providerId?.code || 'Unknown',
        packageName: bundle.packageId?.name || bundle.category || 'General',
        packageCategory: bundle.packageId?.category || bundle.category,
        price,
        requiresGhanaCard: bundle.requiresGhanaCard || false,
        afaRequirements: bundle.afaRequirements || [],
      };

      bundles.push(publicBundle);

      const provCode = bundle.providerId?.code || 'Unknown';
      const provName = bundle.providerId?.name || provCode;
      const provLogo = bundle.providerId?.logo || null;

      if (!providersMap.has(provCode)) {
        providersMap.set(provCode, { code: provCode, name: provName, logo: provLogo, packages: new Map() });
      }
      const provEntry = providersMap.get(provCode);
      const pkgName = bundle.packageId?.name || bundle.category || 'General';
      if (!provEntry.packages.has(pkgName)) {
        provEntry.packages.set(pkgName, {
          _id: bundle.packageId?._id || null,
          name: pkgName,
          category: bundle.packageId?.category || bundle.category || null,
          bundles: [],
        });
      }
      provEntry.packages.get(pkgName).bundles.push(publicBundle);
    }

    // compute store-specific "popular" bundles based on completed orders
    let popularBundles = [];
    try {
      const top = await Order.aggregate([
        { $match: { orderType: 'storefront', 'storefrontData.storefrontId': storefront._id, status: 'completed' } },
        { $unwind: '$storefrontData.items' },
        { $group: { _id: '$storefrontData.items.bundleId', qty: { $sum: '$storefrontData.items.quantity' } } },
        { $sort: { qty: -1 } },
        { $limit: 8 }
      ]);
      const topIds = top.map(r => r._id.toString());
      popularBundles = bundles
        .filter(b => topIds.includes(b._id.toString()))
        .sort((a, b) => topIds.indexOf(a._id.toString()) - topIds.indexOf(b._id.toString()));
    } catch (err) {
      logger.error('[StorefrontService] failed to compute popular bundles', err);
    }

    const providers = Array.from(providersMap.values()).map(p => ({
      code: p.code,
      name: p.name,
      logo: p.logo,
      packages: Array.from(p.packages.values()),
    }));

    return {
      storefront: {
        businessName: storefront.businessName,
        displayName: storefront.displayName,
        description: storefront.description,
        contactInfo: storefront.contactInfo,
        settings: storefront.settings,
        branding: storefront.branding || {},
        paymentMethods: storefront.paymentMethods.filter(pm => pm.isActive),
      },
      bundles,
      providers,
      popularBundles,
    };
  }

  // =========================================================================
  // Order Creation
  // =========================================================================

  async createStorefrontOrder(businessName, orderData) {
    const storefront = await AgentStorefront.findPublicStore(businessName);
    if (!storefront) throw new Error('Storefront not found or not available');

    const { items, customerInfo, paymentMethod } = orderData;

    let totalAmount = 0, totalMarkup = 0, totalTierCost = 0;
    let hasAfaBundles = false;
    const storefrontItems = [];
    const systemItems = [];

    for (const item of items) {
      const pricingRecord = await StorefrontPricing.findOne({
        storefrontId: storefront._id,
        bundleId: item.bundleId,
      }).populate({ path: 'bundleId', populate: { path: 'providerId', select: 'name code' } });

      let bundle, displayPrice, tierPrice;

      if (pricingRecord) {
        if (!pricingRecord.isActive) throw new Error(`Bundle not available in this store: ${item.bundleId}`);
        bundle = pricingRecord.bundleId;
        tierPrice = pricingRecord.tierPrice;
        displayPrice = pricingRecord.hasCustomPrice ? pricingRecord.customPrice : pricingRecord.tierPrice;
      } else {
        bundle = await Bundle.findOne({ _id: item.bundleId, isActive: true, isDeleted: { $ne: true } })
          .populate('providerId', 'name code');
        if (!bundle) throw new Error(`Bundle not available in this store: ${item.bundleId}`);
        tierPrice = bundle.pricingTiers?.[storefront.agentId?.userType || 'agent'] ?? bundle.pricingTiers?.default ?? bundle.price;
        displayPrice = tierPrice;
      }

      const itemTotal    = displayPrice * item.quantity;
      const itemMarkup   = (displayPrice - tierPrice) * item.quantity;
      const itemTierCost = tierPrice * item.quantity;

      totalAmount   += itemTotal;
      totalMarkup   += itemMarkup;
      totalTierCost += itemTierCost;

      const phone       = item.customerPhone || customerInfo.phone;
      const providerCode = bundle.providerId?.code || 'Unknown';

      if (providerCode === 'AFA' && bundle.requiresGhanaCard) {
        hasAfaBundles = true;
        if (!customerInfo.ghanaCardNumber) throw new Error(`Ghana Card number is required for AFA bundle: ${bundle.name}`);
        if (!/^GHA-\d{9}-\d$/i.test(customerInfo.ghanaCardNumber.toUpperCase())) {
          throw new Error(`Invalid Ghana Card format for: ${bundle.name}. Must be GHA-XXXXXXXXX-X`);
        }
      }

      storefrontItems.push({
        bundleId: bundle._id,
        bundleName: bundle.name,
        provider: providerCode,
        dataVolume: bundle.dataVolume,
        dataUnit: bundle.dataUnit,
        validity: bundle.validity,
        validityUnit: bundle.validityUnit,
        quantity: item.quantity,
        customerPhone: phone,
        unitPrice: displayPrice,
        tierPrice,
        totalPrice: itemTotal,
      });

      systemItems.push({
        packageGroup: bundle.packageId,
        packageItem: bundle._id,
        packageDetails: {
          name: bundle.name,
          code: bundle._id.toString(),
          price: tierPrice,
          dataVolume: bundle.dataVolume,
          validity: bundle.validity,
          validityUnit: bundle.validityUnit,
          provider: providerCode,
        },
        quantity: item.quantity,
        unitPrice: tierPrice,
        totalPrice: itemTierCost,
        customerPhone: phone,
        bundleSize: { value: bundle.dataVolume, unit: bundle.dataUnit || 'GB' },
        processingStatus: 'pending',
      });
    }

    // ── Fee delegation for Paystack payments ──────────────────────────────────
    // When fees are delegated to the customer, we increase the order total so
    // the platform receives the full base amount after Paystack deductions.
    let chargeTotal = totalAmount; // what we'll actually charge the customer
    let feeBreakdown = null;

    if (paymentMethod.type === 'paystack') {
      try {
        const feeConfig = await getFeeConfig();
        const { chargeAmount, paystackFee, platformFee, totalFee } =
          calculateChargeWithFees(totalAmount, feeConfig);
        chargeTotal = chargeAmount;
        feeBreakdown = {
          baseAmount: totalAmount,
          paystackFee,
          platformFee,
          totalFee,
          delegated: feeConfig.delegateFeesToCustomer,
        };
      } catch (err) {
        logger.warn('[StorefrontService] Fee calculation failed, using base amount:', err.message);
      }
    }

    const order = new Order({
      orderType: 'storefront',
      customer: null,
      ...(hasAfaBundles ? {
        customerInfo: {
          name: customerInfo.name,
          phone: customerInfo.phone,
          ...(customerInfo.ghanaCardNumber ? { ghanaCardNumber: customerInfo.ghanaCardNumber } : {}),
        },
      } : {}),
      items: systemItems,
      storefrontData: {
        storefrontId: storefront._id,
        customerInfo: {
          name: customerInfo.name,
          phone: customerInfo.phone,
          ...(customerInfo.email ? { email: customerInfo.email } : {}),
          ...(customerInfo.ghanaCardNumber ? { ghanaCardNumber: customerInfo.ghanaCardNumber } : {}),
        },
        paymentMethod: {
          type: paymentMethod.type,
          reference: paymentMethod.reference || '',
          paymentProofUrl: paymentMethod.paymentProofUrl || '',
          verified: false,
        },
        totalMarkup,
        totalTierCost,
        items: storefrontItems,
        ...(feeBreakdown ? { feeBreakdown } : {}),
      },
      // top-level paymentMethod mirrors storefront type so generic code can tell
      paymentMethod: paymentMethod.type === 'paystack' ? 'card' : paymentMethod.type,
      subtotal: totalAmount,
      total: chargeTotal,
      // Paystack orders are pending_payment until webhook/verify confirms payment.
      // Mobile money orders are also pending_payment — agent verifies manually.
      status: 'pending_payment',
      tenantId: storefront.agentId._id || storefront.agentId,
      createdBy: storefront.agentId._id || storefront.agentId,
    });

    if (hasAfaBundles && customerInfo.ghanaCardNumber) {
      order.notes = `AFA Registration — ${systemItems[0]?.packageDetails?.name || 'AFA Bundle'} for ${customerInfo.name}${customerInfo.phone ? ` (${customerInfo.phone})` : ''} — Ghana Card: ${customerInfo.ghanaCardNumber}`;
    }

    await order.save();

    try {
      const agentId = (storefront.agentId._id || storefront.agentId).toString();
      await notificationService.createInAppNotification(
        agentId,
        'New Storefront Order',
        `New order from ${customerInfo.name}${customerInfo.phone ? ` (${customerInfo.phone})` : ''} for GHS ${totalAmount.toFixed(2)}`,
        'info',
        { orderId: order._id, orderNumber: order.orderNumber, type: 'storefront_order' }
      );
    } catch (err) {
      logger.error('[StorefrontService] New order notification failed:', err);
    }

    return order;
  }

  // =========================================================================
  // Paystack Payment Processing
  // =========================================================================

  /**
   * Confirm a storefront Paystack payment — called from BOTH the webhook handler
   * and the frontend verify endpoint so the payment is never missed regardless of
   * whether the webhook arrives before or after the user's browser callback.
   *
   * Design mirrors walletService.processPaystackWebhook:
   *  - NO MongoDB sessions → works on standalone MongoDB (no replica set needed)
   *  - Idempotency via order.storefrontData.paymentMethod.verified flag
   *  - Order ID extracted from reference directly (no dependency on metadata.orderId)
   *  - Agent balances updated with atomic $inc
   *
   * @param {object} paystackData  The raw Paystack transaction object (from verifyTransaction or webhook).
   */
  async processPaystackPayment(paystackData) {
    const reference = paystackData.reference;

    // ── 1. Derive order ID from reference ────────────────────────────────────
    const orderId = this._orderIdFromReference(reference);
    if (!orderId) {
      // Not a storefront reference — silently skip (wallet handler will pick it up)
      return { processed: false, reason: 'not_storefront_reference' };
    }

    // ── 2. Load order ─────────────────────────────────────────────────────────
    const order = await Order.findById(orderId);
    if (!order || order.orderType !== 'storefront') {
      logger.warn('[StorefrontService] Order not found for Paystack payment', { orderId, reference });
      return { processed: false, reason: 'order_not_found' };
    }

    // ── 3. Idempotency — if already processed, return success immediately ─────
    if (order.storefrontData?.paymentMethod?.verified === true) {
      logger.info('[StorefrontService] Payment already processed — idempotency guard triggered', { orderId, reference });
      return { processed: false, duplicate: true, order };
    }

    // ── 4. Validate payment status ────────────────────────────────────────────
    if (paystackData.status !== 'success') {
      logger.warn('[StorefrontService] Paystack transaction not successful', { reference, status: paystackData.status });
      return { processed: false, reason: 'payment_not_successful' };
    }

    // ── 5. Amount validation ──────────────────────────────────────────────────
    const customerTotal = Number(order.total) || 0;
    const expectedPesewas = paystackService.convertToPesewas(customerTotal);

    if (Number(paystackData.amount) !== Number(expectedPesewas)) {
      logger.error('[StorefrontService] Amount mismatch', { orderId, expectedPesewas, received: paystackData.amount });
      // Record the mismatch but don't block the order (amounts can vary by fractions due to fee rounding)
      order.metadata = order.metadata || {};
      order.metadata.paystackAmountMismatch = { expected: expectedPesewas, received: paystackData.amount };
      await order.save();
      return { processed: false, reason: 'amount_mismatch' };
    }

    // ── 6. Load storefront & agent ─────────────────────────────────────────────
    const storefront = await AgentStorefront.findById(order.storefrontData.storefrontId);
    if (!storefront) throw new Error('Storefront not found for order');

    const agentId = storefront.agentId;

    // ── 7. Compute split ──────────────────────────────────────────────────────
    const tierCost    = order.storefrontData.totalTierCost
      || (order.storefrontData.items || []).reduce((s, it) => s + ((it.tierPrice || 0) * (it.quantity || 1)), 0);

    const paystackFeePesewas = Number(paystackData.fees) || 0;
    const { netReceived, shortfall } = calculateStorefrontSplit({ customerTotal, paystackFeePesewas, tierCost });

    if (shortfall > 0) {
      logger.error('[StorefrontService] Insufficient net after Paystack fees', { orderId, netReceived, tierCost });
      order.metadata = order.metadata || {};
      order.metadata.paystackShortfall = { netReceived, tierCost };
      await order.save();
      return { processed: false, reason: 'insufficient_net' };
    }

    // ── 8. Storefront profit is only credited when the order
    // transitions to **completed** status.  We no longer touch any
    // wallet/earnings balance during payment verification; the markup
    // will be applied later by _creditStorefrontProfit when the order is
    // finalised.
    //
    // (This deferral avoids premature earnings for orders that might be
    // cancelled or fail during processing.)
    //
    // NOTE: previous implementation incremented the agent's
    // earningsBalance here, but that logic was removed per recent
    // requirements.

    // ── 11. Mark order as paid and advance to processing queue ────────────────
    order.storefrontData.paymentMethod.verified   = true;
    order.storefrontData.paymentMethod.verifiedAt = new Date();
    order.storefrontData.paymentMethod.verificationNotes = `Paystack auto-verified (${paystackData.channel || 'online'})`;
    order.storefrontData.paymentMethod.gateway    = 'paystack';
    order.storefrontData.paymentMethod.reference  = reference;
    order.paymentStatus = 'paid';
    order.status        = 'pending'; // enters admin processing queue
    order.metadata      = order.metadata || {};
    order.metadata.paystack = {
      reference,
      transactionId: paystackData.id,
      customerPaid: customerTotal,
      paystackCollectionFee: paystackFeePesewas / 100,
      netReceived,
      processedAt: new Date(),
    };

    await order.save();

    logger.info(`[StorefrontService] Paystack payment confirmed — Order ${order.orderNumber}, GH₵${customerTotal}, ref: ${reference}`);

    // ── 12. Real-time & in-app notifications (non-critical) ───────────────────
    await this._notifyAgent(agentId, order._id, order.orderNumber, customerTotal);

    try {
      const admins = await User.find({ userType: 'super_admin', isActive: true }).select('_id');
      for (const admin of admins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          'Storefront Order Paid',
          `Order ${order.orderNumber} paid via Paystack — ready for processing.`,
          'info',
          { orderId: order._id, orderNumber: order.orderNumber, type: 'storefront_order_paid' }
        );
      }

      await notificationService.createInAppNotification(
        agentId.toString(),
        'Storefront Order Paid',
        `Order ${order.orderNumber} from ${order.storefrontData?.customerInfo?.name || 'customer'} has been paid (GH₵${customerTotal.toFixed(2)}). It is now queued for processing.`,
        'success',
        { orderId: order._id, orderNumber: order.orderNumber, type: 'storefront_order_paid' }
      );
    } catch (err) {
      logger.error('[StorefrontService] Notification failed after payment processing:', err);
    }

    return { processed: true, order };
  }

  /**
   * Called by the Paystack webhook handler (paystackRoutes → paystackService).
   * Thin router: wallet top-ups go to walletService, storefront orders come here.
   */
  async processPaystackOrderWebhook(event) {
    const { data } = event;
    const reference = data?.reference;

    if (!reference) return { processed: false, reason: 'no_reference' };

    if (reference.startsWith('storefront_')) {
      return this.processPaystackPayment(data);
    }

    // Not a storefront reference — caller should route elsewhere
    return { processed: false, reason: 'not_storefront_reference' };
  }

  /**
   * Issue a refund through Paystack for a storefront order.
   * Only works when the order has a Paystack reference stored in
   * `storefrontData.paymentMethod.reference`.
   * Returns whatever the Paystack service returns (promise) or null if no
   * refund was attempted.
   */
  async refundPaystackOrder(orderId) {
    const order = await Order.findById(orderId);
    if (!order || order.orderType !== 'storefront') {
      throw new Error('Order not found or not a storefront order');
    }

    const pm = order.storefrontData?.paymentMethod;
    if (!pm || pm.type !== 'paystack') {
      return null; // nothing to refund
    }

    const reference = pm.reference;
    if (!reference) {
      throw new Error('No Paystack reference available on order');
    }

    const ps = (await import('./paystackService.js')).default;
    // paystackService should expose a refundTransaction/refund method
    if (typeof ps.refundTransaction === 'function') {
      return ps.refundTransaction(reference);
    } else if (typeof ps.refund === 'function') {
      return ps.refund(reference);
    } else {
      throw new Error('Paystack service does not support refunds');
    }
  }

  // =========================================================================
  // Agent manual payment verification (Mobile Money / Bank Transfer)
  // =========================================================================

  /**
   * Agent manually verifies a mobile money or bank transfer payment.
   * Deducts the tier cost from the agent's wallet and advances the order.
   * This path is only for non-Paystack payment methods.
   */
  async verifyManualPayment(orderId, verificationData, userId) {
    const order = await Order.findById(orderId);
    if (!order || order.orderType !== 'storefront') throw new Error('Order not found');

    const storefront = await AgentStorefront.findById(order.storefrontData.storefrontId);
    if (!storefront || storefront.agentId.toString() !== userId.toString()) {
      throw new Error('Not authorized to verify this order');
    }

    if (order.storefrontData.paymentMethod.verified) throw new Error('Payment already verified for this order');
    if (order.status === 'cancelled') throw new Error('Cannot verify a cancelled order');
    if (order.status !== 'pending_payment') throw new Error('Order is not awaiting payment');

    // Paystack orders should go through processPaystackPayment — not this path
    if (order.storefrontData.paymentMethod.type === 'paystack') {
      throw new Error('Paystack orders are verified automatically. Use the Paystack verify endpoint instead.');
    }

    const tierCost = order.storefrontData.totalTierCost
      || (order.storefrontData.items || []).reduce((s, it) => s + (it.tierPrice * it.quantity), 0);

    if (tierCost <= 0) throw new Error('Unable to calculate order cost');

    // Deduct from agent wallet — throws if insufficient balance
    try {
      await walletService.debitWallet(
        userId.toString(),
        tierCost,
        `Storefront order fulfillment (Order: ${order.orderNumber})`,
        order._id,
        { orderType: 'storefront', storefrontId: storefront._id.toString() }
      );
    } catch {
      throw new Error(`Insufficient wallet balance. You need GH₵${tierCost.toFixed(2)} to fulfil this order.`);
    }

    order.storefrontData.paymentMethod.verified   = true;
    order.storefrontData.paymentMethod.verifiedAt = new Date();
    order.storefrontData.paymentMethod.verificationNotes = verificationData.notes || '';
    order.paymentStatus = 'paid';
    order.status        = 'pending'; // enters admin processing queue

    await order.save();

    try {
      const admins = await User.find({ userType: 'super_admin', isActive: true }).select('_id');
      for (const admin of admins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          'Storefront Order Ready',
          `Storefront order ${order.orderNumber} payment manually verified. Ready for processing.`,
          'info',
          { orderId: order._id, orderNumber: order.orderNumber, type: 'storefront_order_verified' }
        );
      }
    } catch (err) {
      logger.error('[StorefrontService] Notification failed after manual verification:', err);
    }

    return order;
  }

  // Keep the old name as an alias so existing controller code doesn't break
  async verifyPayment(orderId, verificationData, userId) {
    return this.verifyManualPayment(orderId, verificationData, userId);
  }

  // =========================================================================
  // Order Management (Agent-facing)
  // =========================================================================

  async getStorefrontOrders(storefrontId, filters = {}, pagination = {}) {
    const { status } = filters;
    const { limit = 50, offset = 0 } = pagination;

    const query = { orderType: 'storefront', 'storefrontData.storefrontId': storefrontId };
    if (status) query.status = status;

    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit),
      Order.countDocuments(query),
    ]);

    return { orders, total };
  }

  async rejectOrder(orderId, rejectionReason, userId) {
    const order = await Order.findById(orderId);
    if (!order || order.orderType !== 'storefront') throw new Error('Order not found');

    const storefront = await AgentStorefront.findById(order.storefrontData.storefrontId);
    if (!storefront || storefront.agentId.toString() !== userId.toString()) throw new Error('Not authorized');

    if (['completed', 'processing'].includes(order.status)) {
      throw new Error('Cannot reject an order already being processed');
    }

    // Refund wallet if agent already paid (manual verify path only)
    if (order.storefrontData.paymentMethod.verified && order.paymentStatus === 'paid'
        && order.storefrontData.paymentMethod.type !== 'paystack') {
      const tierCost = order.storefrontData.totalTierCost
        || (order.storefrontData.items || []).reduce((s, it) => s + (it.tierPrice * it.quantity), 0);
      if (tierCost > 0) {
        try {
          await walletService.creditWallet(
            userId.toString(),
            tierCost,
            `Refund for rejected storefront order (Order: ${order.orderNumber})`,
            order._id,
            { orderType: 'storefront', reason: 'order_rejected' }
          );
        } catch (err) {
          logger.error(`[StorefrontService] Refund failed for rejected order ${order._id}:`, err);
        }
      }
    }

    order.status = 'cancelled';
    order.storefrontData.paymentMethod.verificationNotes = rejectionReason;
    return order.save();
  }

  // =========================================================================
  // Analytics
  // =========================================================================

  async getStorefrontAnalytics(storefrontId, dateRange = {}) {
    const matchQuery = { orderType: 'storefront', 'storefrontData.storefrontId': storefrontId };

    if (dateRange.startDate || dateRange.endDate) {
      matchQuery.createdAt = {};
      if (dateRange.startDate) matchQuery.createdAt.$gte = new Date(dateRange.startDate);
      if (dateRange.endDate)   matchQuery.createdAt.$lte = new Date(dateRange.endDate);
    }

    const [result] = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalOrders:        { $sum: 1 },
          totalRevenue:       { $sum: '$total' },
          // profit from completed orders only (matches earnings behaviour)
          totalProfit:        {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$storefrontData.totalMarkup', 0] }
          },
          // extra fields for reporting/pagination
          pendingProfit:      {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$storefrontData.totalMarkup', 0] }
          },
          confirmedProfit:    {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, '$storefrontData.totalMarkup', 0] }
          },
          averageOrderValue:  { $avg: '$total' },
          completedOrders:    { $sum: { $cond: [{ $eq: ['$status', 'completed']  }, 1, 0] } },
          confirmedOrders:    { $sum: { $cond: [{ $eq: ['$status', 'confirmed']  }, 1, 0] } },
          pendingOrders:      { $sum: { $cond: [{ $eq: ['$status', 'pending']    }, 1, 0] } },
          cancelledOrders:    { $sum: { $cond: [{ $eq: ['$status', 'cancelled']  }, 1, 0] } },
        },
      },
    ]);

    return result || {
      totalOrders: 0, totalRevenue: 0, totalProfit: 0, averageOrderValue: 0,
      completedOrders: 0, confirmedOrders: 0, pendingOrders: 0, cancelledOrders: 0,
      pendingProfit: 0, confirmedProfit: 0,
    };
  }

  // =========================================================================
  // Admin Operations
  // =========================================================================

  async getAllStorefronts(filters = {}, pagination = {}) {
    const { status, search } = filters;
    const { limit = 20, offset = 0 } = pagination;
    const query = {};

    if (status === 'active')    { query.isActive = true; query.suspendedByAdmin = { $ne: true }; }
    else if (status === 'inactive')  query.isActive = false;
    else if (status === 'pending')   query.isApproved = false;
    else if (status === 'approved')  query.isApproved = true;
    else if (status === 'suspended') query.suspendedByAdmin = true;

    if (search) {
      query.$or = [
        { businessName: { $regex: search, $options: 'i' } },
        { displayName:  { $regex: search, $options: 'i' } },
      ];
    }

    const [storefronts, total] = await Promise.all([
      AgentStorefront.find(query)
        .populate('agentId', 'fullName email phone userType walletBalance')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
      AgentStorefront.countDocuments(query),
    ]);

    return { storefronts, total };
  }

  async approveStorefront(storefrontId, adminId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) throw new Error('Storefront not found');
    if (storefront.isApproved) throw new Error('Storefront is already approved');

    storefront.isApproved = true;
    storefront.isActive   = true;
    storefront.approvedAt = new Date();
    storefront.approvedBy = adminId;
    await storefront.save();

    try {
      await notificationService.createInAppNotification(
        storefront.agentId.toString(),
        'Storefront Approved!',
        `Your storefront "${storefront.displayName}" has been approved and is now live!`,
        'success',
        { type: 'storefront_approved', storefrontId: storefront._id }
      );
    } catch (err) {
      logger.error('[StorefrontService] Approval notification failed:', err);
    }

    return storefront;
  }

  async adminSuspendStorefront(storefrontId, adminId, reason) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) throw new Error('Storefront not found');
    if (storefront.suspendedByAdmin) throw new Error('Storefront is already suspended');

    storefront.isActive         = false;
    storefront.suspendedByAdmin = true;
    storefront.suspensionReason = reason || 'Suspended by administrator';
    storefront.suspendedAt      = new Date();
    storefront.suspendedBy      = adminId;
    await storefront.save();

    try {
      await notificationService.createInAppNotification(
        storefront.agentId.toString(),
        'Storefront Suspended',
        `Your storefront "${storefront.displayName}" has been suspended.${reason ? ` Reason: ${reason}` : ''} Contact support.`,
        'error',
        { type: 'storefront_suspended', storefrontId: storefront._id }
      );
    } catch (err) {
      logger.error('[StorefrontService] Suspension notification failed:', err);
    }

    return storefront;
  }

  async adminUnsuspendStorefront(storefrontId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) throw new Error('Storefront not found');
    if (!storefront.suspendedByAdmin) throw new Error('Storefront is not suspended');

    storefront.suspendedByAdmin = false;
    storefront.suspensionReason = null;
    storefront.suspendedAt      = null;
    storefront.suspendedBy      = null;
    storefront.isActive         = storefront.isApproved;
    await storefront.save();

    try {
      await notificationService.createInAppNotification(
        storefront.agentId.toString(),
        'Storefront Unsuspended',
        `Your storefront "${storefront.displayName}" has been reactivated.`,
        'success',
        { type: 'storefront_unsuspended', storefrontId: storefront._id }
      );
    } catch (err) {
      logger.error('[StorefrontService] Unsuspension notification failed:', err);
    }

    return storefront;
  }

  async adminDeleteStorefront(storefrontId, adminId, reason) {
    const storefront = await AgentStorefront.findById(storefrontId).populate('agentId', 'fullName');
    if (!storefront) throw new Error('Storefront not found');

    const active = await Order.countDocuments({
      orderType: 'storefront',
      'storefrontData.storefrontId': storefrontId,
      status: { $in: ['pending', 'confirmed', 'processing'] },
    });
    if (active > 0) throw new Error(`Cannot delete storefront with ${active} active order(s).`);

    const agentId    = storefront.agentId._id || storefront.agentId;
    const displayName = storefront.displayName;

    await StorefrontPricing.deleteMany({ storefrontId });
    await AgentStorefront.findByIdAndDelete(storefrontId);

    try {
      await notificationService.createInAppNotification(
        agentId.toString(),
        'Storefront Removed',
        `Your storefront "${displayName}" has been removed by an administrator.${reason ? ` Reason: ${reason}` : ''}`,
        'error',
        { type: 'storefront_deleted' }
      );
    } catch (err) {
      logger.error('[StorefrontService] Deletion notification failed:', err);
    }

    return { deleted: true };
  }

  async toggleAutoApprove(enabled) {
    const settings = await Settings.getInstance();
    settings.autoApproveStorefronts = enabled;
    await settings.save();
    return { autoApproveStorefronts: settings.autoApproveStorefronts };
  }

  async getAutoApproveSetting() {
    const settings = await Settings.getInstance();
    return { autoApproveStorefronts: settings.autoApproveStorefronts || false };
  }

  async getAdminStorefrontStats() {
    const [totalStores, activeStores, pendingApproval, suspendedStores, totalStorefrontOrders] = await Promise.all([
      AgentStorefront.countDocuments(),
      AgentStorefront.countDocuments({ isActive: true, isApproved: true, suspendedByAdmin: { $ne: true } }),
      AgentStorefront.countDocuments({ isApproved: false }),
      AgentStorefront.countDocuments({ suspendedByAdmin: true }),
      Order.countDocuments({ orderType: 'storefront' }),
    ]);

    const [revenueStats] = await Order.aggregate([
      { $match: { orderType: 'storefront', status: { $in: ['completed', 'confirmed'] } } },
      { $group: { _id: null, totalRevenue: { $sum: '$total' }, totalProfit: { $sum: '$storefrontData.totalMarkup' } } },
    ]);

    const settings = await Settings.getInstance();

    return {
      totalStores, activeStores, pendingApproval, suspendedStores, totalStorefrontOrders,
      totalRevenue: revenueStats?.totalRevenue || 0,
      totalProfit:  revenueStats?.totalProfit  || 0,
      autoApproveStorefronts: settings.autoApproveStorefronts || false,
    };
  }
}

export default new StorefrontService();