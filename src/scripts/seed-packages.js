import mongoose from 'mongoose';
import Package from '../models/Package.js';
import Bundle from '../models/Bundle.js';
import Provider from '../models/Provider.js';
import User from '../models/User.js';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);

// Sample provider data (without createdBy - will be set during seeding)
const providers = [
  {
    name: 'MTN Ghana',
    code: 'MTN',
    description: 'MTN Ghana - Leading telecommunications provider',
    logo: {
      url: 'https://example.com/mtn-logo.png',
      alt: 'MTN Ghana Logo'
    },
    isActive: true,
    salesCount: 0,
    viewCount: 0
  },
  {
    name: 'Telecel Ghana',
    code: 'TELECEL',
    description: 'Telecel Ghana - Reliable mobile network',
    logo: {
      url: 'https://example.com/telecel-logo.png',
      alt: 'Telecel Ghana Logo'
    },
    isActive: true,
    salesCount: 0,
    viewCount: 0
  },
  {
    name: 'AirtelTigo',
    code: 'AT',
    description: 'AirtelTigo - Fast and reliable network',
    logo: {
      url: 'https://example.com/airteltigo-logo.png',
      alt: 'AirtelTigo Logo'
    },
    isActive: true,
    salesCount: 0,
    viewCount: 0
  },
  {
    name: 'GLO Ghana',
    code: 'GLO',
    description: 'GLO Ghana - Affordable mobile services',
    logo: {
      url: 'https://example.com/glo-logo.png',
      alt: 'GLO Ghana Logo'
    },
    isActive: true,
    salesCount: 0,
    viewCount: 0
  }
];

// Sample package data (package groups)
const packages = [
  {
    name: 'Daily Data Plans',
    description: '24-hour data bundles for daily internet usage',
    provider: 'MTN',
    category: 'daily',
    isActive: true
  },
  {
    name: 'Weekly Data Plans',
    description: '7-day data bundles for weekly internet usage',
    provider: 'MTN',
    category: 'weekly',
    isActive: true
  },
  {
    name: 'Monthly Data Plans',
    description: '30-day data bundles for monthly internet usage',
    provider: 'MTN',
    category: 'monthly',
    isActive: true
  },
  {
    name: 'Daily Data Plans',
    description: '24-hour data bundles for daily internet usage',
    provider: 'TELECEL',
    category: 'daily',
    isActive: true
  },
  {
    name: 'Weekly Data Plans',
    description: '7-day data bundles for weekly internet usage',
    provider: 'TELECEL',
    category: 'weekly',
    isActive: true
  },
  {
    name: 'Monthly Data Plans',
    description: '30-day data bundles for monthly internet usage',
    provider: 'TELECEL',
    category: 'monthly',
    isActive: true
  },
  {
    name: 'Daily Data Plans',
    description: '24-hour data bundles for daily internet usage',
    provider: 'AT',
    category: 'daily',
    isActive: true
  },
  {
    name: 'Weekly Data Plans',
    description: '7-day data bundles for weekly internet usage',
    provider: 'AT',
    category: 'weekly',
    isActive: true
  },
  {
    name: 'Monthly Data Plans',
    description: '30-day data bundles for monthly internet usage',
    provider: 'AT',
    category: 'monthly',
    isActive: true
  },
  {
    name: 'Daily Data Plans',
    description: '24-hour data bundles for daily internet usage',
    provider: 'GLO',
    category: 'daily',
    isActive: true
  },
  {
    name: 'Weekly Data Plans',
    description: '7-day data bundles for weekly internet usage',
    provider: 'GLO',
    category: 'weekly',
    isActive: true
  },
  {
    name: 'Monthly Data Plans',
    description: '30-day data bundles for monthly internet usage',
    provider: 'GLO',
    category: 'monthly',
    isActive: true
  }
];

// Sample bundle data (individual data plans)
const bundles = [
  // MTN Bundles
  {
    name: 'MTN 50MB Daily',
    description: '50MB data valid for 24 hours',
    dataVolume: 50,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 1.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Basic Browsing'],
    bundleCode: 'MTN_50MB_1D',
    category: 'daily',
    tags: ['daily', 'small', 'social'],
    provider: 'MTN',
    isActive: true
  },
  {
    name: 'MTN 100MB Daily',
    description: '100MB data valid for 24 hours',
    dataVolume: 100,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 2.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Basic Browsing'],
    bundleCode: 'MTN_100MB_1D',
    category: 'daily',
    tags: ['daily', 'medium', 'social'],
    provider: 'MTN',
    isActive: true
  },
  {
    name: 'MTN 250MB Daily',
    description: '250MB data valid for 24 hours',
    dataVolume: 250,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 4.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Browsing'],
    bundleCode: 'MTN_250MB_1D',
    category: 'daily',
    tags: ['daily', 'large', 'streaming'],
    provider: 'MTN',
    isActive: true
  },
  {
    name: 'MTN 500MB Daily',
    description: '500MB data valid for 24 hours',
    dataVolume: 500,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 7.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming'],
    bundleCode: 'MTN_500MB_1D',
    category: 'daily',
    tags: ['daily', 'premium', 'gaming'],
    provider: 'MTN',
    isActive: true
  },
  {
    name: 'MTN 1GB Weekly',
    description: '1GB data valid for 7 days',
    dataVolume: 1,
    dataUnit: 'GB',
    validity: 7,
    validityUnit: 'days',
    price: 10.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming'],
    bundleCode: 'MTN_1GB_7D',
    category: 'weekly',
    tags: ['weekly', 'standard', 'all-purpose'],
    provider: 'MTN',
    isActive: true
  },
  {
    name: 'MTN 2GB Weekly',
    description: '2GB data valid for 7 days',
    dataVolume: 2,
    dataUnit: 'GB',
    validity: 7,
    validityUnit: 'days',
    price: 18.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming', 'Video Calls'],
    bundleCode: 'MTN_2GB_7D',
    category: 'weekly',
    tags: ['weekly', 'large', 'video'],
    provider: 'MTN',
    isActive: true
  },
  {
    name: 'MTN 5GB Monthly',
    description: '5GB data valid for 30 days',
    dataVolume: 5,
    dataUnit: 'GB',
    validity: 30,
    validityUnit: 'days',
    price: 35.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming', 'Video Calls'],
    bundleCode: 'MTN_5GB_30D',
    category: 'monthly',
    tags: ['monthly', 'standard', 'all-purpose'],
    provider: 'MTN',
    isActive: true
  },
  {
    name: 'MTN 10GB Monthly',
    description: '10GB data valid for 30 days',
    dataVolume: 10,
    dataUnit: 'GB',
    validity: 30,
    validityUnit: 'days',
    price: 65.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming', 'Video Calls', 'HD Streaming'],
    bundleCode: 'MTN_10GB_30D',
    category: 'monthly',
    tags: ['monthly', 'large', 'hd'],
    provider: 'MTN',
    isActive: true
  },

  // TELECEL Bundles
  {
    name: 'TELECEL 50MB Daily',
    description: '50MB data valid for 24 hours',
    dataVolume: 50,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 0.80,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Basic Browsing'],
    bundleCode: 'TELECEL_50MB_1D',
    category: 'daily',
    tags: ['daily', 'small', 'social'],
    provider: 'TELECEL',
    isActive: true
  },
  {
    name: 'TELECEL 100MB Daily',
    description: '100MB data valid for 24 hours',
    dataVolume: 100,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 1.50,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Basic Browsing'],
    bundleCode: 'TELECEL_100MB_1D',
    category: 'daily',
    tags: ['daily', 'medium', 'social'],
    provider: 'TELECEL',
    isActive: true
  },
  {
    name: 'TELECEL 250MB Daily',
    description: '250MB data valid for 24 hours',
    dataVolume: 250,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 3.50,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Browsing'],
    bundleCode: 'TELECEL_250MB_1D',
    category: 'daily',
    tags: ['daily', 'large', 'streaming'],
    provider: 'TELECEL',
    isActive: true
  },
  {
    name: 'TELECEL 1GB Weekly',
    description: '1GB data valid for 7 days',
    dataVolume: 1,
    dataUnit: 'GB',
    validity: 7,
    validityUnit: 'days',
    price: 8.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming'],
    bundleCode: 'TELECEL_1GB_7D',
    category: 'weekly',
    tags: ['weekly', 'standard', 'all-purpose'],
    provider: 'TELECEL',
    isActive: true
  },
  {
    name: 'TELECEL 2GB Weekly',
    description: '2GB data valid for 7 days',
    dataVolume: 2,
    dataUnit: 'GB',
    validity: 7,
    validityUnit: 'days',
    price: 15.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming', 'Video Calls'],
    bundleCode: 'TELECEL_2GB_7D',
    category: 'weekly',
    tags: ['weekly', 'large', 'video'],
    provider: 'TELECEL',
    isActive: true
  },
  {
    name: 'TELECEL 5GB Monthly',
    description: '5GB data valid for 30 days',
    dataVolume: 5,
    dataUnit: 'GB',
    validity: 30,
    validityUnit: 'days',
    price: 30.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming', 'Video Calls'],
    bundleCode: 'TELECEL_5GB_30D',
    category: 'monthly',
    tags: ['monthly', 'standard', 'all-purpose'],
    provider: 'TELECEL',
    isActive: true
  },

  // AirtelTigo Bundles
  {
    name: 'AT 50MB Daily',
    description: '50MB data valid for 24 hours',
    dataVolume: 50,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 0.90,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Basic Browsing'],
    bundleCode: 'AT_50MB_1D',
    category: 'daily',
    tags: ['daily', 'small', 'social'],
    provider: 'AT',
    isActive: true
  },
  {
    name: 'AT 100MB Daily',
    description: '100MB data valid for 24 hours',
    dataVolume: 100,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 1.80,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Basic Browsing'],
    bundleCode: 'AT_100MB_1D',
    category: 'daily',
    tags: ['daily', 'medium', 'social'],
    provider: 'AT',
    isActive: true
  },
  {
    name: 'AT 250MB Daily',
    description: '250MB data valid for 24 hours',
    dataVolume: 250,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 3.80,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Browsing'],
    bundleCode: 'AT_250MB_1D',
    category: 'daily',
    tags: ['daily', 'large', 'streaming'],
    provider: 'AT',
    isActive: true
  },
  {
    name: 'AT 1GB Weekly',
    description: '1GB data valid for 7 days',
    dataVolume: 1,
    dataUnit: 'GB',
    validity: 7,
    validityUnit: 'days',
    price: 9.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming'],
    bundleCode: 'AT_1GB_7D',
    category: 'weekly',
    tags: ['weekly', 'standard', 'all-purpose'],
    provider: 'AT',
    isActive: true
  },
  {
    name: 'AT 2GB Weekly',
    description: '2GB data valid for 7 days',
    dataVolume: 2,
    dataUnit: 'GB',
    validity: 7,
    validityUnit: 'days',
    price: 16.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming', 'Video Calls'],
    bundleCode: 'AT_2GB_7D',
    category: 'weekly',
    tags: ['weekly', 'large', 'video'],
    provider: 'AT',
    isActive: true
  },
  {
    name: 'AT 5GB Monthly',
    description: '5GB data valid for 30 days',
    dataVolume: 5,
    dataUnit: 'GB',
    validity: 30,
    validityUnit: 'days',
    price: 32.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming', 'Video Calls'],
    bundleCode: 'AT_5GB_30D',
    category: 'monthly',
    tags: ['monthly', 'standard', 'all-purpose'],
    provider: 'AT',
    isActive: true
  },

  // GLO Bundles
  {
    name: 'GLO 50MB Daily',
    description: '50MB data valid for 24 hours',
    dataVolume: 50,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 0.70,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Basic Browsing'],
    bundleCode: 'GLO_50MB_1D',
    category: 'daily',
    tags: ['daily', 'small', 'social'],
    provider: 'GLO',
    isActive: true
  },
  {
    name: 'GLO 100MB Daily',
    description: '100MB data valid for 24 hours',
    dataVolume: 100,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 1.30,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Basic Browsing'],
    bundleCode: 'GLO_100MB_1D',
    category: 'daily',
    tags: ['daily', 'medium', 'social'],
    provider: 'GLO',
    isActive: true
  },
  {
    name: 'GLO 250MB Daily',
    description: '250MB data valid for 24 hours',
    dataVolume: 250,
    dataUnit: 'MB',
    validity: 1,
    validityUnit: 'days',
    price: 3.20,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Browsing'],
    bundleCode: 'GLO_250MB_1D',
    category: 'daily',
    tags: ['daily', 'large', 'streaming'],
    provider: 'GLO',
    isActive: true
  },
  {
    name: 'GLO 1GB Weekly',
    description: '1GB data valid for 7 days',
    dataVolume: 1,
    dataUnit: 'GB',
    validity: 7,
    validityUnit: 'days',
    price: 7.50,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming'],
    bundleCode: 'GLO_1GB_7D',
    category: 'weekly',
    tags: ['weekly', 'standard', 'all-purpose'],
    provider: 'GLO',
    isActive: true
  },
  {
    name: 'GLO 2GB Weekly',
    description: '2GB data valid for 7 days',
    dataVolume: 2,
    dataUnit: 'GB',
    validity: 7,
    validityUnit: 'days',
    price: 14.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming', 'Video Calls'],
    bundleCode: 'GLO_2GB_7D',
    category: 'weekly',
    tags: ['weekly', 'large', 'video'],
    provider: 'GLO',
    isActive: true
  },
  {
    name: 'GLO 5GB Monthly',
    description: '5GB data valid for 30 days',
    dataVolume: 5,
    dataUnit: 'GB',
    validity: 30,
    validityUnit: 'days',
    price: 28.00,
    currency: 'GHS',
    features: ['Social Media', 'WhatsApp', 'Email', 'Streaming', 'Gaming', 'Video Calls'],
    bundleCode: 'GLO_5GB_30D',
    category: 'monthly',
    tags: ['monthly', 'standard', 'all-purpose'],
    provider: 'GLO',
    isActive: true
  }
];

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/saas-ecommerce');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function checkDataStructure() {
  try {
    // Check if old data structure exists (Product model with packageItems)
    const oldProducts = await mongoose.connection.db.collection('products').find({}).toArray();
    
    if (oldProducts.length > 0) {
      console.log('🔄 Found old data structure. Checking for packageItems...');
      
      const hasOldStructure = oldProducts.some(product => 
        product.packageItems && Array.isArray(product.packageItems)
      );
      
      if (hasOldStructure) {
        console.log('🗑️  Removing old data structure...');
        await mongoose.connection.db.collection('products').deleteMany({});
        console.log('✅ Old data structure removed');
      }
    }

    // Check if old Package model exists with different structure
    const oldPackages = await mongoose.connection.db.collection('packages').find({}).toArray();
    
    if (oldPackages.length > 0) {
      console.log('🔄 Found existing packages. Checking structure...');
      
      const hasOldStructure = oldPackages.some(pkg => 
        pkg.packageItems && Array.isArray(pkg.packageItems)
      );
      
      if (hasOldStructure) {
        console.log('🗑️  Removing old package structure...');
        await mongoose.connection.db.collection('packages').deleteMany({});
        console.log('✅ Old package structure removed');
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Error checking data structure:', error);
    return false;
  }
}

async function seedProviders() {
  try {
    console.log('🌱 Seeding providers...');
    
    // First, create or find a system user for createdBy field
    let systemUser = await User.findOne({ email: 'system@saas-ecommerce.com' });
    
    if (!systemUser) {
      console.log('🔧 Creating system user for seeding...');
      systemUser = await User.create({
        fullName: 'System Administrator',
        email: 'system@saas-ecommerce.com',
        phone: '+233000000000',
        password: 'systemPassword123!',
        userType: 'super_admin',
        isVerified: true,
        isFirstTime: false
      });
      console.log('✅ System user created');
    }
    
    // Clear existing providers
    await Provider.deleteMany({});
    
    // Add createdBy field to all providers
    const providersWithCreator = providers.map(provider => ({
      ...provider,
      createdBy: systemUser._id
    }));
    
    // Insert new providers
    const createdProviders = await Provider.insertMany(providersWithCreator);
    console.log(`✅ Seeded ${createdProviders.length} providers`);
    
    return createdProviders;
  } catch (error) {
    console.error('❌ Error seeding providers:', error);
    throw error;
  }
}

async function seedPackages() {
  try {
    console.log('🌱 Seeding packages...');
    
    // Get or create system user for createdBy and tenantId fields
    let systemUser = await User.findOne({ email: 'system@saas-ecommerce.com' });
    
    if (!systemUser) {
      console.log('🔧 Creating system user for package seeding...');
      systemUser = await User.create({
        fullName: 'System Administrator',
        email: 'system@saas-ecommerce.com',
        phone: '+233000000000',
        password: 'systemPassword123!',
        userType: 'super_admin',
        isVerified: true,
        isFirstTime: false
      });
    }
    
    // Clear existing packages
    await Package.deleteMany({});
    
    // Add required fields to all packages
    const packagesWithRequiredFields = packages.map(pkg => ({
      ...pkg,
      tenantId: systemUser._id, // Use system user as tenant
      createdBy: systemUser._id
    }));
    
    // Insert new packages
    const createdPackages = await Package.insertMany(packagesWithRequiredFields);
    console.log(`✅ Seeded ${createdPackages.length} packages`);
    
    return createdPackages;
  } catch (error) {
    console.error('❌ Error seeding packages:', error);
    throw error;
  }
}

async function seedBundles() {
  try {
    console.log('🌱 Seeding bundles...');
    
    // Get or create system user for createdBy field
    let systemUser = await User.findOne({ email: 'system@saas-ecommerce.com' });
    
    if (!systemUser) {
      console.log('🔧 Creating system user for bundle seeding...');
      systemUser = await User.create({
        fullName: 'System Administrator',
        email: 'system@saas-ecommerce.com',
        phone: '+233000000000',
        password: 'systemPassword123!',
        userType: 'super_admin',
        isVerified: true,
        isFirstTime: false
      });
    }
    
    // Clear existing bundles
    await Bundle.deleteMany({});
    
    // Get package IDs for linking
    const packageMap = {};
    const allPackages = await Package.find({});
    
    allPackages.forEach(pkg => {
      const key = `${pkg.provider}_${pkg.category}`;
      packageMap[key] = pkg._id;
    });
    
    // Get provider IDs for linking
    const providerMap = {};
    const allProviders = await Provider.find({});
    
    allProviders.forEach(provider => {
      providerMap[provider.code] = provider._id;
    });
    
    console.log(`📦 Found ${allPackages.length} packages`);
    console.log(`🏢 Found ${allProviders.length} providers`);
    console.log(`🔗 Provider map:`, Object.keys(providerMap));
    
    // Prepare bundles with proper references
    const bundlesWithRefs = bundles.map(bundle => {
      const packageKey = `${bundle.provider}_${bundle.category}`;
      const packageId = packageMap[packageKey];
      const providerId = providerMap[bundle.provider];
      
      if (!packageId) {
        console.warn(`⚠️  No package found for ${packageKey}`);
        return null; // Skip this bundle
      }
      
      if (!providerId) {
        console.warn(`⚠️  No provider found for ${bundle.provider}`);
        return null; // Skip this bundle
      }
      
      return {
        ...bundle,
        packageId: packageId,
        providerId: providerId,
        tenantId: systemUser._id, // Use system user as tenant
        createdBy: systemUser._id, // Use system user ID
        isDeleted: false
      };
    }).filter(bundle => bundle !== null); // Remove null bundles
    
    if (bundlesWithRefs.length === 0) {
      console.warn('⚠️  No valid bundles to create');
      return [];
    }
    
    // Insert bundles
    const createdBundles = await Bundle.insertMany(bundlesWithRefs);
    console.log(`✅ Seeded ${createdBundles.length} bundles`);
    
    return createdBundles;
  } catch (error) {
    console.error('❌ Error seeding bundles:', error);
    throw error;
  }
}

async function validateSeeding() {
  try {
    console.log('🔍 Validating seeded data...');
    
    const providerCount = await Provider.countDocuments();
    const packageCount = await Package.countDocuments();
    const bundleCount = await Bundle.countDocuments();
    
    console.log(`📊 Validation Results:`);
    console.log(`   - Providers: ${providerCount}`);
    console.log(`   - Packages: ${packageCount}`);
    console.log(`   - Bundles: ${bundleCount}`);
    
    if (providerCount === providers.length && 
        packageCount === packages.length && 
        bundleCount === bundles.length) {
      console.log('✅ All data seeded successfully!');
      return true;
    } else {
      console.log('⚠️  Some data may not have been seeded correctly');
      return false;
    }
  } catch (error) {
    console.error('❌ Error validating seeding:', error);
    return false;
  }
}

async function main() {
  try {
    console.log('🚀 Starting package seeding process...');
    
    // Connect to database
    await connectDB();
    
    // Check and clean old data structure
    await checkDataStructure();
    
    // Seed data in order - ensure providers are created first
    console.log('🔄 Seeding providers first...');
    const createdProviders = await seedProviders();
    
    console.log('🔄 Seeding packages...');
    const createdPackages = await seedPackages();
    
    console.log('🔄 Seeding bundles...');
    const createdBundles = await seedBundles();
    
    // Validate seeding
    const isValid = await validateSeeding();
    
    if (isValid) {
      console.log('🎉 Package seeding completed successfully!');
    } else {
      console.log('⚠️  Seeding completed with warnings');
    }
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the seeding script
export {
  seedProviders,
  seedPackages,
  seedBundles,
  checkDataStructure,
  validateSeeding
};

if (process.argv[1] === __filename) {
  main();
} 