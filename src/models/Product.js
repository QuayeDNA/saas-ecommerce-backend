// src/models/Product.js
import mongoose from "mongoose";

// Schema for single packages (previously variants)
const packageItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    code: {
      type: String,
      required: true,
    },
    price: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, min: 0 },
    inventory: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Inventory must be an integer",
      },
    },
    reservedInventory: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 10 },
    isActive: { type: Boolean, default: true },
    
    // Mobile bundle specific fields
    dataVolume: { type: Number, required: true }, // in GB
    validity: { type: Number, default: null }, // in days, null = unlimited
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Schema for package groups (e.g., "Daily Bundles", "Weekly Bundles")
const packageGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    provider: {
      type: String,
      required: true,
      enum: ["MTN", "TELECEL", "AT", "GLO"],
    },
    packageItems: [packageItemSchema],
    banner: {
      url: String,
      alt: String,
    },
    isActive: { type: Boolean, default: true },
    tags: [String],

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
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Status and lifecycle
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // SEO fields
    slug: { type: String, unique: true },

    // Business metrics
    salesCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for available inventory (total - reserved)
packageItemSchema.virtual("availableInventory").get(function () {
  return this.inventory - this.reservedInventory;
});

// Pre-save middleware for slug generation and code validation
packageGroupSchema.pre("save", async function (next) {
  // Generate slug if needed
  if (this.isModified("name") && !this.slug) {
    this.slug =
      this.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/(^-)|(-$)/g, "") +
      "-" +
      Date.now();
  }
  
  // Validate package item codes are unique within tenant
  if (this.packageItems && this.packageItems.length > 0) {
    const codes = this.packageItems.map(item => item.code).filter(Boolean);
    const uniqueCodes = new Set(codes);
    
    // Check for duplicates within the same package group
    if (codes.length !== uniqueCodes.size) {
      return next(new Error("Package codes must be unique within the same package group"));
    }
    
    // Check for duplicates across other package groups in the same tenant
    const existingCodes = await this.constructor.distinct("packageItems.code", {
      tenantId: this.tenantId,
      isDeleted: false,
      _id: { $ne: this._id }
    });
    
    const duplicateCodes = codes.filter(code => existingCodes.includes(code));
    if (duplicateCodes.length > 0) {
      return next(new Error(`Package codes already exist: ${duplicateCodes.join(", ")}`));
    }
  }
  
  next();
});

// Indexes for efficient querying
packageGroupSchema.index({ tenantId: 1, provider: 1 });
packageGroupSchema.index({ tenantId: 1, isActive: 1, isDeleted: 1 });
packageGroupSchema.index({ "packageItems.code": 1 }, { sparse: true });
packageGroupSchema.index({ tags: 1 });

// Instance methods
packageGroupSchema.methods.softDelete = function (userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  return this.save();
};

packageGroupSchema.methods.restore = function () {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
};

packageGroupSchema.methods.getLowStockItems = function () {
  return this.packageItems.filter(
    (item) =>
      item.availableInventory <= item.lowStockThreshold &&
      item.isActive &&
      !item.isDeleted
  );
};

export default mongoose.model("PackageGroup", packageGroupSchema);
