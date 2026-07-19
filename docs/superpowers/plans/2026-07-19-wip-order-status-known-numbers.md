# WIP Order Status & Known Number Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `work_in_progress` order status with automatic known-number list updates, centralized order status constants, and known-number CRUD for superadmin.

**Architecture:** Backend constants file (`src/constants/orderStatuses.js`) as single source of truth for all order status strings. Order model uses the constant array for its enum. Cancellation from `work_in_progress` triggers `KnownMtnNumber.deleteOne()` after refund. Completion from `work_in_progress` triggers `KnownMtnNumber.findOneAndUpdate()` upsert. CRUD endpoints under existing settings routes. Frontend constants file (`src/constants/orderStatuses.ts`) replaces inline maps in both BryteLinks and Directdata.

**Tech Stack:** Backend: Node.js/Mongoose/Express, Vitest. Frontend: React/TypeScript, Vite.

---

## Task 1: Backend Order Status Constants

**Files:**
- Create: `backend/src/constants/orderStatuses.js`
- Test: `backend/src/constants/orderStatuses.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `ORDER_STATUSES`, `TERMINAL_STATUSES`, `CANCELLABLE_STATUSES`, `COMPLETABLE_STATUSES`, `ALL_STATUSES` (named exports)

- [ ] **Step 1: Write the failing test**

```js
// backend/src/constants/orderStatuses.test.js
import { describe, it, expect } from "vitest";
import {
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  CANCELLABLE_STATUSES,
  COMPLETABLE_STATUSES,
  ALL_STATUSES,
} from "./orderStatuses.js";

describe("Order Status Constants", () => {
  it("should include all expected status values", () => {
    expect(ORDER_STATUSES.DRAFT).toBe("draft");
    expect(ORDER_STATUSES.PENDING).toBe("pending");
    expect(ORDER_STATUSES.PENDING_PAYMENT).toBe("pending_payment");
    expect(ORDER_STATUSES.CONFIRMED).toBe("confirmed");
    expect(ORDER_STATUSES.PROCESSING).toBe("processing");
    expect(ORDER_STATUSES.PARTIALLY_COMPLETED).toBe("partially_completed");
    expect(ORDER_STATUSES.COMPLETED).toBe("completed");
    expect(ORDER_STATUSES.CANCELLED).toBe("cancelled");
    expect(ORDER_STATUSES.FAILED).toBe("failed");
    expect(ORDER_STATUSES.WORK_IN_PROGRESS).toBe("work_in_progress");
  });

  it("should include work_in_progress in ALL_STATUSES", () => {
    expect(ALL_STATUSES).toContain("work_in_progress");
  });

  it("should not include work_in_progress in TERMINAL_STATUSES", () => {
    expect(TERMINAL_STATUSES).not.toContain("work_in_progress");
  });

  it("should include work_in_progress in CANCELLABLE_STATUSES", () => {
    expect(CANCELLABLE_STATUSES).toContain("work_in_progress");
  });

  it("should include work_in_progress in COMPLETABLE_STATUSES", () => {
    expect(COMPLETABLE_STATUSES).toContain("work_in_progress");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/constants/orderStatuses.test.js`
Expected: FAIL with import error (file not found)

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/constants/orderStatuses.js

const ORDER_STATUSES = Object.freeze({
  DRAFT: "draft",
  PENDING: "pending",
  PENDING_PAYMENT: "pending_payment",
  CONFIRMED: "confirmed",
  PROCESSING: "processing",
  PARTIALLY_COMPLETED: "partially_completed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed",
  WORK_IN_PROGRESS: "work_in_progress",
});

const TERMINAL_STATUSES = Object.freeze([
  ORDER_STATUSES.COMPLETED,
  ORDER_STATUSES.CANCELLED,
  ORDER_STATUSES.FAILED,
  ORDER_STATUSES.PARTIALLY_COMPLETED,
]);

const CANCELLABLE_STATUSES = Object.freeze([
  ORDER_STATUSES.PENDING,
  ORDER_STATUSES.CONFIRMED,
  ORDER_STATUSES.DRAFT,
  ORDER_STATUSES.WORK_IN_PROGRESS,
]);

const COMPLETABLE_STATUSES = Object.freeze([
  ORDER_STATUSES.PENDING,
  ORDER_STATUSES.CONFIRMED,
  ORDER_STATUSES.PROCESSING,
  ORDER_STATUSES.WORK_IN_PROGRESS,
]);

const ALL_STATUSES = Object.freeze(Object.values(ORDER_STATUSES));

export {
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  CANCELLABLE_STATUSES,
  COMPLETABLE_STATUSES,
  ALL_STATUSES,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/constants/orderStatuses.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/constants/orderStatuses.js src/constants/orderStatuses.test.js
git commit -m "feat: add centralized order status constants with WIP support"
```

---

## Task 2: Update Order Model to Use Constants

**Files:**
- Modify: `backend/src/models/Order.js`

- [ ] **Step 1: Update Order model — import constants**

Add import at top (after line 9):

```js
import {
  ALL_STATUSES,
  CANCELLABLE_STATUSES,
  COMPLETABLE_STATUSES,
  ORDER_STATUSES,
} from "../constants/orderStatuses.js";
```

- [ ] **Step 2: Replace inline status enum with `ALL_STATUSES`**

Find the `status` field definition (~lines 199-213). Replace the inline `enum` array with `ALL_STATUSES`:

```js
status: {
  type: String,
  enum: ALL_STATUSES,
  default: "pending",
},
```

- [ ] **Step 3: Update `updateStatus()` to detect WIP→completed**

After line 402 (the processing check), add:

```js
  // Auto-transition from work_in_progress to completed when all items complete
  if (this.status === ORDER_STATUSES.WORK_IN_PROGRESS && uniqueStatuses.length === 1 && uniqueStatuses[0] === "completed") {
    this.status = ORDER_STATUSES.COMPLETED;
    this.processingCompletedAt = new Date();
  }
```

- [ ] **Step 4: Verify tests still pass**

Run: `cd backend && npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/models/Order.js
git commit -m "feat(order-model): use centralized constants, add WIP status, detect WIP→completed"
```

---

## Task 3: WIP Known-List Logic in orderService

**Files:**
- Modify: `backend/src/services/orderService.js`

- [ ] **Step 1: Add constants import at the top of the file**

```js
import { ORDER_STATUSES, CANCELLABLE_STATUSES, COMPLETABLE_STATUSES } from "../constants/orderStatuses.js";
```

- [ ] **Step 2: Replace hardcoded status references in the imports area** — scan for `"pending"`, `"confirmed"`, `"draft"`, `"completed"`, `"cancelled"`, `"processing"`, `"failed"`, `"work_in_progress"` and replace with `ORDER_STATUSES.*` in non-test files. Key locations:

Line 1605 — cancellation guard:
```js
// Before:
if (!["pending", "confirmed", "draft"].includes(order.status)) {
// After:
if (!CANCELLABLE_STATUSES.includes(order.status)) {
```

- [ ] **Step 3: Add known-list cleanup helper method**

Add this private method before `cancelOrder`:

```js
async _removeFromKnownMtnList(phone) {
  if (!phone) return;
  const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
  let normalized = phone.replace(/[\s\-\(\)\+]/g, "");
  if (normalized.startsWith("233")) normalized = "0" + normalized.slice(3);
  await KnownMtnNumber.deleteOne({ phone: normalized });
}

async _addToKnownMtnList(phone) {
  if (!phone) return;
  const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
  let normalized = phone.replace(/[\s\-\(\)\+]/g, "");
  if (normalized.startsWith("233")) normalized = "0" + normalized.slice(3);
  const exists = await KnownMtnNumber.exists({ phone: normalized });
  if (!exists) {
    await KnownMtnNumber.create({ phone: normalized });
  }
}
```

- [ ] **Step 4: Add MTN helper to extract MTN phones from order items**

```js
_getMtnPhonesFromOrder(order) {
  const phones = new Set();
  for (const item of (order.items || [])) {
    const provider = item.packageDetails?.provider || item.provider;
    if (provider === "MTN" && item.customerPhone) {
      phones.add(item.customerPhone);
    }
  }
  return [...phones];
}
```

- [ ] **Step 5: Update `cancelOrder` to allow WIP cancellation + known-list cleanup**

Replace line 1605:
```js
if (!CANCELLABLE_STATUSES.includes(order.status)) {
  throw new Error("Order cannot be cancelled in current status");
}
```

After the refund section (after line 1720) and before setting item statuses, add known-list removal:
```js
// If cancelling from work_in_progress and provider is MTN, remove from known list
if (order.status === ORDER_STATUSES.WORK_IN_PROGRESS) {
  const mtnPhones = this._getMtnPhonesFromOrder(order);
  for (const phone of mtnPhones) {
    await this._removeFromKnownMtnList(phone);
  }
}
```

- [ ] **Step 6: Export helper for controller use**

Export `_addToKnownMtnList` and `_getMtnPhonesFromOrder` as public methods for use in the controller:

```js
// At the bottom of the class, before the last export line:
async addMtnNumbersToKnownList(order) {
  const mtnPhones = this._getMtnPhonesFromOrder(order);
  for (const phone of mtnPhones) {
    await this._addToKnownMtnList(phone);
  }
}
```

- [ ] **Step 7: Verify existing tests still pass**

Run: `cd backend && npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd backend
git add src/services/orderService.js
git commit -m "feat(order-service): WIP cancellation removes MTN numbers from known list"
```

---

## Task 4: Update Order Controller — Constants + WIP Transitions

**Files:**
- Modify: `backend/src/controllers/orderController.js`

- [ ] **Step 1: Add constants import**

```js
import { ORDER_STATUSES, CANCELLABLE_STATUSES, COMPLETABLE_STATUSES } from "../constants/orderStatuses.js";
```

- [ ] **Step 2: Replace hardcoded status strings in `updateOrderStatus`**

Line 540: `if (status === "failed")` → `if (status === ORDER_STATUSES.FAILED)`
Line 550: `if (status === "cancelled")` → `if (status === ORDER_STATUSES.CANCELLED)`
Line 598: `if (status === "processing" ...)` → `if (status === ORDER_STATUSES.PROCESSING ...)`
Line 600: `} else if (status === "completed" ...)` → `} else if (status === ORDER_STATUSES.COMPLETED ...)`
Line 632: `if (updatedOrder && status === "completed")` → `if (updatedOrder && status === ORDER_STATUSES.COMPLETED)`

- [ ] **Step 3: Add WIP→completed known-list addition in `updateOrderStatus`**

After the commission credit and storefront profit sections (after line 648), add:

```js
// If order was WIP and is now completed, add MTN numbers to known list
if (order.status === ORDER_STATUSES.WORK_IN_PROGRESS && status === ORDER_STATUSES.COMPLETED) {
  try {
    await orderService.addMtnNumbersToKnownList(updatedOrder);
  } catch (err) {
    logger.error(
      `[OrderController] failed to update known MTN list after WIP→completed for order ${updatedOrder._id}: ${err.message}`,
    );
  }
}
```

- [ ] **Step 4: Replace hardcoded status strings in `bulkProcessOrders`**

Line 1108: `!["processing", "completed"]` → `![ORDER_STATUSES.PROCESSING, ORDER_STATUSES.COMPLETED]`
Line 1142: `order.status === "completed"` → `order.status === ORDER_STATUSES.COMPLETED`
Line 1152: `!["pending", "confirmed", "processing"]` → `!COMPLETABLE_STATUSES.includes(order.status)`
Line 1174: `action === "completed" && order.orderType === "storefront"` → `action === ORDER_STATUSES.COMPLETED && ...`
Line 1179: `if (action === "completed")` → `if (action === ORDER_STATUSES.COMPLETED)`

- [ ] **Step 5: Add WIP→completed known-list addition in `bulkProcessOrders`**

After the commission credit block (after line 1187), add:

```js
// If order was WIP and is now completed, add MTN numbers to known list
if (order.status === ORDER_STATUSES.WORK_IN_PROGRESS && action === ORDER_STATUSES.COMPLETED) {
  try {
    await orderService.addMtnNumbersToKnownList(order);
  } catch (err) {
    logger.error(
      `[BulkProcess] Failed to update known MTN list after WIP→completed for order ${order._id}: ${err.message}`,
    );
  }
}
```

Note: This check uses `order.status` which was the status BEFORE the update to `action` (since we already set `order.status = action` on line 1162, we need to check the pre-update status). So we need to save `order.status` before setting it:

```js
const previousStatus = order.status;
order.status = action;
...
// Then use previousStatus in the WIP check:
if (previousStatus === ORDER_STATUSES.WORK_IN_PROGRESS && action === ORDER_STATUSES.COMPLETED) {
```

- [ ] **Step 6: Patch the `order.save()` call also triggers commission from the post-save hook, but the WIP check must happen after save. Move the `previousStatus` capture before line 1162 and use it.** The order of operations should be:

```js
const previousStatus = order.status;
order.status = action;
...
await order.save();
// Then use previousStatus for WIP check
```

- [ ] **Step 7: Verify existing tests still pass**

Run: `cd backend && npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd backend
git add src/controllers/orderController.js
git commit -m "feat(order-controller): use constants, add WIP→completed known list add"
```

---

## Task 5: Update Storefront Service

**Files:**
- Modify: `backend/src/services/storefrontService.js`

- [ ] **Step 1: Add constants import**

```js
import { ORDER_STATUSES } from "../constants/orderStatuses.js";
```

- [ ] **Step 2: Add same MTN phone extraction helper and known-list helpers**

Same pattern as Task 3 — add `_getMtnPhonesFromOrder(order)`, `_removeFromKnownMtnList(phone)`, `_addToKnownMtnList(phone)`, and `addMtnNumbersToKnownList(order)` methods.

- [ ] **Step 3: Update storefront `cancelOrder` equivalent (or add WIP known-list removal)**

Check if there's a `cancelOrder` equivalent in storefrontService. Search for "cancel" in the file. If found, add same WIP cancellation logic. If not (storefront cancellation goes through orderService.cancelOrder), no change needed for cancellation — but we still need the WIP→completed addition for when storefront orders are completed from WIP.

- [ ] **Step 4: Replace inline status references**

Search for all `"pending"`, `"completed"`, etc. in the file and replace with `ORDER_STATUSES.*` where applicable.

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd backend && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/services/storefrontService.js
git commit -m "feat(storefront-service): use constants, add WIP known-list helpers"
```

---

## Task 6: Known Number CRUD — Service + Controller + Routes

**Files:**
- Modify: `backend/src/services/settingsService.js`
- Modify: `backend/src/controllers/settingsController.js`
- Modify: `backend/src/routes/settingsRoutes.js`

- [ ] **Step 1: Add CRUD methods to settingsService.js**

After the `getMtnNumberStats` method (line 895), add:

```js
async listMtnNumbers(page = 1, limit = 20, search = "") {
  const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
  const filter = search
    ? { phone: { $regex: search.replace(/[\s\-\(\)\+]/g, ""), $options: "i" } }
    : {};
  const total = await KnownMtnNumber.countDocuments(filter);
  const numbers = await KnownMtnNumber.find(filter)
    .sort({ importedAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  return { numbers, total, page, totalPages: Math.ceil(total / limit) };
}

async addMtnNumber(phone) {
  const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
  let normalized = phone.replace(/[\s\-\(\)\+]/g, "");
  if (normalized.startsWith("233")) normalized = "0" + normalized.slice(3);
  if (!/^0\d{9}$/.test(normalized)) {
    throw new Error("Invalid phone number format");
  }
  const result = await KnownMtnNumber.findOneAndUpdate(
    { phone: normalized },
    { phone: normalized, importedAt: new Date() },
    { upsert: true, returnDocument: "after", new: true },
  );
  return result;
}

async deleteMtnNumber(id) {
  const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
  const result = await KnownMtnNumber.findByIdAndDelete(id);
  if (!result) throw new Error("Known number not found");
  return result;
}

async bulkDeleteMtnNumbers(ids) {
  const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
  const result = await KnownMtnNumber.deleteMany({ _id: { $in: ids } });
  return { deletedCount: result.deletedCount };
}
```

- [ ] **Step 2: Add controller handlers in settingsController.js**

```js
async listMtnNumbers(req, res) {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const result = await settingsService.listMtnNumbers(
      parseInt(page, 10),
      parseInt(limit, 10),
      search,
    );
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async addMtnNumber(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }
    const result = await settingsService.addMtnNumber(phone);
    res.status(201).json({ success: true, number: result });
  } catch (error) {
    const status = error.message.includes("Invalid") ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
}

async deleteMtnNumber(req, res) {
  try {
    const { id } = req.params;
    await settingsService.deleteMtnNumber(id);
    res.json({ success: true, message: "Number removed from known list" });
  } catch (error) {
    const status = error.message === "Known number not found" ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
}

async bulkDeleteMtnNumbers(req, res) {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "IDs array is required" });
    }
    const result = await settingsService.bulkDeleteMtnNumbers(ids);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
```

- [ ] **Step 3: Add routes in settingsRoutes.js**

After the existing MTN number routes (line 99), add:

```js
router.get("/settings/mtn-numbers", authorize("super_admin"), settingsController.listMtnNumbers);
router.post("/settings/mtn-numbers", authorize("super_admin"), settingsController.addMtnNumber);
router.delete("/settings/mtn-numbers/:id", authorize("super_admin"), settingsController.deleteMtnNumber);
router.post("/settings/mtn-numbers/bulk-delete", authorize("super_admin"), settingsController.bulkDeleteMtnNumbers);
```

- [ ] **Step 4: Verify existing tests still pass**

Run: `cd backend && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/services/settingsService.js src/controllers/settingsController.js src/routes/settingsRoutes.js
git commit -m "feat(settings): add known number CRUD endpoints"
```

---

## Task 7: Backend Tests — WIP Behavior + CRUD

**Files:**
- Create: `backend/src/services/orderService.wip.test.js`
- Create: `backend/src/services/settingsService.knownNumbers.test.js`

- [ ] **Step 1: Write WIP behavior tests**

```js
// backend/src/services/orderService.wip.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/Order.js", () => ({ default: { findOne: vi.fn(), findByIdAndUpdate: vi.fn() } }));
vi.mock("../models/User.js", () => ({ default: { findById: vi.fn(), find: vi.fn() } }));
vi.mock("../models/WalletTransaction.js", () => ({ default: { create: vi.fn() } }));
vi.mock("../models/KnownMtnNumber.js", () => ({
  default: { exists: vi.fn(), deleteOne: vi.fn(), create: vi.fn() },
}));
vi.mock("../models/Settings.js", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("./walletService.js", () => ({ default: { creditWallet: vi.fn() } }));
vi.mock("./notificationService.js", () => ({ default: { createInAppNotification: vi.fn() } }));
vi.mock("./websocketService.js", () => ({ default: { broadcastOrderStatusUpdate: vi.fn() } }));
vi.mock("../utils/logger.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../utils/auditLogger.js", () => ({ logAuditAction: vi.fn().mockResolvedValue() }));

import KnownMtnNumber from "../models/KnownMtnNumber.js";
import orderService from "./orderService.js";

describe("OrderService WIP", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe("_removeFromKnownMtnList", () => {
    it("should normalize and remove MTN phone from known list", async () => {
      KnownMtnNumber.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await orderService._removeFromKnownMtnList("0541234567");
      expect(KnownMtnNumber.deleteOne).toHaveBeenCalledWith({ phone: "0541234567" });
    });

    it("should normalize 233 prefix before removing", async () => {
      KnownMtnNumber.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await orderService._removeFromKnownMtnList("233541234567");
      expect(KnownMtnNumber.deleteOne).toHaveBeenCalledWith({ phone: "0541234567" });
    });

    it("should do nothing when phone is empty", async () => {
      await orderService._removeFromKnownMtnList("");
      expect(KnownMtnNumber.deleteOne).not.toHaveBeenCalled();
    });
  });

  describe("_addToKnownMtnList", () => {
    it("should add phone to known list if not already present", async () => {
      KnownMtnNumber.exists.mockResolvedValue(null);
      KnownMtnNumber.create.mockResolvedValue({ phone: "0541234567" });
      await orderService._addToKnownMtnList("0541234567");
      expect(KnownMtnNumber.create).toHaveBeenCalledWith({ phone: "0541234567" });
    });

    it("should not add phone if already in known list", async () => {
      KnownMtnNumber.exists.mockResolvedValue(true);
      await orderService._addToKnownMtnList("0541234567");
      expect(KnownMtnNumber.create).not.toHaveBeenCalled();
    });

    it("should do nothing when phone is empty", async () => {
      await orderService._addToKnownMtnList("");
      expect(KnownMtnNumber.exists).not.toHaveBeenCalled();
    });
  });

  describe("_getMtnPhonesFromOrder", () => {
    it("should extract MTN phones from order items", () => {
      const order = {
        items: [
          { customerPhone: "0541111111", packageDetails: { provider: "MTN" } },
          { customerPhone: "0542222222", packageDetails: { provider: "Vodafone" } },
          { customerPhone: "0543333333", packageDetails: { provider: "MTN" } },
        ],
      };
      const phones = orderService._getMtnPhonesFromOrder(order);
      expect(phones).toEqual(["0541111111", "0543333333"]);
    });

    it("should return empty array for non-MTN orders", () => {
      const order = {
        items: [
          { customerPhone: "0541111111", packageDetails: { provider: "Vodafone" } },
        ],
      };
      const phones = orderService._getMtnPhonesFromOrder(order);
      expect(phones).toEqual([]);
    });

    it("should handle empty items", () => {
      const phones = orderService._getMtnPhonesFromOrder({ items: [] });
      expect(phones).toEqual([]);
    });
  });

  describe("addMtnNumbersToKnownList", () => {
    it("should add all MTN phones from order to known list", async () => {
      KnownMtnNumber.exists.mockResolvedValue(null);
      KnownMtnNumber.create.mockResolvedValue({});
      const order = {
        items: [
          { customerPhone: "0541111111", packageDetails: { provider: "MTN" } },
        ],
      };
      await orderService.addMtnNumbersToKnownList(order);
      expect(KnownMtnNumber.create).toHaveBeenCalledWith({ phone: "0541111111" });
    });
  });
});
```

- [ ] **Step 2: Write known number CRUD tests**

```js
// backend/src/services/settingsService.knownNumbers.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/KnownMtnNumber.js", () => ({
  default: {
    countDocuments: vi.fn(),
    find: vi.fn(() => ({ sort: vi.fn(() => ({ skip: vi.fn(() => ({ limit: vi.fn(() => ({ lean: vi.fn() })) })) })) })),
    findOneAndUpdate: vi.fn(),
    findByIdAndDelete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

import KnownMtnNumber from "../models/KnownMtnNumber.js";
import settingsService from "./settingsService.js";

describe("SettingsService Known Numbers CRUD", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe("listMtnNumbers", () => {
    it("should return paginated results", async () => {
      KnownMtnNumber.countDocuments.mockResolvedValue(50);
      KnownMtnNumber.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue([{ phone: "0541111111" }]),
            }),
          }),
        }),
      });
      const result = await settingsService.listMtnNumbers(1, 20);
      expect(result.total).toBe(50);
      expect(result.totalPages).toBe(3);
      expect(result.numbers).toHaveLength(1);
    });
  });

  describe("addMtnNumber", () => {
    it("should normalize and upsert a phone number", async () => {
      KnownMtnNumber.findOneAndUpdate.mockResolvedValue({ phone: "0541111111" });
      const result = await settingsService.addMtnNumber("0541111111");
      expect(KnownMtnNumber.findOneAndUpdate).toHaveBeenCalledWith(
        { phone: "0541111111" },
        { phone: "0541111111", importedAt: expect.any(Date) },
        { upsert: true, returnDocument: "after", new: true },
      );
      expect(result.phone).toBe("0541111111");
    });

    it("should convert 233 prefix", async () => {
      KnownMtnNumber.findOneAndUpdate.mockResolvedValue({ phone: "0541111111" });
      await settingsService.addMtnNumber("233541111111");
      expect(KnownMtnNumber.findOneAndUpdate).toHaveBeenCalledWith(
        { phone: "0541111111" },
        { phone: "0541111111", importedAt: expect.any(Date) },
        expect.any(Object),
      );
    });

    it("should throw on invalid number", async () => {
      await expect(settingsService.addMtnNumber("123")).rejects.toThrow("Invalid phone number format");
    });
  });

  describe("deleteMtnNumber", () => {
    it("should delete by id", async () => {
      KnownMtnNumber.findByIdAndDelete.mockResolvedValue({ _id: "abc", phone: "0541111111" });
      const result = await settingsService.deleteMtnNumber("abc");
      expect(result.phone).toBe("0541111111");
    });

    it("should throw 404 if not found", async () => {
      KnownMtnNumber.findByIdAndDelete.mockResolvedValue(null);
      await expect(settingsService.deleteMtnNumber("abc")).rejects.toThrow("Known number not found");
    });
  });

  describe("bulkDeleteMtnNumbers", () => {
    it("should delete multiple by ids", async () => {
      KnownMtnNumber.deleteMany.mockResolvedValue({ deletedCount: 3 });
      const result = await settingsService.bulkDeleteMtnNumbers(["a", "b", "c"]);
      expect(result.deletedCount).toBe(3);
      expect(KnownMtnNumber.deleteMany).toHaveBeenCalledWith({ _id: { $in: ["a", "b", "c"] } });
    });
  });
});
```

- [ ] **Step 3: Write controller CRUD tests**

```js
// backend/src/controllers/settingsController.knownNumbers.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/settingsService.js", () => ({
  default: {
    listMtnNumbers: vi.fn(),
    addMtnNumber: vi.fn(),
    deleteMtnNumber: vi.fn(),
    bulkDeleteMtnNumbers: vi.fn(),
  },
}));

import settingsService from "../services/settingsService.js";
import settingsController from "./settingsController.js";

function mockReqRes(overrides = {}) {
  const req = { query: {}, body: {}, params: {}, ...overrides };
  const res = { json: vi.fn(), status: vi.fn(() => res) };
  return { req, res };
}

describe("SettingsController Known Numbers CRUD", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe("listMtnNumbers", () => {
    it("should return paginated results", async () => {
      settingsService.listMtnNumbers.mockResolvedValue({ numbers: [], total: 0, page: 1, totalPages: 0 });
      const { req, res } = mockReqRes({ query: { page: "1", limit: "20" } });
      await settingsController.listMtnNumbers(req, res);
      expect(res.json).toHaveBeenCalledWith({ success: true, numbers: [], total: 0, page: 1, totalPages: 0 });
    });
  });

  describe("addMtnNumber", () => {
    it("should create and return 201", async () => {
      settingsService.addMtnNumber.mockResolvedValue({ phone: "0541111111" });
      const { req, res } = mockReqRes({ body: { phone: "0541111111" } });
      await settingsController.addMtnNumber(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, number: { phone: "0541111111" } });
    });

    it("should return 400 if phone missing", async () => {
      const { req, res } = mockReqRes({ body: {} });
      await settingsController.addMtnNumber(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("deleteMtnNumber", () => {
    it("should delete and return success", async () => {
      settingsService.deleteMtnNumber.mockResolvedValue({ _id: "abc" });
      const { req, res } = mockReqRes({ params: { id: "abc" } });
      await settingsController.deleteMtnNumber(req, res);
      expect(res.json).toHaveBeenCalledWith({ success: true, message: expect.any(String) });
    });
  });

  describe("bulkDeleteMtnNumbers", () => {
    it("should delete multiple", async () => {
      settingsService.bulkDeleteMtnNumbers.mockResolvedValue({ deletedCount: 2 });
      const { req, res } = mockReqRes({ body: { ids: ["a", "b"] } });
      await settingsController.bulkDeleteMtnNumbers(req, res);
      expect(res.json).toHaveBeenCalledWith({ success: true, deletedCount: 2 });
    });

    it("should return 400 if ids missing", async () => {
      const { req, res } = mockReqRes({ body: {} });
      await settingsController.bulkDeleteMtnNumbers(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `cd backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/services/orderService.wip.test.js src/services/settingsService.knownNumbers.test.js src/controllers/settingsController.knownNumbers.test.js
git commit -m "test: add WIP behavior and known number CRUD tests"
```

---

## Task 8: Frontend Constants + Types (BryteLinks + Directdata)

**Files:**
- Create: `BryteLinks/src/constants/orderStatuses.ts`
- Create: `Directdata/src/constants/orderStatuses.ts`
- Modify: `BryteLinks/src/types/order.ts`
- Modify: `Directdata/src/types/order.ts`

These files are **identical** in both apps (CSS variable names differ slightly).

- [ ] **Step 1: Create constants file**

```typescript
// src/constants/orderStatuses.ts

export const ORDER_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  PENDING_PAYMENT: "pending_payment",
  CONFIRMED: "confirmed",
  PROCESSING: "processing",
  PARTIALLY_COMPLETED: "partially_completed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed",
  WORK_IN_PROGRESS: "work_in_progress",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_LABELS: Record<string, string> = {
  [ORDER_STATUS.DRAFT]: "Draft",
  [ORDER_STATUS.PENDING]: "Pending",
  [ORDER_STATUS.PENDING_PAYMENT]: "Awaiting Payment",
  [ORDER_STATUS.CONFIRMED]: "Confirmed",
  [ORDER_STATUS.PROCESSING]: "Processing",
  [ORDER_STATUS.PARTIALLY_COMPLETED]: "Partial",
  [ORDER_STATUS.COMPLETED]: "Delivered ✓",
  [ORDER_STATUS.CANCELLED]: "Cancelled",
  [ORDER_STATUS.FAILED]: "Failed",
  [ORDER_STATUS.WORK_IN_PROGRESS]: "WIP",
};

export const TERMINAL_STATUSES: readonly string[] = [
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.FAILED,
  ORDER_STATUS.PARTIALLY_COMPLETED,
];

export const CANCELLABLE_STATUSES: readonly string[] = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.WORK_IN_PROGRESS,
];

export function getStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
```

For **BryteLinks** color mapping, add to the same file:

```typescript
// CSS variable classes specific to BryteLinks
export const ORDER_STATUS_COLORS: Record<string, string> = {
  [ORDER_STATUS.DRAFT]: "bg-[var(--bg-surface-alt)] text-[var(--text-muted)]",
  [ORDER_STATUS.PENDING]: "bg-[var(--warning-lighter)] text-[var(--warning)]",
  [ORDER_STATUS.PENDING_PAYMENT]: "bg-[var(--warning-lighter)] text-[var(--warning)]",
  [ORDER_STATUS.CONFIRMED]: "bg-[var(--color-accent-soft)] text-[var(--color-secondary)]",
  [ORDER_STATUS.PROCESSING]: "bg-[var(--info)] text-white",
  [ORDER_STATUS.PARTIALLY_COMPLETED]: "bg-[var(--warning-lighter)] text-[var(--warning)]",
  [ORDER_STATUS.COMPLETED]: "bg-[var(--success)] text-white",
  [ORDER_STATUS.CANCELLED]: "bg-[var(--bg-surface-alt)] text-[var(--text-muted)]",
  [ORDER_STATUS.FAILED]: "bg-[var(--error)] text-white",
  [ORDER_STATUS.WORK_IN_PROGRESS]: "bg-[var(--warning-lighter)] text-[var(--warning)]",
};

export function getStatusColor(status: string): string {
  return ORDER_STATUS_COLORS[status] ?? "bg-[var(--bg-surface)] text-[var(--text-primary)]";
}
```

For **Directdata** color mapping — same variable names as BryteLinks (confirmed from exploration they share the same CSS variable naming). Copy the same file content.

- [ ] **Step 2: Update `types/order.ts` in both apps**

Find the `Order.status` union (line 134-142) and add `"work_in_progress"`:

```typescript
status: "draft" | "pending" | "pending_payment" | "confirmed" | "processing" | "partially_completed" | "completed" | "cancelled" | "failed" | "work_in_progress";
```

Also update the item-level `processingStatus` union to include WIP if desired (optional — WIP is order-level, not item-level):

Consider adding the same to `StorefrontOrder.status` in `storefront.service.ts` (lines ~139).

- [ ] **Step 3: Try building**

Run: `cd BryteLinks && npx vite build` and `cd Directdata && npx vite build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add BryteLinks/src/constants/orderStatuses.ts BryteLinks/src/types/order.ts
git add Directdata/src/constants/orderStatuses.ts Directdata/src/types/order.ts
git commit -m "feat(frontend): add centralized order status constants with WIP status"
```

---

## Task 9: Frontend Order UI — Use Constants + WIP (BryteLinks + Directdata)

**Files per app:**
- Modify: `src/components/orders/UnifiedOrderCard.tsx`
- Modify: `src/components/orders/UnifiedOrderTable.tsx`
- Modify: `src/components/orders/UnifiedOrderList.tsx`
- Modify: `src/components/storefront/order-manager.tsx`
- Modify: `src/components/public/constants.ts`
- Modify: `src/utils/order-lock.ts`

- [ ] **Step 1: Update `UnifiedOrderCard.tsx`**

Replace local `statusOptions` array and `getStatusColor()`/`getStatusBorderColor()` functions with imports from `../../constants/orderStatuses`.

Add `work_in_progress` to the status dropdown options array.

Import:
```typescript
import { ORDER_STATUS, getStatusColor, getStatusLabel } from "../../constants/orderStatuses";
```

The status dropdown `statusOptions` array should include:
```typescript
{ value: ORDER_STATUS.WORK_IN_PROGRESS, label: "WIP", color: getStatusColor(ORDER_STATUS.WORK_IN_PROGRESS) },
```

Replace all inline `order.status === "pending"` type comparisons with `ORDER_STATUS.PENDING`.

- [ ] **Step 2: Update `UnifiedOrderTable.tsx`**

Replace local `getStatusColor()` and `getStatusIcon()` with imports from constants.

Add WIP icon (e.g., `FaClock` for WIP status).

Import:
```typescript
import { ORDER_STATUS, getStatusColor, getStatusLabel } from "../../constants/orderStatuses";
```

- [ ] **Step 3: Update `UnifiedOrderList.tsx`**

Replace inline filter `options` array at lines 590-598 with imports from constants:

```typescript
import { ORDER_STATUS, getStatusLabel } from "../../constants/orderStatuses";
```

Replace:
```typescript
status: {
  options: [
    { value: ORDER_STATUS.DRAFT, label: getStatusLabel(ORDER_STATUS.DRAFT) },
    { value: ORDER_STATUS.PENDING, label: getStatusLabel(ORDER_STATUS.PENDING) },
    // ... etc
  ],
},
```

- [ ] **Step 4: Update `storefront/order-manager.tsx`**

Add WIP to `STATUS_OPTIONS` array and `STATUS_BADGE_MAP`.

```typescript
// In STATUS_OPTIONS:
{ value: "work_in_progress", label: "WIP" },

// In STATUS_BADGE_MAP:
work_in_progress: "warning",
```

- [ ] **Step 5: Update `public/constants.ts`**

Add WIP entry to `ORDER_STATUS_CFG`:

```typescript
work_in_progress: { label: "WIP", bg: "#FEF3C7", color: "#92400E" },
```

- [ ] **Step 6: Update `utils/order-lock.ts`**

Replace local `TERMINAL_STATUSES` with import:

```typescript
import { TERMINAL_STATUSES } from "../constants/orderStatuses";
```

Remove the local definition.

- [ ] **Step 7: Build both apps**

Run: `cd BryteLinks && npx vite build` && `cd Directdata && npx vite build`
Expected: Both build clean, zero errors

- [ ] **Step 8: Commit**

```bash
git add BryteLinks/src/components/orders/ BryteLinks/src/components/storefront/order-manager.tsx BryteLinks/src/components/public/constants.ts BryteLinks/src/utils/order-lock.ts
git add Directdata/src/components/orders/ Directdata/src/components/storefront/order-manager.tsx Directdata/src/components/public/constants.ts Directdata/src/utils/order-lock.ts
git commit -m "feat(frontend): update order UI to use centralized constants and display WIP status"
```

---

## Task 10: Frontend Known Number CRUD + Dialog (BryteLinks + Directdata)

**Files per app:**
- Modify: `src/services/settings.service.ts`
- Modify: `src/pages/superadmin/settings/general-tab.tsx`

- [ ] **Step 1: Add CRUD methods to `settings.service.ts`**

After `importMtnNumbers`, add:

```typescript
async listMtnNumbers(page: number = 1, limit: number = 20, search: string = ""): Promise<{
  numbers: Array<{ _id: string; phone: string; importedAt: string }>;
  total: number;
  page: number;
  totalPages: number;
}> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set("search", search);
  const res = await fetch(`${this.baseUrl}/settings/mtn-numbers?${params}`, {
    headers: this.headers(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Failed to fetch known numbers");
  return data;
}

async addMtnNumber(phone: string): Promise<{ phone: string }> {
  const res = await fetch(`${this.baseUrl}/settings/mtn-numbers`, {
    method: "POST",
    headers: this.headers(),
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Failed to add number");
  return data.number;
}

async deleteMtnNumber(id: string): Promise<void> {
  const res = await fetch(`${this.baseUrl}/settings/mtn-numbers/${id}`, {
    method: "DELETE",
    headers: this.headers(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Failed to delete number");
}

async bulkDeleteMtnNumbers(ids: string[]): Promise<{ deletedCount: number }> {
  const res = await fetch(`${this.baseUrl}/settings/mtn-numbers/bulk-delete`, {
    method: "POST",
    headers: this.headers(),
    body: JSON.stringify({ ids }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Bulk delete failed");
  return data;
}
```

- [ ] **Step 2: Create the Known Numbers Dialog Component**

Create `BryteLinks/src/pages/superadmin/settings/components/KnownNumbersDialog.tsx` (and identical in Directdata):

```tsx
import React, { useState, useEffect, useCallback } from "react";
import { FaTimes, FaSearch, FaTrash, FaPlus } from "react-icons/fa";
import settingsService from "../../../../services/settings.service";

interface KnownNumbersDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onStatsChange: () => void;
}

export default function KnownNumbersDialog({ isOpen, onClose, onStatsChange }: KnownNumbersDialogProps) {
  const [numbers, setNumbers] = useState<Array<{ _id: string; phone: string; importedAt: string }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const limit = 20;

  const fetchNumbers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await settingsService.listMtnNumbers(page, limit, search);
      setNumbers(result.numbers);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (isOpen) fetchNumbers();
  }, [isOpen, fetchNumbers]);

  const handleAdd = async () => {
    if (!newPhone.trim()) return;
    setError("");
    try {
      await settingsService.addMtnNumber(newPhone.trim());
      setNewPhone("");
      await fetchNumbers();
      onStatsChange();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    setError("");
    try {
      await settingsService.deleteMtnNumber(id);
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      await fetchNumbers();
      onStatsChange();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setError("");
    try {
      await settingsService.bulkDeleteMtnNumbers([...selectedIds]);
      setSelectedIds(new Set());
      await fetchNumbers();
      onStatsChange();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--bg-surface)] rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Known Numbers</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <FaTimes />
          </button>
        </div>

        {/* Add + Search */}
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Add phone number..."
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="flex-1 px-3 py-2 border border-[var(--border-color)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm"
            />
            <button
              onClick={handleAdd}
              className="px-3 py-2 bg-[var(--color-secondary)] text-white rounded-lg hover:opacity-90 text-sm flex items-center gap-1"
            >
              <FaPlus size={12} /> Add
            </button>
          </div>

          <div className="relative">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
            <input
              type="text"
              placeholder="Search numbers..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 border border-[var(--border-color)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm"
            />
          </div>

          {error && <p className="text-sm text-[var(--error)]">{error}</p>}
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="px-4 pb-2 flex items-center gap-2">
            <button
              onClick={handleBulkDelete}
              className="px-3 py-1.5 bg-[var(--error)] text-white rounded-lg text-sm hover:opacity-90"
            >
              Delete ({selectedIds.size})
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 border border-[var(--border-color)] text-[var(--text-muted)] rounded-lg text-sm"
            >
              Clear
            </button>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <p className="text-center text-[var(--text-muted)] py-8">Loading...</p>
          ) : numbers.length === 0 ? (
            <p className="text-center text-[var(--text-muted)] py-8">No known numbers found</p>
          ) : (
            <div className="space-y-1">
              {numbers.map((num) => (
                <div
                  key={num._id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[var(--bg-surface-alt)] group"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(num._id)}
                      onChange={() => toggleSelect(num._id)}
                      className="accent-[var(--color-secondary)]"
                    />
                    <span className="text-sm text-[var(--text-primary)] font-mono">{num.phone}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(num._id)}
                    className="text-[var(--text-muted)] hover:text-[var(--error)] opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <FaTrash size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-color)] text-sm text-[var(--text-muted)]">
            <span>{total} total</span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-2 py-1 border border-[var(--border-color)] rounded disabled:opacity-40"
              >
                Prev
              </button>
              <span className="px-2 py-1">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2 py-1 border border-[var(--border-color)] rounded disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `general-tab.tsx`**

Replace the static "Known numbers" row (lines 206-214) with a clickable "Manage" row:

```tsx
// At top, add import:
import KnownNumbersDialog from "./components/KnownNumbersDialog";

// Add state:
const [showKnownNumbers, setShowKnownNumbers] = useState(false);

// Replace lines 206-214:
<div className="flex items-center justify-between">
  <div>
    <p className="text-sm font-medium text-[var(--text-primary)]">Known numbers</p>
    <p className="text-xs text-[var(--text-muted)]">
      {mtnNumbersCount !== null ? `${mtnNumbersCount.toLocaleString()} numbers in the allowlist` : "Loading..."}
    </p>
  </div>
  <button
    onClick={() => setShowKnownNumbers(true)}
    className="px-3 py-1.5 text-sm border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface-alt)]"
  >
    Manage
  </button>
</div>

// At bottom of the component, before closing fragment:
<KnownNumbersDialog
  isOpen={showKnownNumbers}
  onClose={() => setShowKnownNumbers(false)}
  onStatsChange={onRefreshMtnStats}
/>
```

- [ ] **Step 4: Build both apps**

Run: `cd BryteLinks && npx vite build` && `cd Directdata && npx vite build`
Expected: Both build clean, zero errors

- [ ] **Step 5: Commit**

```bash
git add BryteLinks/src/services/settings.service.ts BryteLinks/src/pages/superadmin/settings/
git add Directdata/src/services/settings.service.ts Directdata/src/pages/superadmin/settings/
git commit -m "feat(frontend): add known number CRUD dialog in settings page"
```

---

## Verification

After all tasks, run full test suite and builds:

```bash
cd backend && npx vitest run
cd ../BryteLinks && npx vite build
cd ../Directdata && npx vite build
```

Expected:
- Backend: ALL tests pass (expecting ~260+)
- BryteLinks: Vite build clean, 0 errors
- Directdata: Vite build clean, 0 errors
