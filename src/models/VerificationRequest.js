import mongoose from "mongoose";

const verificationRequestSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    source: {
      type: String,
      enum: ["agent", "customer", "admin"],
      required: true,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewNote: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

verificationRequestSchema.index(
  { phone: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  }
);

export default mongoose.model("VerificationRequest", verificationRequestSchema);
