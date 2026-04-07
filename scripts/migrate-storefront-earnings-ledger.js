import "dotenv/config";
import mongoose from "mongoose";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import AgentStorefront from "../src/models/AgentStorefront.js";
import EarningsTransaction from "../src/models/EarningsTransaction.js";
import PayoutRequest from "../src/models/PayoutRequest.js";
import User from "../src/models/User.js";

function getArg(name) {
  const arg = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (!arg) return null;
  return arg.split("=").slice(1).join("=").trim();
}

function getBoolArg(name) {
  const value = getArg(name);
  if (!value) return false;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

async function askEnvironment() {
  const envArg = getArg("--env");
  if (envArg === "dev" || envArg === "prod") {
    return envArg;
  }

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("Select database (dev/prod): ");
  rl.close();

  const env = String(answer || "")
    .trim()
    .toLowerCase();

  if (env !== "dev" && env !== "prod") {
    throw new Error("Invalid environment. Use --env=dev or --env=prod.");
  }

  return env;
}

async function askToProceed(promptText) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(promptText);
  rl.close();
  return String(answer || "")
    .trim()
    .toLowerCase();
}

async function resolveDatabaseUri() {
  const directUri = getArg("--uri");
  if (directUri) return directUri;

  const env = await askEnvironment();
  if (env === "prod") {
    if (!process.env.PROD_DBURI) {
      throw new Error("PROD_DBURI is not set in .env");
    }
    return process.env.PROD_DBURI;
  }

  if (!process.env.DBURI) {
    throw new Error("DBURI is not set in .env");
  }
  return process.env.DBURI;
}

async function normalizeSources({ dryRun }) {
  const operations = [
    {
      name: "legacy storefront source -> storefront_profit",
      filter: {
        "metadata.source": "storefront_order_completed",
      },
      update: {
        $set: {
          "metadata.source": "storefront_profit",
        },
      },
    },
    {
      name: "profit credits missing source -> storefront_profit",
      filter: {
        type: "credit",
        relatedOrder: { $exists: true, $ne: null },
        $or: [
          { "metadata.source": { $exists: false } },
          { "metadata.source": null },
          { "metadata.source": "" },
        ],
      },
      update: {
        $set: {
          "metadata.source": "storefront_profit",
        },
      },
    },
    {
      name: "payout debits -> payout_requested",
      filter: {
        relatedPayout: { $exists: true, $ne: null },
        $or: [{ type: "payout" }, { type: "debit" }],
      },
      update: {
        $set: {
          type: "debit",
          "metadata.source": "payout_requested",
        },
      },
    },
    {
      name: "payout refunds -> payout_refunded",
      filter: {
        relatedPayout: { $exists: true, $ne: null },
        type: "credit",
        $or: [
          { "metadata.source": { $exists: false } },
          { "metadata.source": null },
          { "metadata.source": "" },
          { "metadata.source": "transfer_failed" },
        ],
      },
      update: {
        $set: {
          "metadata.source": "payout_refunded",
        },
      },
    },
  ];

  const results = [];

  for (const op of operations) {
    if (dryRun) {
      const matched = await EarningsTransaction.countDocuments(op.filter);
      results.push({ name: op.name, matched, modified: 0 });
      continue;
    }

    const result = await EarningsTransaction.updateMany(op.filter, op.update);
    results.push({
      name: op.name,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  }

  return results;
}

async function recomputeBalances({ dryRun }) {
  const [storefrontAgents, txUsers, payoutUsers] = await Promise.all([
    AgentStorefront.distinct("agentId"),
    EarningsTransaction.distinct("user"),
    PayoutRequest.distinct("user"),
  ]);

  const userIds = new Set();
  for (const rawId of [...storefrontAgents, ...txUsers, ...payoutUsers]) {
    if (!rawId) continue;
    userIds.add(String(rawId));
  }

  const negativeBalances = [];
  let updatedUsers = 0;

  for (const userId of userIds) {
    const objectId = new mongoose.Types.ObjectId(userId);

    const [profitAgg, withdrawnAgg] = await Promise.all([
      EarningsTransaction.aggregate([
        {
          $match: {
            user: objectId,
            type: "credit",
            "metadata.source": "storefront_profit",
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      PayoutRequest.aggregate([
        {
          $match: {
            user: objectId,
            status: "completed",
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const totalProfit = round2(profitAgg[0]?.total || 0);
    const totalWithdrawn = round2(withdrawnAgg[0]?.total || 0);
    const recomputedBalance = round2(totalProfit - totalWithdrawn);

    if (recomputedBalance < 0) {
      negativeBalances.push({
        userId,
        totalProfit,
        totalWithdrawn,
        recomputedBalance,
      });
    }

    if (!dryRun) {
      await User.updateOne(
        { _id: objectId },
        { $set: { earningsBalance: recomputedBalance } },
        { runValidators: false },
      );
    }

    updatedUsers += 1;
  }

  return {
    evaluatedUsers: userIds.size,
    updatedUsers,
    negativeBalances,
  };
}

async function main() {
  const dryRun = getBoolArg("--dry-run");
  const skipPrompt = getBoolArg("--yes");

  const uri = await resolveDatabaseUri();
  await mongoose.connect(uri);

  console.log("Connected to database.");
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);

  if (!dryRun && !skipPrompt) {
    const answer = await askToProceed(
      "This will delete legacy admin adjustment ledger entries and rewrite earnings balances. Type APPLY to continue: ",
    );
    if (answer !== "apply") {
      console.log("Aborted.");
      await mongoose.disconnect();
      return;
    }
  }

  const legacyFilter = {
    "metadata.source": { $in: ["admin_reconciliation", "admin_backfill"] },
  };

  const legacyCount = await EarningsTransaction.countDocuments(legacyFilter);
  let deletedLegacyCount = 0;

  if (!dryRun) {
    const deletion = await EarningsTransaction.deleteMany(legacyFilter);
    deletedLegacyCount = deletion.deletedCount || 0;
  }

  const normalization = await normalizeSources({ dryRun });
  const balanceResult = await recomputeBalances({ dryRun });

  const summary = {
    mode: dryRun ? "dry-run" : "applied",
    legacyEntriesFound: legacyCount,
    legacyEntriesDeleted: deletedLegacyCount,
    sourceNormalization: normalization,
    balances: {
      evaluatedUsers: balanceResult.evaluatedUsers,
      updatedUsers: balanceResult.updatedUsers,
      negativeBalanceCount: balanceResult.negativeBalances.length,
    },
    negativeBalances: balanceResult.negativeBalances,
    completedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(summary, null, 2));

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
