import mongoose from "mongoose";

const commissionSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    date: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["credited", "cancelled"],
      default: "credited",
    },
    creditedAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

commissionSchema.index({ referrer: 1, status: 1 });
commissionSchema.index({ order: 1 }, { unique: true });

const Commission = mongoose.model("Commission", commissionSchema);

export default Commission;
