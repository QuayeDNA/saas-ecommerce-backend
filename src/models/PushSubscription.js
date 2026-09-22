import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  endpoint: {
    type: String,
    required: true,
    unique: true,
  },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  userAgent: {
    type: String,
    default: '',
  },
  platform: {
    type: String,
    default: 'unknown',
  },
  enabled: {
    type: Boolean,
    default: true,
  },
  soundEnabled: {
    type: Boolean,
    default: true,
  },
  lastSeenAt: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

pushSubscriptionSchema.index({ user: 1, createdAt: -1 });
pushSubscriptionSchema.index({ user: 1, enabled: 1 });

export default mongoose.model('PushSubscription', pushSubscriptionSchema);
