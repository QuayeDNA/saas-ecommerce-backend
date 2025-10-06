/**
 * Database Backup & Restore Script
 *
 * This script creates a backup of the production MongoDB database
 * and restores it to your local development database.
 *
 * IMPORTANT: This will OVERWRITE your local database!
 *
 * Usage:
 *   node scripts/copy-prod-to-local.js
 */

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database URIs
const PROD_DB_URI =
  "mongodb+srv://AnansE:MXHs1t8F4gGTLGNe@mongodbcluster.kjbxxoj.mongodb.net/saas-ecommerce";
const LOCAL_DB_URI = "mongodb://localhost:27017/saas-ecommerce-dev";

// Backup directory
const BACKUP_DIR = path.join(__dirname, "../backups");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const BACKUP_FILE = path.join(BACKUP_DIR, `backup-${timestamp}.json`);

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("   DATABASE COPY SCRIPT: Production → Local Development");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");
console.log("⚠️  WARNING: This will OVERWRITE your local database!");
console.log("");
console.log(`📁 Backup will be saved to: ${BACKUP_FILE}`);
console.log(`🔹 Production DB: ${PROD_DB_URI.replace(/:[^:@]+@/, ":****@")}`);
console.log(`🔹 Local DB: ${LOCAL_DB_URI}`);
console.log("");

// Create backup directory if it doesn't exist
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`✅ Created backup directory: ${BACKUP_DIR}`);
}

/**
 * Get all collection names from a database
 */
async function getCollections(connection) {
  const collections = await connection.db.listCollections().toArray();
  return collections.map((c) => c.name);
}

/**
 * Backup data from production database
 */
async function backupProductionData() {
  console.log("\n📥 Step 1: Connecting to Production Database...");
  const prodConnection = await mongoose
    .createConnection(PROD_DB_URI)
    .asPromise();
  console.log("✅ Connected to production database");

  console.log("\n📋 Step 2: Fetching all collections...");
  const collections = await getCollections(prodConnection);
  console.log(
    `✅ Found ${collections.length} collections:`,
    collections.join(", ")
  );

  console.log("\n💾 Step 3: Backing up data...");
  const backup = {
    timestamp: new Date().toISOString(),
    source: "production",
    collections: {},
  };

  for (const collectionName of collections) {
    process.stdout.write(`   - ${collectionName}... `);
    const collection = prodConnection.db.collection(collectionName);
    const documents = await collection.find({}).toArray();
    backup.collections[collectionName] = documents;
    console.log(`✅ ${documents.length} documents`);
  }

  console.log("\n💾 Step 4: Saving backup to file...");
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
  console.log(`✅ Backup saved: ${BACKUP_FILE}`);
  console.log(
    `   Size: ${(fs.statSync(BACKUP_FILE).size / 1024 / 1024).toFixed(2)} MB`
  );

  await prodConnection.close();
  console.log("✅ Disconnected from production database");

  return backup;
}

/**
 * Restore data to local database
 */
async function restoreToLocal(backup) {
  console.log("\n📤 Step 5: Connecting to Local Database...");
  const localConnection = await mongoose
    .createConnection(LOCAL_DB_URI)
    .asPromise();
  console.log("✅ Connected to local database");

  console.log("\n🗑️  Step 6: Clearing existing local data...");
  const existingCollections = await getCollections(localConnection);
  for (const collectionName of existingCollections) {
    process.stdout.write(`   - Dropping ${collectionName}... `);
    await localConnection.db
      .collection(collectionName)
      .drop()
      .catch(() => {});
    console.log("✅");
  }

  console.log("\n📥 Step 7: Restoring data to local database...");
  const collectionNames = Object.keys(backup.collections);

  for (const collectionName of collectionNames) {
    const documents = backup.collections[collectionName];

    if (documents.length === 0) {
      console.log(`   - ${collectionName}: Skipped (empty)`);
      continue;
    }

    process.stdout.write(`   - ${collectionName}... `);
    const collection = localConnection.db.collection(collectionName);
    await collection.insertMany(documents);
    console.log(`✅ ${documents.length} documents`);
  }

  await localConnection.close();
  console.log("✅ Disconnected from local database");
}

/**
 * Verify the restoration
 */
async function verifyRestore() {
  console.log("\n🔍 Step 8: Verifying restoration...");
  const localConnection = await mongoose
    .createConnection(LOCAL_DB_URI)
    .asPromise();

  const collections = await getCollections(localConnection);
  console.log(`✅ Local database has ${collections.length} collections`);

  for (const collectionName of collections) {
    const count = await localConnection.db
      .collection(collectionName)
      .countDocuments();
    console.log(`   - ${collectionName}: ${count} documents`);
  }

  await localConnection.close();
}

/**
 * Main execution
 */
async function main() {
  try {
    const startTime = Date.now();

    // Step 1-4: Backup production data
    const backup = await backupProductionData();

    // Step 5-7: Restore to local
    await restoreToLocal(backup);

    // Step 8: Verify
    await verifyRestore();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(
      "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    console.log("   ✅ DATABASE COPY COMPLETED SUCCESSFULLY!");
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    console.log("");
    console.log(`⏱️  Total time: ${duration}s`);
    console.log(`📁 Backup saved: ${BACKUP_FILE}`);
    console.log(`🗄️  Local database: ${LOCAL_DB_URI}`);
    console.log("");
    console.log(
      "🎉 You can now use the production data for local development!"
    );
    console.log("");
    console.log("⚠️  REMEMBER:");
    console.log("   - Your local database now contains PRODUCTION data");
    console.log("   - Any changes you make will NOT affect production");
    console.log("   - Keep the backup file in case you need to restore again");
    console.log("");
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error("\nStack trace:", error.stack);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);
