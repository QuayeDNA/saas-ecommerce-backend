// src/scripts/seed-data.js
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import connectDB from '../config/db.js';
import User from '../models/User.js';
import Provider from '../models/Provider.js';
import PackageGroup from '../models/Product.js'; // Using the existing Product.js model which is now our PackageGroup
import logger from '../utils/logger.js';

// Connect to database
connectDB();

// Seed data function
const seedData = async () => {
  try {
    logger.info('Starting database seeding...');
    
    // Clean existing data - be careful with this in production!
    await User.deleteMany({ email: { $in: ['admin@example.com', 'tenant@example.com'] } });
    await Provider.deleteMany({});
    await PackageGroup.deleteMany({});
    
    logger.info('Deleted existing test data');

    // Create test admin user
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    
    const adminUser = new User({
      fullName: 'Test Admin',
      email: 'admin@example.com',
      phone: '+233500000000',
      password: hashedPassword,
      userType: 'super_admin',
      isVerified: true,
      role: 'admin'
    });
    
    await adminUser.save();
    logger.info(`Created test admin user: ${adminUser._id}`);

    // Create tenant user (agent type)
    const tenantUser = new User({
      fullName: 'Test Tenant',
      email: 'tenant@example.com',
      phone: '+233500000001',
      password: hashedPassword,
      userType: 'agent',
      isVerified: true,
      role: 'owner',
      businessName: 'Test Business',
      businessCategory: 'services',
      subscriptionPlan: 'premium',
      subscriptionStatus: 'active'
    });
    
    await tenantUser.save();
    logger.info(`Created test tenant user: ${tenantUser._id}`);

    // Create providers
    const providers = [
      {
        name: 'MTN',
        code: 'MTN',
        description: 'MTN Ghana Mobile Network',
        logo: {
          url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/New_MTN_logo.svg/512px-New_MTN_logo.svg.png',
          alt: 'MTN Logo'
        },
        isActive: true,
        tags: ['mobile', 'data', 'voice'],
        tenantId: tenantUser._id,
        createdBy: tenantUser._id
      },
      {
        name: 'TELECEL',
        code: 'TELECEL',
        description: 'TELECEL Ghana Mobile Network',
        logo: {
          url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Vodafone_icon.svg/512px-Vodafone_icon.svg.png',
          alt: 'TELECEL Logo'
        },
        isActive: true,
        tags: ['mobile', 'data', 'voice'],
        tenantId: tenantUser._id,
        createdBy: tenantUser._id
      },
      {
        name: 'AT (AirtelTigo)',
        code: 'AT',
        description: 'AT (AirtelTigo) Ghana Mobile Network',
        logo: {
          url: 'https://play-lh.googleusercontent.com/NiU2-fctnNdOtOnZ5NfLA9aBUwUGXGmZKOBXXFBSWE0HB92NGb8C-j0LzkPTNAO9mbg',
          alt: 'AT Logo'
        },
        isActive: true,
        tags: ['mobile', 'data', 'voice'],
        tenantId: tenantUser._id,
        createdBy: tenantUser._id
      }
    ];
    
    const createdProviders = await Provider.insertMany(providers);
    logger.info(`Created ${createdProviders.length} providers`);
    
    // Map for easy lookup of provider codes (not IDs)
    const providerMap = {};
    createdProviders.forEach(provider => {
      providerMap[provider.name] = provider.code;
    });

    // Create package groups and their package items
    const packageGroups = [
      {
        name: 'MTN Daily Bundles',
        description: 'Affordable daily data bundles from MTN',
        provider: 'MTN',
        slug: 'mtn-daily-bundles',
        banner: {
          url: 'https://example.com/mtn-daily-banner.jpg',
          alt: 'MTN Daily Bundles Banner'
        },
        isActive: true,
        tags: ['data', 'daily', 'affordable'],
        tenantId: tenantUser._id,
        createdBy: tenantUser._id,
        packageItems: [
          {
            name: '50MB Daily',
            description: 'Small daily data for light browsing',
            code: 'MTN-DAILY-50MB',
            price: 1.0,
            costPrice: 0.8,
            inventory: 1000,
            reservedInventory: 0,
            lowStockThreshold: 100,
            isActive: true,
            dataVolume: 0.05, // 50MB in GB
            validity: 1 // 1 day
          },
          {
            name: '400MB Daily',
            description: 'Medium daily data for regular browsing',
            code: 'MTN-DAILY-400MB',
            price: 3.0,
            costPrice: 2.5,
            inventory: 1000,
            reservedInventory: 0,
            lowStockThreshold: 100,
            isActive: true,
            dataVolume: 0.4, // 400MB in GB
            validity: 1 // 1 day
          },
          {
            name: '1GB Daily',
            description: 'Large daily data for streaming and downloads',
            code: 'MTN-DAILY-1GB',
            price: 5.0,
            costPrice: 4.0,
            inventory: 1000,
            reservedInventory: 0,
            lowStockThreshold: 100,
            isActive: true,
            dataVolume: 1.0, // 1GB
            validity: 1 // 1 day
          }
        ]
      },
      {
        name: 'MTN Weekly Bundles',
        description: 'Affordable weekly data bundles from MTN',
        provider: 'MTN',
        slug: 'mtn-weekly-bundles',
        banner: {
          url: 'https://example.com/mtn-weekly-banner.jpg',
          alt: 'MTN Weekly Bundles Banner'
        },
        isActive: true,
        tags: ['data', 'weekly', 'affordable'],
        tenantId: tenantUser._id,
        createdBy: tenantUser._id,
        packageItems: [
          {
            name: '1GB Weekly',
            description: 'Small weekly data bundle',
            code: 'MTN-WEEKLY-1GB',
            price: 10.0,
            costPrice: 8.0,
            inventory: 1000,
            reservedInventory: 0,
            lowStockThreshold: 100,
            isActive: true,
            dataVolume: 1.0, // 1GB
            validity: 7 // 7 days
          },
          {
            name: '2GB Weekly',
            description: 'Medium weekly data bundle',
            code: 'MTN-WEEKLY-2GB',
            price: 15.0,
            costPrice: 12.0,
            inventory: 1000,
            reservedInventory: 0,
            lowStockThreshold: 100,
            isActive: true,
            dataVolume: 2.0, // 2GB
            validity: 7 // 7 days
          }
        ]
      },
      {
        name: 'TELECEL Daily Bundles',
        description: 'Affordable daily data bundles from TELECEL',
        provider: 'TELECEL',
        slug: 'telecel-daily-bundles',
        banner: {
          url: 'https://example.com/telecel-daily-banner.jpg',
          alt: 'TELECEL Daily Bundles Banner'
        },
        isActive: true,
        tags: ['data', 'daily', 'affordable'],
        tenantId: tenantUser._id,
        createdBy: tenantUser._id,
        packageItems: [
          {
            name: '100MB Daily',
            description: 'Small daily data for light browsing',
            code: 'TEL-DAILY-100MB',
            price: 1.0,
            costPrice: 0.8,
            inventory: 1000,
            reservedInventory: 0,
            lowStockThreshold: 100,
            isActive: true,
            dataVolume: 0.1, // 100MB in GB
            validity: 1 // 1 day
          },
          {
            name: '500MB Daily',
            description: 'Medium daily data for regular browsing',
            code: 'TEL-DAILY-500MB',
            price: 3.0,
            costPrice: 2.5,
            inventory: 1000,
            reservedInventory: 0,
            lowStockThreshold: 100,
            isActive: true,
            dataVolume: 0.5, // 500MB in GB
            validity: 1 // 1 day
          }
        ]
      },
      {
        name: 'AT Freedom Bundles',
        description: 'Affordable data bundles from AT (AirtelTigo)',
        provider: 'AT',
        slug: 'at-freedom-bundles',
        banner: {
          url: 'https://example.com/at-banner.jpg',
          alt: 'AT Freedom Bundles Banner'
        },
        isActive: true,
        tags: ['data', 'freedom', 'affordable'],
        tenantId: tenantUser._id,
        createdBy: tenantUser._id,
        packageItems: [
          {
            name: '1GB Freedom',
            description: '1GB data without expiry',
            code: 'AT-FREEDOM-1GB',
            price: 10.0,
            costPrice: 8.0,
            inventory: 1000,
            reservedInventory: 0,
            lowStockThreshold: 100,
            isActive: true,
            dataVolume: 1.0, // 1GB
            validity: 30 // 30 days
          },
          {
            name: '3GB Freedom',
            description: '3GB data without expiry',
            code: 'AT-FREEDOM-3GB',
            price: 20.0,
            costPrice: 16.0,
            inventory: 1000,
            reservedInventory: 0,
            lowStockThreshold: 100,
            isActive: true,
            dataVolume: 3.0, // 3GB
            validity: 30 // 30 days
          }
        ]
      }
    ];

    // Replace provider strings with actual provider IDs
    for (const packageGroup of packageGroups) {
      packageGroup.provider = providerMap[packageGroup.provider];
    }
    
    const createdPackageGroups = await PackageGroup.insertMany(packageGroups);
    logger.info(`Created ${createdPackageGroups.length} package groups with a total of ${packageGroups.reduce((acc, group) => acc + group.packageItems.length, 0)} package items`);
    
    logger.info('Database seeding completed successfully');
    
  } catch (error) {
    logger.error(`Database seeding failed: ${error.message}`);
  } finally {
    // Disconnect from database
    mongoose.connection.close();
    logger.info('Database connection closed');
  }
};

// Run the seed function
seedData();
