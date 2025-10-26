// src/models/CommissionRecord.js
import mongoose from "mongoose";

const commissionRecordSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    period: {
      type: String,
      required: true,
      enum: ["monthly", "weekly", "daily"],
      default: "monthly",
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    totalOrders: {
      type: Number,
      required: true,
      default: 0,
    },
    totalRevenue: {
      type: Number,
      required: true,
      default: 0,
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "rejected", "cancelled"],
      default: "pending",
    },
    isFinal: {
      type: Boolean,
      default: false,
      index: true,
    },
    finalizedAt: {
      type: Date,
    },
    paidAt: {
      type: Date,
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    paymentReference: {
      type: String,
    },
    rejectedAt: {
      type: Date,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    rejectionReason: {
      type: String,
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient queries
commissionRecordSchema.index({ agentId: 1, periodStart: -1 });
commissionRecordSchema.index({ tenantId: 1, status: 1 });
commissionRecordSchema.index({ periodStart: 1, periodEnd: 1 });
commissionRecordSchema.index({ agentId: 1, status: 1, periodStart: -1 });

// Virtual for formatted period
commissionRecordSchema.virtual("formattedPeriod").get(function () {
  const start = this.periodStart.toLocaleDateString();
  const end = this.periodEnd.toLocaleDateString();
  return `${start} - ${end}`;
});

// Virtual for formatted rate
commissionRecordSchema.virtual("formattedRate").get(function () {
  return `${(this.commissionRate * 100).toFixed(1)}%`;
});

// Method to mark as paid
commissionRecordSchema.methods.markAsPaid = function (
  paidBy,
  paymentReference = null
) {
  this.status = "paid";
  this.paidAt = new Date();
  this.paidBy = paidBy;
  if (paymentReference) {
    this.paymentReference = paymentReference;
  }
  return this.save();
};

// Method to mark as rejected
commissionRecordSchema.methods.markAsRejected = function (
  rejectedBy,
  rejectionReason = null
) {
  this.status = "rejected";
  this.rejectedAt = new Date();
  this.rejectedBy = rejectedBy;
  if (rejectionReason) {
    this.rejectionReason = rejectionReason;
  }
  return this.save();
};

// Static method to calculate commission for an agent
commissionRecordSchema.statics.calculateCommission = async function (
  agentId,
  tenantId,
  startDate,
  endDate
) {
  const Order = (await import("./Order.js")).default;
  const Settings = (await import("./Settings.js")).default;

  // Get completed orders for the period
  const orders = await Order.find({
    createdBy: agentId,
    tenantId: tenantId,
    status: "completed",
    createdAt: { $gte: startDate, $lte: endDate },
  });

  const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);

  // Get commission rate from settings
  const settings = await Settings.getInstance();
  const commissionRate = settings.agentCommission || 5.0;

  const commissionAmount = (totalRevenue * commissionRate) / 100;

  return {
    totalOrders: orders.length,
    totalRevenue,
    commissionRate,
    amount: Math.round(commissionAmount * 100) / 100,
  };
};

const CommissionRecord = mongoose.model(
  "CommissionRecord",
  commissionRecordSchema
);

export default CommissionRecord;
