// src/models/Provider.js
import mongoose from 'mongoose';

const providerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { 
      type: String,
      required: true,
      enum: ["MTN", "TELECEL", "AT", "AFA"],
    },
    description: { type: String, trim: true },
    logo: {
      url: String,
      alt: String,
    },
    isActive: { type: Boolean, default: true },
    
    // Audit fields (no multi-tenant - providers are global)
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

// Indexes
providerSchema.index({ code: 1 }, { unique: true });
providerSchema.index({ isActive: 1, isDeleted: 1 });

// Virtual for package groups associated with this provider
providerSchema.virtual('packageGroups', {
  ref: 'Package',
  localField: 'code',
  foreignField: 'provider',
  justOne: false
});

// Instance methods
providerSchema.methods.softDelete = function (userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  return this.save();
};

providerSchema.methods.restore = function () {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
};

export default mongoose.model("Provider", providerSchema);
