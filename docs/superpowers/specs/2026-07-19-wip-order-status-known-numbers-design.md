# WIP Order Status & Known Number Management

**Date:** 2026-07-19
**Status:** Draft
**Apps Affected:** Backend, BryteLinks, Directdata (Caskmafhub & NewApp excluded)

---

## Problem

When an MTN order is placed and the number passes the `KnownMtnNumber` allowlist check, the order proceeds to processing. However, the external MTN provider may later flag the number as "unknown," causing the order to stall. Currently, these orders get cancelled and refunded, but the number remains in the known list — causing the same failure on retry. Conversely, if a WIP order eventually completes successfully, the number should be promoted to the known list so future orders bypass the restriction.

The system also lacks individual CRUD operations on the known number list (only bulk import exists), and order status strings are duplicated inline across ~30+ files with no centralized source of truth.

---

## Solution Overview

1. **Centralize order status constants** — single source of truth for both backend and each frontend app
2. **Add `work_in_progress` order status** — new status between processing and cancelled/completed
3. **Auto-update known list on WIP transitions** — remove on cancel, add on complete (MTN only)
4. **Known number CRUD** — superadmin-managed list via settings dialog

---

## 1. Backend Order Status Constants

**File:** `backend/src/constants/orderStatuses.js` (new)

Exports:

```js
ORDER_STATUSES        // { DRAFT, PENDING, PENDING_PAYMENT, CONFIRMED, PROCESSING,
                       //   PARTIALLY_COMPLETED, COMPLETED, CANCELLED, FAILED,
                       //   WORK_IN_PROGRESS }
TERMINAL_STATUSES     // ["completed", "cancelled", "failed", "partially_completed"]
CANCELLABLE_STATUSES  // ["pending", "confirmed", "draft", "work_in_progress"]
COMPLETABLE_STATUSES  // ["pending", "confirmed", "processing", "work_in_progress"]
ALL_STATUSES          // Object.values(ORDER_STATUSES)
```

**Files updated to use the constants:**

| File | Change |
|------|--------|
| `src/models/Order.js` | `status` enum uses `ALL_STATUSES`; `CANCELLABLE_STATUSES` for guard; `COMPLETABLE_STATUSES` for processable |
| `src/services/orderService.js` | All inline string comparisons replaced with `ORDER_STATUSES.*` |
| `src/services/storefrontService.js` | Same |
| `src/controllers/orderController.js` | Same |
| `src/controllers/walletController.js` | Same if referencing order statuses |
| `src/validators/orderValidator.js` | Status validation uses `ALL_STATUSES` |

---

## 2. WIP State Machine

### Model Change

`"work_in_progress"` added to `Order.status` enum via `ALL_STATUSES`.

### Status Transitions

```
Any status ──→ work_in_progress         // super_admin manual set
work_in_progress ──→ completed          // via updateStatus() or manual
work_in_progress ──→ cancelled          // via cancelOrder() or manual
work_in_progress ──→ failed             // via updateStatus() auto-detection
```

### WIP → Cancelled (Known List Cleanup)

In `orderService.cancelOrder()`:

1. Allow cancellation from `work_in_progress` (add to `CANCELLABLE_STATUSES`)
2. Existing refund logic runs unchanged (wallet credit / Paystack refund)
3. **After refund succeeds**, scan order items:
   - If `item.providerId?.code === "MTN"` OR `item.provider === "MTN"` (storefront)
   - Normalize the phone number
   - Call `KnownMtnNumber.deleteOne({ phone: normalized })`
4. Same logic in `storefrontService` for storefront orders

### WIP → Completed (Known List Addition)

In `orderService.updateOrderStatus()` / `bulkProcessOrders()` / `updateStatus()`:

1. When status transitions to `completed` from `work_in_progress`
2. Scan order items for MTN provider
3. Normalize phone number
4. Check `KnownMtnNumber.exists({ phone: normalized })` — if not found, insert it

### Non-MTN Guard

Both cleanup and addition logic gate on `provider === "MTN"`. Non-MTN WIP orders are ignored.

---

## 3. Known Number CRUD API

**New endpoints** (all under `settingsRoutes.js`, super_admin only):

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/settings/mtn-numbers` | Paginated list with phone search |
| `POST` | `/api/settings/mtn-numbers` | Add single number |
| `DELETE` | `/api/settings/mtn-numbers/:id` | Delete single number |
| `POST` | `/api/settings/mtn-numbers/bulk-delete` | Delete multiple by IDs |

**Existing endpoints** preserved:
- `GET/PUT /api/settings/mtn-restriction`
- `POST /api/settings/mtn-numbers/import`
- `GET /api/settings/mtn-numbers/stats`

**Settings service** (`settingsService.js`) new methods:

| Method | Behavior |
|--------|----------|
| `listMtnNumbers(page, limit, search?)` | Paginated query with optional `$regex` on phone, returns `{ numbers, total, page, totalPages }` |
| `addMtnNumber(phone)` | Strip `+`/spaces, convert `233`→`0` prefix, `findOneAndUpdate` with `upsert`/`returnDocument` |
| `deleteMtnNumber(id)` | `findByIdAndDelete`, throws `404` if not found |
| `bulkDeleteMtnNumbers(ids)` | `deleteMany({ _id: { $in: ids } })`, returns `{ deletedCount }` |

**Settings controller** (`settingsController.js`) — 4 new handlers wrapping above.

**Tests:**
- `backend/tests/unit/constants/orderStatuses.test.js` — constant structure & values
- `backend/tests/unit/services/orderService.wip.test.js` — WIP cancellation removes known number, WIP completion adds number, non-MTN WIP skips
- `backend/tests/unit/services/settingsService.knownNumbers.test.js` — CRUD operations, pagination, duplicate handling, 404 on delete
- `backend/tests/unit/controllers/settingsController.knownNumbers.test.js` — HTTP handlers for CRUD endpoints

---

## 4. Frontend — Status Constants (BryteLinks & Directdata)

**File:** `src/constants/orderStatuses.ts` (new, identical in both apps)

Exports:

```typescript
ORDER_STATUS                    // const object with all status strings
OrderStatus                     // type union derived from ORDER_STATUS
ORDER_STATUS_LABELS             // Record<OrderStatus, string>
ORDER_STATUS_COLORS             // Record<OrderStatus, string> — CSS var classes
getStatusColor(status)          // returns color class
getStatusLabel(status)          // returns display label
TERMINAL_STATUSES               // const array of terminal statuses
CANCELLABLE_STATUSES            // const array of cancellable statuses
```

**WIP display:** Label `"WIP"`, color `bg-[var(--warning-lighter)] text-[var(--warning)]`.

**Files updated to import from constants** (replacing local maps):

| File | What changes |
|------|-------------|
| `types/order.ts` | `"work_in_progress"` added to `Order.status` union |
| `components/orders/UnifiedOrderCard.tsx` | Remove local `statusOptions`, `getStatusColor()`, `getStatusBorderColor()` — import from constants |
| `components/orders/UnifiedOrderTable.tsx` | Remove local `getStatusColor()`, `getStatusIcon()` — import from constants |
| `components/orders/UnifiedOrderList.tsx` | Replace inline filter `options` with constants |
| `components/storefront/order-manager.tsx` | Add WIP to `STATUS_OPTIONS`, `STATUS_BADGE_MAP` |
| `components/public/constants.ts` | Add WIP to `ORDER_STATUS_CFG` |
| `utils/order-lock.ts` | Import `TERMINAL_STATUSES` from constants |

---

## 5. Frontend — Known Number Management Dialog

**Location:** General tab of settings page (`general-tab.tsx`), replacing the static count row.

**Dialog features:**
- Search input with debounced `$regex` query
- Paginated list (20 per page) showing phone + imported date
- "Add Number" button with inline input field
- Delete button per row, confirmation required
- Bulk delete mode (checkbox per row, "Delete Selected" action)
- Count refreshes after add/delete operations

**Settings service** (`settings.service.ts`) new methods:
- `listMtnNumbers(page, limit, search?)`
- `addMtnNumber(phone)`
- `deleteMtnNumber(id)`
- `bulkDeleteMtnNumbers(ids)`

---

## 6. Non-Covered (Caskmafhub & NewApp)

These apps have no MTN restriction feature and are unchanged. Their `Order.status` types remain the same (no `work_in_progress`). If they receive a `work_in_progress` order from the API, it will silently pass through their existing status displays (rendered as raw `"work_in_progress"` label via `formatStatus()` utility).

---

## Files Changed Summary

### Backend

| File | Change Type |
|------|-------------|
| `src/constants/orderStatuses.js` | **New** |
| `src/models/Order.js` | Edit — use `ALL_STATUSES`, expand `CANCELLABLE_STATUSES` |
| `src/services/orderService.js` | Edit — known list cleanup on cancel, addition on complete |
| `src/services/storefrontService.js` | Edit — same WIP logic |
| `src/services/settingsService.js` | Edit — add CRUD methods |
| `src/controllers/orderController.js` | Edit — use constants, permit WIP→complete |
| `src/controllers/settingsController.js` | Edit — add CRUD handlers |
| `src/routes/settingsRoutes.js` | Edit — add CRUD routes |
| `src/validators/orderValidator.js` | Edit — use `ALL_STATUSES` |
| `tests/unit/constants/orderStatuses.test.js` | **New** |
| `tests/unit/services/orderService.wip.test.js` | **New** |
| `tests/unit/services/settingsService.knownNumbers.test.js` | **New** |
| `tests/unit/controllers/settingsController.knownNumbers.test.js` | **New** |

### BryteLinks & Directdata

| File | Change Type |
|------|-------------|
| `src/constants/orderStatuses.ts` | **New** |
| `src/types/order.ts` | Edit — add `work_in_progress` to union |
| `src/components/orders/UnifiedOrderCard.tsx` | Edit — import from constants |
| `src/components/orders/UnifiedOrderTable.tsx` | Edit — import from constants |
| `src/components/orders/UnifiedOrderList.tsx` | Edit — import from constants |
| `src/components/storefront/order-manager.tsx` | Edit — add WIP |
| `src/components/public/constants.ts` | Edit — add WIP to `ORDER_STATUS_CFG` |
| `src/utils/order-lock.ts` | Edit — import from constants |
| `src/services/settings.service.ts` | Edit — add CRUD methods |
| `src/pages/superadmin/settings/general-tab.tsx` | Edit — add "Manage" button + dialog |
