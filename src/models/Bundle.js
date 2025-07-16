// src/models/Bundle.js
import mongoose from "mongoose";

const bundleSchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      required: true, 
      trim: true 
    },
    description: { 
      type: String, 
      trim: true 
    },
    dataVolume: {
      type: Number,
      required: true,
      min: 0.1
    },
    dataUnit: {
      type: String,
      required: true,
      enum: ["MB", "GB", "TB"],
      default: "GB"
    },
    validity: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: 30
    },
    validityUnit: {
      type: String,
      required: true,
      enum: ["hours", "days", "weeks", "months", "unlimited"],
      default: "days"
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: "GHS"
    },
    features: [{
      type: String,
      trim: true
    }],
    isActive: { 
      type: Boolean, 
      default: true 
    },
    bundleCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      maxlength: 20
    },
    category: {
      type: String,
      trim: true,
      maxlength: 50
    },
    tags: [{
      type: String,
      trim: true
    }],

    // Relationships
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Package",
      required: true
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: true
    },

    // Multi-tenant and audit fields
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
    updatedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    },

    // Status and lifecycle
    isDeleted: { 
      type: Boolean, 
      default: false 
    },
    deletedAt: Date,
    deletedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient querying
bundleSchema.index({ tenantId: 1, providerId: 1 });
bundleSchema.index({ tenantId: 1, packageId: 1 });
bundleSchema.index({ tenantId: 1, isActive: 1, isDeleted: 1 });
bundleSchema.index({ bundleCode: 1 });
bundleSchema.index({ category: 1 });
bundleSchema.index({ price: 1 });
bundleSchema.index({ dataVolume: 1 });

// Virtual for formatted data volume
bundleSchema.virtual('formattedDataVolume').get(function() {
  return `${this.dataVolume} ${this.dataUnit}`;
});

// Virtual for formatted validity
bundleSchema.virtual('formattedValidity').get(function() {
  return `${this.validity} ${this.validityUnit}`;
});

// Virtual for availability (wallet-based)
bundleSchema.virtual('isAvailable').get(function() {
  return this.isActive && !this.isDeleted;
});

// Instance methods
bundleSchema.methods.softDelete = function (userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  return this.save();
};

bundleSchema.methods.restore = function () {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
};

// Check if bundle can be purchased (wallet-based availability)
bundleSchema.methods.canPurchase = function (walletBalance) {
  if (!this.isAvailable) {
    return false;
  }
  return walletBalance >= this.price;
};

// Get summary for public display
bundleSchema.methods.getSummary = function () {
  return {
    id: this._id,
    name: this.name,
    description: this.description,
    dataVolume: this.formattedDataVolume,
    validity: this.formattedValidity,
    price: this.price,
    currency: this.currency,
    features: this.features,
    category: this.category,
    tags: this.tags,
    isAvailable: this.isAvailable
  };
};

export default mongoose.model("Bundle", bundleSchema); 