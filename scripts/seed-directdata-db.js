import mongoose from "mongoose";
import bcrypt from "bcrypt";
import crypto from "crypto";
import User from "../src/models/User.js";
import Settings from "../src/models/Settings.js";

const DB_URI = "mongodb://localhost:27017/saas-ecommerce-directdata-dev";

async function seed() {
  console.log("Connecting to", DB_URI);
  await mongoose.connect(DB_URI);
  console.log("Connected.\n");

  // ── Drop existing data ──────────────────────────────────────────────
  const existingUser = await User.findOne({ email: "directadmin@test.com" });
  if (existingUser) {
    console.log("Dropping existing super admin...");
    await User.deleteOne({ email: "directadmin@test.com" });
  }

  // ── Create super admin ──────────────────────────────────────────────
  const user = await User.create({
    fullName: "DirectData Admin",
    email: "directadmin@test.com",
    phone: "+233501234567",
    password: "Admin@123",
    userType: "super_admin",
    isVerified: true,
    isFirstTime: false,
  });
  console.log("Super admin created:");
  console.log("  Email:    directadmin@test.com");
  console.log("  Password: Admin@123\n");

  // ── Create Settings + integration key ────────────────────────────────
  const rawKey = "sk_integ_" + crypto.randomBytes(32).toString("hex");
  const hashedKey = await bcrypt.hash(rawKey, 10);

  let settings = await Settings.findOne();
  if (settings) {
    console.log("Dropping existing settings...");
    await Settings.deleteOne({ _id: settings._id });
  }

  settings = await Settings.create({
    integrationKey: {
      hashedKey,
      label: "",
      createdAt: new Date(),
      regeneratedAt: null,
    },
  });

  console.log("Integration key generated:");
  console.log("  Raw key (save this now — never shown again):");
  console.log("  " + rawKey);
  console.log(`  Preview: ...${rawKey.slice(-4)}\n`);

  console.log("─".repeat(50));
  console.log("Add to PRIMARY app's Connected Apps settings:");
  console.log(`  App ID:   directdata`);
  console.log(`  Name:     DirectData`);
  console.log(`  Base URL: http://localhost:5051`);
  console.log(`  API Key:  ${rawKey}`);
  console.log("");
  console.log("IMPORTANT:");
  console.log("  - Base URL should be just the origin (no /api suffix)");
  console.log("  - The Target backend must run on port 5051");
  console.log("  - Target DB: saas-ecommerce-directdata-dev");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
