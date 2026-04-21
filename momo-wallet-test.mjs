#!/usr/bin/env node
// momo-wallet-test.mjs
// Run with: node momo-wallet-test.mjs

// Load .env into process.env for standalone test runs
import "dotenv/config";
import fetch from "node-fetch";

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
  console.log("\n🚀 MTN MoMo Wallet Top-Up Test");
  console.log(`   Base URL : ${BASE_URL}`);
  console.log(`   API Root : ${API_ROOT}`);
  console.log(`   Phone    : 233241111111`);
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
    body: JSON.stringify({ amount: 10, phoneNumber: "233241111111" }),
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
