import mongoose from 'mongoose';

const paystackVerificationTaskSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['storefront', 'wallet'],
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'done', 'failed'],
      default: 'pending',
    },
    attemptCount: {
      type: Number,
      default: 0,
    },
    lastAttemptAt: Date,
    lastError: String,
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('PaystackVerificationTask', paystackVerificationTaskSchema);
