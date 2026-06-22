// src/models/WebhookDeliveryLog.js
import mongoose from "mongoose";

const webhookDeliveryLogSchema = new mongoose.Schema(
  {
    webhookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebhookEndpoint",
      required: true,
      index: true,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    event: {
      type: String,
      required: true,
      enum: [
        "order.placed",
        "order.processing",
        "order.completed",
        "order.failed",
        "order.refunded",
        "bundle.delivered",
      ],
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    attemptNumber: {
      type: Number,
      required: true,
      default: 1,
    },
    statusCode: {
      type: Number,
    },
    responseBody: {
      type: mongoose.Schema.Types.Mixed,
    },
    success: {
      type: Boolean,
      required: true,
    },
    errorMessage: {
      type: String,
    },
    deliveredAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

webhookDeliveryLogSchema.index({ webhookId: 1, deliveredAt: -1 });
webhookDeliveryLogSchema.index({ agentId: 1, deliveredAt: -1 });
webhookDeliveryLogSchema.index({ orderId: 1 });

const WebhookDeliveryLog = mongoose.model("WebhookDeliveryLog", webhookDeliveryLogSchema);

export default WebhookDeliveryLog;
