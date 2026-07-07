# MTN New Number Order Restriction

**Date:** 2026-07-06
**Status:** Draft

## Problem

MTN provider updated their policies to limit orders to existing customers only. New (previously unseen) numbers take significantly longer to process or get rejected outright. The system should proactively reject orders with new MTN numbers at creation time instead of accepting them only to fail later.

## Solution

A super admin toggle that, when enabled, checks every order's customer phone number against a known allowlist of MTN numbers. Numbers not on the list are rejected with a clear message at order creation.

## Architecture

### 1. Settings Toggle

**File:** `src/models/Settings.js`

Add one field to the existing Settings singleton document:

```js
mtnOrderRestrictionEnabled: {
  type: Boolean,
  default: false,
}
```

When `false` (default), no check is performed — existing behavior unchanged.

### 2. KnownMtnNumber Model (New)

**File:** `src/models/KnownMtnNumber.js`

A lean model with a single indexed field — the normalized phone number:

```js
const knownMtnNumberSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  importedAt: {
    type: Date,
    default: Date.now,
  },
});
```

- The `phone` field stores numbers in normalized format (digits only, `0` prefix, no `+233`).
- Unique index prevents duplicate entries.
- Indexed for O(1) `exists()` lookups per order.

### 3. API Endpoints

All under super_admin authentication:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings/mtn-restriction` | Get toggle state + stats |
| `PUT` | `/api/settings/mtn-restriction` | Update toggle state |
| `POST` | `/api/settings/mtn-numbers/import` | Import numbers (TXT body, one per line) |
| `GET` | `/api/settings/mtn-numbers/stats` | Count of known numbers |

**Import endpoint** accepts raw `text/plain` body. Normalizes each line, bulk-inserts with `ordered: false` — duplicate keys are silently skipped. Returns `{ imported: N, skipped: M }`.

### 4. Validation at Order Creation

Three injection points, all following the same pattern:

```
if (settings.mtnOrderRestrictionEnabled) {
  const exists = await KnownMtnNumber.exists({ phone: normalizedPhone });
  if (!exists) {
    throw new Error(
      "Due to updated provider policies, new numbers cannot have their orders processed."
    );
  }
}
```

#### 4a. `orderService.createSingleOrder()`

- Single `customerPhone` per order.
- If number is not on the allowlist → throw error → order not created → 400 response with message.

#### 4b. `orderService.createBulkOrders()`

- Multiple numbers in a single bulk payload.
- **Validate ALL numbers first** before any wallet debit or order creation.
  - Numbers on allowlist → proceed to normal creation.
  - Numbers not on allowlist → mark as `skipped` in the bulk response.
- The bulk response already has a per-item results structure. Add a `skipped: true` and error message for failed items.
- Behavior: partial acceptance — some items are created, some are skipped.

#### 4c. `storefrontService.createStorefrontOrder()`

- Items in `storefrontData.items[]` each have a `customerPhone`.
- Storefront orders are single-customer interactions — if any item has a new number, reject the **entire order** (no partial acceptance).
- Throw error → order not created → customer sees the message.

### 5. Error Message

All environments return the same message:

> "Due to updated provider policies, new numbers cannot have their orders processed."

No differentiation between new MTN numbers vs other errors to avoid information leakage.

### 6. Initial Population

Run a one-time script or curl command to import the extracted `saas-ecommerce-mtn-numbers.txt` via the import API.

```bash
curl -X POST https://<host>/api/settings/mtn-numbers/import \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: text/plain" \
  --data-binary @mtn-extracts/saas-ecommerce-mtn-numbers.txt
```

## Files to Change

| File | Type of Change |
|------|---------------|
| `src/models/Settings.js` | +1 field: `mtnOrderRestrictionEnabled` |
| `src/models/KnownMtnNumber.js` | New file |
| `src/services/settingsService.js` | +get/update/import/stats methods |
| `src/controllers/settingsController.js` | +handler for each new route |
| `src/routes/settingsRoutes.js` | +4 new routes |
| `src/services/orderService.js` | +check in `createSingleOrder()` (line ~293) and `createBulkOrders()` (line ~536) |
| `src/services/storefrontService.js` | +check in `createStorefrontOrder()` (line ~677) |

## Out of Scope

- Frontend UI for the toggle/import — API-only (frontend can be added later)
- Updating the known numbers list automatically — manual import only
- Rate limiting on the import endpoint (follows existing patterns)

## Spec Self-Review

- No placeholders/TODOs remaining.
- All sections are internally consistent.
- Scope is focused on backend validation only.
- Requirements are unambiguous.
