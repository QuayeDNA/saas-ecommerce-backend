// src/models/User.js
import mongoose from "mongoose";
import bcrypt from "bcrypt";

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
    enum: ["agent", "super_agent", "dealer", "super_dealer", "super_admin"],
    default: "agent",
  },
  // Multi-tenant fields
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: function () {
      return ["agent", "super_agent", "dealer", "super_dealer"].includes(
        this.userType
      );
    },
  },
  businessName: {
    type: String,
    required: function () {
      return ["agent", "super_agent", "dealer", "super_dealer"].includes(
        this.userType
      );
    },
    trim: true,
  },
  agentCode: {
    type: String,
    unique: true,
    sparse: true, // Only enforce uniqueness when the field is present
    required: function () {
      return ["agent", "super_agent", "dealer", "super_dealer"].includes(
        this.userType
      );
    },
  },
  businessCategory: {
    type: String,
    enum: ["electronics", "fashion", "food", "services", "other"],
    default: "services",
    required: function () {
      return ["agent", "super_agent", "dealer", "super_dealer"].includes(
        this.userType
      );
    },
  },
  subscriptionPlan: {
    type: String,
    enum: ["basic", "premium", "enterprise"],
    default: "basic",
    required: function () {
      return ["agent", "super_agent", "dealer", "super_dealer"].includes(
        this.userType
      );
    },
  },
  subscriptionStatus: {
    type: String,
    enum: ["active", "inactive", "suspended"],
    default: "active",
    required: function () {
      return ["agent", "super_agent", "dealer", "super_dealer"].includes(
        this.userType
      );
    },
  },
  walletBalance: {
    type: Number,
    default: 0,
    min: 0,
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
  verificationToken: String,
  verificationResent: {
    type: Boolean,
    default: false,
  },
  resetPasswordToken: String,
  refreshToken: String,
  resetPasswordExpires: Date,
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
    commissionUpdates: {
      type: Boolean,
      default: true,
    },
    announcements: {
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
      return ["agent", "super_agent", "dealer", "super_dealer"].includes(
        this.userType
      )
        ? "pending"
        : "active";
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
  delete userObject.verificationToken;
  delete userObject.verificationResent;
  delete userObject.resetPasswordToken;
  delete userObject.resetPasswordExpires;
  return userObject;
};

export default mongoose.model("User", userSchema);
