// src/models/Package.js
import mongoose from "mongoose";

const packageSchema = new mongoose.Schema(
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
      provider: {
    type: String,
    required: true,
    enum: ["MTN", "TELECEL", "AT", "AFA"],
  },
    category: {
      type: String,
      required: true,
      enum: ["daily", "weekly", "monthly", "unlimited", "custom", "big-time", "ishare-premium", "telecel"],
    },
    isActive: { 
      type: Boolean, 
      default: true 
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
packageSchema.index({ tenantId: 1, provider: 1 });
packageSchema.index({ tenantId: 1, category: 1 });
packageSchema.index({ tenantId: 1, isActive: 1, isDeleted: 1 });

// Instance methods
packageSchema.methods.softDelete = function (userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  return this.save();
};

packageSchema.methods.restore = function () {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
};

export default mongoose.model("Package", packageSchema);
