import mongoose from 'mongoose';
import Package from '../models/Package.js';
import Bundle from '../models/Bundle.js';
import Provider from '../models/Provider.js';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const isDirect = path.resolve(path.normalize(process.argv[1])) === path.resolve(path.normalize(__filename));

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/saas-ecommerce');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    return false;
  }
  return true;
}

async function checkIfSeedingNeeded() {
  try {
    console.log('🔍 Checking if seeding is needed...');
    
    // Check if we have any providers
    const providerCount = await Provider.countDocuments();
    console.log(`   - Providers found: ${providerCount}`);
    
    // Check if we have any packages
    const packageCount = await Package.countDocuments();
    console.log(`   - Packages found: ${packageCount}`);
    
    // Check if we have any bundles
    const bundleCount = await Bundle.countDocuments();
    console.log(`   - Bundles found: ${bundleCount}`);
    
    // If any of these are 0, we need seeding
    if (providerCount === 0 || packageCount === 0 || bundleCount === 0) {
      console.log('⚠️  Seeding needed - some data is missing');
      return true;
    }
    
    // Check if we have data for all providers
    const providers = await Provider.find({});
    const expectedProviders = ['MTN', 'TELECEL', 'AT', 'GLO'];
    const existingProviderCodes = providers.map(p => p.code);
    
    const missingProviders = expectedProviders.filter(code => !existingProviderCodes.includes(code));
    
    if (missingProviders.length > 0) {
      console.log(`⚠️  Seeding needed - missing providers: ${missingProviders.join(', ')}`);
      return true;
    }
    
    // Check if we have bundles for all providers
    const bundles = await Bundle.find({});
    const bundleProviders = [...new Set(bundles.map(b => b.provider))];
    const missingBundleProviders = expectedProviders.filter(code => !bundleProviders.includes(code));
    
    if (missingBundleProviders.length > 0) {
      console.log(`⚠️  Seeding needed - missing bundles for providers: ${missingBundleProviders.join(', ')}`);
      return true;
    }
    
    console.log('✅ No seeding needed - all data is present');
    return false;
    
  } catch (error) {
    console.error('❌ Error checking seeding status:', error);
    return true; // Assume seeding is needed if there's an error
  }
}

async function runSeeding() {
  try {
    console.log('🚀 Running seeding process...');
    
    // Import and run the seeding functions
    const { seedProviders, seedPackages, seedBundles, checkDataStructure, validateSeeding } = await import('./seed-packages.js');
    
    // Check and clean old data structure
    await checkDataStructure();
    
    // Seed data in order
    await seedProviders();
    await seedPackages();
    await seedBundles();
    
    // Validate seeding
    const isValid = await validateSeeding();
    
    if (isValid) {
      console.log('🎉 Seeding completed successfully!');
      return true;
    } else {
      console.log('⚠️  Seeding completed with warnings');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    return false;
  }
}

async function main() {
  try {
    console.log('🔍 Starting seeding check...');
    
    // Connect to database
    const connected = await connectDB();
    if (!connected) {
      process.exit(1);
    }
    
    // Check if seeding is needed
    const needsSeeding = await checkIfSeedingNeeded();
    
    if (needsSeeding) {
      console.log('🌱 Seeding is needed. Starting seeding process...');
      const success = await runSeeding();
      
      if (success) {
        console.log('✅ Application is ready with seeded data');
      } else {
        console.log('⚠️  Application started but seeding had issues');
      }
    } else {
      console.log('✅ Application is ready - no seeding needed');
    }
    
  } catch (error) {
    console.error('❌ Seeding check failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Export functions for use in other parts of the application
export {
  checkIfSeedingNeeded,
  runSeeding
};

if (isDirect) {
  main();
} 