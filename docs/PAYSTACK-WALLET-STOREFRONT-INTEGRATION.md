# Paystack — Wallet Top‑Up & Storefront Direct‑Pay Integration

Purpose
- Document a concrete implementation plan to integrate Paystack for:
  1. Agent wallet top‑ups (auto‑credit when payment confirmed).
  2. Storefront: customer pays agent directly and order is auto‑verified on successful payment.

Status: Draft — use this file as the single source of truth for development, tests and QA.

---

## 1) Executive summary ✅
- Current system: `wallet` top‑ups are *request → admin approve/reject* (`src/services/walletService.js`). Storefront orders are *customer places order → agent manually verifies payment → system debits agent wallet and order moves to processing* (`src/services/storefrontService.js`).
- Goal: add Paystack as an automated payment path so:
  - Agents can pay via Paystack to top up their wallets and the wallet is auto‑credited on Paystack confirmation.
  - Customers can pay agents (via Paystack subaccount/splits or platform routing) and the storefront order is auto‑verified by the webhook — removing manual verification.

---

## 2) Important existing loci (what we'll change) 🗺️
- Wallet flows: `src/services/walletService.js`, `src/controllers/walletController.js`, `src/models/WalletTransaction.js`, `src/routes/walletRoutes.js`.
- Storefront flows: `src/services/storefrontService.js`, `src/controllers/storefrontController.js`, `src/models/AgentStorefront.js`, `src/models/StorefrontPricing.js`, `src/models/Order.js`, `src/routes/storefrontRoutes.js`.
- Settings & configuration: `src/models/Settings.js`, `src/services/settingsService.js`, `src/controllers/settingsController.js`.
- Add new service(s): `src/services/paystackService.js` (gateway abstraction + webhook verification).
- New public webhook route: `src/routes/paystackRoutes.js` (or extend `publicRoutes.js`) — mounted in `app.js`.

---

## 3) High‑level design (both flows) 💡

A. Wallet top‑up (Paystack)
- UX: Agent requests/initiates top‑up → backend creates a WalletTransaction (status="pending") and initializes a Paystack transaction → returns `authorization_url` (or client reference) to frontend → agent completes payment → Paystack POSTs webhook → backend verifies signature → find WalletTransaction by reference → verify amount/user → credit wallet via `walletService.creditWallet()` → mark WalletTransaction `completed`.

B. Storefront direct payment (Paystack via platform account)
- UX: Customer places a storefront order → server initializes a Paystack transaction using the *platform* Paystack account (attach metadata.orderId). The public checkout **does not** set `subaccount`/`split` — customer payments land in the platform account. When Paystack posts the webhook (charge.success) the backend:
  - verifies webhook signature and metadata.orderId,
  - marks the order paid (storefrontData.paymentMethod.verified = true; paymentStatus = 'paid'; order.status = 'pending'),
  - performs a server‑side accounting split: credit the agent's wallet with the base/tier cost (so the agent can fulfill), record the agent's profit/markup as withdrawable earnings (`user.earningsBalance`), and persist Paystack fee / net amounts on the order/transaction records.
This keeps customer checkout simple and centralizes funds while preserving agent earnings as withdrawable balances.

Notes:
- Agent Paystack subaccounts remain available only for admin/manual payouts or future automatic transfers — they are *not* used to route public storefront customer payments in this design.
- Webhook handling must be idempotent and secure (signature verification + duplicate checks).

---

## 4) Data model changes (proposed diffs) 🔧

1) `WalletTransaction` (small additions in `metadata` — no breaking change):
- add `metadata.paystack = { reference, authorization_url, gateway: 'paystack', channel }`
- keep `status: 'pending' | 'completed' | 'rejected'` (existing)

2) `Order.storefrontData.paymentMethod` (extend in `src/models/Order.js`):
- support `type: 'paystack'` and add fields:
  - `gateway: 'paystack'`
  - `gatewayReference` (string)
  - `gatewayTransactionId` (string)
  - `gatewayStatus` (string)

3) `AgentStorefront` (extend `paymentMethods` in `src/models/AgentStorefront.js`):
- retain optional `paystackSubaccountId` / `paystackRecipientCode` to support agent payout onboarding and future direct transfers.
- Important: these fields are **not** used to route public storefront payments in the new flow; they only serve as payout destinations for admin/manual or future automated transfers.

4) Settings: add Paystack keys in `Settings` and expose via admin UI (kept secret in DB):
- `paystackEnabled` (bool)
- `paystackSecretKey` (string) — used to verify webhook and call Paystack APIs
- `paystackPublicKey` (string)
- `paystackWebhookSecret` (string) — optional/useful

---

## 5) API & webhook contract (new/changed endpoints) 🔗

A. Wallet top‑up (Paystack)
- POST `/api/wallet/paystack/initiate` (auth required — wallet user)
  - body: { amount: number, returnUrl?: string }
  - server: creates WalletTransaction (status: pending), calls Paystack initialize, stores metadata.paystack.reference
  - response: { authorizationUrl, reference, transactionId }

- POST `/api/webhooks/paystack` (public; verify signature)
  - handles Paystack events (charge.success, charge.failed, transfer.*)
  - finds WalletTransaction by metadata.paystack.reference
  - if charge.success & amount matches → credit wallet (atomic) and set WalletTransaction.status = 'completed'
  - idempotent: skip if already completed

- GET `/api/wallet/topup/status/:txId` (existing `walletTransaction` status check can be reused)

B. Storefront payment (Paystack)
- POST `/api/storefront/:businessName/paystack/init` (public) or return `authorizationUrl` from `createStorefrontOrder`
  - body: order details or orderId after create
  - server: initialize Paystack transaction with metadata.orderId using the *platform* account — **do not** include `subaccount` or `split` for public storefront checkout. Funds land in the platform account and the backend performs the fund split (wallet credit + agent earnings) once the webhook confirms payment.
  - response: { authorizationUrl, reference }

- Paystack webhook `/api/webhooks/paystack` handles storefront `charge.success` → validate `metadata.orderId` → update Order: set `storefrontData.paymentMethod.verified = true`, `paymentStatus = 'paid'`, `status = 'pending'`, record gatewayReference

Security: validate HMAC‑SHA512 signature (Paystack header `x-paystack-signature`) using secret.

---

## 6) Webhook processing rules & idempotency ✅
- Use `reference` (Paystack `reference`) as idempotency key.
- Steps on webhook:
  1. Verify signature (raw request body required). See note below to preserve raw body in Express.
  2. Parse event: only process `charge.success`, `transfer.success` and other needed events.
  3. Lookup WalletTransaction or Order using `metadata.reference` or `metadata.orderId`.
  4. If matching DB record exists and is `pending`, validate amount & currency.
  5. Perform atomic DB update (credit wallet OR mark order paid) inside try/catch and set record `metadata.paystack.processedAt`, `gatewayTransactionId`.
  6. If DB record already `completed`, return 200 (idempotent).
  7. On mismatch (amount/currency), create internal incident (flag transaction, notify admins).

Implementation note: add middleware to capture raw body for the webhook route:
```js
// app.js or paystackRoutes.js
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));
```
Verify Paystack signature:
```js
import crypto from 'crypto';
const signature = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.rawBody).digest('hex');
if (signature !== req.headers['x-paystack-signature']) return res.status(400).end();
```

---

## 7) Edge cases & how to handle them (very important) ⚠️
- Duplicate webhooks: detect by `reference` + record status → idempotent return 200.
- Amount mismatch: flag transaction, notify admin, do NOT auto‑credit; open manual review workflow.
- Partial payments: mark `partial` and notify agent; provide UI to accept partial or wait for completion.
- Failed payments / charge.failed: mark pending request `rejected`, notify user.
- Refunds/chargebacks: implement `charge.refunded` handler to reverse wallet credit or mark order refunded.
- Missing top‑up request (webhook with no DB mapping): create an audit entry and notify admin for reconciliation.
- Expired payment (authorization timed out): mark pending top‑up expired after TTL (e.g., 24 hours).
- Agent Paystack subaccount is *not required* for public storefront payments — storefront checkout always routes to the platform account. Agent payout onboarding (subaccounts/recipient codes) only affects direct Paystack transfers (future auto‑payouts). In the MVP agents receive earnings in‑app and request withdrawals through the payout API.

---

## 8) Tests to add (unit + integration) ✅
- Unit: `paystackService.verifySignature()` with valid/invalid payloads.
- Integration: `wallet.paystack.initiate -> simulate paystack webhook (charge.success) -> wallet balance increased` (`src/scripts/test-paystack-topup.test.js`).
- Integration: `storefront.createOrder -> initiate paystack checkout -> simulate webhook -> order auto‑verified and `paymentStatus` = 'paid'`.
- Edge case tests: duplicate webhook ignored; amount mismatch flagged; refund reverses order/payment.

---

## 9) Files to add / modify (developer checklist) 🛠️
- Add: `src/services/paystackService.js` — low‑level Paystack HTTP + webhook verify
- Add: `src/routes/paystackRoutes.js` + `src/controllers/paystackController.js` (webhook receiver)
- Modify: `src/models/WalletTransaction.js` (document `metadata.paystack` usage — no schema breaking change)
- Modify: `src/models/Order.js` — extend `storefrontData.paymentMethod` to accept `gateway` fields
- Modify: `src/models/AgentStorefront.js` — retain `paystackSubaccountId` / `paystackRecipientCode` for payout onboarding (NOT used for public checkout routing).
- Add: `src/models/PayoutRequest.js` — stores agent withdrawal requests and admin processing metadata.
- Modify: `src/models/User.js` — add `earningsBalance: Number` (default 0) to hold withdrawable profits.
- Modify: `src/services/walletService.js` — reuse `creditWallet()` for base/tier credit and add helper to record earnings ledger entries; ensure WalletTransaction `metadata.paystack` is populated on webhook credit.
- Modify: `src/services/storefrontService.js` — remove public-checkout subaccount routing in `createStorefrontOrder`; update `processPaystackOrderWebhook` to perform server‑side split (credit wallet + increment `earningsBalance`) and persist Paystack fee/net amounts.
- Modify: `src/controllers/storefrontController.js` — do not include `subaccount` when initializing Paystack for public orders; return authorizationUrl and metadata to frontend.
- Add: payout API endpoints and controller methods:
  - POST `/api/wallet/payouts/request` (agent)
  - GET `/api/wallet/payouts` (agent/admin)
  - PUT `/api/wallet/payouts/:id/approve|reject` (admin)
- Modify: frontend:
  - `saas-ecommerce/src/pages/public/public-store.tsx` — change public checkout to Paystack flow (require customer email + redirect to Paystack authorization_url).
  - `saas-ecommerce/src/pages/agent/storefront-dashboard.tsx` — show `earningsBalance` and add “Request withdrawal” UI.
  - `saas-ecommerce/src/services/storefront.service.ts` — surface Paystack init response.
- Modify: `app.js` — mount webhook route and capture raw request body for signature verification.
- Add tests: integration tests for Paystack webhook → ledger split, payout request lifecycle, duplicate webhook idempotency, and front‑end checkout redirect flow.

---

## 10) Implementation step plan (recommended order) ⏱️
1. Add `paystackService.js` (API + signature verification). (1 day)
2. Add DB/backwards compatible model fields (Order + AgentStorefront) + settings entries for Paystack keys. (0.5 day)
3. Implement `POST /api/wallet/paystack/initiate` and pending `WalletTransaction` creation. (0.5 day)
4. Implement webhook endpoint + tests for wallet top‑up flow; wire to `walletService.creditWallet()`; include idempotency and logging. (1 day)
5. Implement storefront checkout initiation + return authorization_url from createStorefrontOrder or separate endpoint. (0.5 day)
6. Extend webhook handler: on storefront charge.success → mark order paid/verified. (0.5 day)
7. Add integration tests, QA flows, and docs + admin UI settings. (1 day)
8. Rollout: behind feature toggle (`paystackEnabled` in `Settings`). (0.25 day)

Estimated total: 4–6 working days (including tests & QA).

---

## 11) Sample payloads & code snippets (useful for implementation) 🧩
A. Initialize Paystack transaction (server → Paystack):
```js
// POST https://api.paystack.co/transaction/initialize
// body: { amount: amountInCentsOrSmallestUnit, email, reference, callback_url, metadata: { userId, walletTransactionId } }
```

B. Paystack webhook verification (Node.js/Express):
```js
import crypto from 'crypto';
const raw = req.rawBody; // ensure rawBody capture
const expected = crypto.createHmac('sha512', PAYSTACK_SECRET).update(raw).digest('hex');
if (expected !== req.headers['x-paystack-signature']) return res.status(400).end();
const event = req.body; // safe to parse now
```

C. Webhook processing example (wallet top up):
- Lookup `WalletTransaction` by `metadata.paystack.reference === event.data.reference` and status `pending`.
- Validate `event.data.amount` === expected amount (note: Paystack uses the smallest currency unit)
- Call `walletService.creditWallet(userId, amount, 'Topup via Paystack', adminId=null, { metadata: { paystack: event.data } })` and set tx.status = 'completed'.

---

## 12) Acceptance criteria (QA) ✅
- Agent initiates top‑up → receives Paystack URL → completes payment → wallet balance increases automatically within 10s of webhook.
- Customer completes storefront payment → order is marked `paymentStatus: 'paid'` and `storefrontData.paymentMethod.verified = true` without manual agent verification.
- Agent `walletBalance` is credited with the base/tier amount and `user.earningsBalance` is incremented by the markup (profit) on successful Paystack charge.
- Agent can create a payout request ≤ `earningsBalance`; admin approval reduces `earningsBalance` and marks payout record accordingly.
- Ledger entries exist for wallet credit, earnings allocation and payout requests (audit trail).
- Duplicate webhooks do not double‑credit or double‑verify.
- Mismatched amounts create an incident and do not auto‑credit.
- Admin can disable Paystack via Settings and flows fall back to manual verification.

---

## 13) Migration & config (ENV / Settings) 🔐
ENV / Settings keys to add (also expose via admin `Settings` UI):
- PAYSTACK_SECRET_KEY (env) and `paystackSecretKey` in `Settings` (for live/preview keys)
- PAYSTACK_PUBLIC_KEY (env)
- PAYSTACK_WEBHOOK_SECRET (optional)
- settings flag: `paystackEnabled` (boolean)

DB migration: add `paystackSubaccountId` optional field to `AgentStorefront` (no destructive migration required).

---

## 14) Risks & mitigations 🛡️
- Risk: webhook signature handling — mitigate by using raw body and strict signature verification.
- Risk: accidental double credits — mitigate with unique Paystack reference lookup and idempotent handling.
- Risk: agent subaccount onboarding complexity — mitigate by supporting platform‑split payments first, agent subaccounts later.

---

## 15) Next steps / sprint tasks (prio ordered) 🔁
1. Create `paystackService` + test harness to simulate webhooks. 
2. Implement wallet init + webhook handler → test & QA. (must do first)
3. Implement storefront checkout + webhook auto‑verify → test & QA.
4. Add admin settings UI for Paystack keys and feature toggle.
5. Add E2E tests and monitoring/logging for webhook events.

---

## 16) Helpful references & files (where to start coding) 📚
- Wallet: `src/services/walletService.js`, `src/controllers/walletController.js`, `src/routes/walletRoutes.js`
- Storefront: `src/services/storefrontService.js`, `src/controllers/storefrontController.js`, `src/routes/storefrontRoutes.js`
- Models: `src/models/WalletTransaction.js`, `src/models/Order.js`, `src/models/AgentStorefront.js`
- Settings: `src/models/Settings.js`, `src/services/settingsService.js`
- App router: `app.js` (mount webhook route + raw body)

---

If you'd like, I can now:
1) scaffold the `paystackService` + webhook route and tests, or
2) open PR with the changes described above.

Pick one and I'll implement the next step. 🚀