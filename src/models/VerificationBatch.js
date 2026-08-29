import mongoose from "mongoose";

const verificationBatchSchema = new mongoose.Schema(
  {
    batchNumber: {
      type: Number,
      required: true,
      unique: true,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["submitted", "approved", "rejected", "partial"],
      default: "submitted",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("VerificationBatch", verificationBatchSchema);
