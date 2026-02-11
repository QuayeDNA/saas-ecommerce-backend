// src/models/AgentStorefront.js
import mongoose from 'mongoose';

const agentStorefrontSchema = new mongoose.Schema({
  // Basic Store Info
  agentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    unique: true // One store per agent
  },
  businessName: { 
    type: String, 
    required: true, 
    unique: true,
    minLength: 3,
    maxLength: 50,
    match: /^[a-zA-Z0-9_-]+$/, // Alphanumeric, underscores, hyphens only
    lowercase: true,
    trim: true
  },
  displayName: { 
    type: String, 
    required: true,
    maxLength: 100,
    trim: true
  },
  description: {
    type: String,
    maxLength: 500,
    trim: true
  },
  
  // Contact & Payment Info
  contactInfo: {
    phone: { 
      type: String, 
      required: true,
      match: /^[0-9+\-\s()]+$/ // Allow international phone format
    },
    email: {
      type: String,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ // Basic email validation
    },
    whatsapp: String
  },
  
  paymentMethods: [{
    type: { 
      type: String, 
      enum: ['mobile_money', 'bank_transfer'], 
      required: true 
    },
    details: {
      // Mobile Money: { accounts: [{ provider: 'MTN', number: '0241234567', accountName: 'John Doe' }, ...] } (max 2 accounts)
      // Bank Transfer: { bank: 'GCB', account: '1234567890', name: 'John Doe' } (single account for now, can be extended later if needed)
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    isActive: { 
      type: Boolean, 
      default: true 
    }
  }],
  
  // Store Status
  isActive: { 
    type: Boolean, 
    default: false 
  },
  isApproved: { 
    type: Boolean, 
    default: false 
  },
  approvedAt: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Admin suspension (distinct from agent deactivation)
  suspendedByAdmin: {
    type: Boolean,
    default: false
  },
  suspensionReason: String,
  suspendedAt: Date,
  suspendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Simple Settings
  settings: {
    theme: { 
      type: String, 
      enum: ['blue', 'green', 'purple', 'red', 'orange', 'teal', 'indigo', 'pink'], 
      default: 'blue' 
    },
    showContact: { 
      type: Boolean, 
      default: true 
    }
  },

  // Branding & Customization
  branding: {
    logoUrl: String,
    bannerUrl: String,
    tagline: {
      type: String,
      maxLength: 120,
      trim: true
    },
    customColors: {
      primary: String,   // hex e.g. #3B82F6
      secondary: String, // hex
      accent: String,    // hex
    },
    socialLinks: {
      facebook: String,
      instagram: String,
      twitter: String,
      tiktok: String,
    },
    layout: {
      type: String,
      enum: ['classic', 'modern', 'minimal'],
      default: 'classic'
    },
    showBanner: {
      type: Boolean,
      default: true
    },
    footerText: {
      type: String,
      maxLength: 200,
      trim: true
    }
  }
}, { 
  timestamps: true 
});

// Indexes for performance (agentId and businessName already indexed via unique: true)
agentStorefrontSchema.index({ isActive: 1, isApproved: 1 });

// Virtual for store URL
agentStorefrontSchema.virtual('storeUrl').get(function() {
  return `/store/${this.businessName}`;
});

// Method to check if store is publicly accessible
agentStorefrontSchema.methods.isPubliclyAccessible = function() {
  return this.isActive && this.isApproved && !this.suspendedByAdmin;
};

// Pre-save validation
agentStorefrontSchema.pre('save', function(next) {
  // Ensure at least one active payment method
  const hasActivePayment = this.paymentMethods.some(pm => pm.isActive);
  if (!hasActivePayment && this.paymentMethods.length > 0) {
    return next(new Error('At least one payment method must be active'));
  }
  next();
});

// Static method to find public store by business name
agentStorefrontSchema.statics.findPublicStore = function(businessName) {
  return this.findOne({
    businessName: businessName.toLowerCase(),
    isActive: true,
    isApproved: true,
    suspendedByAdmin: { $ne: true }
  }).populate('agentId', 'fullName userType');
};

const AgentStorefront = mongoose.model('AgentStorefront', agentStorefrontSchema);

export default AgentStorefront;