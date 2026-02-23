# Paystack Implementation – Gap Analysis vs STOREFRONT_PAYMENT_PAYOUT_REVIEW.md

**Date:** February 2025  
**Purpose:** Compare current codebase to the design and checklist in `STOREFRONT_PAYMENT_PAYOUT_REVIEW.md`, plus prior findings. This document states what is done, what is missing, and what must be implemented (including payouts).

---

## 1. Document vs Current State – Summary Table

| Area | Doc / Review | Current Implementation | Status |
|------|--------------|------------------------|--------|
| **Storefront: platform-routing** | Customer pays platform; no subaccount at checkout | ✅ Controller does not pass subaccount to Paystack init | Done |
| **Storefront: server-side split** | Credit wallet (tier) + earningsBalance (markup) in one transaction | ✅ `processPaystackOrderWebhook` uses Mongo session, credits both | Done |
| **Storefront: amount charged** | Customer pays **customer total** (display price); `order.total` = that amount | ❌ `order.total` = totalTierCost; Paystack is charged tier cost only | **Bug – see §2** |
| **Storefront: webhook amount check** | Validate `data.amount === convertToPesewas(order.total)` | ❌ Validates vs sum of `storefrontData.items.totalPrice` (customer total) while charge is tier cost | **Bug – see §2** |
| **Storefront: atomic webhook** | Single Mongo transaction, idempotency, full metadata | ✅ Session + commit/abort; idempotency; metadata on order | Done |
| **User.earningsBalance** | Add field (default 0) | ✅ Present on User model | Done |
| **EarningsTransaction model** | Separate ledger; types credit/debit/**payout** | ✅ Model exists; type enum is `['credit','debit']` only | **Missing `payout` type** |
| **PayoutRequest model** | Full schema (destination, status, paystackTransfer, fees, etc.) | ❌ No `PayoutRequest.js` | **Not implemented** |
| **Payout service** | requestPayout, approvePayout, processPayoutAuto, transfer webhook, refund | ❌ No payoutService | **Not implemented** |
| **Paystack Transfers API** | initiateTransfer, createTransferRecipient, resolveAccountNumber | ❌ paystackService has none of these | **Not implemented** |
| **Webhook: transfer events** | Handle transfer.success / transfer.failed | ❌ Only charge.success / charge.failed | **Not implemented** |
| **Wallet webhook** | Idempotent, amount/currency check | ❌ `user` undefined bug; no currency check | **Bugs – see prior analysis** |
| **Payout security** | Limits, fraud hints, KYC for auto | ❌ None | **Not implemented** |
| **Earnings dashboard API** | GET /api/wallet/earnings/dashboard | ❌ No such route | **Not implemented** |
| **Admin payout review** | Review queue, approve/reject, manual ref | ❌ No PayoutRequest → no queue | **Not implemented** |
| **Webhook queue (Bull)** | Optional async processing | ❌ In-memory only | Optional later |

---

## 2. Critical Fixes (Storefront Amount & Wallet Webhook)

These must be fixed regardless of payout work.

### 2.1 Storefront: Charge Customer Full Amount and Align Webhook

**Problem (from prior analysis):**

- In `storefrontService.createStorefrontOrder`, `order.total` and `order.subtotal` are set to **totalTierCost** (agent cost).
- In `storefrontController.createStorefrontOrder`, Paystack init uses `order.total` → customer is charged **tier cost**.
- In `storefrontService.processPaystackOrderWebhook`, expected amount is derived from **customer total** (sum of `storefrontData.items[].totalPrice`).
- When there is markup, Paystack amount &lt; customer total → webhook fails with `amount_mismatch` and the customer was undercharged.

**Doc alignment:** The review’s “Improved Version” assumes `order.total` is what the customer pays and uses `expectedAmount = paystackService.convertToPesewas(order.total)`. So `order.total` must represent the **customer-facing total**.

**Required changes:**

1. **Order creation**  
   - Keep `storefrontData.totalTierCost` and `storefrontData.totalMarkup` unchanged.  
   - Set **customer-facing total** on the order:
     - Either set `order.subtotal` and `order.total` to **totalAmount** (customer total), **or**
     - Add e.g. `order.storefrontData.customerTotal = totalAmount` and use it for Paystack and webhook.
   - Recommendation: set `order.total = totalAmount` (and `order.subtotal = totalAmount`) so existing “order total” semantics mean “what the customer pays”. Use `storefrontData.totalTierCost` / `totalMarkup` only for the split.

2. **Paystack init (controller)**  
   - Use the **same** value for the amount sent to Paystack:
     - If you set `order.total = totalAmount`: keep using `order.total` for `amountPesewas`.
     - If you use a separate field: e.g. `customerTotal = order.storefrontData.customerTotal ?? order.total` and use that for `convertToPesewas(customerTotal)`.

3. **Webhook validation**  
   - Expected amount must match what you charge:
     - `expectedPesewas = convertToPesewas(order.total)` if `order.total` is customer total, **or**
     - `expectedPesewas = convertToPesewas(order.storefrontData.customerTotal)` if you use that field.
   - Keep validating `netReceived >= tierCost` (and any other existing checks).

After this, the flow matches the doc: customer is charged full price; webhook validates that amount; split (wallet + earnings) stays as today.

### 2.2 Wallet Top-Up Webhook: `user` Undefined and Currency

**Problems (from prior analysis):**

- In `walletService.processPaystackWebhook`, after crediting the user you use `user._id` and `user.walletBalance` in the “reconcile other pending” and WebSocket blocks, but the variable is never set; only `updatedUser` exists → runtime error and broken reconciliation/WS.
- No check that `data.currency === 'GHS'`.

**Required changes:**

- Use `updatedUser` (or a single `user` variable assigned from the result of `User.findByIdAndUpdate`) everywhere in that handler, including reconciliation and WebSocket.
- Add a guard: if `data.currency !== 'GHS'`, do not credit; log and optionally flag the transaction.

---

## 3. What the Doc Says vs What Exists – Detail

### 3.1 Storefront Webhook (Doc § “Enhanced Webhook Handler”)

- **Atomic transaction:** ✅ Implemented with `mongoose.startSession()` and commit/abort.
- **Idempotency:** ✅ Check on `order.storefrontData.paymentMethod?.verified`.
- **Amount validation:** ❌ Uses customer total for `expectedPesewas` while charge is tier cost → fix per §2.1.
- **Split:** ✅ tierCost to wallet, markup to earningsBalance.
- **Paystack fee / net:** ✅ You use `data.fees` and compute net; doc recommends storing full metadata → you already store `order.metadata.paystack` with fee and net.
- **Ledger entries:** ✅ WalletTransaction and EarningsTransaction created in session.
- **Doc uses `order.total` for expected amount:** So once `order.total` = customer total and Paystack init uses it, your webhook should use `order.total` (or the same field) for `expectedPesewas`.

### 3.2 EarningsTransaction (Doc § “New Model: EarningsTransaction”)

- **Exists:** ✅ `src/models/EarningsTransaction.js`.
- **Doc enum:** `['credit', 'debit', 'payout']`.
- **Current enum:** `['credit', 'debit']`.
- **Action:** Add `'payout'` to the `type` enum so payout deductions can be recorded as type `payout`.

### 3.3 PayoutRequest Model (Doc § “Enhanced PayoutRequest Model”)

- **Status:** ❌ No `PayoutRequest` model in the repo.
- **Action:** Implement the model as in the doc (or equivalent), including:
  - user, amount, currency
  - destination (type: mobile_money | bank_account; provider/phone or bankCode/accountNumber/accountName; recipientName; recipientCode)
  - status: pending | approved | processing | completed | rejected | failed
  - reviewedBy, reviewedAt, adminNotes, rejectionReason
  - paystackTransfer: transferCode, transferReference, recipientCode, status, transferredAt, failureReason
  - requestedAt, processedAt, completedAt
  - transferFee, netAmount
  - Indexes as in doc (user+status, status+requestedAt, paystackTransfer.transferCode)
  - Pre-save validation for destination fields by type

### 3.4 Payout Service (Doc § “Payout Service Implementation”)

- **Status:** ❌ No payoutService.
- **Action:** Implement a payout service that provides at least:
  - **requestPayout(userId, amount, destination)**  
    Validate balance ≥ amount, minimum payout (e.g. GHS 1 MoMo / GHS 50 bank), no other pending payout; validate destination (phone/bank); create PayoutRequest (pending); notify admin.
  - **approvePayout(payoutId, adminId, transferReference?)**  
    In a transaction: deduct earningsBalance, create EarningsTransaction (type `payout`, negative amount), set payout status to approved (and completed if manual ref provided).
  - **processPayoutAuto(payoutId)**  
    When payout is approved: create/get Paystack recipient, call initiateTransfer, set status to processing, store paystackTransfer on PayoutRequest.
  - **createPaystackRecipient(payout)**  
    Build payload from destination (mobile_money vs nuban), call Paystack, return recipient_code; cache on payout.destination.recipientCode.
  - **validateDestination(destination)**  
    MoMo: Ghana phone format and network match (MTN/VOD/ATL). Bank: call resolveAccountNumber, set recipientName.
  - **handleTransferWebhook(event)**  
    On transfer.success: set payout completed, notify agent. On transfer.failed: set failed, call refundFailedPayout (credit earningsBalance back + EarningsTransaction), notify agent.
  - **refundFailedPayout(payout)**  
    Atomic: $inc earningsBalance by payout.amount, create EarningsTransaction credit linked to payout.

The doc’s code is a good reference; adapt to your project structure (e.g. mongoose import, logger, notification calls).

### 3.5 Paystack Service – Transfers API (Doc § “Add Paystack Transfers API methods”)

- **Status:** ❌ paystackService has no transfer methods.
- **Action:** Add and use in payoutService:
  - **createTransferRecipient(data)**  
    POST `/transferrecipient`; payload by type (mobile_money: account_number, bank_code MTN/VOD/ATL; nuban: account_number, bank_code). Return recipient_code.
  - **initiateTransfer({ source, amount, recipient, reference, reason })**  
    POST `/transfer`; amount in pesewas; return transfer_code etc.
  - **resolveAccountNumber(accountNumber, bankCode)**  
    GET resolve account; return account_name for validation and recipient name.

Doc notes transfer pricing: MoMo GHS 1, Bank GHS 8 per successful transfer; implement minimum thresholds or fee deduction as in doc.

### 3.6 Webhook: Transfer Events (Doc § “Handle Paystack transfer webhook”)

- **Status:** paystackController only handles `charge.success` and `charge.failed`.
- **Action:** In the same webhook handler (after signature verification), add:
  - `transfer.success` → payoutService.handleTransferWebhook(event)
  - `transfer.failed` → payoutService.handleTransferWebhook(event)

So that payout status and refunds are updated automatically.

### 3.7 Payout Security (Doc § “Payout Security Controls” & “Fraud Detection”)

- **Status:** Not implemented.
- **Action (Phase 1–2):**  
  - Enforce minimum payout (e.g. GHS 1 MoMo, GHS 50 bank) and “max payout ≤ earningsBalance”.  
  - Optional but recommended: daily limit (e.g. amount and count) and “one pending payout per user” (you already prevent duplicate pending in the doc’s requestPayout).  
- **Later (Phase 3):** Fraud hints (e.g. new destination, large % of balance, velocity) and optional KYC for auto-payout as in doc.

### 3.8 Earnings Dashboard & Admin Payout UI (Doc § “Agent Earnings Dashboard” & “Admin Dashboard”)

- **Status:** No earnings or payout routes.
- **Action:**
  - **Agent:**  
    - GET `/api/wallet/earnings/dashboard` (or under `/api/wallet`) returning availableBalance (earningsBalance), walletBalance, totalEarned, totalWithdrawn, recentPayouts, canRequestPayout.  
    - GET `/api/wallet/payouts` (list own payout requests).  
    - POST `/api/wallet/payouts/request` (body: amount, destination) → calls payoutService.requestPayout.
  - **Admin:**  
    - GET `/api/admin/payouts/review-queue` or `/api/payouts/pending` (list pending PayoutRequests with user info).  
    - PUT `/api/payouts/:id/approve` (body optional: transferReference for manual).  
    - PUT `/api/payouts/:id/reject` (body: rejectionReason).  
    - Optional: POST `/api/payouts/:id/process` to trigger processPayoutAuto after approval.

### 3.9 Webhook Queue (Doc § “Webhook Processing Queue”)

- **Status:** Not implemented; webhook runs in request.
- **Action:** Optional for later. Doc suggests Bull: verify signature, enqueue payload, return 200, then process charge/transfer in worker. Helps with timeout and retries; not required for MVP.

---

## 4. Implementation Checklist (Consolidated)

### 4.1 Critical (Do First)

- [ ] **Storefront amount:** Set customer-facing total (e.g. `order.total = totalAmount`) and use it for Paystack init and webhook expected amount; keep split logic as is (§2.1).
- [ ] **Wallet webhook:** Fix `user` → `updatedUser` and add GHS currency check (§2.2).

### 4.2 Earnings & Ledger

- [ ] **EarningsTransaction:** Add `'payout'` to `type` enum.

### 4.3 Payout – Models & Core

- [ ] **PayoutRequest:** Create model per doc (destination, status, paystackTransfer, transferFee, netAmount, indexes, validation).
- [ ] **paystackService:** Add createTransferRecipient, initiateTransfer, resolveAccountNumber (GHS: MoMo MTN/VOD/ATL, bank codes).
- [ ] **payoutService:** Implement requestPayout, approvePayout, processPayoutAuto, createPaystackRecipient, validateDestination, handleTransferWebhook, refundFailedPayout.
- [ ] **Paystack webhook:** Handle transfer.success and transfer.failed and call payoutService.handleTransferWebhook.

### 4.4 Payout – APIs & UX

- [ ] **Agent:** GET earnings dashboard, GET own payouts, POST payout request (with destination validation).
- [ ] **Admin:** GET payout review queue, PUT approve (optional manual ref), PUT reject.
- [ ] **Frontend:** Storefront dashboard shows earningsBalance and “Request payout”; form for amount + destination (MoMo/bank); list of payout statuses.

### 4.5 Optional / Later

- [ ] Payout limits (daily amount/count) and fraud hints.
- [ ] Bull (or similar) queue for webhook processing.
- [ ] KYC and auto-payout (Phase 3 in doc).

---

## 5. Phasing (From the Doc)

- **Phase 1 (MVP):** Platform-routing storefront payments ✅ (after amount fix); earningsBalance ✅; EarningsTransaction ✅ (add payout type); **manual payout only**: PayoutRequest + request/approve/reject + admin records transfer reference manually.
- **Phase 2:** Paystack Transfers API in paystackService; “Approve & Pay” triggers processPayoutAuto; transfer webhooks update status and refund on failure.
- **Phase 3:** KYC, auto-approve rules, batch processing, full auto-payout (doc: 6+ months in).

---

## 6. References

- **Design & checklist:** `saas-ecommerce-backend/docs/STOREFRONT_PAYMENT_PAYOUT_REVIEW.md`
- **Wallet/storefront integration:** `PAYSTACK-WALLET-STOREFRONT-INTEGRATION.md`, `STOREFRONT-PAYMENTS-AND-AGENT-PAYOUTS.md`
- **Current code:**  
  - Storefront: `storefrontService.createStorefrontOrder`, `processPaystackOrderWebhook`; `storefrontController.createStorefrontOrder`  
  - Wallet: `walletService.processPaystackWebhook`  
  - Paystack: `paystackService.js`, `paystackController.handleWebhook`

This gap analysis should be used together with the prior Paystack front/back findings (storefront amount bug, wallet `user` bug, currency check, verify endpoint hardening, frontend Paystack availability) so that payment and payout are both correct and complete.
