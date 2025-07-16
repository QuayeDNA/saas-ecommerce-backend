import mongoose from 'mongoose';
import Package from '../models/Package.js';
import Bundle from '../models/Bundle.js';
import Provider from '../models/Provider.js';
import User from '../models/User.js';
import 'dotenv/config';

const ADMIN_EMAIL = 'admin@saastleplay.com';
const ADMIN_PASSWORD = 'systemPassword123!';

const PROVIDERS = [
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
    description: 'Telecel Ghana',
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
    description: 'AirtelTigo Ghana',
    logo: {
      url: 'https://example.com/at-logo.png',
      alt: 'AirtelTigo Ghana Logo'
    },
    isActive: true,
    salesCount: 0,
    viewCount: 0
  }
];

const PACKAGES = [
  // MTN Agent Unlimited
  {
    provider: 'MTN',
    name: 'MTN Agent Unlimited Bundles',
    description: 'All MTN agent unlimited bundles. 1-15mins Delivery. Maximum 30mins.',
    category: 'unlimited',
    isActive: true,
    isDeleted: false,
    bundles: [
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
    ],
  },
  // AT BIG TIME
  {
    provider: 'AT',
    name: 'AT BIG TIME Bundles',
    description: 'AT BIG TIME agent bundles.',
    category: 'big-time',
    isActive: true,
    isDeleted: false,
    bundles: [
      { name: 'AT BIG TIME 30GB', dataVolume: 30, price: 75.0 },
      { name: 'AT BIG TIME 40GB', dataVolume: 40, price: 88.0 },
      { name: 'AT BIG TIME 50GB', dataVolume: 50, price: 100.0 },
      { name: 'AT BIG TIME 60GB', dataVolume: 60, price: 132.0 },
      { name: 'AT BIG TIME 70GB', dataVolume: 70, price: 140.0 },
      { name: 'AT BIG TIME 80GB', dataVolume: 80, price: 173.0 },
      { name: 'AT BIG TIME 100GB', dataVolume: 100, price: 197.0 },
      { name: 'AT BIG TIME 200GB', dataVolume: 200, price: 385.0 },
    ],
  },
  // AT iShare
  {
    provider: 'AT',
    name: 'AT iShare Premium Bundles',
    description: 'AT iShare Premium bundles.',
    category: 'ishare-premium',
    isActive: true,
    isDeleted: false,
    bundles: [
      { name: 'AT iShare 1GB', dataVolume: 1, price: 4.2 },
      { name: 'AT iShare 2GB', dataVolume: 2, price: 8.0 },
      { name: 'AT iShare 3GB', dataVolume: 3, price: 12.0 },
      { name: 'AT iShare 4GB', dataVolume: 4, price: 16.0 },
      { name: 'AT iShare 5GB', dataVolume: 5, price: 20.0 },
      { name: 'AT iShare 6GB', dataVolume: 6, price: 23.5 },
      { name: 'AT iShare 7GB', dataVolume: 7, price: 27.5 },
      { name: 'AT iShare 8GB', dataVolume: 8, price: 31.0 },
      { name: 'AT iShare 10GB', dataVolume: 10, price: 40.0 },
      { name: 'AT iShare 12GB', dataVolume: 12, price: 46.5 },
      { name: 'AT iShare 15GB', dataVolume: 15, price: 59.0 },
    ],
  },
  // TELECEL
  {
    provider: 'TELECEL',
    name: 'Telecel Data Bundles',
    description: 'Telecel Ghana data bundles.',
    category: 'telecel',
    isActive: true,
    isDeleted: false,
    bundles: [
      { name: 'Telecel 5GB', dataVolume: 5, price: 21.2 },
      { name: 'Telecel 10GB', dataVolume: 10, price: 39.5 },
      { name: 'Telecel 15GB', dataVolume: 15, price: 57.0 },
      { name: 'Telecel 20GB', dataVolume: 20, price: 77.0 },
      { name: 'Telecel 25GB', dataVolume: 25, price: 95.0 },
      { name: 'Telecel 30GB', dataVolume: 30, price: 112.0 },
      { name: 'Telecel 40GB', dataVolume: 40, price: 149.0 },
      { name: 'Telecel 50GB', dataVolume: 50, price: 188.0 },
    ],
  },
];

async function main() {
  await mongoose.connect(process.env.DBURI, {});
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

  // Ensure all providers exist
  for (const p of PROVIDERS) {
    let provider = await Provider.findOne({ code: p.code });
    if (!provider) {
      provider = await Provider.create({ ...p, createdBy: admin._id });
      console.log(`${p.name} provider created`);
    }
  }

  // Sync packages and bundles
  for (const pkgDef of PACKAGES) {
    const provider = await Provider.findOne({ code: pkgDef.provider });
    if (!provider) continue;

    // Find or create package
    let pkg = await Package.findOne({ name: pkgDef.name, provider: pkgDef.provider, category: pkgDef.category });
    if (!pkg) {
      pkg = await Package.create({
        ...pkgDef,
        providerId: provider._id,
        tenantId: admin._id,
        createdBy: admin._id
      });
      console.log(`Package created: ${pkgDef.name}`);
    } else {
      // Update if any field differs
      let needsUpdate = false;
      for (const key of ['description', 'isActive', 'isDeleted', 'category']) {
        if (pkg[key] !== pkgDef[key]) {
          pkg[key] = pkgDef[key];
          needsUpdate = true;
        }
      }
      if (needsUpdate) {
        await pkg.save();
        console.log(`Package updated: ${pkgDef.name}`);
      }
    }

    // Sync bundles for this package
    const existingBundles = await Bundle.find({ packageId: pkg._id });
    const scriptBundleCodes = pkgDef.bundles.map(b => b.name.replace(/\s+/g, '_').toUpperCase());

    // Remove bundles not in script
    for (const dbBundle of existingBundles) {
      const code = dbBundle.name.replace(/\s+/g, '_').toUpperCase();
      if (!scriptBundleCodes.includes(code)) {
        await dbBundle.deleteOne();
        console.log(`Bundle removed: ${dbBundle.name}`);
      }
    }

    // Add or update bundles
    for (const b of pkgDef.bundles) {
      const bundleCode = b.name.replace(/\s+/g, '_').toUpperCase();
      let bundle = await Bundle.findOne({ packageId: pkg._id, bundleCode });
      if (!bundle) {
        bundle = await Bundle.create({
          name: b.name,
          description: `${b.dataVolume}GB. Instant delivery.`,
          dataVolume: b.dataVolume,
          dataUnit: 'GB',
          validity: 'unlimited',
          validityUnit: 'unlimited',
          price: b.price,
          currency: 'GHS',
          features: [],
          bundleCode,
          category: pkgDef.category,
          tags: [pkgDef.category, pkgDef.provider.toLowerCase()],
          provider: pkgDef.provider,
          isActive: true,
          isDeleted: false,
          packageId: pkg._id,
          providerId: provider._id,
          tenantId: admin._id,
          createdBy: admin._id
        });
        console.log(`Bundle created: ${b.name}`);
      } else {
        // Update if any field differs
        let needsUpdate = false;
        for (const key of ['price', 'dataVolume', 'category']) {
          if (bundle[key] !== b[key] && b[key] !== undefined) {
            bundle[key] = b[key];
            needsUpdate = true;
          }
        }
        // Always update validity to unlimited
        if (bundle.validity !== 'unlimited' || bundle.validityUnit !== 'unlimited') {
          bundle.validity = 'unlimited';
          bundle.validityUnit = 'unlimited';
          needsUpdate = true;
        }
        if (needsUpdate) {
          await bundle.save();
          console.log(`Bundle updated: ${b.name}`);
        }
      }
    }
  }

  console.log('All packages and bundles synced!');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}); 