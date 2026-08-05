# Cross-App Wallet Transfer (Agent Self-Service)

**Date:** 2026-08-01
**Status:** Draft
**Apps Affected:** Backend, BryteLinks, Directdata (Caskmafhub & NewApp can adopt the same pattern later)

---

## Problem

An agent has wallet balance in App A (e.g., BryteLinks) but wants to run transactions in a connected App B (e.g., Directdata). Today there is no way for an agent to move their own balance between apps.

Current state:

- Each app runs the same backend codebase but has its **own database**. There is no shared identity ID; `email` and `agentCode` are unique **per DB**, and agent codes are app-prefixed (so they differ across apps).
- Cross-app management (orders + wallets) is **super_admin-only**. The admin UI calls `/api/wallet/app/:appId/...` → `crossAppBridgeWalletService` proxies with the destination's `apiKey` → destination `/api/internal/...` authenticated by `authenticateCrossAppKey`.
- The internal `top-up` / `debit` endpoints accept a **raw `userId` + amount** — full admin power, nothing scoped to a specific agent.
- Agent identity is verified **physically by admins** (some users use temporary emails), so email/OTP based identity proof is not viable.

**Goal:** Let a wallet-enabled agent transfer some or all of their wallet balance from the source app into a connected destination app — agent-initiated, admin-togglable, secure, with a full audit/accounting trail.

---

## Requirements

1. **Admin toggle** — feature is off by default; a super admin enables it per app.
2. **Agent-initiated** — the agent initiates from their wallet in the source app.
3. **Identity proof = destination login** — the agent proves ownership of the destination account by supplying the destination **security PIN** (4–6 digits) plus an identifier (email/phone/agentCode). The source backend never sees the destination password.
4. **No auto-provisioning** — the destination must already have an active, wallet-enabled account with a configured PIN. If not, the transfer fails.
5. **No fee, no amount cap** (future knobs only).
6. **Two-sided money movement** — debit the source wallet, credit the destination wallet, idempotent by reference, with rollback if the credit leg fails.
7. **Full trail** — both apps record `WalletTransaction` entries, audit logs, and a `CrossAppTransfer` ledger joined by `reference`.
8. **Admin visibility** — admins see transfer history and can keep using the existing manual top-up/debit.

---

## Architecture

```
[Agent, Source App UI]
  │ 1. opens Transfer dialog (only if admin enabled the feature)
  │    dest app + identifier (email/phone/agentCode) + security PIN + amount
  ▼
[Source Backend]  (holds dest apiKey in Settings.connectedApps)
  │ 2. POST /api/wallet/transfer        (agent JWT auth, feature-gated)
  │ 3. → dest: POST /api/internal/wallet/verify-destination
  │      dest finds user by identifier, bcrypt-compares PIN,
  │      returns { userId, transferTicket }  (5-min, purpose-locked)
  │ 4. debit source wallet (atomic, reference = crossapp_<uuid>)
  │ 5. → dest: POST /api/internal/wallet/transfer-credit
  │      dest validates ticket == userId, credits idempotently by reference
  │ 6. credit leg fails? → reverse the source debit (rollback), ledger = failed
  ▼
[Destination Backend]   → WalletTransaction(credit) + audit + CrossAppTransfer ledger
[Source Backend]        → WalletTransaction(debit)  + audit + CrossAppTransfer ledger
```

---

## 1. Settings: Feature Flag

**File:** `backend/src/models/Settings.js`

Add:

```js
crossAppWalletTransferEnabled: { type: Boolean, default: false }
```

**Files:**
- `src/services/settingsService.js` — `getCrossAppTransferSettings()` / `updateCrossAppTransferSettings()` (mask nothing sensitive; flag is just a boolean). Follows the `momoBridgeEnabled` pattern.
- `src/controllers/settingsController.js` + `src/routes/settingsRoutes.js`
  - `GET /api/settings/wallet-transfer` — any authenticated user (agents must know if the feature is on).
  - `PUT /api/settings/wallet-transfer` — `super_admin` only.

---

## 2. Source App API (Agent-Facing)

**File:** `src/routes/walletRoutes.js`, `src/controllers/walletController.js` (or a new `walletTransferController.js`)

| Route | Auth | Behavior |
|-------|------|----------|
| `GET /api/wallet/transfer/targets` | `authenticate` + `authorizeWalletUser` | Returns `[{ appId, name }]` for **enabled** connected apps (never the `apiKey`). Empty if feature off or no apps. |
| `POST /api/wallet/transfer` | `authenticate` + `authorizeWalletUser` + feature flag + rate limit | Body `{ appId, identifier, pin, amount, note? }`. Source user id comes from the JWT (`req.user.userId`), never from input. |

Validation: positive `amount`; identifier is email/phone/agentCode; PIN is 4–6 digits.

---

## 3. Internal Endpoints (on Every App; `authenticateCrossAppKey`)

**File:** `src/routes/internalRoutes.js`, new `internalWalletTransferController.js`

### `POST /api/internal/wallet/verify-destination`

Body: `{ identifier, pin }`

1. Find user by `$or: [{ email }, { phone }, { agentCode }]` (email lowercased).
2. User must exist → else 404 `Destination account not found`.
3. User must be wallet-enabled (`canHaveWallet`) and `status === "active"` → else 403.
4. If `user.requiresPinSetup || !user.securityPin` → 400 `PIN not configured` (reuses existing flag semantics — see `authService.forgotPasswordWithPin`).
5. `bcrypt.compare(pin, user.securityPin)` → mismatch → 401 `Invalid security PIN`.
6. Issue a short-lived scoped **transferTicket** (JWT, signed with the destination's `JWTSECRET`):

```js
{ userId, purpose: "wallet_transfer", scope: "credit_only" }, { expiresIn: "5m" }
```

Return `{ userId, transferTicket }`. **No access/refresh tokens are returned.**

Applied with a brute-force rate limit (e.g., `apiEndpointLimits.highFrequency`).

### `POST /api/internal/wallet/transfer-credit`

Body: `{ userId, amount, reference, ticket }`

1. Verify the `ticket`: signature, `purpose === "wallet_transfer"`, not expired, `ticket.userId === userId`.
2. Idempotency guard — if a completed credit with this `reference` already exists, return the existing transaction (unique index / `metadata.crossAppTransfer.reference`; follow the MoMo Bridge `momobridge_<ref>` pattern with reference `crossapp_<ref>`).
3. Credit via existing `walletService.creditWallet(userId, amount, description, null, { adminAction: true, crossApp: true, crossAppTransfer: { reference, fromAppId } })`.

### `GET /api/internal/wallet/transfers/:reference`

Return the status of a transfer credit (completed / not found). Used to **reconcile ambiguous outcomes** (e.g., network timeout after the credit may have succeeded).

---

## 4. Orchestration — `walletTransferService` (Source Side)

**File:** `backend/src/services/walletTransferService.js` (new)

`createTransfer(sourceUser, { appId, identifier, pin, amount, note })`:

1. `getConnectedAppByAppId(appId)` — must exist and be enabled.
2. Check `crossAppWalletTransferEnabled`.
3. Call destination `verify-destination` → `{ userId, ticket }`.
4. `reference = crossapp_<uuid>`.
5. **Debit the source wallet atomically** via `walletService.debitWallet(sourceUser._id, amount, description, null, { idempotencyKey: reference, crossAppTransfer: { ... } })`. Insufficient balance aborts here.
6. Call destination `transfer-credit`.
   - **Success** → mark transfer `completed`.
   - **Credit fails** → reverse the source debit via `walletService.creditWallet(...)` with a reversal description; mark transfer `failed`; surface the error.
   - **Ambiguous (timeout after possible success)** → leave transfer `pending`; expose a recheck path that queries destination `GET /transfers/:reference`; a small reconciliation job (or manual recheck) resolves it.
7. Persist a `CrossAppTransfer` ledger doc on the source side.

The destination also persists a best-effort `CrossAppTransfer` ledger doc (credit leg) with the same `reference` (idempotent).

---

## 5. Ledger & Audit

**File:** `backend/src/models/CrossAppTransfer.js` (new)

```
reference        (String, unique)          — crossapp_<uuid>, joins the two legs
sourceAppId, destAppId
sourceUserId, destUserId
sourceUserEmail, destUserEmail            — denormalized for the admin ledger view
amount
status            completed | failed | pending
note
sourceAppName, destAppName
createdAt, updatedAt, completedAt, error?
```

**WalletTransaction entries:**
- Source: type `debit`, description `Cross-app transfer to {destAppName} ({reference})`, `metadata.crossAppTransfer`.
- Destination: type `credit`, description `Cross-app transfer from {sourceAppName} ({reference})`, `metadata.crossAppTransfer`.

**Audit:** `logAuditAction` on both sides with a new action `WALLET_CROSS_APP_TRANSFER` (add to `src/constants/audit.js`).

**Admin UI:** a "Transfers" tab in `wallet-top-ups.tsx` (both apps) listing local `CrossAppTransfer` docs (reference, agent, destination app, amount, status, time). Manual top-up/debit stays unchanged.

---

## 6. Frontend (Both Apps, Symmetric)

**File:** `BryteLinks/src/services/wallet-service.ts` (and the Directdata equivalent)

```ts
getTransferTargets(): Promise<{ appId: string; name: string }[]>
crossAppTransfer(appId: string, data: { identifier: string; pin: string; amount: number; note?: string }): Promise<{ reference: string; status: string }>
getTransferHistory(): Promise<CrossAppTransfer[]>
```

**New component:** `BryteLinks/src/components/wallet/CrossAppWalletTransferDialog.tsx` (and Directdata equivalent)

- Fields: destination app selector, identifier (email/phone/agentCode), security PIN (masked, numeric), amount, optional note.
- Confirmation step summarizing amount + destination before submitting.
- Shows source balance; disables when insufficient.
- Error handling for all failure modes (account not found, PIN not configured, invalid PIN, insufficient balance, feature disabled, destination unreachable).

**Wiring:** shown on the agent wallet page only when the agent is wallet-enabled, the feature flag is on, and there is at least one enabled connected app. `CrossAppSwitcher` remains admin-only.

---

## 7. Security

- The destination **security PIN** flows frontend → source backend → destination backend over TLS; it is **never logged, never stored**, and masked in any log line.
- The destination password is never used — no password-harvesting exposure for the source backend.
- `transferTicket` is short-lived (5 min), purpose-locked, and bound to the exact `userId`; `transfer-credit` refuses a ticket that doesn't match the requested `userId` (prevents "verify user A, credit user B").
- The agent can only move their **own** source balance — the source userId is JWT-derived, not client-supplied.
- The destination only credits wallet-enabled, active users.
- Brute-force rate limit on `verify-destination`.
- Idempotency by `reference` on both legs; reconciliation for ambiguous outcomes.
- No new tokens are issued to the source backend; the existing integration-key trust model is unchanged.

---

## 8. Error Handling

| Case | Behavior |
|------|----------|
| Destination account not found | 404 `Destination account not found` (no auto-provisioning) |
| Destination PIN not configured | 400 `Security PIN not configured` |
| Invalid destination PIN | 401 `Invalid security PIN` |
| Destination not wallet-enabled / inactive | 403 |
| Feature disabled | 403 |
| Insufficient source balance | 400 |
| Credit leg fails | Reverse source debit; transfer `failed` |
| Credit leg ambiguous (timeout) | Transfer `pending`; reconciled via recheck / job |
| Destination app offline | 502 `Request to <app> failed` |

---

## 9. Testing

- **Settings flag:** get/update service + controller tests (super_admin gate, agent read access).
- **`verify-destination`:** user found / not found; PIN not configured; invalid PIN; non-wallet user; inactive user; ticket payload shape (userId, purpose, expiry); rate limit.
- **`transfer-credit`:** valid ticket; mismatched `userId`; expired ticket; duplicate `reference` (idempotent); delegates to `creditWallet` with correct metadata.
- **`walletTransferService`:** success; destination missing; PIN failure; credit failure → rollback; ambiguous → pending; idempotent retry.
- **Frontend:** TypeScript build clean in both apps (existing `npm run build` verification).

---

## Out of Scope (Future Knobs)

- Transfer fees / minimum / maximum amount
- Auto-provisioning destination accounts
- Multi-hop / chained transfers
- Bulk transfers
