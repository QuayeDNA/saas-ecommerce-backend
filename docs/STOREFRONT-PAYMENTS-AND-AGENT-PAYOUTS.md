# Storefront Payments & Agent Payouts — spec

Purpose
- Separate, focused specification that replaces the current *public‑storefront → agent subaccount* routing idea with a safer, auditable platform‑routing + agent earnings/payout workflow.
- Explains existing implementation, what will be removed, and the exact changes to add (API, DB, backend logic, frontend, tests, and rollout).

Status: Proposal (draft) — intended to be implemented after the updated Paystack integration doc changes.

---

## Executive summary (short)
- Public storefront customer payments will be collected into the platform's Paystack account (no `subaccount` routing for public checkout).
- On Paystack confirmation, the backend will:
  1. mark order as paid, and
  2. perform a server‑side fund split: credit agent's wallet with the base/tier cost and record the agent's profit (markup) as `earningsBalance` (withdrawable).
- Agents withdraw earnings via an in‑app payout request (admin reviews and marks complete). Agent Paystack subaccounts remain for future automatic payouts but are not used for public checkout.

---

## Current implementation (what the codebase already has)
- Agent subaccount creation
  - File: `src/services/storefrontService.js` → `createPaystackSubaccount(userId)` — creates and persists `paystackSubaccountId` on `AgentStorefront`.
- Public storefront order + Paystack init
  - File: `src/controllers/storefrontController.js` → `createStorefrontOrder` currently *may include* `subaccount` when `order.storefrontData.paystackSubaccountId` is present.
- Webhook handling
  - File: `src/services/storefrontService.js` → `processPaystackOrderWebhook(event)` marks orders paid but does not split funds into wallet/earnings automatically (order is transitioned to `pending`).
- Wallet + commissions
  - Wallet flows exist (`walletService.creditWallet` / `debitWallet`) and commission calculation routines exist (`commissionService`).


## What will be removed / deprecated
- Remove usage of `paystackSubaccountId` (or `split`) for *public storefront checkout routing* — public checkout will no longer route customer funds directly into agent subaccounts.
- Deprecate any frontend guidance that suggests public customers can pay directly to agent Paystack subaccounts.


## What will be added (high level)
1. Server‑side split on successful Paystack webhook (storefront charge.success):
   - credit agent wallet with base/tier cost (so agent can fulfill),
   - record agent profit (markup) in `user.earningsBalance` (withdrawable),
   - persist transaction ledger entries and Paystack fee metadata.
2. `earningsBalance` on `User` model and `PayoutRequest` model + endpoints for agent payout lifecycle.
3. Frontend changes: public checkout uses Paystack (redirect to authorization_url) and agent dashboard shows earnings + request payout UI.
4. Admin panel: list/approve/reject payout requests; optional manual Paystack transfer recording.


## Detailed flow (public storefront → payout ledger)
1. Customer fills storefront checkout (must include email for Paystack customer creation).
2. Frontend calls backend (POST /api/storefront/:businessName/order) with paymentMethod.type = `'paystack'` or uses `createPublicOrder` which returns a Paystack `authorization_url`.
3. Backend initializes Paystack transaction via `paystackService.initializeTransaction({ email, amount, reference, metadata: { orderId } })` — **no** `subaccount` or `split` is passed.
4. Customer completes payment on Paystack.
5. Paystack posts `charge.success` webhook to `/api/webhooks/paystack` (server verifies signature).
6. Backend (idempotent):
   - validate amount and metadata.orderId,
   - mark order.storefrontData.paymentMethod.verified = true; order.paymentStatus = 'paid'; order.status = 'pending',
   - compute baseAmount = totalTierCost, profit = totalMarkup,
   - credit agent wallet: `walletService.creditWallet(agentId, baseAmount, ...)` (creates WalletTransaction),
   - increment `user.earningsBalance += profit` and record an earnings transaction (audit),
   - store paystack details (reference, transactionId, fee, net) in order.metadata.paystack.
7. Notify agent + admins; order enters standard processing queue.


## Payout (withdrawal) MVP
- Agent requests payout via POST `/api/wallet/payouts/request` specifying amount (<= earningsBalance) and destination (bank details on profile or Paystack subaccount if present).
- Request is `pending` until admin approves/rejects.
- On approval admin either: (A) performs external Paystack transfer / bank transfer, then marks payout `completed` and records `transferRef`, or (B) (future) system performs automatic Paystack transfer when agent has a validated Paystack recipient/subaccount.
- Approve flow deducts `earningsBalance` atomically and creates a WalletTransaction/Payout ledger entry.


## Data model changes (summary)
- User model (`src/models/User.js`): add `earningsBalance: { type: Number, default: 0 }`.
- New model: `PayoutRequest` — fields: user, amount, currency, destination (bank / paystackRecipient), status, adminNotes, createdAt, processedAt, transferRef, metadata.
- WalletTransaction: reuse and populate `metadata.paystack` for webhook reconciliations.
- Order.model: extend `storefrontData.paymentMethod` with gateway fields (gateway, gatewayReference, gatewayTransactionId, gatewayStatus) and store `metadata.paystack` (fee/net).
- AgentStorefront: keep `paystackSubaccountId` but mark as payout-only (not for public checkout routing).


## API endpoints (new / changed)
- POST `/api/storefront/:businessName/order` — returns Paystack `authorization_url` when paymentMethod.type === 'paystack'.
- POST `/api/webhooks/paystack` — unified webhook that handles charge.success for wallet top‑ups and storefront orders.
- POST `/api/wallet/payouts/request` — agent requests withdrawal.
- GET `/api/wallet/payouts` — list requests (agent/admin views differ by role).
- PUT `/api/wallet/payouts/:id/approve` — admin approves (records transferRef / deducts earningsBalance).
- PUT `/api/wallet/payouts/:id/reject` — admin rejects and optionally returns earningsBalance.


## Frontend changes (summary)
- `public-store.tsx` — implement Paystack redirect flow (require customer email), remove manual `transactionRef` input for customer mobile‑money checks.
- `storefront-dashboard.tsx` — show `earningsBalance` and add “Request withdrawal” modal; show payout request status.
- Wallet page — show earnings ledger + payout history.


## Tests to add
- Integration: Paystack webhook → verify order paid + wallet credited + earningsBalance incremented.
- Unit: idempotent webhook handling (duplicate event ignored).
- Integration: payout request lifecycle (create → approve → earningsBalance changes) and rejected flows.
- E2E: public checkout → redirect to Paystack (test harness) → webhook simulation → final order state.


## Security / compliance notes
- Webhook signature verification (HMAC SHA‑512) is mandatory — use raw request body capture.
- KYC & Paystack Transfers: automatic transfers to agents require recipient verification (KYC) on Paystack — keep payout request MVP manual to avoid KYC complexity.
- Persist Paystack fee & net amounts to support later changes (fee allocation to platform/agent).


## Migration & rollout
1. Add `earningsBalance` to `User` (default 0) — no destructive migration required.
2. Deploy Paystack webhook + admin UI behind `paystackEnabled` feature flag in `Settings`.
3. QA in staging with Paystack test keys + ngrok webhook forwarding.
4. Monitor webhooks and reconcile ledger for first 24–72 hours post‑release.


## Developer checklist (prioritized)
1. Implement `paystackService` webhook verify + init helper.
2. Update `createStorefrontOrder` to initialize Paystack via **platform account** and return authorization_url (no `subaccount`).
3. Update `processPaystackOrderWebhook` to perform server‑side split (credit wallet + earningsBalance) and write ledger entries.
4. Add `PayoutRequest` model + API endpoints + controller + validations.
5. Add frontend UI: public-store checkout redirect; dashboard earnings & payout modal.
6. Add tests (integration + unit + E2E) and update docs.
7. Add admin UI for payout review and transfer logging.


## Rollback strategy
- Toggle `paystackEnabled` off (Settings) so storefronts fall back to manual payment verification.
- Reconcile any partially processed webhooks manually using persisted `metadata.paystack` values.


---

If you want, I can now:
- implement the backend webhook + server‑side split and unit tests, or
- scaffold the payout request model + endpoints and frontend UI next.

Choose which implementation task to start with. 👇