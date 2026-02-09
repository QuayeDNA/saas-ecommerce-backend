// src/models/StorefrontPricing.js
import mongoose from 'mongoose';

const storefrontPricingSchema = new mongoose.Schema({
  storefrontId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'AgentStorefront', 
    required: true 
  },
  bundleId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Bundle', 
    required: true 
  },
  
  // Pricing Info
  tierPrice: { 
    type: Number, 
    required: true,
    min: 0
  }, // Agent's tier price (base cost)
  customPrice: { 
    type: Number, 
    required: true,
    min: 0
  }, // Store price (tier + markup)
  markup: { 
    type: Number, 
    required: true,
    min: 0
  }, // Profit per bundle (customPrice - tierPrice)
  markupPercentage: { 
    type: Number, 
    required: true,
    min: 0
  }, // (markup / tierPrice) * 100
  
  // Whether the agent has set a custom price (vs just enabling at tier price)
  hasCustomPrice: {
    type: Boolean,
    default: false
  },
  
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { 
  timestamps: true 
});

// Compound unique index for efficient lookups and prevent duplicates
storefrontPricingSchema.index({ storefrontId: 1, bundleId: 1 }, { unique: true });

// Additional indexes for common queries
storefrontPricingSchema.index({ storefrontId: 1, isActive: 1 });
storefrontPricingSchema.index({ bundleId: 1 });

// Pre-save validation and calculations
storefrontPricingSchema.pre('save', function(next) {
  // Ensure custom price is not less than tier price
  if (this.customPrice < this.tierPrice) {
    return next(new Error('Custom price cannot be less than tier price'));
  }
  
  // Calculate markup and percentage
  this.markup = this.customPrice - this.tierPrice;
  this.markupPercentage = this.tierPrice > 0 ? (this.markup / this.tierPrice) * 100 : 0;
  
  next();
});

// Virtual for profit margin display
storefrontPricingSchema.virtual('profitMargin').get(function() {
  return this.markupPercentage.toFixed(2) + '%';
});

// Static method to get active pricing for a storefront
storefrontPricingSchema.statics.getActivePricing = function(storefrontId) {
  return this.find({
    storefrontId,
    isActive: true
  }).populate('bundleId');
};

// Static method to get pricing for a specific bundle in a storefront
storefrontPricingSchema.statics.getBundlePricing = function(storefrontId, bundleId) {
  return this.findOne({
    storefrontId,
    bundleId,
    isActive: true
  }).populate('bundleId');
};

// Method to update pricing
storefrontPricingSchema.methods.updatePricing = function(customPrice) {
  this.customPrice = customPrice;
  this.markup = customPrice - this.tierPrice;
  this.markupPercentage = this.tierPrice > 0 ? (this.markup / this.tierPrice) * 100 : 0;
  return this.save();
};

// Static method for bulk pricing operations
storefrontPricingSchema.statics.bulkUpdatePricing = async function(storefrontId, pricingUpdates) {
  const bulkOps = pricingUpdates.map(update => ({
    updateOne: {
      filter: { storefrontId, bundleId: update.bundleId },
      update: {
        customPrice: update.customPrice,
        markup: update.customPrice - update.tierPrice,
        markupPercentage: update.tierPrice > 0 ? ((update.customPrice - update.tierPrice) / update.tierPrice) * 100 : 0,
        isActive: update.isActive !== undefined ? update.isActive : true
      },
      upsert: true
    }
  }));
  
  return this.bulkWrite(bulkOps);
};

const StorefrontPricing = mongoose.model('StorefrontPricing', storefrontPricingSchema);

export default StorefrontPricing;