import mongoose from "mongoose";

const blockedRecipientSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    reason: {
      type: String,
      default: "Ordering blocked due to platform violations",
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("BlockedRecipient", blockedRecipientSchema);
