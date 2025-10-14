// src/models/Bundle.js
import mongoose from "mongoose";

const bundleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    dataVolume: {
      type: Number,
      required: false,
      min: 0.1,
    },
    dataUnit: {
      type: String,
      required: false,
      enum: ["MB", "GB", "TB"],
      default: "GB",
    },
    validity: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
      validate: {
        validator: function (value) {
          // Allow numbers >= 1 or string 'unlimited'
          return (
            (typeof value === "number" && value >= 1) ||
            (typeof value === "string" && value === "unlimited")
          );
        },
        message: 'Validity must be a number >= 1 or "unlimited"',
      },
    },
    validityUnit: {
      type: String,
      required: false,
      enum: ["hours", "days", "weeks", "months", "unlimited"],
      default: "days",
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    // User type-based pricing tiers
    pricingTiers: {
      agent: {
        type: Number,
        min: 0,
        default: function () {
          return this.price;
        },
      },
      super_agent: {
        type: Number,
        min: 0,
        default: function () {
          return this.price;
        },
      },
      dealer: {
        type: Number,
        min: 0,
        default: function () {
          return this.price;
        },
      },
      super_dealer: {
        type: Number,
        min: 0,
        default: function () {
          return this.price;
        },
      },
      default: {
        type: Number,
        min: 0,
        default: function () {
          return this.price;
        },
      },
    },
    currency: {
      type: String,
      default: "GHS",
    },
    features: [
      {
        type: String,
        trim: true,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    bundleCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      maxlength: 20,
    },
    category: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],

    // AFA-specific fields
    requiresGhanaCard: {
      type: Boolean,
      default: false,
    },
    afaRequirements: {
      type: [String], // Array of additional requirements like ['ghana_card', 'proof_of_address', etc.]
      default: [],
    },

    // Relationships
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Package",
      required: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
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
      ref: "User",
    },

    // Status and lifecycle
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
bundleSchema.index({ category: 1 });
bundleSchema.index({ price: 1 });
bundleSchema.index({ dataVolume: 1 });

// Pre-save middleware to initialize pricing tiers
bundleSchema.pre("save", function (next) {
  // Initialize pricing tiers if not set
  if (
    this.isNew &&
    (!this.pricingTiers || Object.keys(this.pricingTiers).length === 0)
  ) {
    this.pricingTiers = {
      agent: this.price,
      super_agent: this.price,
      dealer: this.price,
      super_dealer: this.price,
      default: this.price,
    };
  }
  next();
});

// Virtual for formatted data volume
bundleSchema.virtual("formattedDataVolume").get(function () {
  return `${this.dataVolume} ${this.dataUnit}`;
});

// Virtual for formatted validity
bundleSchema.virtual("formattedValidity").get(function () {
  if (this.validity === "unlimited" || this.validityUnit === "unlimited") {
    return "Unlimited";
  }
  return `${this.validity} ${this.validityUnit}`;
});

// Virtual for availability (wallet-based)
bundleSchema.virtual("isAvailable").get(function () {
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

// Get price for specific user type
bundleSchema.methods.getPriceForUserType = function (userType) {
  // Business user types that have specific pricing
  const businessUserTypes = ["agent", "super_agent", "dealer", "super_dealer"];

  // If user type has specific pricing and it's set, return it
  if (
    businessUserTypes.includes(userType) &&
    this.pricingTiers &&
    this.pricingTiers[userType] !== undefined &&
    this.pricingTiers[userType] !== null
  ) {
    return this.pricingTiers[userType];
  }

  // Fall back to default pricing tier, then base price
  if (
    this.pricingTiers &&
    this.pricingTiers.default !== undefined &&
    this.pricingTiers.default !== null
  ) {
    return this.pricingTiers.default;
  }

  // Final fallback to base price
  return this.price;
};

// Update pricing tiers
bundleSchema.methods.updatePricingTiers = function (pricingData, updatedBy) {
  if (!this.pricingTiers) {
    this.pricingTiers = {};
  }

  // Update individual pricing tiers
  const businessUserTypes = [
    "agent",
    "super_agent",
    "dealer",
    "super_dealer",
    "default",
  ];

  businessUserTypes.forEach((userType) => {
    if (pricingData[userType] !== undefined) {
      this.pricingTiers[userType] = pricingData[userType];
    }
  });

  this.updatedBy = updatedBy;
  this.updatedAt = new Date();

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
    isAvailable: this.isAvailable,
  };
};

export default mongoose.model("Bundle", bundleSchema);
