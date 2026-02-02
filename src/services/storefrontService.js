// src/services/storefrontService.js
import AgentStorefront from '../models/AgentStorefront.js';
import User from '../models/User.js';
import Bundle from '../models/Bundle.js';
import Order from '../models/Order.js';
import paymentVerificationService from './paymentVerificationService.js';

class StorefrontService {
  /**
   * Create a new storefront for an agent
   */
  async createStorefront(agentId, storefrontData) {
    // Validate agent permissions
    const agent = await User.findById(agentId);
    const allowedUserTypes = ['agent', 'super_agent', 'dealer', 'super_dealer'];
    if (!agent || !allowedUserTypes.includes(agent.userType)) {
      throw new Error('Only agents can create storefronts');
    }

    // Check if agent already has a storefront
    const existingStorefront = await AgentStorefront.findOne({ agentId });
    if (existingStorefront) {
      throw new Error('Agent already has a storefront');
    }

    // Validate business name uniqueness
    const businessNameExists = await AgentStorefront.findOne({
      businessName: storefrontData.businessName.toLowerCase()
    });
    if (businessNameExists) {
      throw new Error('Business name already exists');
    }

    // Create storefront
    const storefront = new AgentStorefront({
      agentId,
      ...storefrontData,
      businessName: storefrontData.businessName.toLowerCase()
    });

    return await storefront.save();
  }

  /**
   * Get storefront by business name (public)
   */
  async getStorefrontByBusinessName(businessName) {
    const storefront = await AgentStorefront.findOne({
      businessName: businessName.toLowerCase(),
      isActive: true,
      isPublic: true
    }).populate('agentId', 'fullName businessName');

    if (!storefront) {
      throw new Error('Storefront not found');
    }

    // Increment view count
    storefront.analytics.totalViews += 1;
    await storefront.save();

    return storefront;
  }

  /**
   * Get storefront by agent ID (private)
   */
  async getStorefrontByAgentId(agentId) {
    return await AgentStorefront.findOne({ agentId });
  }

  /**
   * Update storefront
   */
  async updateStorefront(storefrontId, agentId, updateData) {
    const storefront = await AgentStorefront.findOne({
      _id: storefrontId,
      agentId
    });

    if (!storefront) {
      throw new Error('Storefront not found');
    }

    // Validate business name uniqueness if changed
    if (updateData.businessName && updateData.businessName !== storefront.businessName) {
      const businessNameExists = await AgentStorefront.findOne({
        businessName: updateData.businessName.toLowerCase(),
        _id: { $ne: storefrontId }
      });
      if (businessNameExists) {
        throw new Error('Business name already exists');
      }
      updateData.businessName = updateData.businessName.toLowerCase();
    }

    Object.assign(storefront, updateData);
    return await storefront.save();
  }

  /**
   * Add payment method to storefront
   */
  async addPaymentMethod(storefrontId, agentId, paymentMethodData) {
    const storefront = await AgentStorefront.findOne({
      _id: storefrontId,
      agentId
    });

    if (!storefront) {
      throw new Error('Storefront not found');
    }

    // Validate payment method data based on type
    this.validatePaymentMethod(paymentMethodData);

    storefront.paymentMethods.push(paymentMethodData);
    return await storefront.save();
  }

  /**
   * Update payment method
   */
  async updatePaymentMethod(storefrontId, agentId, methodId, updateData) {
    const storefront = await AgentStorefront.findOne({
      _id: storefrontId,
      agentId
    });

    if (!storefront) {
      throw new Error('Storefront not found');
    }

    const methodIndex = storefront.paymentMethods.findIndex(
      method => method._id.toString() === methodId
    );

    if (methodIndex === -1) {
      throw new Error('Payment method not found');
    }

    // Validate updated data
    this.validatePaymentMethod(updateData);

    Object.assign(storefront.paymentMethods[methodIndex], updateData);
    return await storefront.save();
  }

  /**
   * Set custom pricing for bundles
   */
  async setPricing(storefrontId, agentId, pricingData) {
    const storefront = await AgentStorefront.findOne({
      _id: storefrontId,
      agentId
    });

    if (!storefront) {
      throw new Error('Storefront not found');
    }

    // Validate pricing against agent's tier prices
    for (const price of pricingData) {
      const bundle = await Bundle.findById(price.bundleId);
      if (!bundle) {
        throw new Error(`Bundle ${price.bundleId} not found`);
      }

      // Get agent's tier price for this bundle
      const agentTierPrice = this.getPriceForUserType(bundle, 'agent');
      if (price.customPrice < agentTierPrice) {
        throw new Error(`Custom price for bundle ${bundle.name} cannot be below agent's tier price of ${agentTierPrice}`);
      }

      price.markup = price.customPrice - agentTierPrice;
    }

    storefront.pricing = pricingData;
    return await storefront.save();
  }

  /**
   * Get bundles with custom pricing for storefront
   */
  async getStorefrontBundles(storefrontId) {
    const storefront = await AgentStorefront.findById(storefrontId)
      .populate('pricing.bundleId');

    if (!storefront) {
      throw new Error('Storefront not found');
    }

    // Return bundles with custom pricing
    return storefront.pricing
      .filter(p => p.isActive)
      .map(p => ({
        bundle: p.bundleId,
        customPrice: p.customPrice,
        markup: p.markup
      }));
  }

  /**
   * Create storefront order
   */
  async createStorefrontOrder(storefrontId, orderData) {
    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront || !storefront.isActive) {
      throw new Error('Storefront not found or inactive');
    }

    // Validate payment method
    const paymentMethod = storefront.paymentMethods.find(
      pm => pm.type === orderData.paymentMethod.type && pm.isActive
    );
    if (!paymentMethod) {
      throw new Error('Invalid or inactive payment method');
    }

    // Validate and enrich order items with custom pricing
    const enrichedItems = [];
    for (const item of orderData.items) {
      const pricing = storefront.pricing.find(
        p => p.bundleId.toString() === item.bundleId && p.isActive
      );

      if (!pricing) {
        throw new Error(`Bundle ${item.bundleId} not available in storefront`);
      }

      const bundle = await Bundle.findById(item.bundleId);
      if (!bundle) {
        throw new Error(`Bundle ${item.bundleId} not found`);
      }

      enrichedItems.push({
        ...item,
        unitPrice: pricing.customPrice,
        totalPrice: pricing.customPrice * item.quantity,
        customPricing: {
          originalPrice: pricing.customPrice - pricing.markup, // Agent's tier price
          customPrice: pricing.customPrice,
          markup: pricing.markup
        }
      });
    }

    // Calculate totals
    const subtotal = enrichedItems.reduce((sum, item) => sum + item.totalPrice, 0);

    // Create order
    const order = new Order({
      orderType: 'storefront',
      customerInfo: orderData.customerInfo,
      items: enrichedItems,
      subtotal,
      total: subtotal,
      status: 'pending_payment',
      paymentMethod: 'external', // Storefront orders use external payment
      tenantId: storefront.agentId,
      createdBy: storefront.agentId,
      storefrontData: {
        storefrontId: storefront._id,
        paymentMethod: orderData.paymentMethod
      }
    });

    return await order.save();
  }

  /**
   * Confirm payment for storefront order
   */
  async confirmPayment(orderId, agentId, verificationData) {
    const order = await Order.findOne({
      _id: orderId,
      'storefrontData.storefrontId': { $exists: true }
    }).populate('storefrontData.storefrontId');

    if (!order) {
      throw new Error('Order not found');
    }

    // Verify agent owns the storefront
    if (order.storefrontData.storefrontId.agentId.toString() !== agentId) {
      throw new Error('Unauthorized to confirm this payment');
    }

    if (order.status !== 'pending_payment') {
      throw new Error('Order is not in pending payment status');
    }

    // Enhanced payment verification based on payment type
    const paymentType = order.storefrontData.paymentMethod.type;
    const paymentData = order.storefrontData.paymentMethod[paymentType];

    // Add order amount to payment data for validation
    const paymentDataWithAmount = {
      ...paymentData,
      amount: order.total
    };

    const verificationResult = await paymentVerificationService.verifyPayment(
      paymentType,
      paymentDataWithAmount,
      verificationData
    );

    if (!verificationResult.isValid) {
      // Store failed verification attempt
      order.storefrontData.paymentMethod.verificationAttempts =
        (order.storefrontData.paymentMethod.verificationAttempts || 0) + 1;

      order.storefrontData.paymentMethod.lastVerificationAttempt = {
        timestamp: new Date(),
        result: 'failed',
        error: verificationResult.error,
        agentId: agentId
      };

      await order.save();

      throw new Error(verificationResult.error || 'Payment verification failed');
    }

    // Update payment verification with enhanced data
    order.storefrontData.paymentMethod.verified = true;
    order.storefrontData.paymentMethod.verifiedAt = new Date();
    order.storefrontData.paymentMethod.verifiedBy = agentId;
    order.storefrontData.paymentMethod.verificationNotes = verificationData.notes || verificationResult.notes;
    order.storefrontData.paymentMethod.verificationConfidence = verificationResult.confidence;
    order.storefrontData.paymentMethod.verificationMetadata = verificationResult.metadata;

    // Store successful verification attempt
    order.storefrontData.paymentMethod.lastVerificationAttempt = {
      timestamp: new Date(),
      result: 'success',
      confidence: verificationResult.confidence,
      agentId: agentId
    };

    // Calculate agent profit
    const totalMarkup = order.items.reduce((sum, item) =>
      sum + (item.customPricing.markup * item.quantity), 0
    );
    order.storefrontData.agentProfit = totalMarkup;

    // Update order status
    order.status = 'confirmed';

    const savedOrder = await order.save();

    // Update storefront analytics
    await order.storefrontData.storefrontId.updateAnalytics({
      revenue: order.total,
      profit: totalMarkup
    });

    return savedOrder;
  }

  /**
   * Get pending orders for agent's storefront
   */
  async getPendingOrders(agentId) {
    const storefront = await AgentStorefront.findOne({ agentId });
    if (!storefront) {
      return [];
    }

    return await Order.find({
      'storefrontData.storefrontId': storefront._id,
      status: 'pending_payment'
    }).sort({ createdAt: -1 });
  }

  /**
   * Validate payment method data
   */
  validatePaymentMethod(paymentMethod) {
    const { type } = paymentMethod;

    switch (type) {
      case 'mobile_money':
        if (!paymentMethod.mobileMoney?.accountName ||
            !paymentMethod.mobileMoney?.accountNumber ||
            !paymentMethod.mobileMoney?.network) {
          throw new Error('Mobile money payment method requires account name, number, and network');
        }
        break;

      case 'bank_transfer':
        if (!paymentMethod.bankTransfer?.bankName ||
            !paymentMethod.bankTransfer?.accountName ||
            !paymentMethod.bankTransfer?.accountNumber) {
          throw new Error('Bank transfer payment method requires bank name, account name, and number');
        }
        break;

      case 'paystack':
        // Paystack validation will be added when implemented
        break;

      default:
        throw new Error('Invalid payment method type');
    }
  }

  /**
   * Get price for user type from bundle
   */
  getPriceForUserType(bundle, userType) {
    const tier = bundle.pricingTiers?.find(t => t.userType === userType);
    return tier ? tier.price : bundle.price;
  }
}

export default new StorefrontService();