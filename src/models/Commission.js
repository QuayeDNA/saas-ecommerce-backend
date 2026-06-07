import mongoose from "mongoose";

const commissionSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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
    batchTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    ordersCount: {
      type: Number,
      required: true,
      min: 0,
    },
    qualifiedUsersCount: {
      type: Number,
      required: true,
      min: 0,
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
commissionSchema.index({ date: 1, referrer: 1 }, { unique: true });

const Commission = mongoose.model("Commission", commissionSchema);

export default Commission;
