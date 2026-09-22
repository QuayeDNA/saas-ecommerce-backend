import mongoose from 'mongoose';
import User from '../src/models/User.js';
import PushSubscription from '../src/models/PushSubscription.js';
import logger from '../src/utils/logger.js';

async function migrate() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  logger.info('Connected to MongoDB');

  const users = await User.find({
    pushSubscription: { $exists: true, $ne: null },
  }).select('_id pushSubscription');

  logger.info(`Found ${users.length} users with push subscriptions`);

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    const sub = user.pushSubscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      skipped++;
      continue;
    }

    try {
      await PushSubscription.findOneAndUpdate(
        { endpoint: sub.endpoint },
        {
          user: user._id,
          endpoint: sub.endpoint,
          keys: sub.keys,
          userAgent: 'migrated',
          platform: 'unknown',
          enabled: true,
          soundEnabled: true,
          lastSeenAt: new Date(),
        },
        { upsert: true, new: true }
      );
      migrated++;
    } catch (err) {
      logger.error(`Failed to migrate subscription for user ${user._id}:`, err);
      skipped++;
    }
  }

  logger.info(`Migration complete: ${migrated} migrated, ${skipped} skipped`);
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  logger.error('Migration failed:', err);
  process.exit(1);
});
