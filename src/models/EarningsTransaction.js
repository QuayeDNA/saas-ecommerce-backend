// src/models/EarningsTransaction.js
import mongoose from 'mongoose';

const earningsTransactionSchema = new mongoose.Schema({
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
    default: function() {
      return `ETX${Date.now()}${Math.random().toString(36).substring(2,8).toUpperCase()}`;
    }
  },
  relatedOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  relatedPayout: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PayoutRequest'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

earningsTransactionSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('EarningsTransaction', earningsTransactionSchema);
