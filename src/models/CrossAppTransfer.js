// src/models/CrossAppTransfer.js
import mongoose from "mongoose";

const crossAppTransferSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    sourceAppId: { type: String, required: true },
    destAppId: { type: String, required: true },
    sourceUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    destUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    sourceUserEmail: { type: String, default: "" },
    destUserEmail: { type: String, default: "" },
    amount: { type: Number, required: true, min: 0.01 },
    status: {
      type: String,
      enum: ["completed", "failed", "pending"],
      default: "pending",
    },
    note: { type: String, default: "" },
    sourceAppName: { type: String, required: true },
    destAppName: { type: String, required: true },
    error: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

crossAppTransferSchema.index({ sourceUserId: 1, createdAt: -1 });
crossAppTransferSchema.index({ destUserId: 1, createdAt: -1 });
crossAppTransferSchema.index({ status: 1 });

export default mongoose.model("CrossAppTransfer", crossAppTransferSchema);
