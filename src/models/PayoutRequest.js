// src/models/PayoutRequest.js
import mongoose from "mongoose";

const payoutRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1, // Minimum GHS 1
    },
    currency: {
      type: String,
      default: "GHS",
    },

    destination: {
      type: {
        type: String,
        enum: ["mobile_money", "bank_account"],
        required: true,
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
    },

    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "processing",
        "completed",
        "rejected",
        "failed",
      ],
      default: "pending",
      index: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: Date,
    adminNotes: String,
    rejectionReason: String,

    paystackTransfer: {
      transferCode: String,
      transferReference: String,
      recipientCode: String,
      status: String,
      transferredAt: Date,
      failureReason: String,
    },

    requestedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: Date,
    completedAt: Date,

    transferFee: {
      type: Number,
      default: 0,
    },
    netAmount: Number,

    metadata: mongoose.Schema.Types.Mixed,
  },
  {
    timestamps: true,
  },
);

payoutRequestSchema.index({ user: 1, status: 1 });
payoutRequestSchema.index({ status: 1, requestedAt: -1 });
payoutRequestSchema.index({ "paystackTransfer.transferReference": 1 });

payoutRequestSchema.pre("save", function (next) {
  const dest = this.destination;
  if (!dest || !dest.type) return next();
  if (dest.type === "mobile_money") {
    if (!dest.mobileProvider || !dest.phoneNumber || !dest.accountName) {
      return next(
        new Error(
          "Mobile money requires provider, phone number, and account name",
        ),
      );
    }
  } else if (dest.type === "bank_account") {
    if (!dest.bankCode || !dest.accountNumber) {
      return next(
        new Error("Bank account requires bank code and account number"),
      );
    }
  }
  next();
});

export default mongoose.model("PayoutRequest", payoutRequestSchema);
