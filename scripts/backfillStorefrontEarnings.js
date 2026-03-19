#!/usr/bin/env node
// scripts/backfillStorefrontEarnings.js
//
// One-time recovery script: credits EarningsTransaction records for all
// completed storefront orders that have no corresponding earnings entry.
//
// Based on production data: 15 completed orders, totalProfit GH₵6.70 across
// multiple agents — all missing from EarningsTransaction.
//
// Safe to run multiple times — idempotency guard skips already-credited orders.
//
// Usage:
//   node --experimental-vm-modules scripts/backfillStorefrontEarnings.js

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import Order from "../src/models/Order.js";
import EarningsTransaction from "../src/models/EarningsTransaction.js";
import AgentStorefront from "../src/models/AgentStorefront.js";
import User from "../src/models/User.js";

async function creditProfit(order) {
  const markup = Number(order.storefrontData?.totalMarkup) || 0;

  if (markup <= 0) {
    return { skipped: true, reason: "zero_markup" };
  }

  // Primary idempotency: check ledger
  const already = await EarningsTransaction.findOne({
    relatedOrder: order._id,
    type: "credit",
  });
  if (already) {
    // Ensure flag is in sync
    await Order.findByIdAndUpdate(order._id, {
      "metadata.profitCredited": true,
    }).catch(() => {});
    return { skipped: true, reason: "already_credited" };
  }

  // Resolve agentId
  let agentId = order.createdBy;
  if (order.storefrontData?.storefrontId) {
    const sf = await AgentStorefront.findById(order.storefrontData.storefrontId)
      .select("agentId")
      .lean();
    if (sf?.agentId) agentId = sf.agentId;
  }
  if (!agentId) return { skipped: true, reason: "no_agent_id" };

  // Atomic credit
  const updatedUser = await User.findByIdAndUpdate(
    agentId,
    { $inc: { earningsBalance: markup } },
    { new: true, runValidators: false },
  );
  if (!updatedUser) return { skipped: true, reason: "agent_not_found" };

  await EarningsTransaction.create({
    user: agentId,
    type: "credit",
    amount: markup,
    balanceAfter: updatedUser.earningsBalance,
    description: `[BACKFILL] Storefront profit — Order ${order.orderNumber}`,
    relatedOrder: order._id,
    metadata: {
      backfill: true,
      orderNumber: order.orderNumber,
      totalTierCost: order.storefrontData?.totalTierCost,
      totalMarkup: markup,
      storefrontId: order.storefrontData?.storefrontId?.toString(),
      source: "backfill_script",
    },
  });

  // Mark order
  await Order.findByIdAndUpdate(order._id, {
    "metadata.profitCredited": true,
  }).catch(() => {});

  return {
    credited: true,
    agentId: agentId.toString(),
    markup,
    newBalance: updatedUser.earningsBalance,
  };
}

async function run() {
  const dbUri = process.env.MONGODB_URI || process.env.DBURI;
  if (!dbUri) {
    console.error("Missing database URI. Set MONGODB_URI or DBURI in .env.");
    process.exit(1);
  }

  await mongoose.connect(dbUri);
  console.log("✅ Connected to MongoDB\n");

  const orders = await Order.find({
    orderType: "storefront",
    status: "completed",
  })
    .select("_id orderNumber storefrontData createdBy metadata")
    .lean();

  console.log(`Found ${orders.length} completed storefront orders to check.\n`);

  let credited = 0,
    skipped = 0,
    failed = 0,
    totalCredited = 0;

  for (const order of orders) {
    try {
      const result = await creditProfit(order);
      if (result.credited) {
        credited++;
        totalCredited += result.markup;
        console.log(
          `  ✓ ${order.orderNumber.padEnd(15)} GH₵${result.markup.toFixed(2).padStart(6)} → agent ${result.agentId} (balance now GH₵${result.newBalance.toFixed(2)})`,
        );
      } else {
        skipped++;
        console.log(
          `  - ${order.orderNumber.padEnd(15)} skipped (${result.reason})`,
        );
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ ${order.orderNumber} — ERROR: ${err.message}`);
    }
  }

  console.log(`\n${"─".repeat(55)}`);
  console.log(
    `Credited: ${credited} orders  |  GH₵${totalCredited.toFixed(2)} total`,
  );
  console.log(`Skipped:  ${skipped} orders`);
  console.log(`Failed:   ${failed} orders`);

  if (failed > 0) {
    console.log("\n⚠️  Some orders failed — check logs and re-run the script.");
    process.exit(1);
  }

  console.log(
    "\n✅ Backfill complete. Agents' earnings balances are now up to date.",
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Backfill script crashed:", err);
  process.exit(1);
});
