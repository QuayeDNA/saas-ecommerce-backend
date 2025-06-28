// src/models/Product.js
import mongoose from 'mongoose';

// Update SKU validator in variantSchema to use ownerDocument and mongoose.model
const attributeSchema = new mongoose.Schema({
  key: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  label: String,
  dataType: {
    type: String,
    enum: ['string', 'number', 'boolean', 'date', 'array'],
    default: 'string'
  }
}, { _id: false });

const variantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  sku: { 
    type: String, 
    required: true,
    validate: {
      validator: async function(sku) {
        // Get the parent product document
        const product = this.ownerDocument();
        // Check for unique SKU across all products for this tenant
        const existing = await mongoose.model('Product').findOne({
          'variants.sku': sku,
          tenantId: product.tenantId,
          _id: { $ne: product._id }
        });
        return !existing;
      },
      message: 'SKU must be unique within tenant'
    }
  },
  price: { type: Number, required: true, min: 0 },
  costPrice: { type: Number, min: 0 },
  inventory: { 
    type: Number, 
    default: 0,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Inventory must be an integer'
    }
  },
  reservedInventory: { type: Number, default: 0, min: 0 },
  lowStockThreshold: { type: Number, default: 10 },
  attributes: [attributeSchema],
  isActive: { type: Boolean, default: true },
  images: [{
    url: String,
    alt: String,
    isPrimary: { type: Boolean, default: false }
  }],
  // Mobile bundle specific fields
  dataVolume: { type: Number }, // in GB
  validity: { type: Number }, // in days
  network: { 
    type: String, 
    enum: ['MTN', 'Vodafone', 'AirtelTigo', 'Glo'] 
  },
  bundleType: {
    type: String,
    enum: ['data', 'voice', 'sms', 'combo']
  },
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  category: { 
    type: String, 
    required: true,
    enum: ['data-bundle', 'voice-bundle', 'sms-bundle', 'combo-bundle', 'physical', 'digital', 'service']
  },
  subCategory: String,
  provider: { 
    type: String, 
    required: function() {
      return ['data-bundle', 'voice-bundle', 'sms-bundle', 'combo-bundle'].includes(this.category);
    },
    enum: ['MTN', 'Vodafone', 'AirtelTigo', 'Glo', 'Other']
  },
  variants: [variantSchema],
  attributes: [attributeSchema],
  tags: [String],
  
  // Multi-tenant and audit fields
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Status and lifecycle
  isActive: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // SEO and display
  slug: { type: String, unique: true },
  metaTitle: String,
  metaDescription: String,
  
  // Business metrics
  salesCount: { type: Number, default: 0 },
  viewCount: { type: Number, default: 0 },
  rating: { type: Number, min: 0, max: 5, default: 0 },
  reviewCount: { type: Number, default: 0 }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient querying
productSchema.index({ tenantId: 1, category: 1 });
productSchema.index({ tenantId: 1, provider: 1 });
productSchema.index({ tenantId: 1, isActive: 1, isDeleted: 1 });
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });
productSchema.index({ tags: 1 });
productSchema.index({ 'variants.network': 1 });
productSchema.index({ 'variants.bundleType': 1 });

// Virtual for available inventory (total - reserved)
variantSchema.virtual('availableInventory').get(function() {
  return this.inventory - this.reservedInventory;
});

// Pre-save middleware for slug generation
productSchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name.toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/(^-)|(-$)/g, '') + '-' + Date.now();
  }
  next();
});

// Instance methods
productSchema.methods.softDelete = function(userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  return this.save();
};

productSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
};

productSchema.methods.getLowStockVariants = function() {
  return this.variants.filter(variant => 
    variant.availableInventory <= variant.lowStockThreshold && 
    variant.isActive && 
    !variant.isDeleted
  );
};

export default mongoose.model('Product', productSchema);
