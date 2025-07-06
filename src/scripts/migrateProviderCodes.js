import 'dotenv/config';
import mongoose from 'mongoose';
import PackageGroup from '../models/Product.js';
import logger from '../utils/logger.js';

async function migrateProviderCodes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.DBURI);
    logger.info('Connected to MongoDB for provider code migration');

    // Define the mapping from old codes to new codes
    const providerCodeMapping = {
      'Vodafone': 'TELECEL',
      'AirtelTigo': 'AT',
      'Glo': 'GLO'
    };

    // Find all package groups with old provider codes
    const oldProviderCodes = Object.keys(providerCodeMapping);
    const packagesToUpdate = await PackageGroup.find({
      provider: { $in: oldProviderCodes }
    });

    logger.info(`Found ${packagesToUpdate.length} package groups with old provider codes`);

    if (packagesToUpdate.length === 0) {
      logger.info('No packages need to be migrated');
      return;
    }

    // Update each package group
    for (const packageGroup of packagesToUpdate) {
      const oldCode = packageGroup.provider;
      const newCode = providerCodeMapping[oldCode];
      
      logger.info(`Migrating package group "${packageGroup.name}" from ${oldCode} to ${newCode}`);
      
      // Update the provider code
      packageGroup.provider = newCode;
      
      // Update package item codes to reflect the new provider
      if (packageGroup.packageItems && packageGroup.packageItems.length > 0) {
        packageGroup.packageItems.forEach(item => {
          if (item.code && item.code.startsWith(oldCode)) {
            item.code = item.code.replace(oldCode, newCode);
            logger.info(`Updated package item code from ${item.code} to ${item.code}`);
          }
        });
      }
      
      await packageGroup.save();
      logger.info(`Successfully migrated package group: ${packageGroup.name}`);
    }

    logger.info('Provider code migration completed successfully');
    console.log('\n✅ Provider code migration completed!');
    console.log(`Migrated ${packagesToUpdate.length} package groups`);

  } catch (error) {
    logger.error(`Provider code migration failed: ${error.message}`);
    console.error('❌ Error during migration:', error.message);
  } finally {
    await mongoose.connection.close();
    logger.info('Database connection closed');
  }
}

// Run the migration
migrateProviderCodes(); 