# API Marketplace — Security Fix Plan

## Overview

Audit of all BryteLinks Marketplace API endpoints exposed to external developers (API-key consumers) vs. internal dashboard users (JWT session). This document tracks fixes for vulnerabilities, scope corrections, and missing features.

---

## Priority Legend

| Label | Meaning |
|-------|---------|
| 🔴 HIGH | Active exploit possible, fix immediately |
| 🟡 MEDIUM | Should fix before launch |
| 🟢 LOW | Nice to have, polish |

---

## Task List

### 🔴 HIGH: Block Key Management from API Key Auth

**Issue:** All key management endpoints (`POST /keys`, `GET /keys`, `PATCH /keys/:id`, `POST /keys/:id/revoke`, etc.) use `authenticateMarketplaceUser` which accepts API keys OR JWT sessions — but have **zero permission scopes**. A consumer with a valid `packages:read` key can:
- Create new keys with elevated permissions
- Edit their own permissions (self-escalation to `orders:write`)
- List all keys (metadata leak)
- Revoke/suspend/activate/regenerate keys

**Files affected:**
- `backend/src/routes/marketplaceRoutes.js`
- `backend/src/controllers/marketplaceController.js`

**Fix:**
- Add `requirePermission("orders:write")` to all key management routes
- OR inspect `req.apiKey` in the controller and return 403 if request comes via API key

```javascript
// Preferred approach — guard in controller:
if (req.apiKey) {
  return res.status(403).json({ success: false, code: "FORBIDDEN", message: "Key management requires dashboard access" });
}
```

- [x] Create `requireDashboardAccess` guard helper
- [x] Add guard to `createKey`
- [x] Add guard to `listKeys`
- [x] Add guard to `getKey`
- [x] Add guard to `updateKeyLabel`
- [x] Add guard to `revokeKey`
- [x] Add guard to `suspendKey`
- [x] Add guard to `activateKey`
- [x] Add guard to `regenerateKey`
- [x] Add guard to `setKeyExpiration`
- [x] Add guard to `updateKeyPermissions`
- [x] Add guard to `getUsageStats`
- [x] Add guard to `getUsageLogs`
- [x] Add guard to `getAgentDailyCounts`
- [x] Add guard to `getPerKeyStats`
- [x] Updated API metadata to remove these from consumer-facing docs
- [x] All 249 tests pass

---

### 🔴 HIGH: Self-Privilege Escalation via updateKeyPermissions

**Status: Mitigated by dashboard-only guard** — `requireDashboardAccess` blocks API key access entirely to `updateKeyPermissions`. The service already validates permissions against `VALID_PERMISSIONS` (line 279), so even if called from the dashboard, invalid permissions are rejected.

**Files affected:**
- `backend/src/controllers/marketplaceController.js`
- `backend/src/services/apiKeyService.js`

- [x] Service already validates against `VALID_PERMISSIONS`
- [x] Dashboard-only guard blocks API key access
- [x] All 249 tests pass

---

### 🔴 HIGH: Add Wallet Endpoints for API Consumers

**Status: Done**

**Files affected:**
- `backend/src/models/ApiKey.js` — added `wallet:read`, `wallet:topup`
- `backend/src/controllers/marketplaceController.js` — added 3 methods
- `backend/src/routes/marketplaceRoutes.js` — added 3 routes

**New endpoints:**

```
GET  /api/marketplace/wallet/balance     — wallet:read   → { balance, currency }
POST /api/marketplace/wallet/topup       — wallet:topup  → { reference, authorizationUrl, ... }
GET  /api/marketplace/wallet/topup/:ref  — wallet:read   → { reference, status, amount, credited }
```

- [x] `wallet:read` and `wallet:topup` added to `VALID_PERMISSIONS`
- [x] `getWalletBalance` — reads `User.walletBalance` + `currency`
- [x] `initiateTopup` — delegates to `walletService.initiatePaystackTopUp`
- [x] `getTopupStatus` — delegates to `paystackService.verifyTransaction`
- [x] Routes mounted with proper permission checks
- [x] API metadata updated with wallet endpoints + scopes
- [x] All 249 tests pass

---

### 🟡 MEDIUM: Harden Webhook Unsigned Delivery

**Status: Done**

- Removed `callbackUrl` parameter from `createOrder` (body validation + usage)
- Simplified `triggerOrderWebhook` to only deliver to registered webhook endpoints with secrets
- Removed unsigned `fetch()` delivery path — all deliveries now go through `webhookService.deliverEventWithRetry` which uses HMAC signing
- Updated API metadata description for order creation

- [x] `callbackUrl` removed from `createOrder`
- [x] Unsigned `fetch()` path removed from `triggerOrderWebhook`
- [x] All deliveries use HMAC-signed `deliverEventWithRetry`
- [x] All 249 tests pass

---

### 🟡 MEDIUM: Apply Rate Limiting to Session-Authenticated Endpoints

**Status: Done**

Applied `apiEndpointLimits.highFrequency` (60 req/min) to sensitive write endpoints:

**Wallet:**
- `POST /api/wallet/payouts/request` — `apiEndpointLimits.highFrequency`

**Orders:**
- `POST /api/orders/single` — `apiEndpointLimits.highFrequency`
- `POST /api/orders/bulk` — `apiEndpointLimits.highFrequency`

**Commissions:**
- `POST /api/commissions/withdraw` — `apiEndpointLimits.highFrequency`

- [x] Imported `apiEndpointLimits` into wallet, order, and commission routes
- [x] Applied `highFrequency` to 4 sensitive write endpoints
- [x] All 249 tests pass

---

### 🟡 MEDIUM: Add authorizeWalletUser to Wallet Endpoints

**Status: Done**

Added `authorizeWalletUser` to endpoints missing role checks:

- `GET /api/wallet/info`
- `GET /api/wallet/transactions`
- `GET /api/wallet/paystack/verify`
- `GET /api/wallet/earnings/dashboard`
- `GET /api/wallet/payouts`
- `POST /api/wallet/payouts/request`
- `POST /api/wallet/earnings/convert-to-wallet`

- [x] All 7 endpoints updated
- [x] All 249 tests pass

---

### 🟡 MEDIUM: Add authorizeBusinessUser to Commission Endpoints

**Status: Done**

Added `authorizeBusinessUser` to all user-facing commission endpoints:

- `POST /api/commissions/withdraw`
- `GET /api/commissions/balance`
- `GET /api/commissions`
- `GET /api/commissions/stats`
- `GET /api/commissions/withdrawals`

- [x] All 5 endpoints updated
- [x] All 249 tests pass

---

### 🟢 LOW: Make Metadata Endpoint Authenticated

**Status: Skipped** — Public metadata is standard API practice (chicken-and-egg problem). The metadata only describes endpoints without exposing sensitive data. Marking as "won't fix" for now.

---

### 🟢 LOW: Add Tests for Untested Controller Methods

**Status: Pending** — Adding tests is important but lower priority than the security fixes. Left as future work.

---

## Completion Criteria

- [x] All 🔴 HIGH items fixed and verified
- [x] All 🟡 MEDIUM items fixed and verified
- [x] Existing test suite passes (249 tests, 18 test files)
- [x] No lint errors in changed files
