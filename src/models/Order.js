// src/models/Order.js
import mongoose from "mongoose";
import { generateUniqueOrderNumber } from "../utils/orderNumberGenerator.js";

const orderItemSchema = new mongoose.Schema(
  {
    packageGroup: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Package",
      required: true,
    },
    packageItem: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
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
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    // Mobile bundle specific fields
    customerPhone: {
      type: String,
      required: true,
      match: [/^\+?[\d\s-()]{10,}$/, "Please enter a valid phone number"],
    },
    bundleSize: {
      value: { type: mongoose.Schema.Types.Mixed },
      unit: {
        type: String,
        enum: ["MB", "GB"],
        default: "GB",
      },
    },
    // Processing status for individual items
    processingStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "cancelled"],
      default: "pending",
    },
    processingError: String,
    processedAt: Date,
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

  },
  { timestamps: true }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true, // This already creates an index
      // Will be generated in pre-save hook if not provided
    },
    orderType: {
      type: String,
      enum: ["single", "bulk", "regular", "storefront"],
      required: true,
    },
    // Version field for optimistic locking (prevents concurrent modification)
    __v: {
      type: Number,
      select: false, // Don't include in queries by default
    },

    // Customer information
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    customerInfo: {
      name: String,
      email: String,
      phone: String,
    },

    // Storefront-specific data (only for storefront orders)
    storefrontData: {
      storefrontId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'AgentStorefront',
        required: function() { return this.orderType === 'storefront'; }
      },
      customerInfo: {
        name: { 
          type: String, 
          required: function() { return this.orderType === 'storefront'; }
        },
        phone: { 
          type: String, 
          required: function() { return this.orderType === 'storefront'; }
        },
        email: String
      },
      paymentMethod: {
        type: { 
          type: String, 
          enum: ['mobile_money', 'bank_transfer'],
          required: function() { return this.orderType === 'storefront'; }
        },
        reference: String, // Transaction ID or reference
        paymentProofUrl: String, // Future: screenshot of payment for verification
        verified: { type: Boolean, default: false },
        verifiedAt: Date,
        verificationNotes: String
      },
      totalMarkup: { type: Number, default: 0 }, // Total profit for agent
      totalTierCost: { type: Number, default: 0 }, // Agent's cost at tier prices
      items: [{
        bundleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bundle' },
        bundleName: String,
        provider: String,
        dataVolume: Number,
        dataUnit: String,
        validity: mongoose.Schema.Types.Mixed,
        validityUnit: String,
        quantity: { type: Number, default: 1 },
        customerPhone: String,
        unitPrice: Number,   // Storefront price (what customer pays per unit)
        tierPrice: Number,   // Agent's cost (for wallet deduction)
        totalPrice: Number,  // unitPrice * quantity
        processingStatus: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
        processingError: String,
        processedAt: Date
      }]
    },

    // Order items
    items: [orderItemSchema],

    // Pricing
    subtotal: {
      type: Number,
      default: 0,
      min: 0,
      // Will be calculated in pre-save hook
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      default: 0,
      min: 0,
      // Will be calculated in pre-save hook
    },

    // Order status
    status: {
      type: String,
      enum: [
        "draft",
        "pending",
        "pending_payment",
        "confirmed",
        "processing",
        "partially_completed",
        "completed",
        "cancelled",
        "failed",
      ],
      default: "pending",
    },

    // Reception status - tracks whether customer received the data bundle
    receptionStatus: {
      type: String,
      enum: ["not_received", "received", "checking", "resolved"],
      default: "received", // Assume received unless user reports otherwise
    },

    // Track if order has been reported for data delivery issues
    reported: {
      type: Boolean,
      default: false,
    },
    reportedAt: {
      type: Date,
    },
    resolvedAt: {
      type: Date,
    },

    // Payment information
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "mobile_money", "bank_transfer", "wallet"],
      default: "wallet",
    },
    paymentReference: String,

    // Bulk order specific
    bulkData: {
      rawInput: String,
      totalItems: Number,
      successfulItems: { type: Number, default: 0 },
      failedItems: { type: Number, default: 0 },
    },

    // Processing information
    processingNotes: String,
    processingStartedAt: Date,
    processingCompletedAt: Date,

    // Multi-tenant fields
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Metadata
    notes: String,
    tags: [String],
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
orderSchema.index({ tenantId: 1, status: 1 });
orderSchema.index({ tenantId: 1, orderType: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ "items.customerPhone": 1 });
orderSchema.index({ "items.packageDetails.provider": 1 });

// Additional useful indexes for order management
orderSchema.index({ tenantId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, orderType: 1, status: 1 });
orderSchema.index({ tenantId: 1, receptionStatus: 1 }); // Index for reception status filtering

// Virtual for completion percentage
orderSchema.virtual("completionPercentage").get(function () {
  if (!this.items || this.items.length === 0) return 0;
  const completedItems = this.items.filter(
    (item) => item.processingStatus === "completed"
  ).length;
  return Math.round((completedItems / this.items.length) * 100);
});

// Pre-save middleware to generate order number
orderSchema.pre("save", async function (next) {
  // Generate order number if not provided
  if (!this.orderNumber) {
    try {
      this.orderNumber = await generateUniqueOrderNumber();
    } catch (error) {
      console.error("Failed to generate order number:", error);
      return next(error);
    }
  }

  // Calculate totals
  // Storefront orders store items in storefrontData.items and set total directly
  if (this.orderType === 'storefront') {
    // Preserve the manually set total for storefront orders
    if (!this.total && this.storefrontData?.items?.length > 0) {
      this.total = this.storefrontData.items.reduce(
        (sum, item) => sum + (item.totalPrice || 0),
        0
      );
    }
    this.subtotal = this.total || 0;
  } else if (this.items && Array.isArray(this.items) && this.items.length > 0) {
    this.subtotal = this.items.reduce(
      (sum, item) => sum + (item.totalPrice || 0),
      0
    );
  } else {
    this.subtotal = 0;
  }

  // Ensure tax and discount have default values
  this.tax = this.tax || 0;
  this.discount = this.discount || 0;

  // Calculate final total (skip for storefront - already set)
  if (this.orderType !== 'storefront') {
    this.total = this.subtotal + this.tax - this.discount;
  }

  next();
});

// Instance methods
orderSchema.methods.updateStatus = async function () {
  if (!this.items || this.items.length === 0) {
    return this.save();
  }

  const oldStatus = this.status;
  const statuses = this.items.map((item) => item.processingStatus);
  const uniqueStatuses = [...new Set(statuses)];

  if (uniqueStatuses.length === 1) {
    if (uniqueStatuses[0] === "completed") {
      this.status = "completed";
      this.processingCompletedAt = new Date();
    } else if (uniqueStatuses[0] === "failed") {
      this.status = "failed";
    } else if (uniqueStatuses[0] === "processing") {
      this.status = "processing";
    }
  } else if (statuses.includes("completed") && statuses.includes("failed")) {
    this.status = "partially_completed";
  } else if (statuses.includes("processing")) {
    this.status = "processing";
    if (!this.processingStartedAt) {
      this.processingStartedAt = new Date();
    }
  }

  // Update bulk data counters
  if (this.orderType === "bulk") {
    this.bulkData.successfulItems = statuses.filter(
      (s) => s === "completed"
    ).length;
    this.bulkData.failedItems = statuses.filter((s) => s === "failed").length;
  }

  await this.save();

  // Send notification if status changed
  if (oldStatus !== this.status) {
    try {
      const notificationService = (
        await import("../services/notificationService.js")
      ).default;
      await notificationService.sendOrderStatusNotification(
        this.createdBy.toString(),
        this._id.toString(),
        this.orderNumber,
        oldStatus,
        this.status,
        {
          total: this.total,
          items: this.items.length,
          orderType: this.orderType,
        }
      );

      // Send bulk order progress notification for bulk orders
      if (this.orderType === "bulk" && this.bulkData) {
        const processed =
          this.bulkData.successfulItems + this.bulkData.failedItems;
        const total = this.bulkData.totalItems;

        if (processed > 0 && total > 0) {
          await notificationService.sendBulkOrderProgressNotification(
            this.createdBy.toString(),
            this._id.toString(),
            this.orderNumber,
            processed,
            total
          );
        }
      }
    } catch (error) {
      console.error("Failed to send order status notification:", error);
    }
  }

  return this;
};

export default mongoose.model("Order", orderSchema);
