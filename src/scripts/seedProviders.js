import 'dotenv/config';
import mongoose from 'mongoose';
import Provider from '../models/Provider.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

async function seedProviders() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.DBURI);
    logger.info('Connected to MongoDB for seeding providers');

    // Find or create a system user for seeding
    let systemUser = await User.findOne({ email: 'system@saas-ecommerce.com' });
    
    if (!systemUser) {
      logger.info('Creating system user for seeding...');
      systemUser = new User({
        firstName: 'System',
        lastName: 'Admin',
        fullName: 'System Admin',
        email: 'system@saas-ecommerce.com',
        phone: '+233000000000',
        password: 'temporary-password',
        role: 'admin',
        isVerified: true,
        tenantId: new mongoose.Types.ObjectId() // Generate a temporary tenant ID
      });
      await systemUser.save();
      logger.info('System user created');
    }

    const providers = [
      {
        name: 'MTN Ghana',
        code: 'MTN',
        country: 'Ghana',
        logo: 'https://example.com/mtn-logo.png',
        description: 'Leading telecommunications provider in Ghana',
        services: ['voice', 'data', 'sms', 'mobile_money'],
        apiConfig: {
          baseUrl: 'https://api.mtn.com.gh',
          version: 'v1',
          timeout: 30000
        },
        isActive: true,
        createdBy: systemUser._id
      },
      {
        name: 'Telecel Ghana',
        code: 'TELECEL',
        country: 'Ghana',
        logo: 'https://example.com/telecel-logo.png',
        description: 'Premium telecommunications services provider',
        services: ['voice', 'data', 'sms', 'mobile_money'],
        apiConfig: {
          baseUrl: 'https://api.telecel.com.gh',
          version: 'v1',
          timeout: 30000
        },
        isActive: true,
        createdBy: systemUser._id
      },
      {
        name: 'AT (AirtelTigo) Ghana',
        code: 'AT',
        country: 'Ghana',
        logo: 'https://example.com/airteltigo-logo.png',
        description: 'Reliable telecommunications network provider',
        services: ['voice', 'data', 'sms'],
        apiConfig: {
          baseUrl: 'https://api.airteltigo.com.gh',
          version: 'v1',
          timeout: 30000
        },
        isActive: true,
        createdBy: systemUser._id
      },
      {
        name: 'Glo Ghana',
        code: 'GLO',
        country: 'Ghana',
        logo: 'https://example.com/glo-logo.png',
        description: 'Affordable telecommunications services',
        services: ['voice', 'data', 'sms'],
        apiConfig: {
          baseUrl: 'https://api.glo.com.gh',
          version: 'v1',
          timeout: 30000
        },
        isActive: true,
        createdBy: systemUser._id
      }
    ];

    // Clear existing providers
    await Provider.deleteMany({});
    logger.info('Cleared existing providers');

    // Insert new providers
    const insertedProviders = await Provider.insertMany(providers);
    logger.info(`Successfully seeded ${insertedProviders.length} providers`);

    // Log the seeded providers
    insertedProviders.forEach(provider => {
      logger.info(`Provider seeded: ${provider.name} (${provider.code})`);
    });

    console.log('\n✅ Providers seeded successfully!');
    console.log('Seeded providers:');
    insertedProviders.forEach(provider => {
      console.log(`- ${provider.name} (${provider.code})`);
    });

    // Clean up system user if it was created for seeding
    if (systemUser.email === 'system@saas-ecommerce.com') {
      await User.deleteOne({ _id: systemUser._id });
      logger.info('System user cleaned up');
    }

  } catch (error) {
    logger.error(`Provider seeding failed: ${error.message}`);
    console.error('❌ Error seeding providers:', error.message);
  } finally {
    await mongoose.connection.close();
    logger.info('Database connection closed');
  }
}

// Run the seeding
seedProviders();