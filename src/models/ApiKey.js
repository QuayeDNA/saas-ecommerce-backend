// src/models/ApiKey.js
import mongoose from "mongoose";

const API_KEY_PREFIX = "bl_live_";
const VALID_PERMISSIONS = [
  "packages:read",
  "bundles:read",
  "storefront:read",
  "orders:write",
  "momo:write",
];
const KEY_STATUSES = ["active", "suspended", "revoked"];

const apiKeySchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    keyHash: {
      type: String,
      required: true,
    },
    keyPrefix: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: KEY_STATUSES,
      default: "active",
    },
    permissions: {
      type: [String],
      default: [...VALID_PERMISSIONS],
      validate: {
        validator: function (values) {
          return values.every((v) => VALID_PERMISSIONS.includes(v));
        },
        message: "Invalid permission scope: {VALUE}",
      },
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

apiKeySchema.index({ keyHash: 1 }, { unique: true });
apiKeySchema.index({ agentId: 1, status: 1 });
apiKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

apiKeySchema.methods.isExpired = function () {
  return this.expiresAt && this.expiresAt < new Date();
};

apiKeySchema.statics.VALID_PERMISSIONS = VALID_PERMISSIONS;
apiKeySchema.statics.KEY_STATUSES = KEY_STATUSES;
apiKeySchema.statics.API_KEY_PREFIX = API_KEY_PREFIX;

const ApiKey = mongoose.model("ApiKey", apiKeySchema);

export default ApiKey;
