// src/models/WalletTransaction.js
import mongoose from 'mongoose';

const walletTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  balanceAfter: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  reference: {
    type: String,
    required: true,
    // default generator ensures every transaction gets a unique string when the
    // field is omitted. We intentionally avoid setting this property when
    // callers pass `null` so the default can apply (see walletService._recordTransaction).
    default: function() {
      return `TXN${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    }
  },
  relatedOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'approved', 'rejected', 'completed'],
    default: 'completed'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Indexing for faster queries
walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index({ status: 1 });
walletTransactionSchema.index({ reference: 1 }, { unique: true });
// Compound index for atomic idempotency checks — prevents double-crediting the
// same Paystack reference. The partial filter limits the index to completed
// records only, keeping it small and fast.
walletTransactionSchema.index(
  { reference: 1, status: 1 },
  { partialFilterExpression: { status: "completed" } },
);

export default mongoose.model('WalletTransaction', walletTransactionSchema);
