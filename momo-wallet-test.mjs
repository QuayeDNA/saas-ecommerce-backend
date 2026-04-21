#!/usr/bin/env node
// momo-wallet-test.mjs
// Run with: node momo-wallet-test.mjs

// Load .env into process.env for standalone test runs
import "dotenv/config";
import fetch from "node-fetch";

import fs from "fs/promises";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "node:process";

const CONFIG_FILE = path.resolve(process.cwd(), ".momo-sandbox.json");

const SANDBOX_SCENARIOS = {
  failed: "46733123450",
  rejected: "46733123451",
  timeout: "46733123452",
  success: "56733123453",
  pending: "46733123454",
};

async function loadSandboxConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

async function saveSandboxConfig(cfg) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  args.forEach((a) => {
    if (a.startsWith("--msisdn=")) out.msisdn = a.split("=")[1];
    else if (a.startsWith("--scenario=")) out.scenario = a.split("=")[1];
    else if (a === "--list-scenarios") out.list = true;
    else if (a === "--clear-config") out.clear = true;
    else if (a === "--save") out.save = true;
    else if (a === "--help" || a === "-h") out.help = true;
  });
  return out;
}

async function interactiveSelectScenario() {
  const keys = Object.keys(SANDBOX_SCENARIOS);
  const rl = readline.createInterface({ input, output });
  console.log("\nSelect MTN sandbox scenario/number:");
  keys.forEach((k, i) =>
    console.log(`${i + 1}) ${k} -> ${SANDBOX_SCENARIOS[k]}`),
  );
  const answer = await rl.question(`Choose number (1-${keys.length}): `);
  rl.close();
  const idx = parseInt(answer, 10) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= keys.length) {
    throw new Error("Invalid selection");
  }
  const key = keys[idx];
  return { key, msisdn: SANDBOX_SCENARIOS[key] };
}

const BASE_URL = "http://localhost:5050/api/wallet";
// API root derived from wallet route so auth path is predictable
const API_ROOT = BASE_URL.replace(/\/api\/wallet\/?$/, "");

const HEADERS = {
  "Content-Type": "application/json",
};

async function getAuthToken() {
  const email = process.env.TEST_AUTH_EMAIL || process.env.AUTH_EMAIL;
  const password = process.env.TEST_AUTH_PASSWORD || process.env.AUTH_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Missing credentials: set TEST_AUTH_EMAIL and TEST_AUTH_PASSWORD (or AUTH_EMAIL/AUTH_PASSWORD)",
    );
  }

  const res = await safeFetch(`${API_ROOT}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error(`Auth failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

function log(step, label, data) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`STEP ${step}: ${label}`);
  console.log("=".repeat(60));
  console.log(JSON.stringify(data, null, 2));
}

async function safeFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, body: json };
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollVerify(referenceId, maxAttempts = 6, intervalMs = 5000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const verify = await safeFetch(`${BASE_URL}/momo/verify/${referenceId}`, {
      headers: HEADERS,
    });
    log(3, `GET /wallet/momo/verify/${referenceId} (attempt ${attempt})`, {
      status: verify.status,
      body: verify.body,
    });

    if (verify.ok) {
      return verify;
    }

    const message = verify.body?.message || "";
    if (
      message.includes("Payment not yet successful") ||
      message.includes("PENDING")
    ) {
      console.log(
        `\n⏳ Attempt ${attempt} - payment still pending, retrying in ${intervalMs / 1000}s...`,
      );
      if (attempt < maxAttempts) await wait(intervalMs);
      continue;
    }

    throw new Error(`Verification failed: ${message || verify.status}`);
  }

  throw new Error(`Verification timed out after ${maxAttempts} attempts.`);
}

async function runTest() {
  const args = parseArgs();

  if (args.help) {
    console.log(
      "Usage: node momo-wallet-test.mjs [--msisdn=NUMBER] [--scenario=success|failed|rejected|timeout|pending] [--save] [--list-scenarios] [--clear-config]",
    );
    return;
  }

  const cfg = await loadSandboxConfig();
  if (args.clear) {
    try {
      await fs.unlink(CONFIG_FILE);
      console.log(`Cleared saved config (${CONFIG_FILE})`);
    } catch {
      // ignore
    }
    return;
  }

  if (args.list) {
    console.log("Available sandbox scenarios:");
    Object.entries(SANDBOX_SCENARIOS).forEach(([k, v]) =>
      console.log(` - ${k}: ${v}`),
    );
    return;
  }

  // Determine which MSISDN to use
  let chosenMsisdn;
  let chosenScenarioKey = cfg?.scenario || null;
  if (args.msisdn) {
    chosenMsisdn = args.msisdn;
    if (args.save)
      await saveSandboxConfig({
        msisdn: chosenMsisdn,
        scenario: null,
        savedAt: new Date().toISOString(),
      });
  } else if (args.scenario && SANDBOX_SCENARIOS[args.scenario]) {
    chosenScenarioKey = args.scenario;
    chosenMsisdn = SANDBOX_SCENARIOS[args.scenario];
    if (args.save)
      await saveSandboxConfig({
        msisdn: chosenMsisdn,
        scenario: chosenScenarioKey,
        savedAt: new Date().toISOString(),
      });
  } else if (cfg && cfg.msisdn) {
    chosenMsisdn = cfg.msisdn;
    chosenScenarioKey = cfg.scenario || chosenScenarioKey;
  } else {
    // interactive selection (and save selection)
    try {
      const sel = await interactiveSelectScenario();
      chosenMsisdn = sel.msisdn;
      chosenScenarioKey = sel.key;
      await saveSandboxConfig({
        msisdn: chosenMsisdn,
        scenario: chosenScenarioKey,
        savedAt: new Date().toISOString(),
      });
      console.log(`Saved selection to ${CONFIG_FILE}`);
    } catch (err) {
      console.error("No valid selection made:", err.message);
      return;
    }
  }

  console.log("\n🚀 MTN MoMo Wallet Top-Up Test");
  console.log(`   Base URL : ${BASE_URL}`);
  console.log(`   API Root : ${API_ROOT}`);
  console.log(
    `   Phone    : ${chosenMsisdn} ${chosenScenarioKey ? `(${chosenScenarioKey})` : "(custom)"}`,
  );
  console.log(`   Amount   : 10`);

  // Acquire auth token and attach to headers
  let token;
  try {
    token = await getAuthToken();
    HEADERS.Authorization = `Bearer ${token}`;
    console.log(
      "\n🔐 Auth token acquired (truncated):",
      `${token.substring(0, 20)}...`,
    );
  } catch (err) {
    console.error("\n❌ Failed to obtain auth token:", err.message);
    return;
  }

  // STEP 1: Check current wallet balance
  const walletBefore = await safeFetch(`${BASE_URL}/info`, {
    headers: HEADERS,
  });
  log(1, "GET /wallet/info (BEFORE top-up)", {
    status: walletBefore.status,
    body: walletBefore.body,
  });

  if (!walletBefore.ok) {
    console.error(
      "\n❌ Auth failed or wallet endpoint not found. Stopping test.",
    );
    return;
  }

  const balanceBefore = walletBefore.body?.wallet?.balance ?? "unknown";
  console.log(`\n💰 Balance BEFORE: GH₵${balanceBefore}`);

  // STEP 2: Initiate MoMo RequestToPay
  const initiate = await safeFetch(`${BASE_URL}/momo/initiate`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ amount: 10, phoneNumber: chosenMsisdn }),
  });
  log(2, "POST /wallet/momo/initiate", {
    status: initiate.status,
    body: initiate.body,
  });

  if (!initiate.ok) {
    console.error(
      "\n❌ Initiate failed. Check mtnMomoService is wired up and credentials are correct.",
    );
    return;
  }

  const referenceId = initiate.body?.referenceId;
  if (!referenceId) {
    console.error(
      "\n❌ No referenceId in response. Cannot proceed to verify step.",
    );
    return;
  }

  console.log(`\n📋 Reference ID: ${referenceId}`);
  console.log(`\n⏳ Polling verification for up to ${5 * 6} seconds...`);

  let verify;
  try {
    verify = await pollVerify(referenceId, 6, 5000);
  } catch (err) {
    console.error(`\n❌ Verification failed: ${err.message}`);
    console.log(`\n   Retry manually:`);
    console.log(
      `   curl -H "Authorization: Bearer ${token}" ${BASE_URL}/momo/verify/${referenceId}`,
    );
    return;
  }

  console.log("\n✅ Wallet top-up verified and credited successfully");

  // STEP 4: Confirm new balance
  await wait(1000);
  const walletAfter = await safeFetch(`${BASE_URL}/info`, { headers: HEADERS });
  log(4, "GET /wallet/info (AFTER top-up)", {
    status: walletAfter.status,
    body: walletAfter.body,
  });

  const balanceAfter = walletAfter.body?.wallet?.balance ?? "unknown";
  console.log(`\n✅ RESULT SUMMARY`);
  console.log(`   Balance BEFORE : GH₵${balanceBefore}`);
  console.log(`   Balance AFTER  : GH₵${balanceAfter}`);
  console.log(
    `   Difference     : GH₵${(parseFloat(balanceAfter) - parseFloat(balanceBefore)).toFixed(2)}`,
  );
  console.log(`   Reference ID   : ${referenceId}`);
}

runTest().catch((err) => {
  console.error("\n💥 Unhandled error:", err.message);
});
