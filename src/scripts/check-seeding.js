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
  } catch (error) {
    return false;
  }
  return true;
}

async function checkIfSeedingNeeded() {
  try {
    // Check if we have any providers
    const providerCount = await Provider.countDocuments();
    
    // Check if we have any packages
    const packageCount = await Package.countDocuments();
    
    // Check if we have any bundles
    const bundleCount = await Bundle.countDocuments();
    
    // If any of these are 0, we need seeding
    if (providerCount === 0 || packageCount === 0 || bundleCount === 0) {
      return true;
    }
    
    // Check if we have data for all providers
    const providers = await Provider.find({});
    const expectedProviders = ['MTN', 'TELECEL', 'AT'];
    const existingProviderCodes = providers.map(p => p.code);
    
    const missingProviders = expectedProviders.filter(code => !existingProviderCodes.includes(code));
    
    if (missingProviders.length > 0) {
      return true;
    }
    
    // Check if we have bundles for all providers
    const bundles = await Bundle.find({});
    const bundleProviders = [...new Set(bundles.map(b => b.provider))];
    const missingBundleProviders = expectedProviders.filter(code => !bundleProviders.includes(code));
    
    if (missingBundleProviders.length > 0) {
      return true;
    }
    
    return false;
    
  } catch (error) {
    return true; // Assume seeding is needed if there's an error
  }
}

async function runSeeding() {
  try {
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
      return true;
    } else {
      return false;
    }
    
  } catch (error) {
    return false;
  }
}

async function main() {
  try {
    // Connect to database
    const connected = await connectDB();
    if (!connected) {
      process.exit(1);
    }
    
    // Check if seeding is needed
    const needsSeeding = await checkIfSeedingNeeded();
    
    if (needsSeeding) {
      const success = await runSeeding();
      
      if (success) {
        // Application is ready with seeded data
      } else {
        // Application started but seeding had issues
      }
    } else {
      // Application is ready - no seeding needed
    }
    
  } catch (error) {
    // Seeding check failed
  } finally {
    await mongoose.disconnect();
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