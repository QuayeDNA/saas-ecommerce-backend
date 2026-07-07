# MTN New Number Order Restriction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Block new MTN numbers from being processed in orders when super admin toggle is enabled.

**Architecture:** Settings singleton holds `mtnOrderRestrictionEnabled` toggle. Separate `KnownMtnNumber` collection stores allowed numbers (indexed). At order creation, check toggle → lookup number → reject if unknown. Import API allows super admin to populate the allowlist.

**Tech Stack:** Node.js, Mongoose, MongoDB (Atlas)

**Global Constraints:**
- `mtnOrderRestrictionEnabled` defaults to `false` (no behavior change)
- Error message verbatim: `"Due to updated provider policies, new numbers cannot have their orders processed."`
- Number normalization: digits only, strip `+233` → `0`, 10+ digits
- All endpoints behind `authenticate` + `authorize("super_admin")`

---

### Task 1: KnownMtnNumber Model

**Files:**
- Create: `src/models/KnownMtnNumber.js`

- [ ] **Step 1: Create the model file**

```js
// src/models/KnownMtnNumber.js
import mongoose from "mongoose";

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

export default mongoose.model("KnownMtnNumber", knownMtnNumberSchema);
```

---

### Task 2: Settings Model — Add Toggle Field

**Files:**
- Modify: `src/models/Settings.js`

- [ ] **Step 1: Add `mtnOrderRestrictionEnabled` field**

Find where `momoBridgeEnabled` is defined in the schema (around the other boolean toggles). Add after it:

```js
mtnOrderRestrictionEnabled: {
  type: Boolean,
  default: false,
},
```

---

### Task 3: Settings Service — Toggle + Import + Stats

**Files:**
- Modify: `src/services/settingsService.js`

- [ ] **Step 1: Add `getMtnRestrictionSettings()` method**

```js
async getMtnRestrictionSettings() {
  const settings = await Settings.getInstance();
  return {
    mtnOrderRestrictionEnabled: settings.mtnOrderRestrictionEnabled,
  };
}
```

- [ ] **Step 2: Add `updateMtnRestrictionSettings(data)` method**

```js
async updateMtnRestrictionSettings(data) {
  const settings = await Settings.getInstance();
  if (typeof data.mtnOrderRestrictionEnabled === "boolean") {
    settings.mtnOrderRestrictionEnabled = data.mtnOrderRestrictionEnabled;
  }
  await settings.save();
  return { mtnOrderRestrictionEnabled: settings.mtnOrderRestrictionEnabled };
}
```

- [ ] **Step 3: Add `importMtnNumbers(rawText)` method**

```js
async importMtnNumbers(rawText) {
  const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;

  const lines = rawText
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  // Normalize each number
  const numbers = lines.map(line => {
    let d = line.replace(/[\s\-\(\)\+]/g, "");
    if (d.startsWith("233")) d = "0" + d.slice(3);
    return d;
  }).filter(d => d.length >= 10);

  const ops = numbers.map(phone => ({
    updateOne: {
      filter: { phone },
      update: { $setOnInsert: { phone, importedAt: new Date() } },
      upsert: true,
    },
  }));

  let imported = 0;
  let skipped = 0;

  if (ops.length > 0) {
    const result = await KnownMtnNumber.bulkWrite(ops, { ordered: false });
    imported = result.upsertedCount || 0;
    // upsertedCount is the number of new documents; matched docs were skipped
    skipped = (result.matchedCount || 0) - imported;
    if (skipped < 0) skipped = 0;
  }

  return { imported, skipped, total: numbers.length };
}
```

- [ ] **Step 4: Add `getMtnNumberStats()` method**

```js
async getMtnNumberStats() {
  const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
  const count = await KnownMtnNumber.countDocuments();
  return { totalKnownNumbers: count };
}
```

- [ ] **Step 5: Export the new methods**

Add to the `export default { ... }` block at the bottom of the file:
```js
getMtnRestrictionSettings,
updateMtnRestrictionSettings,
importMtnNumbers,
getMtnNumberStats,
```

---

### Task 4: Settings Controller — Handlers

**Files:**
- Modify: `src/controllers/settingsController.js`

- [ ] **Step 1: Add handler for `getMtnRestrictionSettings`**

```js
async getMtnRestrictionSettings(req, reply) {
  try {
    const data = await settingsService.getMtnRestrictionSettings();
    reply.status(200).send({ success: true, data });
  } catch (error) {
    reply.status(500).send({ success: false, message: error.message });
  }
}
```

- [ ] **Step 2: Add handler for `updateMtnRestrictionSettings`**

```js
async updateMtnRestrictionSettings(req, reply) {
  try {
    const data = await settingsService.updateMtnRestrictionSettings(req.body);
    reply.status(200).send({ success: true, data });
  } catch (error) {
    reply.status(500).send({ success: false, message: error.message });
  }
}
```

- [ ] **Step 3: Add handler for `importMtnNumbers`**

```js
async importMtnNumbers(req, reply) {
  try {
    const result = await settingsService.importMtnNumbers(req.body);
    reply.status(200).send({ success: true, data: result });
  } catch (error) {
    reply.status(500).send({ success: false, message: error.message });
  }
}
```

- [ ] **Step 4: Add handler for `getMtnNumberStats`**

```js
async getMtnNumberStats(req, reply) {
  try {
    const data = await settingsService.getMtnNumberStats();
    reply.status(200).send({ success: true, data });
  } catch (error) {
    reply.status(500).send({ success: false, message: error.message });
  }
}
```

- [ ] **Step 5: Export the new handlers**

Add to `export default { ... }`:
```js
getMtnRestrictionSettings,
updateMtnRestrictionSettings,
importMtnNumbers,
getMtnNumberStats,
```

---

### Task 5: Settings Routes

**Files:**
- Modify: `src/routes/settingsRoutes.js`

- [ ] **Step 1: Add 4 new routes under the super_admin section**

Find the super_admin route group (likely starts with `router.use(authenticate); router.use(authorize("super_admin"))` section). Add:

```js
router.get("/mtn-restriction", authenticate, authorize("super_admin"), settingsController.getMtnRestrictionSettings);
router.put("/mtn-restriction", authenticate, authorize("super_admin"), settingsController.updateMtnRestrictionSettings);
router.post("/mtn-numbers/import", authenticate, authorize("super_admin"), settingsController.importMtnNumbers);
router.get("/mtn-numbers/stats", authenticate, authorize("super_admin"), settingsController.getMtnNumberStats);
```

Also add a GET route accessible to authenticated agents (they need to know if restriction is active):

```js
router.get("/mtn-restriction", authenticate, settingsController.getMtnRestrictionSettings);
```

---

### Task 6: Order Service — Single Order Validation

**Files:**
- Modify: `src/services/orderService.js` around line ~293

- [ ] **Step 1: Add the MTN check helper at the top of the file or as an imported utility**

```js
async function checkMtnOrderRestriction(phone) {
  const Settings = (await import("../models/Settings.js")).default;
  const settings = await Settings.getInstance();
  if (!settings.mtnOrderRestrictionEnabled) return;

  const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
  let normalized = phone.replace(/[\s\-\(\)\+]/g, "");
  if (normalized.startsWith("233")) normalized = "0" + normalized.slice(3);

  const exists = await KnownMtnNumber.exists({ phone: normalized });
  if (!exists) {
    throw new Error(
      "Due to updated provider policies, new numbers cannot have their orders processed."
    );
  }
}
```

- [ ] **Step 2: Add check in `createSingleOrder()`**

Inside `createSingleOrder()`, after `customerPhone` is resolved (around line ~340, before the duplicate check), add:

```js
await checkMtnOrderRestriction(item.customerPhone);
```

- [ ] **Step 3: Add check in `createBulkOrders()`**

Inside `createBulkOrders()`, after parsing the bulk input and before the wallet debit, iterate each parsed item and validate. Collect failures in a `skippedItems` array. At the point where individual orders are created, skip items that failed validation.

---

### Task 7: Storefront Service — Storefront Order Validation

**Files:**
- Modify: `src/services/storefrontService.js` around line ~677

- [ ] **Step 1: Add the same `checkMtnOrderRestriction()` helper**

Same logic as Task 6 Step 1.

- [ ] **Step 2: Add check in `createStorefrontOrder()`**

Inside the storefront order creation flow, after items are resolved and before `Order.save()`, iterate `storefrontData.items`. If any item's `customerPhone` fails the check, throw the error (reject entire order).
