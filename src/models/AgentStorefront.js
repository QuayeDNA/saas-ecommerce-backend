// src/models/AgentStorefront.js
import mongoose from "mongoose";

const paymentMethodSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["mobile_money", "bank_transfer", "paystack"],
    required: true
  },
  isActive: { type: Boolean, default: true },

  // Mobile Money Configuration
  mobileMoney: {
    accountName: {
      type: String,
      required: function() { return this.type === 'mobile_money'; }
    },
    accountNumber: {
      type: String,
      required: function() { return this.type === 'mobile_money'; }
    },
    network: {
      type: String,
      enum: ["MTN", "Vodafone", "AirtelTigo"],
      required: function() { return this.type === 'mobile_money'; }
    }
  },

  // Bank Transfer Configuration
  bankTransfer: {
    bankName: {
      type: String,
      required: function() { return this.type === 'bank_transfer'; }
    },
    accountName: {
      type: String,
      required: function() { return this.type === 'bank_transfer'; }
    },
    accountNumber: {
      type: String,
      required: function() { return this.type === 'bank_transfer'; }
    },
    branch: String
  },

  // Paystack Configuration (Future)
  paystack: {
    publicKey: String,
    secretKey: String,
    webhookUrl: String
  },

  instructions: {
    type: String,
    required: true,
    default: "Please follow the payment instructions carefully."
  },
  processingFee: { type: Number, default: 0 }
}, { _id: true });

const pricingSchema = new mongoose.Schema({
  bundleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bundle',
    required: true
  },
  customPrice: {
    type: Number,
    required: true,
    min: 0
  },
  markup: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

const agentStorefrontSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  businessName: {
    type: String,
    unique: true,
    required: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 50,
    match: [/^[a-z0-9-]+$/, 'Business name can only contain lowercase letters, numbers, and hyphens']
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  isActive: {
    type: Boolean,
    default: false
  },
  isPublic: {
    type: Boolean,
    default: true
  },

  // Branding
  theme: {
    primaryColor: {
      type: String,
      default: '#3B82F6',
      match: [/^#[0-9A-F]{6}$/i, 'Primary color must be a valid hex color']
    },
    logoUrl: String,
    bannerUrl: String,
    customCSS: String
  },

  // Pricing configuration
  pricing: [pricingSchema],

  // Payment methods
  paymentMethods: [paymentMethodSchema],

  // Settings
  settings: {
    defaultPaymentMethod: {
      type: String,
      enum: ["mobile_money", "bank_transfer", "paystack"]
    },
    autoFulfill: {
      type: Boolean,
      default: false
    },
    orderNotifications: {
      type: Boolean,
      default: true
    },
    contactInfo: {
      phone: String,
      email: String,
      whatsapp: String
    }
  },

  // Analytics
  analytics: {
    totalViews: { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    totalProfit: { type: Number, default: 0 },
    conversionRate: { type: Number, default: 0 },
    lastActivity: Date
  },

  // Security
  security: {
    rateLimitWindow: { type: Number, default: 60 }, // minutes
    maxOrdersPerWindow: { type: Number, default: 10 },
    blockedIPs: [{ type: String }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
agentStorefrontSchema.index({ agentId: 1 });
agentStorefrontSchema.index({ businessName: 1 });
agentStorefrontSchema.index({ isActive: 1 });
agentStorefrontSchema.index({ 'pricing.bundleId': 1 });
agentStorefrontSchema.index({ createdAt: -1 });

// Virtual for storefront URL
agentStorefrontSchema.virtual('storefrontUrl').get(function() {
  return `/store/${this.businessName}`;
});

// Pre-save middleware for business name validation
agentStorefrontSchema.pre('save', async function(next) {
  // Ensure business name is unique (case insensitive)
  if (this.isModified('businessName')) {
    const existing = await mongoose.model('AgentStorefront').findOne({
      businessName: this.businessName,
      _id: { $ne: this._id }
    });
    if (existing) {
      const error = new Error('Business name already exists');
      error.statusCode = 400;
      return next(error);
    }
  }

  // Validate that agent has permission to create storefront
  if (this.isModified('agentId') || this.isNew) {
    const User = mongoose.model('User');
    const agent = await User.findById(this.agentId);
    if (!agent || agent.userType !== 'agent') {
      const error = new Error('Only base agents can create storefronts');
      error.statusCode = 403;
      return next(error);
    }
  }

  next();
});

// Instance method to get custom price for a bundle
agentStorefrontSchema.methods.getCustomPrice = function(bundleId) {
  const pricing = this.pricing.find(p =>
    p.bundleId.toString() === bundleId.toString() && p.isActive
  );
  return pricing ? pricing.customPrice : null;
};

// Instance method to get active payment methods
agentStorefrontSchema.methods.getActivePaymentMethods = function() {
  return this.paymentMethods.filter(method => method.isActive);
};

// Instance method to update analytics
agentStorefrontSchema.methods.updateAnalytics = async function(orderData) {
  this.analytics.totalOrders += 1;
  this.analytics.totalRevenue += orderData.revenue || 0;
  this.analytics.totalProfit += orderData.profit || 0;
  this.analytics.lastActivity = new Date();

  // Calculate conversion rate (simplified - would need more complex logic in real implementation)
  if (this.analytics.totalViews > 0) {
    this.analytics.conversionRate = (this.analytics.totalOrders / this.analytics.totalViews) * 100;
  }

  return this.save();
};

export default mongoose.model('AgentStorefront', agentStorefrontSchema);