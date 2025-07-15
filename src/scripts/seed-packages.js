import mongoose from 'mongoose';
import Package from '../models/Package.js';
import Bundle from '../models/Bundle.js';
import Provider from '../models/Provider.js';
import User from '../models/User.js';
import 'dotenv/config';

const ADMIN_EMAIL = 'admin@saastleplay.com';
const ADMIN_PASSWORD = 'systemPassword123!';

const MTN_PROVIDER = {
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
};

const MTN_AGENT_BUNDLES = [
  { name: 'MTN 1GB Unlimited', dataVolume: 1, price: 4.7 },
  { name: 'MTN 2GB Unlimited', dataVolume: 2, price: 9.5 },
  { name: 'MTN 3GB Unlimited', dataVolume: 3, price: 13.5 },
  { name: 'MTN 4GB Unlimited', dataVolume: 4, price: 18.5 },
  { name: 'MTN 5GB Unlimited', dataVolume: 5, price: 23 },
  { name: 'MTN 6GB Unlimited', dataVolume: 6, price: 26.5 },
  { name: 'MTN 8GB Unlimited', dataVolume: 8, price: 35.5 },
  { name: 'MTN 10GB Unlimited', dataVolume: 10, price: 43 },
  { name: 'MTN 15GB Unlimited', dataVolume: 15, price: 60.5 },
  { name: 'MTN 20GB Unlimited', dataVolume: 20, price: 81 },
  { name: 'MTN 25GB Unlimited', dataVolume: 25, price: 99.5 },
  { name: 'MTN 30GB Unlimited', dataVolume: 30, price: 119.5 },
  { name: 'MTN 40GB Unlimited', dataVolume: 40, price: 157 },
  { name: 'MTN 50GB Unlimited', dataVolume: 50, price: 197 },
];

async function main() {
  await mongoose.connect(process.env.DBURI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB');

  // Ensure admin user exists
  let admin = await User.findOne({ email: ADMIN_EMAIL });
  if (!admin) {
    admin = await User.create({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      fullName: 'System Admin',
      role: 'admin',
      isActive: true
    });
    console.log('Admin user created');
  }

  // Ensure MTN provider exists
  let provider = await Provider.findOne({ code: 'MTN' });
  if (!provider) {
    provider = await Provider.create({ ...MTN_PROVIDER, createdBy: admin._id });
    console.log('MTN provider created');
  }

  // Remove all existing packages and bundles for MTN
  await Package.deleteMany({ provider: 'MTN' });
  await Bundle.deleteMany({ provider: 'MTN' });

  // Create the MTN Agent Unlimited Package
  const pkg = await Package.create({
    name: 'MTN Agent Unlimited Bundles',
    description: 'All MTN agent unlimited bundles. 1-15mins Delivery. Maximum 30mins.',
    provider: 'MTN',
    category: 'unlimited',
    isActive: true,
    isDeleted: false,
    tenantId: admin._id,
    createdBy: admin._id
  });
  console.log('MTN Agent Unlimited Package created');

  // Create all bundles
  for (const b of MTN_AGENT_BUNDLES) {
    await Bundle.create({
      name: b.name,
      description: `${b.dataVolume}GB unlimited. 1-15mins Delivery. Maximum 30mins.`,
      dataVolume: b.dataVolume,
      dataUnit: 'GB',
      validity: 30,
      validityUnit: 'days',
      price: b.price,
      currency: 'GHS',
      features: ['Agent Pricing', 'Unlimited', 'Fast Delivery'],
      bundleCode: b.name.replace(/\s+/g, '_').toUpperCase(),
      category: 'unlimited',
      tags: ['unlimited', 'agent', 'mtn'],
      provider: 'MTN',
      isActive: true,
      isDeleted: false,
      packageId: pkg._id,
      providerId: provider._id,
      tenantId: admin._id,
      createdBy: admin._id
    });
    console.log(`Bundle seeded: ${b.name}`);
  }

  console.log('All bundles seeded!');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}); 