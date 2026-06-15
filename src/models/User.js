// src/models/User.js
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { ALL_ROLES, BUSINESS_ROLES } from "../constants/roles.js";

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, "Full name is required"],
    trim: true,
    minlength: 2,
    maxlength: 50,
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      "Please enter a valid email",
    ],
  },
  phone: {
    type: String,
    required: [true, "Phone number is required"],
    match: [/^\+?[\d\s-()]{10,}$/, "Please enter a valid phone number"],
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: 6,
  },
  userType: {
    type: String,
    enum: ALL_ROLES,
    default: "agent",
  },
  // Multi-tenant fields
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: function () {
      return BUSINESS_ROLES.includes(this.userType);
    },
  },
  businessName: {
    type: String,
    required: function () {
      return BUSINESS_ROLES.includes(this.userType);
    },
    trim: true,
  },
  agentCode: {
    type: String,
    unique: true,
    sparse: true,
    required: function () {
      return BUSINESS_ROLES.includes(this.userType);
    },
  },
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    index: true,
  },
  businessCategory: {
    type: String,
    enum: ["electronics", "fashion", "food", "services", "other"],
    default: "services",
    required: function () {
      return BUSINESS_ROLES.includes(this.userType);
    },
  },
  subscriptionPlan: {
    type: String,
    enum: ["basic", "premium", "enterprise"],
    default: "basic",
    required: function () {
      return BUSINESS_ROLES.includes(this.userType);
    },
  },
  subscriptionStatus: {
    type: String,
    enum: ["active", "inactive", "suspended"],
    default: "active",
    required: function () {
      return BUSINESS_ROLES.includes(this.userType);
    },
  },
  walletBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  earningsBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  commissionBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  payoutAccount: {
    type: {
      type: String,
      enum: ["mobile_money", "bank_account"],
    },
    mobileProvider: {
      type: String,
      enum: ["MTN", "TELECEL", "AT"],
    },
    phoneNumber: String,
    bankCode: String,
    accountNumber: String,
    accountName: String,
    recipientName: String,
    recipientCode: String,
    updatedAt: Date,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  isFirstTime: {
    type: Boolean,
    default: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  securityPin: {
    type: String,
    minlength: 60, // bcrypt hash length
  },
  requiresPinSetup: {
    type: Boolean,
    default: true,
  },
  forcePasswordChange: {
    type: Boolean,
    default: false,
  },
  passwordChangedAt: {
    type: Date,
    default: null,
  },
  refreshToken: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // Push notification subscription
  pushSubscription: {
    endpoint: String,
    keys: {
      p256dh: String,
      auth: String,
    },
  },
  // Push notification preferences
  pushNotificationPreferences: {
    enabled: {
      type: Boolean,
      default: true,
    },
    orderUpdates: {
      type: Boolean,
      default: true,
    },
    walletUpdates: {
      type: Boolean,
      default: true,
    },
    announcements: {
      type: Boolean,
      default: true,
    },
    apiUpdates: {
      type: Boolean,
      default: true,
    },
  },
  // AFA Registration fields
  afaRegistration: {
    afaId: String,
    registrationType: {
      type: String,
      enum: ["agent", "subscriber"],
    },
    fullName: String,
    phone: String,
    registrationFee: Number,
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    registrationDate: Date,
  },
  status: {
    type: String,
    enum: ["pending", "active", "rejected"],
    default: function () {
      return BUSINESS_ROLES.includes(this.userType) ? "pending" : "active";
    },
  },
});

// Compound index for multi-tenancy
userSchema.index({ tenantId: 1, userType: 1 });

// Password hashing middleware
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Password comparison method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove sensitive data from JSON output
userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.securityPin;
  return userObject;
};

export default mongoose.model("User", userSchema);
