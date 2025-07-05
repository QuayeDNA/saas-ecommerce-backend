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
      validate: {
        validator: async function (code) {
          const packageGroup = this.parent();
          const existing = await packageGroup.constructor.findOne({
            "packageItems.code": code,
            tenantId: packageGroup.tenantId,
            _id: { $ne: packageGroup._id },
          });
          return !existing;
        },
        message: "Package code must be unique within tenant",
      },
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
    validity: { type: Number, required: true }, // in days
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
      enum: ["MTN", "Vodafone", "AirtelTigo", "Glo"],
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

// Pre-save middleware for slug generation
packageGroupSchema.pre("save", function (next) {
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
