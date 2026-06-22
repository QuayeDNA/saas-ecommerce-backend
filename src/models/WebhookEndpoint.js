// src/models/WebhookEndpoint.js
import mongoose from "mongoose";
import crypto from "crypto";

const WEBHOOK_EVENTS = [
  "order.placed",
  "order.processing",
  "order.completed",
  "order.failed",
  "order.refunded",
  "bundle.delivered",
];

const webhookEndpointSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          return /^https?:\/\/.+/.test(v);
        },
        message: "Webhook URL must be a valid HTTP/HTTPS URL",
      },
    },
    secret: {
      type: String,
      required: true,
      select: false, // Don't include in queries
    },
    events: {
      type: [String],
      required: true,
      default: ["order.placed", "order.completed", "order.failed"],
      validate: {
        validator: function (events) {
          return events.every((event) => WEBHOOK_EVENTS.includes(event));
        },
        message: "Invalid webhook event: {VALUE}",
      },
    },
    active: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 200,
    },
  },
  { timestamps: true },
);

webhookEndpointSchema.index({ agentId: 1, active: 1 });
webhookEndpointSchema.index({ secret: 1 });

webhookEndpointSchema.statics.WEBHOOK_EVENTS = WEBHOOK_EVENTS;

const WebhookEndpoint = mongoose.model("WebhookEndpoint", webhookEndpointSchema);

export default WebhookEndpoint;
