// src/services/storefrontService.js
import AgentStorefront from '../models/AgentStorefront.js';
import StorefrontPricing from '../models/StorefrontPricing.js';
import Bundle from '../models/Bundle.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Settings from '../models/Settings.js';
import walletService from './walletService.js';
import notificationService from './notificationService.js';
import logger from '../utils/logger.js';

class StorefrontService {
  
  // =========================================================================
  // Storefront CRUD Operations
  // =========================================================================
  
  /**
   * Create a new storefront for an authenticated user
   * Checks auto-approve setting to determine if store goes live immediately
   */
  async createStorefront(userId, storefrontData) {
    const existingStorefront = await AgentStorefront.findOne({ agentId: userId });
    if (existingStorefront) {
      throw new Error('You already have a storefront');
    }
    
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    if (!user.isActive) {
      throw new Error('Your account is not active');
    }
    
    // Check if auto-approve is enabled
    const settings = await Settings.getInstance();
    const autoApprove = settings.autoApproveStorefronts || false;
    
    const storefront = new AgentStorefront({
      agentId: userId,
      ...storefrontData,
      isApproved: autoApprove,
      isActive: autoApprove,
      ...(autoApprove ? { approvedAt: new Date() } : {})
    });
    
    const saved = await storefront.save();
    
    // Notify admins about new storefront
    try {
      const admins = await User.find({ userType: 'super_admin', isActive: true }).select('_id');
      for (const admin of admins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          'New Storefront Created',
          `${user.fullName} has created a new storefront "${storefrontData.displayName}"${autoApprove ? ' (auto-approved)' : ' - awaiting approval'}`,
          'info',
          { type: 'storefront_created', storefrontId: saved._id }
        );
      }
    } catch (notifErr) {
      logger.error('Failed to send storefront creation notification:', notifErr);
    }
    
    return saved;
  }
  
  /**
   * Get user's storefront
   * If suspended by admin, returns store with suspension info so agent sees the message
   */
  async getAgentStorefront(userId) {
    const storefront = await AgentStorefront.findOne({ agentId: userId })
      .populate('agentId', 'fullName userType');
    
    if (!storefront) return null;
    
    // If suspended by admin, include that info so frontend can show appropriate message
    return storefront;
  }
  
  /**
   * Update storefront (with ownership check)
   * Blocked if suspended by admin
   */
  async updateStorefront(storefrontId, updateData, userId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    if (userId && storefront.agentId.toString() !== userId.toString()) {
      throw new Error('Not authorized to update this storefront');
    }
    
    if (storefront.suspendedByAdmin) {
      throw new Error('Your storefront has been suspended by an administrator. Please contact support.');
    }
    
    // Prevent changing certain fields directly
    delete updateData.isActive;
    delete updateData.isApproved;
    delete updateData.suspendedByAdmin;
    delete updateData.agentId;
    
    Object.assign(storefront, updateData);
    return await storefront.save();
  }
  
  /**
   * Agent deactivates their own storefront (soft - they can still see it, public can't)
   */
  async deactivateStorefront(storefrontId, userId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    if (userId && storefront.agentId.toString() !== userId.toString()) {
      throw new Error('Not authorized to deactivate this storefront');
    }
    
    if (storefront.suspendedByAdmin) {
      throw new Error('Your storefront has been suspended by an administrator. Please contact support.');
    }
    
    storefront.isActive = false;
    return await storefront.save();
  }
  
  /**
   * Agent reactivates their own storefront
   */
  async reactivateStorefront(storefrontId, userId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    if (userId && storefront.agentId.toString() !== userId.toString()) {
      throw new Error('Not authorized');
    }
    
    if (storefront.suspendedByAdmin) {
      throw new Error('Your storefront has been suspended by an administrator. Please contact support.');
    }
    
    if (!storefront.isApproved) {
      throw new Error('Your storefront has not been approved yet');
    }
    
    storefront.isActive = true;
    return await storefront.save();
  }
  
  /**
   * Agent deletes their storefront (graceful - checks for active orders)
   */
  async deleteStorefront(storefrontId, userId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    if (userId && storefront.agentId.toString() !== userId.toString()) {
      throw new Error('Not authorized');
    }
    
    // Check for active orders
    const activeOrders = await Order.countDocuments({
      orderType: 'storefront',
      'storefrontData.storefrontId': storefrontId,
      status: { $in: ['pending', 'confirmed', 'processing'] }
    });
    
    if (activeOrders > 0) {
      throw new Error(`Cannot delete storefront with ${activeOrders} active order(s). Please complete or cancel all pending orders first.`);
    }
    
    // Clean up pricing records
    await StorefrontPricing.deleteMany({ storefrontId });
    
    // Delete the storefront
    await AgentStorefront.findByIdAndDelete(storefrontId);
    
    return { deleted: true };
  }
  
  // =========================================================================
  // Bundle & Pricing Operations
  // =========================================================================
  
  /**
   * Get ALL active bundles with agent's tier pricing + any custom pricing they've set.
   * Shows every bundle the admin has made active, with:
   * - tierPrice (agent's cost based on user type)
   * - customPrice (if agent set one)
   * - isEnabled (whether agent has enabled this bundle in their store)
   */
  async getAgentBundlesForPricing(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const storefront = await AgentStorefront.findOne({ agentId: userId });
    
    // Get ALL active bundles from admin
    const bundles = await Bundle.find({ isActive: true })
      .populate('providerId', 'name code logo')
      .populate('packageId', 'name');
    
    // Get agent's existing pricing/selections
    let pricingMap = new Map();
    if (storefront) {
      const existingPricing = await StorefrontPricing.find({ storefrontId: storefront._id });
      for (const p of existingPricing) {
        pricingMap.set(p.bundleId.toString(), p);
      }
    }
    
    return bundles.map(bundle => {
      const tierPrice = bundle.getPriceForUserType(user.userType);
      const existingPricing = pricingMap.get(bundle._id.toString());
      
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
        provider: bundle.providerId ? {
          _id: bundle.providerId._id,
          name: bundle.providerId.name,
          code: bundle.providerId.code,
        } : null,
        packageName: bundle.packageId?.name || null,
        tierPrice,
        // Custom pricing info (if agent has set any)
        customPrice: existingPricing?.hasCustomPrice ? existingPricing.customPrice : null,
        markup: existingPricing?.hasCustomPrice ? existingPricing.markup : null,
        // Whether this bundle is enabled in the agent's store
        isEnabled: existingPricing?.isActive || false,
      };
    });
  }
  
  /**
   * Set custom pricing for bundles
   * If customPrice is provided, use it. Otherwise enable bundle at tier price.
   */
  async setPricing(storefrontId, pricingData) {
    const storefront = await AgentStorefront.findById(storefrontId).populate('agentId');
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    const results = { updated: 0, created: 0 };
    
    for (const pricing of pricingData) {
      const { bundleId, customPrice } = pricing;
      
      const bundle = await Bundle.findById(bundleId);
      if (!bundle) {
        throw new Error(`Bundle not found: ${bundleId}`);
      }
      
      if (!bundle.isActive) {
        throw new Error(`Bundle is not active: ${bundleId}`);
      }
      
      const tierPrice = bundle.getPriceForUserType(storefront.agentId.userType);
      if (!tierPrice) {
        throw new Error(`Bundle not available for your account type: ${bundleId}`);
      }
      
      const hasCustomPrice = customPrice !== undefined && customPrice !== null;
      const finalPrice = hasCustomPrice ? customPrice : tierPrice;
      
      if (hasCustomPrice && customPrice < tierPrice) {
        throw new Error(`Custom price cannot be less than tier price (${tierPrice}) for bundle: ${bundle.name}`);
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
          storefrontId,
          bundleId,
          tierPrice,
          customPrice: finalPrice,
          markup: finalPrice - tierPrice,
          markupPercentage: tierPrice > 0 ? ((finalPrice - tierPrice) / tierPrice) * 100 : 0,
          hasCustomPrice,
          isActive: true
        });
        results.created++;
      }
    }
    
    return results;
  }
  
  /**
   * Toggle bundle visibility in agent's store (enable/disable bundles)
   * Agent can choose which bundles to show regardless of whether they set custom pricing
   */
  async toggleBundles(storefrontId, bundleUpdates, userId) {
    const storefront = await AgentStorefront.findById(storefrontId).populate('agentId');
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    if (storefront.agentId._id.toString() !== userId.toString()) {
      throw new Error('Not authorized');
    }
    
    const results = { enabled: 0, disabled: 0 };
    
    for (const update of bundleUpdates) {
      const { bundleId, isEnabled } = update;
      
      const bundle = await Bundle.findById(bundleId);
      if (!bundle) continue;
      
      const tierPrice = bundle.getPriceForUserType(storefront.agentId.userType);
      
      if (isEnabled) {
        // Enable bundle - create pricing record at tier price if none exists
        await StorefrontPricing.findOneAndUpdate(
          { storefrontId, bundleId },
          {
            $setOnInsert: {
              tierPrice,
              customPrice: tierPrice,
              markup: 0,
              markupPercentage: 0,
              hasCustomPrice: false
            },
            isActive: true
          },
          { upsert: true, new: true }
        );
        results.enabled++;
      } else {
        // Disable bundle - just set isActive to false (keep the record for potential re-enable)
        await StorefrontPricing.findOneAndUpdate(
          { storefrontId, bundleId },
          { isActive: false }
        );
        results.disabled++;
      }
    }
    
    return results;
  }
  
  /**
   * Get storefront pricing (agent view - includes tier prices, custom prices, enabled status)
   */
  async getStorefrontPricing(storefrontId) {
    return await StorefrontPricing.find({ storefrontId })
      .populate({
        path: 'bundleId',
        select: 'name description dataVolume dataUnit validity validityUnit category bundleCode providerId isActive',
        populate: { path: 'providerId', select: 'name code' }
      })
      .sort({ isActive: -1, createdAt: -1 });
  }
  
  // =========================================================================
  // Public Operations (Customer-facing)
  // =========================================================================
  
  /**
   * Get public storefront by business name
   * Shows ALL admin-active bundles EXCEPT those the agent explicitly disabled.
   * Price = customPrice if agent set one, otherwise agent's tier price.
   */
  async getPublicStorefront(businessName) {
    const storefront = await AgentStorefront.findPublicStore(businessName);
    if (!storefront) {
      throw new Error('Storefront not found or not available');
    }
    
    const agentUserType = storefront.agentId?.userType || 'agent';
    
    // Get ALL StorefrontPricing records for this store (active AND disabled)
    const allPricing = await StorefrontPricing.find({ 
      storefrontId: storefront._id 
    });
    
    // Build a map: bundleId string -> StorefrontPricing record
    const pricingMap = new Map();
    for (const p of allPricing) {
      pricingMap.set(p.bundleId.toString(), p);
    }
    
    // Get ALL active bundles from the system (include AFA fields + packageId for grouping)
    const allBundles = await Bundle.find({ isActive: true, isDeleted: { $ne: true } })
      .select('name description dataVolume dataUnit validity validityUnit category providerId packageId pricingTiers price requiresGhanaCard afaRequirements')
      .populate('providerId', 'name code')
      .populate('packageId', 'name category')
      .lean();
    
    // For each bundle: show unless agent explicitly disabled it
    const bundles = [];
    for (const bundle of allBundles) {
      const pricing = pricingMap.get(bundle._id.toString());
      
      if (pricing && !pricing.isActive) {
        // Agent explicitly disabled this bundle — hide it
        continue;
      }
      
      let price;
      if (pricing) {
        // Agent has an active pricing record
        price = pricing.hasCustomPrice ? pricing.customPrice : pricing.tierPrice;
      } else {
        // No pricing record — show at agent's tier price
        price = bundle.pricingTiers?.[agentUserType] ?? bundle.pricingTiers?.default ?? bundle.price;
      }
      
      bundles.push({
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
        // AFA-specific fields
        requiresGhanaCard: bundle.requiresGhanaCard || false,
        afaRequirements: bundle.afaRequirements || [],
      });
    }
    
    return {
      storefront: {
        businessName: storefront.businessName,
        displayName: storefront.displayName,
        description: storefront.description,
        contactInfo: storefront.contactInfo,
        settings: storefront.settings,
        branding: storefront.branding || {},
        paymentMethods: storefront.paymentMethods.filter(pm => pm.isActive)
      },
      bundles
    };
  }
  
  /**
   * Create storefront order (customer places order)
   * Email is optional. Supports optional payment proof screenshot URL.
   */
  async createStorefrontOrder(businessName, orderData) {
    const storefront = await AgentStorefront.findPublicStore(businessName);
    if (!storefront) {
      throw new Error('Storefront not found or not available');
    }
    
    const { items, customerInfo, paymentMethod } = orderData;
    
    // Validate and calculate order items
    let totalAmount = 0;
    let totalMarkup = 0;
    let totalTierCost = 0;
    const storefrontItems = [];   // For storefrontData.items (customer-facing prices)
    const systemItems = [];       // For top-level items[] (tier prices for agent processing)
    
    for (const item of items) {
      // Look up ANY pricing record (active or disabled) to check agent intent
      const pricingRecord = await StorefrontPricing.findOne({
        storefrontId: storefront._id,
        bundleId: item.bundleId
      }).populate({ path: 'bundleId', populate: { path: 'providerId', select: 'name code' } });
      
      let bundle, displayPrice, tierPrice;
      
      if (pricingRecord) {
        // Agent has a record — reject if they've disabled this bundle
        if (!pricingRecord.isActive) {
          throw new Error(`Bundle not available in this store: ${item.bundleId}`);
        }
        bundle = pricingRecord.bundleId;
        tierPrice = pricingRecord.tierPrice;
        displayPrice = pricingRecord.hasCustomPrice ? pricingRecord.customPrice : pricingRecord.tierPrice;
      } else {
        // No pricing record — bundle is available at tier price by default
        bundle = await Bundle.findOne({ _id: item.bundleId, isActive: true, isDeleted: { $ne: true } })
          .populate('providerId', 'name code');
        if (!bundle) {
          throw new Error(`Bundle not available in this store: ${item.bundleId}`);
        }
        const agentUserType = storefront.agentId?.userType || 'agent';
        tierPrice = bundle.pricingTiers?.[agentUserType] ?? bundle.pricingTiers?.default ?? bundle.price;
        displayPrice = tierPrice;
      }
      
      const itemTotal = displayPrice * item.quantity;
      const itemMarkup = (displayPrice - tierPrice) * item.quantity;
      const itemTierCost = tierPrice * item.quantity;
      
      totalAmount += itemTotal;
      totalMarkup += itemMarkup;
      totalTierCost += itemTierCost;

      const phone = item.customerPhone || customerInfo.phone;
      
      // Resolve provider code from populated providerId
      const providerCode = bundle.providerId?.code || 'Unknown';

      // Storefront-specific item (customer-facing prices)
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
        tierPrice: tierPrice,
        totalPrice: itemTotal
      });

      // System item — matches the orderItemSchema format used by regular/single/bulk orders
      // Uses TIER prices (what the agent actually pays) for the standard processing pipeline
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
        bundleSize: {
          value: bundle.dataVolume,
          unit: bundle.dataUnit || 'GB',
        },
        processingStatus: 'pending',
      });
    }
    
    // Create order with both storefront data AND standard items for display compatibility
    const order = new Order({
      orderType: 'storefront',
      customer: null,
      // Top-level items in standard format — agent dashboard reads these
      items: systemItems,
      storefrontData: {
        storefrontId: storefront._id,
        customerInfo: {
          name: customerInfo.name,
          phone: customerInfo.phone,
          ...(customerInfo.email ? { email: customerInfo.email } : {})
        },
        paymentMethod: {
          type: paymentMethod.type,
          reference: paymentMethod.reference || '',
          paymentProofUrl: paymentMethod.paymentProofUrl || '',
          verified: false
        },
        totalMarkup,
        totalTierCost,
        items: storefrontItems,
      },
      // Use tier cost as the order total — this is what the agent's wallet is charged
      subtotal: totalTierCost,
      total: totalTierCost,
      status: 'pending_payment',
      tenantId: storefront.agentId._id || storefront.agentId,
      createdBy: storefront.agentId._id || storefront.agentId
    });
    
    await order.save();
    
    // Notify the store owner about the new order
    try {
      const agentId = (storefront.agentId._id || storefront.agentId).toString();
      await notificationService.createInAppNotification(
        agentId,
        'New Storefront Order',
        `New order from ${customerInfo.name} (${customerInfo.phone}) for GHS ${totalAmount.toFixed(2)}`,
        'info',
        { orderId: order._id, orderNumber: order.orderNumber, type: 'storefront_order' }
      );
    } catch (notifErr) {
      logger.error('Failed to send storefront order notification:', notifErr);
    }
    
    return order;
  }
  
  // =========================================================================
  // Order Management (Agent-facing)
  // =========================================================================
  
  /**
   * Get storefront orders for agent
   */
  async getStorefrontOrders(storefrontId, filters = {}, pagination = {}) {
    const { status } = filters;
    const { limit = 50, offset = 0 } = pagination;
    
    const query = {
      orderType: 'storefront',
      'storefrontData.storefrontId': storefrontId
    };
    
    if (status) {
      query.status = status;
    }
    
    const [orders, total] = await Promise.all([
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
      Order.countDocuments(query)
    ]);
    
    return { orders, total };
  }
  
  /**
   * Verify payment - deducts agent wallet at tier cost, then sets order to 'pending'
   * to enter the existing order flow (admin processes it from pending → processing → completed).
   * Does NOT auto-process/fulfill the order.
   */
  async verifyPayment(orderId, verificationData, userId) {
    const order = await Order.findById(orderId);
    if (!order || order.orderType !== 'storefront') {
      throw new Error('Order not found');
    }
    
    // Ownership check - verify the order belongs to this agent's storefront
    const storefront = await AgentStorefront.findById(order.storefrontData.storefrontId);
    if (!storefront || storefront.agentId.toString() !== userId.toString()) {
      throw new Error('Not authorized to verify this order');
    }
    
    if (order.storefrontData.paymentMethod.verified) {
      throw new Error('Payment already verified for this order');
    }
    
    if (order.status === 'cancelled') {
      throw new Error('Cannot verify a cancelled order');
    }
    
    if (order.status !== 'pending_payment') {
      throw new Error('Order is not awaiting payment verification');
    }
    
    // Calculate the agent's cost (tier prices, not storefront prices)
    const tierCost = order.storefrontData.totalTierCost || 
      (order.storefrontData.items || []).reduce((sum, item) => sum + (item.tierPrice * item.quantity), 0);
    
    if (tierCost <= 0) {
      throw new Error('Unable to calculate order cost');
    }
    
    // Deduct from agent's wallet at tier price
    try {
      await walletService.debitWallet(
        userId.toString(),
        tierCost,
        `Storefront order fulfillment (Order: ${order.orderNumber})`,
        order._id,
        { orderType: 'storefront', storefrontId: storefront._id.toString() }
      );
    } catch (walletErr) {
      throw new Error(`Insufficient wallet balance. You need GHS ${tierCost.toFixed(2)} to fulfill this order.`);
    }
    
    // Update payment verification - order stays at 'pending' for admin processing
    order.storefrontData.paymentMethod.verified = true;
    order.storefrontData.paymentMethod.verifiedAt = new Date();
    order.storefrontData.paymentMethod.verificationNotes = verificationData.notes || '';
    order.paymentStatus = 'paid';
    // Transition from pending_payment → pending — order now enters admin processing queue
    order.status = 'pending';
    
    await order.save();
    
    // Notify admins about verified storefront order ready for processing
    try {
      const admins = await User.find({ userType: 'super_admin', isActive: true }).select('_id');
      for (const admin of admins) {
        await notificationService.createInAppNotification(
          admin._id.toString(),
          'Storefront Order Ready',
          `Storefront order ${order.orderNumber} payment verified. Ready for processing.`,
          'info',
          { orderId: order._id, orderNumber: order.orderNumber, type: 'storefront_order_verified' }
        );
      }
    } catch (notifErr) {
      logger.error('Failed to send order verification notification to admins:', notifErr);
    }
    
    return order;
  }
  
  /**
   * Reject order (with ownership check)
   */
  async rejectOrder(orderId, rejectionReason, userId) {
    const order = await Order.findById(orderId);
    if (!order || order.orderType !== 'storefront') {
      throw new Error('Order not found');
    }
    
    // Ownership check
    const storefront = await AgentStorefront.findById(order.storefrontData.storefrontId);
    if (!storefront || storefront.agentId.toString() !== userId.toString()) {
      throw new Error('Not authorized to reject this order');
    }
    
    if (order.status === 'completed' || order.status === 'processing') {
      throw new Error('Cannot reject an order that is already being processed');
    }
    
    // If payment was already verified and wallet deducted, refund the agent
    if (order.storefrontData.paymentMethod.verified && order.paymentStatus === 'paid') {
      const tierCost = order.storefrontData.totalTierCost || 
        (order.storefrontData.items || []).reduce((sum, item) => sum + (item.tierPrice * item.quantity), 0);
      
      if (tierCost > 0) {
        try {
          await walletService.creditWallet(
            userId.toString(),
            tierCost,
            `Refund for rejected storefront order (Order: ${order.orderNumber})`,
            order._id,
            { orderType: 'storefront', reason: 'order_rejected' }
          );
        } catch (refundErr) {
          logger.error(`Refund failed for rejected storefront order ${order._id}:`, refundErr);
        }
      }
    }
    
    order.status = 'cancelled';
    order.storefrontData.paymentMethod.verificationNotes = rejectionReason;
    
    return await order.save();
  }
  
  // =========================================================================
  // Analytics
  // =========================================================================
  
  /**
   * Get storefront analytics
   */
  async getStorefrontAnalytics(storefrontId, dateRange = {}) {
    const matchQuery = {
      orderType: 'storefront',
      'storefrontData.storefrontId': storefrontId
    };
    
    if (dateRange.startDate || dateRange.endDate) {
      matchQuery.createdAt = {};
      if (dateRange.startDate) matchQuery.createdAt.$gte = new Date(dateRange.startDate);
      if (dateRange.endDate) matchQuery.createdAt.$lte = new Date(dateRange.endDate);
    }
    
    const analytics = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$total' },
          totalProfit: { $sum: '$storefrontData.totalMarkup' },
          averageOrderValue: { $avg: '$total' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          confirmedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          }
        }
      }
    ]);
    
    return analytics[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      totalProfit: 0,
      averageOrderValue: 0,
      completedOrders: 0,
      confirmedOrders: 0,
      pendingOrders: 0,
      cancelledOrders: 0
    };
  }
  
  // =========================================================================
  // Admin Operations (Super Admin)
  // =========================================================================
  
  /**
   * Get all storefronts (admin view)
   */
  async getAllStorefronts(filters = {}, pagination = {}) {
    const { status, search } = filters;
    const { limit = 20, offset = 0 } = pagination;
    
    const query = {};
    
    if (status === 'active') { query.isActive = true; query.suspendedByAdmin = { $ne: true }; }
    else if (status === 'inactive') query.isActive = false;
    else if (status === 'pending') query.isApproved = false;
    else if (status === 'approved') query.isApproved = true;
    else if (status === 'suspended') query.suspendedByAdmin = true;
    
    if (search) {
      query.$or = [
        { businessName: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } }
      ];
    }
    
    const [storefronts, total] = await Promise.all([
      AgentStorefront.find(query)
        .populate('agentId', 'fullName email phone userType walletBalance')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
      AgentStorefront.countDocuments(query)
    ]);
    
    return { storefronts, total };
  }
  
  /**
   * Approve a storefront (admin)
   */
  async approveStorefront(storefrontId, adminId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    if (storefront.isApproved) {
      throw new Error('Storefront is already approved');
    }
    
    storefront.isApproved = true;
    storefront.isActive = true;
    storefront.approvedAt = new Date();
    storefront.approvedBy = adminId;
    
    await storefront.save();
    
    // Notify store owner
    try {
      await notificationService.createInAppNotification(
        storefront.agentId.toString(),
        'Storefront Approved!',
        `Your storefront "${storefront.displayName}" has been approved and is now live!`,
        'success',
        { type: 'storefront_approved', storefrontId: storefront._id }
      );
    } catch (notifErr) {
      logger.error('Failed to send approval notification:', notifErr);
    }
    
    return storefront;
  }
  
  /**
   * Admin suspends a storefront (agent cannot see it, public cannot access)
   * Different from agent deactivation - this blocks the agent too
   */
  async adminSuspendStorefront(storefrontId, adminId, reason) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    if (storefront.suspendedByAdmin) {
      throw new Error('Storefront is already suspended');
    }
    
    storefront.isActive = false;
    storefront.suspendedByAdmin = true;
    storefront.suspensionReason = reason || 'Suspended by administrator';
    storefront.suspendedAt = new Date();
    storefront.suspendedBy = adminId;
    
    await storefront.save();
    
    // Notify store owner
    try {
      await notificationService.createInAppNotification(
        storefront.agentId.toString(),
        'Storefront Suspended',
        `Your storefront "${storefront.displayName}" has been suspended by an administrator. ${reason ? `Reason: ${reason}` : ''} Please contact support for assistance.`,
        'error',
        { type: 'storefront_suspended', storefrontId: storefront._id }
      );
    } catch (notifErr) {
      logger.error('Failed to send suspension notification:', notifErr);
    }
    
    return storefront;
  }
  
  /**
   * Admin unsuspends a storefront (lifts the admin ban)
   */
  async adminUnsuspendStorefront(storefrontId, adminId) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    if (!storefront.suspendedByAdmin) {
      throw new Error('Storefront is not suspended');
    }
    
    storefront.suspendedByAdmin = false;
    storefront.suspensionReason = null;
    storefront.suspendedAt = null;
    storefront.suspendedBy = null;
    // Restore active status if it was approved
    storefront.isActive = storefront.isApproved;
    
    await storefront.save();
    
    // Notify store owner
    try {
      await notificationService.createInAppNotification(
        storefront.agentId.toString(),
        'Storefront Unsuspended',
        `Your storefront "${storefront.displayName}" has been reactivated by an administrator. Your store is now live again!`,
        'success',
        { type: 'storefront_unsuspended', storefrontId: storefront._id }
      );
    } catch (notifErr) {
      logger.error('Failed to send unsuspension notification:', notifErr);
    }
    
    return storefront;
  }
  
  /**
   * Admin deletes a storefront (graceful - checks active orders, notifies agent)
   */
  async adminDeleteStorefront(storefrontId, adminId, reason) {
    const storefront = await AgentStorefront.findById(storefrontId).populate('agentId', 'fullName');
    if (!storefront) {
      throw new Error('Storefront not found');
    }
    
    // Check for active orders
    const activeOrders = await Order.countDocuments({
      orderType: 'storefront',
      'storefrontData.storefrontId': storefrontId,
      status: { $in: ['pending', 'confirmed', 'processing'] }
    });
    
    if (activeOrders > 0) {
      throw new Error(`Cannot delete storefront with ${activeOrders} active order(s). Please ensure all orders are completed or cancelled first.`);
    }
    
    const agentId = storefront.agentId._id || storefront.agentId;
    const displayName = storefront.displayName;
    
    // Clean up pricing records
    await StorefrontPricing.deleteMany({ storefrontId });
    
    // Delete the storefront
    await AgentStorefront.findByIdAndDelete(storefrontId);
    
    // Notify the agent
    try {
      await notificationService.createInAppNotification(
        agentId.toString(),
        'Storefront Removed',
        `Your storefront "${displayName}" has been removed by an administrator. ${reason ? `Reason: ${reason}` : ''} Please contact support if you have questions.`,
        'error',
        { type: 'storefront_deleted' }
      );
    } catch (notifErr) {
      logger.error('Failed to send deletion notification:', notifErr);
    }
    
    return { deleted: true };
  }
  
  /**
   * Toggle auto-approve setting
   */
  async toggleAutoApprove(enabled) {
    const settings = await Settings.getInstance();
    settings.autoApproveStorefronts = enabled;
    await settings.save();
    return { autoApproveStorefronts: settings.autoApproveStorefronts };
  }
  
  /**
   * Get auto-approve setting
   */
  async getAutoApproveSetting() {
    const settings = await Settings.getInstance();
    return { autoApproveStorefronts: settings.autoApproveStorefronts || false };
  }
  
  /**
   * Get admin analytics dashboard data
   */
  async getAdminStorefrontStats() {
    const [totalStores, activeStores, pendingApproval, suspendedStores, totalStorefrontOrders] = await Promise.all([
      AgentStorefront.countDocuments(),
      AgentStorefront.countDocuments({ isActive: true, isApproved: true, suspendedByAdmin: { $ne: true } }),
      AgentStorefront.countDocuments({ isApproved: false }),
      AgentStorefront.countDocuments({ suspendedByAdmin: true }),
      Order.countDocuments({ orderType: 'storefront' })
    ]);
    
    // Get revenue stats
    const revenueStats = await Order.aggregate([
      { $match: { orderType: 'storefront', status: { $in: ['completed', 'confirmed'] } } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          totalProfit: { $sum: '$storefrontData.totalMarkup' }
        }
      }
    ]);
    
    // Get auto-approve setting
    const settings = await Settings.getInstance();
    
    return {
      totalStores,
      activeStores,
      pendingApproval,
      suspendedStores,
      totalStorefrontOrders,
      totalRevenue: revenueStats[0]?.totalRevenue || 0,
      totalProfit: revenueStats[0]?.totalProfit || 0,
      autoApproveStorefronts: settings.autoApproveStorefronts || false
    };
  }
}

export default new StorefrontService();