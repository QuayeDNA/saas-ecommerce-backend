import mongoose from 'mongoose';
import User from '../models/User.js';
import logger from '../utils/logger.js';

async function fixWalletBalance() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB');

    // Find users with undefined walletBalance
    const usersWithUndefinedBalance = await User.find({
      $or: [
        { walletBalance: { $exists: false } },
        { walletBalance: null },
        { walletBalance: undefined }
      ]
    });

    logger.info(`Found ${usersWithUndefinedBalance.length} users with undefined walletBalance`);

    if (usersWithUndefinedBalance.length > 0) {
      // Update all users with undefined walletBalance to 0
      const result = await User.updateMany(
        {
          $or: [
            { walletBalance: { $exists: false } },
            { walletBalance: null },
            { walletBalance: undefined }
          ]
        },
        { $set: { walletBalance: 0 } }
      );

      logger.info(`Updated ${result.modifiedCount} users with walletBalance = 0`);
    }

    // Also ensure all users have walletBalance field (set to 0 if not present)
    const allUsers = await User.find({});
    let updatedCount = 0;

    for (const user of allUsers) {
      if (user.walletBalance === undefined || user.walletBalance === null) {
        user.walletBalance = 0;
        await user.save();
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      logger.info(`Updated ${updatedCount} additional users with walletBalance = 0`);
    }

    logger.info('Wallet balance fix completed successfully');
  } catch (error) {
    logger.error(`Error fixing wallet balance: ${error.message}`);
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixWalletBalance();
}

export default fixWalletBalance; 