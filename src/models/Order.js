// src/models/Order.js
import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  packageGroup: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package',
    required: true
  },
  packageItem: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  packageDetails: {
    name: String,
    code: String,
    price: Number,
    dataVolume: Number,
    validity: { type: mongoose.Schema.Types.Mixed },
    validityUnit: { type: mongoose.Schema.Types.Mixed },
    provider: String,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  // Mobile bundle specific fields
  customerPhone: {
    type: String,
    required: true,
    match: [/^\+?[\d\s-()]{10,}$/, 'Please enter a valid phone number']
  },
  bundleSize: {
    value: { type: mongoose.Schema.Types.Mixed },
    unit: {
      type: String,
      enum: ['MB', 'GB'],
      default: 'GB'
    }
  },
  // Processing status for individual items
  processingStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  processingError: String,
  processedAt: Date,
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,  // This already creates an index
    // Will be generated in pre-save hook if not provided
  },
  orderType: {
    type: String,
    enum: ['single', 'bulk', 'regular'],
    required: true
  },
  
  // Customer information
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  customerInfo: {
    name: String,
    email: String,
    phone: String
  },
  
  // Order items
  items: [orderItemSchema],
  
  // Pricing
  subtotal: {
    type: Number,
    default: 0,
    min: 0
    // Will be calculated in pre-save hook
  },
  tax: {
    type: Number,
    default: 0,
    min: 0
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  total: {
    type: Number,
    default: 0,
    min: 0
    // Will be calculated in pre-save hook
  },
  
  // Order status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'partially_completed', 'completed', 'cancelled', 'failed'],
    default: 'pending'
  },
  
  // Payment information
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'mobile_money', 'bank_transfer', 'wallet'],
    default: 'wallet'
  },
  paymentReference: String,
  
  // Bulk order specific
  bulkData: {
    rawInput: String,
    totalItems: Number,
    successfulItems: { type: Number, default: 0 },
    failedItems: { type: Number, default: 0 }
  },
  
  // Processing information
  processingNotes: String,
  processingStartedAt: Date,
  processingCompletedAt: Date,
  
  // Multi-tenant fields
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Metadata
  notes: String,
  tags: [String],
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
orderSchema.index({ tenantId: 1, status: 1 });
orderSchema.index({ tenantId: 1, orderType: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'items.customerPhone': 1 });
orderSchema.index({ 'items.packageDetails.provider': 1 });

// Additional useful indexes for order management
orderSchema.index({ tenantId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, orderType: 1, status: 1 });

// Virtual for completion percentage
orderSchema.virtual('completionPercentage').get(function() {
  if (!this.items || this.items.length === 0) return 0;
  const completedItems = this.items.filter(item => item.processingStatus === 'completed').length;
  return Math.round((completedItems / this.items.length) * 100);
});

// Pre-save middleware to generate order number
orderSchema.pre('save', async function(next) {
  // Generate order number if not provided
  if (!this.orderNumber) {
    // Get the count of existing orders to generate a sequential number
    const count = await mongoose.model('Order').countDocuments();
    // Generate a 5-digit number, starting from 10000
    const orderNumber = (10000 + count + 1).toString();
    this.orderNumber = orderNumber;
  }
  
  // Calculate totals
  if (this.items && Array.isArray(this.items) && this.items.length > 0) {
    this.subtotal = this.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
  } else {
    this.subtotal = 0;
  }
  
  // Ensure tax and discount have default values
  this.tax = this.tax || 0;
  this.discount = this.discount || 0;
  
  // Calculate final total
  this.total = this.subtotal + this.tax - this.discount;
  
  next();
});

// Instance methods
orderSchema.methods.updateStatus = function() {
  if (!this.items || this.items.length === 0) {
    return this.save();
  }
  const statuses = this.items.map(item => item.processingStatus);
  const uniqueStatuses = [...new Set(statuses)];
  
  if (uniqueStatuses.length === 1) {
    if (uniqueStatuses[0] === 'completed') {
      this.status = 'completed';
      this.processingCompletedAt = new Date();
    } else if (uniqueStatuses[0] === 'failed') {
      this.status = 'failed';
    } else if (uniqueStatuses[0] === 'processing') {
      this.status = 'processing';
    }
  } else if (statuses.includes('completed') && statuses.includes('failed')) {
    this.status = 'partially_completed';
  } else if (statuses.includes('processing')) {
    this.status = 'processing';
    if (!this.processingStartedAt) {
      this.processingStartedAt = new Date();
    }
  }
  
  // Update bulk data counters
  if (this.orderType === 'bulk') {
    this.bulkData.successfulItems = statuses.filter(s => s === 'completed').length;
    this.bulkData.failedItems = statuses.filter(s => s === 'failed').length;
  }
  
  return this.save();
};

export default mongoose.model('Order', orderSchema);
