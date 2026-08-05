# Cross-App Wallet Transfer (Agent Self-Service) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a wallet-enabled agent transfer some or all of their wallet balance from the source app into a connected destination app — agent-initiated, admin-togglable, secure, with a full audit/accounting trail.

**Architecture:** The agent proves ownership of the destination account by supplying the destination **security PIN** (4–6 digits) plus an identifier (email/phone/agentCode). The source backend calls destination internal endpoints over the existing integration-key trust model: `verify-destination` returns a 5-minute purpose-locked `transferTicket` JWT; the source debits its own wallet atomically (reference `crossapp_<uuid>`); the destination credits idempotently by that reference; a credit-leg failure rolls the source debit back (network timeouts leave the transfer `pending` for reconciliation). Both apps write `WalletTransaction` records, audit logs, and a `CrossAppTransfer` ledger joined by `reference`.

**Tech Stack:** Node.js + Express + Mongoose + JWT (`jsonwebtoken`) + bcrypt on the backend; Vitest for backend tests; React + TypeScript + Vite on both frontend apps (BryteLinks and Directdata).

## Global Constraints

- Feature flag `crossAppWalletTransferEnabled` defaults to **false**; feature off means agents see no targets and any transfer attempt is rejected (403).
- Destination must be a pre-existing, **active**, wallet-enabled account with a configured PIN. No auto-provisioning.
- No transfer fee, no minimum/maximum amount (future knobs only). Amount must be a positive float.
- PIN is 4–6 digits; validated on source (express-validator) and destination (`/^\d{4,6}$/`).
- The agent can only move their **own** source balance — source userId comes from `req.user.userId`, never from input.
- `transferTicket` is a JWT signed with `process.env.JWTSECRET`: `{ userId, purpose: "wallet_transfer", scope: "credit_only" }`, `expiresIn: "5m"`. `transfer-credit` refuses any ticket whose `userId` does not match the requested `userId` or whose purpose/scope don't match.
- Transfer `reference` format: `crossapp_<uuid>`.
- Both legs are idempotent by `reference`; ambiguous credit outcomes leave the transfer `pending` and are resolved via recheck.
- The destination PIN is never logged, never stored; it is masked in any log line.
- `CrossAppSwitcher` stays admin-only. Agents never see `apiKey`.
- Backend tests run with Vitest. Frontend verification is the existing `npm run build` (`tsc -b && vite build`) in each app — no frontend test framework exists in the repo.
- Each app's deployment must set its own `DEFAULT_APP_ID` env var (e.g. `app_a` for BryteLinks, `app_b` for Directdata) so the ledger records the correct local identity via `getLocalAppIdentity()`.

---

### Task 1: CrossAppTransfer Model + Audit Action

**Files:**
- Create: `backend/src/models/CrossAppTransfer.js`
- Modify: `backend/src/constants/audit.js`
- Test: `backend/src/models/CrossAppTransfer.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CrossAppTransfer` Mongoose model (fields: `reference` unique required, `sourceAppId`, `destAppId`, optional `sourceUserId`/`destUserId` ObjectIds, `sourceUserEmail`/`destUserEmail` strings default `""`, `amount` min 0.01, `status` enum `["completed","failed","pending"]` default `"pending"`, `note` default `""`, `sourceAppName`/`destAppName` required, `error` default null, `completedAt` default null, timestamps). Also adds audit action constant `AUDIT_ACTIONS.WALLET_CROSS_APP_TRANSFER`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/models/CrossAppTransfer.test.js`:

```js
import { describe, it, expect } from "vitest";
import CrossAppTransfer from "../models/CrossAppTransfer.js";

describe("CrossAppTransfer model", () => {
  it("exposes the expected schema paths", () => {
    const paths = CrossAppTransfer.schema.paths;
    expect(paths.reference.options.required).toBe(true);
    expect(paths.reference.options.unique).toBe(true);
    expect(paths.status.options.enum).toEqual(["completed", "failed", "pending"]);
    expect(paths.status.options.default).toBe("pending");
    expect(paths.amount.options.min).toBe(0.01);
    expect(paths.sourceAppId.options.required).toBe(true);
    expect(paths.destAppId.options.required).toBe(true);
    expect(paths.sourceUserId.options.required).toBeFalsy();
  });

  it("creates a valid document with defaults", () => {
    const doc = new CrossAppTransfer({
      reference: "crossapp_abc123",
      sourceAppId: "app_a",
      destAppId: "app_b",
      sourceUserEmail: "agent@a.com",
      destUserEmail: "agent@b.com",
      amount: 50,
      sourceAppName: "BryteLinks",
      destAppName: "DirectData",
    });
    expect(doc.reference).toBe("crossapp_abc123");
    expect(doc.status).toBe("pending");
    expect(doc.completedAt).toBeNull();
    expect(doc.error).toBeNull();
    expect(doc.note).toBe("");
    expect(doc.sourceUserEmail).toBe("agent@a.com");
  });

  it("rejects an invalid status", () => {
    const doc = new CrossAppTransfer({
      reference: "crossapp_xyz",
      sourceAppId: "app_a",
      destAppId: "app_b",
      sourceUserEmail: "a@a.com",
      destUserEmail: "b@b.com",
      amount: 5,
      sourceAppName: "A",
      destAppName: "B",
      status: "bogus",
    });
    const err = doc.validateSync();
    expect(err).toBeTruthy();
    expect(err.errors.status.message).toContain("bogus");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/models/CrossAppTransfer.test.js`
Expected: FAIL — module `../models/CrossAppTransfer.js` cannot be resolved.

- [ ] **Step 3: Create the model**

Create `backend/src/models/CrossAppTransfer.js`:

```js
// src/models/CrossAppTransfer.js
import mongoose from "mongoose";

const crossAppTransferSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    sourceAppId: { type: String, required: true },
    destAppId: { type: String, required: true },
    sourceUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    destUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    sourceUserEmail: { type: String, default: "" },
    destUserEmail: { type: String, default: "" },
    amount: { type: Number, required: true, min: 0.01 },
    status: {
      type: String,
      enum: ["completed", "failed", "pending"],
      default: "pending",
    },
    note: { type: String, default: "" },
    sourceAppName: { type: String, required: true },
    destAppName: { type: String, required: true },
    error: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

crossAppTransferSchema.index({ sourceUserId: 1, createdAt: -1 });
crossAppTransferSchema.index({ destUserId: 1, createdAt: -1 });
crossAppTransferSchema.index({ status: 1 });

export default mongoose.model("CrossAppTransfer", crossAppTransferSchema);
```

- [ ] **Step 4: Add the audit action**

In `backend/src/constants/audit.js`, inside the `AUDIT_ACTIONS` object, after `WALLET_PAYSTACK_VERIFIED` (line 33):

```js
  WALLET_CROSS_APP_TRANSFER: "Cross-App Wallet Transfer",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/models/CrossAppTransfer.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/models/CrossAppTransfer.js src/models/CrossAppTransfer.test.js src/constants/audit.js
git commit -m "feat(wallet): add CrossAppTransfer ledger model and audit action"
```

---

### Task 2: Settings Flag + Settings Service

**Files:**
- Modify: `backend/src/models/Settings.js` (near line 302)
- Modify: `backend/src/services/settingsService.js` (after the MoMo Bridge section, near line 829)
- Test: `backend/src/services/settingsService.crossAppTransfer.test.js`

**Interfaces:**
- Consumes: `Settings` model.
- Produces: `settingsService.getCrossAppTransferSettings()` → `Promise<{ crossAppWalletTransferEnabled: boolean }>`; `settingsService.updateCrossAppTransferSettings(patch)` → `Promise<{ crossAppWalletTransferEnabled: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/settingsService.crossAppTransfer.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/Settings.js", () => ({
  default: { getInstance: vi.fn() },
}));

vi.mock("../utils/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn() },
}));

import Settings from "../models/Settings.js";
import settingsService from "./settingsService.js";

function makeSettings(overrides = {}) {
  return {
    crossAppWalletTransferEnabled: false,
    save: vi.fn(),
    ...overrides,
  };
}

describe("SettingsService Cross-App Wallet Transfer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getCrossAppTransferSettings", () => {
    it("returns the flag defaulting to false", async () => {
      Settings.getInstance.mockResolvedValue(makeSettings());
      const result = await settingsService.getCrossAppTransferSettings();
      expect(result).toEqual({ crossAppWalletTransferEnabled: false });
    });

    it("returns true when enabled", async () => {
      Settings.getInstance.mockResolvedValue(
        makeSettings({ crossAppWalletTransferEnabled: true }),
      );
      const result = await settingsService.getCrossAppTransferSettings();
      expect(result).toEqual({ crossAppWalletTransferEnabled: true });
    });
  });

  describe("updateCrossAppTransferSettings", () => {
    it("persists the boolean flag", async () => {
      const settings = makeSettings();
      Settings.getInstance.mockResolvedValue(settings);

      const result = await settingsService.updateCrossAppTransferSettings({
        crossAppWalletTransferEnabled: true,
      });

      expect(settings.crossAppWalletTransferEnabled).toBe(true);
      expect(settings.save).toHaveBeenCalled();
      expect(result).toEqual({ crossAppWalletTransferEnabled: true });
    });

    it("leaves the flag untouched when not provided", async () => {
      const settings = makeSettings({ crossAppWalletTransferEnabled: true });
      Settings.getInstance.mockResolvedValue(settings);

      const result = await settingsService.updateCrossAppTransferSettings({});

      expect(settings.save).toHaveBeenCalled();
      expect(result).toEqual({ crossAppWalletTransferEnabled: true });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/settingsService.crossAppTransfer.test.js`
Expected: FAIL — `getCrossAppTransferSettings` is not a function.

- [ ] **Step 3: Add the model field**

In `backend/src/models/Settings.js`, after the `momoBridgeAccountNumber` field (line 301), add:

```js
    // Cross-app wallet transfers — agent self-service moving balance between apps
    crossAppWalletTransferEnabled: {
      type: Boolean,
      default: false,
    },
```

- [ ] **Step 4: Add the service methods**

In `backend/src/services/settingsService.js`, after the MoMo Bridge section (after the `updateMomoBridgeSettings` method), add:

```js
  // ---------------------------------------------------------------------------
  // Cross-App Wallet Transfer — Agent Self-Service
  // ---------------------------------------------------------------------------

  async getCrossAppTransferSettings() {
    try {
      const settings = await Settings.getInstance();
      return {
        crossAppWalletTransferEnabled:
          settings.crossAppWalletTransferEnabled ?? false,
      };
    } catch (error) {
      logger.error(
        `Error getting cross-app wallet transfer settings: ${error.message}`,
      );
      throw error;
    }
  }

  async updateCrossAppTransferSettings(transferSettings) {
    try {
      const settings = await Settings.getInstance();

      if (transferSettings.crossAppWalletTransferEnabled !== undefined) {
        settings.crossAppWalletTransferEnabled = Boolean(
          transferSettings.crossAppWalletTransferEnabled,
        );
      }

      await settings.save();

      logger.info(
        "Cross-app wallet transfer settings updated:",
        transferSettings,
      );

      return this.getCrossAppTransferSettings();
    } catch (error) {
      logger.error(
        `Error updating cross-app wallet transfer settings: ${error.message}`,
      );
      throw error;
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/settingsService.crossAppTransfer.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/models/Settings.js src/services/settingsService.js src/services/settingsService.crossAppTransfer.test.js
git commit -m "feat(settings): add cross-app wallet transfer flag with service get/update"
```

---

### Task 3: Settings Controller + Routes

**Files:**
- Modify: `backend/src/controllers/settingsController.js` (after `updateMomoBridgeSettings`, line 387)
- Modify: `backend/src/routes/settingsRoutes.js`
- Test: `backend/src/controllers/settingsController.crossAppTransfer.test.js`

**Interfaces:**
- Consumes: `settingsService.getCrossAppTransferSettings` / `updateCrossAppTransferSettings` (Task 2).
- Produces: `GET /api/settings/wallet-transfer` (any authenticated user) and `PUT /api/settings/wallet-transfer` (super_admin) both returning `{ success: true, data: { crossAppWalletTransferEnabled } }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/settingsController.crossAppTransfer.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/settingsService.js", () => ({
  default: {
    getCrossAppTransferSettings: vi.fn(),
    updateCrossAppTransferSettings: vi.fn(),
  },
}));

vi.mock("../utils/logger.js", () => ({
  default: { error: vi.fn() },
}));

import settingsService from "../services/settingsService.js";
import settingsController from "./settingsController.js";

function mockReqRes(overrides = {}) {
  const req = { params: {}, body: {}, ...overrides };
  const res = { json: vi.fn(), status: vi.fn(() => res) };
  return { req, res };
}

describe("SettingsController Cross-App Wallet Transfer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getCrossAppTransferSettings", () => {
    it("returns the settings object", async () => {
      settingsService.getCrossAppTransferSettings.mockResolvedValue({
        crossAppWalletTransferEnabled: true,
      });

      const { req, res } = mockReqRes();
      await settingsController.getCrossAppTransferSettings(req, res);

      expect(settingsService.getCrossAppTransferSettings).toHaveBeenCalledOnce();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { crossAppWalletTransferEnabled: true },
      });
    });

    it("handles service errors", async () => {
      settingsService.getCrossAppTransferSettings.mockRejectedValue(
        new Error("DB error"),
      );

      const { req, res } = mockReqRes();
      await settingsController.getCrossAppTransferSettings(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Failed to get cross-app wallet transfer settings",
      });
    });
  });

  describe("updateCrossAppTransferSettings", () => {
    it("updates and returns the settings object", async () => {
      settingsService.updateCrossAppTransferSettings.mockResolvedValue({
        crossAppWalletTransferEnabled: true,
      });

      const { req, res } = mockReqRes({
        body: { crossAppWalletTransferEnabled: true },
      });
      await settingsController.updateCrossAppTransferSettings(req, res);

      expect(settingsService.updateCrossAppTransferSettings).toHaveBeenCalledWith(
        { crossAppWalletTransferEnabled: true },
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { crossAppWalletTransferEnabled: true },
      });
    });

    it("handles service errors", async () => {
      settingsService.updateCrossAppTransferSettings.mockRejectedValue(
        new Error("DB error"),
      );

      const { req, res } = mockReqRes({ body: {} });
      await settingsController.updateCrossAppTransferSettings(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Failed to update cross-app wallet transfer settings",
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/controllers/settingsController.crossAppTransfer.test.js`
Expected: FAIL — `getCrossAppTransferSettings` is not a function on the controller.

- [ ] **Step 3: Add the controller handlers**

In `backend/src/controllers/settingsController.js`, after `updateMomoBridgeSettings` (line 387), add:

```js
  // ---------------------------------------------------------------------------
  // Cross-App Wallet Transfer — Agent Self-Service
  // ---------------------------------------------------------------------------
  async getCrossAppTransferSettings(req, res) {
    try {
      const settings = await settingsService.getCrossAppTransferSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error getting cross-app wallet transfer settings:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get cross-app wallet transfer settings",
      });
    }
  }

  async updateCrossAppTransferSettings(req, res) {
    try {
      const settings =
        await settingsService.updateCrossAppTransferSettings(req.body);
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error updating cross-app wallet transfer settings:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update cross-app wallet transfer settings",
      });
    }
  }
```

- [ ] **Step 4: Add the routes**

In `backend/src/routes/settingsRoutes.js`:

After line 39 (`/mtn-restriction` GET — still in the "any authenticated user" block above `router.use(authorize("super_admin"))`):

```js
// Cross-App Wallet Transfer — GET available to all authenticated users (agents need it for the transfer dialog)
router.get("/wallet-transfer", settingsController.getCrossAppTransferSettings);
```

After line 105 (`/momobridge` PUT — in the super_admin block):

```js
// Cross-App Wallet Transfer — Settings (PUT only, super_admin)
router.put("/wallet-transfer", settingsController.updateCrossAppTransferSettings);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/controllers/settingsController.crossAppTransfer.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/settingsController.js src/routes/settingsRoutes.js src/controllers/settingsController.crossAppTransfer.test.js
git commit -m "feat(settings): expose cross-app wallet transfer GET/PUT endpoints"
```

---

### Task 4: Local Identity Helper + Internal `verify-destination`

**Files:**
- Modify: `backend/src/utils/appContextResolver.js` (add `getLocalAppIdentity`)
- Create: `backend/src/controllers/internalWalletTransferController.js` (part 1: `verifyDestination`)
- Modify: `backend/src/routes/internalRoutes.js`
- Test: `backend/src/controllers/internalWalletTransferController.test.js` (verifyDestination suite)

**Interfaces:**
- Consumes: `getLocalAppIdentity` (produced here), `canHaveWallet`, `bcrypt`, `jwt`, `User` model.
- Produces: `getLocalAppIdentity()` → `{ appId, name }`; internal route `POST /api/internal/wallet/verify-destination` (body `{ identifier, pin }`) → `200 { success: true, data: { userId, transferTicket, email } }`. Error responses: 400 missing/invalid input or PIN not configured; 404 account not found; 403 not wallet-enabled/inactive; 401 invalid PIN.

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/internalWalletTransferController.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("bcrypt", () => ({
  default: { compare: vi.fn() },
}));

vi.mock("jsonwebtoken", () => ({
  default: { sign: vi.fn(), verify: vi.fn() },
}));

vi.mock("../models/User.js", () => ({
  default: { findOne: vi.fn(), findById: vi.fn() },
}));

vi.mock("../models/WalletTransaction.js", () => ({
  default: { findOne: vi.fn() },
}));

vi.mock("../models/CrossAppTransfer.js", () => ({
  default: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock("../services/walletService.js", () => ({
  default: { creditWallet: vi.fn() },
}));

vi.mock("../utils/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../utils/auditLogger.js", () => ({
  logAuditAction: vi.fn(),
}));

vi.mock("../utils/appContextResolver.js", () => ({
  getLocalAppIdentity: vi.fn(),
}));

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import CrossAppTransfer from "../models/CrossAppTransfer.js";
import walletService from "../services/walletService.js";
import { getLocalAppIdentity } from "../utils/appContextResolver.js";
import * as controller from "./internalWalletTransferController.js";

function mockReqRes(overrides = {}) {
  const req = { params: {}, query: {}, body: {}, ...overrides };
  const res = { json: vi.fn(), status: vi.fn(() => res) };
  return { req, res };
}

function makeUser(overrides = {}) {
  return {
    _id: "dest-user-1",
    email: "agent@b.com",
    phone: "0244000000",
    agentCode: "DD0001",
    userType: "agent",
    status: "active",
    securityPin: "hashed_pin",
    requiresPinSetup: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getLocalAppIdentity.mockReturnValue({ appId: "app_b", name: "DirectData" });
});

describe("verifyDestination", () => {
  it("rejects a missing identifier", async () => {
    const { req, res } = mockReqRes({ body: { identifier: "", pin: "1234" } });
    await controller.verifyDestination(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects an invalid PIN format", async () => {
    const { req, res } = mockReqRes({ body: { identifier: "agent@b.com", pin: "12a" } });
    await controller.verifyDestination(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Security PIN must be 4 to 6 digits",
    });
  });

  it("returns 404 when the account is not found", async () => {
    User.findOne.mockResolvedValue(null);
    const { req, res } = mockReqRes({ body: { identifier: "nobody@b.com", pin: "1234" } });
    await controller.verifyDestination(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Destination account not found",
    });
  });

  it("returns 403 for a non-wallet-enabled or inactive user", async () => {
    User.findOne.mockResolvedValue(makeUser({ userType: "customer", status: "active" }));
    const { req, res } = mockReqRes({ body: { identifier: "customer@b.com", pin: "1234" } });
    await controller.verifyDestination(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 400 when the PIN is not configured", async () => {
    User.findOne.mockResolvedValue(makeUser({ requiresPinSetup: true }));
    const { req, res } = mockReqRes({ body: { identifier: "agent@b.com", pin: "1234" } });
    await controller.verifyDestination(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Security PIN not configured",
    });
  });

  it("returns 401 on PIN mismatch", async () => {
    User.findOne.mockResolvedValue(makeUser());
    bcrypt.compare.mockResolvedValue(false);
    const { req, res } = mockReqRes({ body: { identifier: "agent@b.com", pin: "9999" } });
    await controller.verifyDestination(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Invalid security PIN",
    });
  });

  it("returns a ticket when the PIN matches", async () => {
    User.findOne.mockResolvedValue(makeUser());
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue("ticket.jwt.xyz");

    const { req, res } = mockReqRes({ body: { identifier: "agent@b.com", pin: "1234" } });
    await controller.verifyDestination(req, res);

    expect(bcrypt.compare).toHaveBeenCalledWith("1234", "hashed_pin");
    expect(jwt.sign).toHaveBeenCalledWith(
      { userId: "dest-user-1", purpose: "wallet_transfer", scope: "credit_only" },
      process.env.JWTSECRET,
      { expiresIn: "5m" },
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { userId: "dest-user-1", transferTicket: "ticket.jwt.xyz", email: "agent@b.com" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/controllers/internalWalletTransferController.test.js`
Expected: FAIL — module `./internalWalletTransferController.js` cannot be resolved.

- [ ] **Step 3: Add the local identity helper**

In `backend/src/utils/appContextResolver.js`, before the final export block (line 372), add:

```js
export function getLocalAppIdentity() {
  const appId = normalizeAppId();
  const manifest = getRawAppConfig(appId)?.manifest || {};
  return {
    appId,
    name: manifest.short_name || manifest.name || appId,
  };
}
```

- [ ] **Step 4: Create the controller (part 1)**

Create `backend/src/controllers/internalWalletTransferController.js`:

```js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import CrossAppTransfer from "../models/CrossAppTransfer.js";
import walletService from "../services/walletService.js";
import { canHaveWallet } from "../utils/userTypeHelpers.js";
import { getLocalAppIdentity } from "../utils/appContextResolver.js";
import logger from "../utils/logger.js";
import { logAuditAction } from "../utils/auditLogger.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

const isValidPin = (pin) => /^\d{4,6}$/.test(String(pin || ""));

export async function verifyDestination(req, res) {
  try {
    const { identifier, pin } = req.body;

    if (!identifier || !identifier.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Destination identifier is required" });
    }
    if (!isValidPin(pin)) {
      return res.status(400).json({
        success: false,
        message: "Security PIN must be 4 to 6 digits",
      });
    }

    const trimmed = identifier.trim();
    const user = await User.findOne({
      $or: [
        { email: trimmed.toLowerCase() },
        { phone: trimmed },
        { agentCode: trimmed },
      ],
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Destination account not found" });
    }

    if (!canHaveWallet(user.userType) || user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Destination account is not wallet-enabled or is inactive",
      });
    }

    if (user.requiresPinSetup || !user.securityPin) {
      return res.status(400).json({
        success: false,
        message: "Security PIN not configured",
      });
    }

    const isPinMatch = await bcrypt.compare(String(pin), user.securityPin);
    if (!isPinMatch) {
      logger.warn(`Invalid destination PIN attempt for identifier: ${trimmed}`);
      return res
        .status(401)
        .json({ success: false, message: "Invalid security PIN" });
    }

    const transferTicket = jwt.sign(
      { userId: user._id, purpose: "wallet_transfer", scope: "credit_only" },
      process.env.JWTSECRET,
      { expiresIn: "5m" },
    );

    return res.json({
      success: true,
      data: { userId: user._id, transferTicket, email: user.email },
    });
  } catch (err) {
    logger.error(`[internal.verifyDestination] ${err.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to verify destination" });
  }
}
```

- [ ] **Step 5: Register the route**

In `backend/src/routes/internalRoutes.js`, add the import after line 4:

```js
import * as internalWalletTransferController from '../controllers/internalWalletTransferController.js';
```

And add the route (after the existing wallet routes, line 32):

```js
router.post('/wallet/verify-destination', authenticateCrossAppKey, internalWalletTransferController.verifyDestination);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/controllers/internalWalletTransferController.test.js`
Expected: PASS (7 tests, verifyDestination suite).

- [ ] **Step 7: Commit**

```bash
git add src/utils/appContextResolver.js src/controllers/internalWalletTransferController.js src/routes/internalRoutes.js src/controllers/internalWalletTransferController.test.js
git commit -m "feat(wallet): internal verify-destination endpoint issues purpose-locked transfer ticket"
```

---

### Task 5: Internal `transfer-credit` + `transfers/:reference`

**Files:**
- Modify: `backend/src/controllers/internalWalletTransferController.js` (add `creditTransfer`, `getTransferStatus`)
- Modify: `backend/src/routes/internalRoutes.js`
- Test: `backend/src/controllers/internalWalletTransferController.test.js` (add suites)

**Interfaces:**
- Consumes: `walletService.creditWallet`, `CrossAppTransfer` model, `getLocalAppIdentity`, `logAuditAction`.
- Produces: internal route `POST /api/internal/wallet/transfer-credit` (body `{ userId, amount, reference, ticket, metadata }`) → `200 { success: true, transaction, reference, status: "completed" }` or `{ success: true, alreadyProcessed: true, transaction }` on idempotent replay; internal route `GET /api/internal/wallet/transfers/:reference` → `200 { success: true, transfer }` or `404`.

- [ ] **Step 1: Add the failing tests**

Append to `backend/src/controllers/internalWalletTransferController.test.js`:

```js
describe("creditTransfer", () => {
  it("rejects missing required fields", async () => {
    const { req, res } = mockReqRes({ body: { userId: "u1", amount: 10 } });
    await controller.creditTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects an invalid/expired ticket", async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error("jwt expired");
    });
    const { req, res } = mockReqRes({
      body: { userId: "u1", amount: 10, reference: "crossapp_x", ticket: "bad" },
    });
    await controller.creditTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Transfer ticket is invalid or expired",
    });
  });

  it("rejects a ticket whose userId does not match", async () => {
    jwt.verify.mockReturnValue({
      userId: "u1",
      purpose: "wallet_transfer",
      scope: "credit_only",
    });
    const { req, res } = mockReqRes({
      body: { userId: "u2", amount: 10, reference: "crossapp_x", ticket: "tk" },
    });
    await controller.creditTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns the existing transaction idempotently for a completed reference", async () => {
    jwt.verify.mockReturnValue({
      userId: "u1",
      purpose: "wallet_transfer",
      scope: "credit_only",
    });
    const existing = { _id: "txn-1", reference: "crossapp_x" };
    WalletTransaction.findOne.mockResolvedValue(existing);

    const { req, res } = mockReqRes({
      body: { userId: "u1", amount: 10, reference: "crossapp_x", ticket: "tk" },
    });
    await controller.creditTransfer(req, res);

    expect(walletService.creditWallet).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      alreadyProcessed: true,
      transaction: existing,
    });
  });

  it("returns 404 when the user is missing", async () => {
    jwt.verify.mockReturnValue({
      userId: "u1",
      purpose: "wallet_transfer",
      scope: "credit_only",
    });
    WalletTransaction.findOne.mockResolvedValue(null);
    User.findById.mockResolvedValue(null);

    const { req, res } = mockReqRes({
      body: { userId: "u1", amount: 10, reference: "crossapp_x", ticket: "tk" },
    });
    await controller.creditTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 403 for a non-wallet-enabled destination user", async () => {
    jwt.verify.mockReturnValue({
      userId: "u1",
      purpose: "wallet_transfer",
      scope: "credit_only",
    });
    WalletTransaction.findOne.mockResolvedValue(null);
    User.findById.mockResolvedValue(
      makeUser({ userType: "customer", status: "active" }),
    );

    const { req, res } = mockReqRes({
      body: { userId: "u1", amount: 10, reference: "crossapp_x", ticket: "tk" },
    });
    await controller.creditTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("credits the wallet with transfer metadata and writes the destination ledger", async () => {
    jwt.verify.mockReturnValue({
      userId: "u1",
      purpose: "wallet_transfer",
      scope: "credit_only",
    });
    WalletTransaction.findOne.mockResolvedValue(null);
    User.findById.mockResolvedValue(makeUser());
    walletService.creditWallet.mockResolvedValue({ _id: "txn-credit" });
    CrossAppTransfer.findOneAndUpdate.mockResolvedValue({ _id: "ledger" });

    const { req, res } = mockReqRes({
      body: {
        userId: "u1",
        amount: 25,
        reference: "crossapp_x",
        ticket: "tk",
        metadata: {
          sourceAppId: "app_a",
          sourceAppName: "BryteLinks",
          sourceUserEmail: "agent@a.com",
        },
      },
    });
    await controller.creditTransfer(req, res);

    expect(walletService.creditWallet).toHaveBeenCalledWith(
      "u1",
      25,
      "Cross-app transfer from BryteLinks (crossapp_x)",
      null,
      {
        adminAction: true,
        crossApp: true,
        crossAppTransfer: {
          reference: "crossapp_x",
          fromAppId: "app_a",
          sourceAppName: "BryteLinks",
        },
      },
    );
    expect(CrossAppTransfer.findOneAndUpdate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      transaction: { _id: "txn-credit" },
      reference: "crossapp_x",
      status: "completed",
    });
  });
});

describe("getTransferStatus", () => {
  it("returns the transfer when found", async () => {
    const transfer = { reference: "crossapp_x", status: "completed" };
    CrossAppTransfer.findOne.mockResolvedValue(transfer);

    const { req, res } = mockReqRes({ params: { reference: "crossapp_x" } });
    await controller.getTransferStatus(req, res);

    expect(CrossAppTransfer.findOne).toHaveBeenCalledWith({ reference: "crossapp_x" });
    expect(res.json).toHaveBeenCalledWith({ success: true, transfer });
  });

  it("returns 404 when not found", async () => {
    CrossAppTransfer.findOne.mockResolvedValue(null);

    const { req, res } = mockReqRes({ params: { reference: "crossapp_x" } });
    await controller.getTransferStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Transfer not found",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/controllers/internalWalletTransferController.test.js`
Expected: FAIL — `creditTransfer` / `getTransferStatus` are not functions.

- [ ] **Step 3: Add the controllers**

Append to `backend/src/controllers/internalWalletTransferController.js`:

```js
export async function creditTransfer(req, res) {
  try {
    const { userId, amount, reference, ticket, metadata } = req.body;

    if (!userId || !amount || amount <= 0 || !reference || !ticket) {
      return res.status(400).json({
        success: false,
        message: "userId, amount, reference and ticket are required",
      });
    }

    const referenceStr = String(reference);

    // ── Ticket verification ────────────────────────────────────────────────
    let ticketPayload;
    try {
      ticketPayload = jwt.verify(ticket, process.env.JWTSECRET);
    } catch (err) {
      return res
        .status(401)
        .json({ success: false, message: "Transfer ticket is invalid or expired" });
    }

    if (
      ticketPayload.purpose !== "wallet_transfer" ||
      ticketPayload.scope !== "credit_only" ||
      String(ticketPayload.userId) !== String(userId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Transfer ticket does not match the destination account",
      });
    }

    // ── Idempotency guard (completed credits only) ─────────────────────────
    const existing = await WalletTransaction.findOne({
      reference: referenceStr,
      status: "completed",
    });
    if (existing) {
      return res.json({
        success: true,
        alreadyProcessed: true,
        transaction: existing,
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (!canHaveWallet(user.userType) || user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Destination account is not wallet-enabled or is inactive",
      });
    }

    const sourceAppId = metadata?.sourceAppId || "unknown";
    const sourceAppName = metadata?.sourceAppName || sourceAppId;
    const sourceUserEmail = metadata?.sourceUserEmail || "";

    const transaction = await walletService.creditWallet(
      userId,
      parseFloat(amount),
      `Cross-app transfer from ${sourceAppName} (${referenceStr})`,
      null,
      {
        adminAction: true,
        crossApp: true,
        crossAppTransfer: {
          reference: referenceStr,
          fromAppId: sourceAppId,
          sourceAppName,
        },
      },
    );

    // ── Best-effort destination ledger (idempotent by reference) ───────────
    const localIdentity = getLocalAppIdentity();
    await CrossAppTransfer.findOneAndUpdate(
      { reference: referenceStr },
      {
        $set: {
          reference: referenceStr,
          sourceAppId,
          destAppId: localIdentity.appId,
          sourceUserEmail,
          destUserEmail: user.email || "",
          amount: parseFloat(amount),
          status: "completed",
          sourceAppName,
          destAppName: localIdentity.name,
          error: null,
          completedAt: new Date(),
        },
        $setOnInsert: {
          sourceUserId: null,
          destUserId: userId,
        },
      },
      { upsert: true, setDefaultsOnInsert: true, new: true },
    );

    await logAuditAction(null, {
      userId,
      action: AUDIT_ACTIONS.WALLET_CROSS_APP_TRANSFER,
      category: AUDIT_CATEGORIES.WALLET,
      resource: { userId },
      metadata: {
        source: "internal.creditTransfer",
        reference: referenceStr,
        amount: parseFloat(amount),
        fromAppId: sourceAppId,
        fromAppName: sourceAppName,
        direction: "credit",
      },
      severity: AUDIT_SEVERITIES.INFO,
    });

    return res.json({
      success: true,
      transaction,
      reference: referenceStr,
      status: "completed",
    });
  } catch (err) {
    logger.error(`[internal.creditTransfer] ${err.message}`);
    const status = err.message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message: err.message });
  }
}

export async function getTransferStatus(req, res) {
  try {
    const { reference } = req.params;
    const transfer = await CrossAppTransfer.findOne({ reference });
    if (!transfer) {
      return res
        .status(404)
        .json({ success: false, message: "Transfer not found" });
    }
    return res.json({ success: true, transfer });
  } catch (err) {
    logger.error(`[internal.getTransferStatus] ${err.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get transfer status" });
  }
}
```

- [ ] **Step 4: Register the routes**

In `backend/src/routes/internalRoutes.js`, after the `verify-destination` route:

```js
router.post('/wallet/transfer-credit', authenticateCrossAppKey, internalWalletTransferController.creditTransfer);
router.get('/wallet/transfers/:reference', authenticateCrossAppKey, internalWalletTransferController.getTransferStatus);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/controllers/internalWalletTransferController.test.js`
Expected: PASS (all suites — 16 tests).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/internalWalletTransferController.js src/routes/internalRoutes.js src/controllers/internalWalletTransferController.test.js
git commit -m "feat(wallet): internal transfer-credit with ticket validation, idempotency and ledger"
```

---

### Task 6: walletTransferService (Source-Side Orchestration)

**Files:**
- Create: `backend/src/services/walletTransferService.js`
- Test: `backend/src/services/walletTransferService.test.js`

**Interfaces:**
- Consumes: `settingsService.getCrossAppTransferSettings`/`getConnectedApps` (Task 2), `getConnectedAppByAppId`/`makeRequest` from `../utils/connectedApps.js`, `walletService.debitWallet`/`creditWallet`, `CrossAppTransfer` model, `getLocalAppIdentity` (Task 4).
- Produces:
  - `isEnabled()` → `Promise<boolean>`
  - `getTransferTargets()` → `Promise<Array<{ appId, name }>>` (empty when feature off)
  - `createTransfer(sourceUser, { appId, identifier, pin, amount, note })` → `Promise<{ reference, status }>`; throws on failure (error objects carry `status` for controller mapping)
  - `getTransfersForUser(sourceUserId, page, limit)` → `{ transfers, pagination }`
  - `getAdminTransfers(page, limit, status)` → `{ transfers, pagination }`
  - `recheckTransfer(sourceUserId, reference)` → `Promise<CrossAppTransfer>` (resolves `pending` → `completed` if the destination confirms)

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/walletTransferService.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/CrossAppTransfer.js", () => ({
  default: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock("./settingsService.js", () => ({
  default: {
    getCrossAppTransferSettings: vi.fn(),
    getConnectedApps: vi.fn(),
  },
}));

vi.mock("./walletService.js", () => ({
  default: { creditWallet: vi.fn(), debitWallet: vi.fn() },
}));

vi.mock("../utils/connectedApps.js", () => ({
  getConnectedAppByAppId: vi.fn(),
  makeRequest: vi.fn(),
}));

vi.mock("../utils/appContextResolver.js", () => ({
  getLocalAppIdentity: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../utils/auditLogger.js", () => ({
  logAuditAction: vi.fn(),
}));

import walletTransferService from "./walletTransferService.js";
import settingsService from "./settingsService.js";
import walletService from "./walletService.js";
import CrossAppTransfer from "../models/CrossAppTransfer.js";
import { getConnectedAppByAppId, makeRequest } from "../utils/connectedApps.js";
import { getLocalAppIdentity } from "../utils/appContextResolver.js";

const sourceUser = { _id: "src-user-1", email: "agent@a.com" };

const destApp = {
  appId: "app_b",
  name: "DirectData",
  baseUrl: "https://directdata.example.com",
  apiKey: "sk_abc",
  enabled: true,
};

function enabledSettings() {
  return { crossAppWalletTransferEnabled: true };
}

beforeEach(() => {
  vi.resetAllMocks();
  getLocalAppIdentity.mockReturnValue({ appId: "app_a", name: "BryteLinks" });
});

describe("getTransferTargets", () => {
  it("returns an empty array when the feature is disabled", async () => {
    settingsService.getCrossAppTransferSettings.mockResolvedValue({
      crossAppWalletTransferEnabled: false,
    });
    const targets = await walletTransferService.getTransferTargets();
    expect(targets).toEqual([]);
  });

  it("returns only enabled connected apps, never exposing apiKey", async () => {
    settingsService.getCrossAppTransferSettings.mockResolvedValue(enabledSettings());
    settingsService.getConnectedApps.mockResolvedValue([
      destApp,
      { appId: "app_c", name: "Offline", baseUrl: "x", apiKey: "sk_x", enabled: false },
    ]);
    const targets = await walletTransferService.getTransferTargets();
    expect(targets).toEqual([{ appId: "app_b", name: "DirectData" }]);
  });
});

describe("createTransfer", () => {
  it("rejects when the feature is disabled", async () => {
    settingsService.getCrossAppTransferSettings.mockResolvedValue({
      crossAppWalletTransferEnabled: false,
    });
    await expect(
      walletTransferService.createTransfer(sourceUser, {
        appId: "app_b",
        identifier: "agent@b.com",
        pin: "1234",
        amount: 50,
      }),
    ).rejects.toThrow(/disabled/);
    expect(walletService.debitWallet).not.toHaveBeenCalled();
  });

  it("propagates a missing/disabled destination app error before any money movement", async () => {
    settingsService.getCrossAppTransferSettings.mockResolvedValue(enabledSettings());
    getConnectedAppByAppId.mockRejectedValue(
      new Error("Connected app 'app_x' not found"),
    );
    await expect(
      walletTransferService.createTransfer(sourceUser, {
        appId: "app_x",
        identifier: "a@b.com",
        pin: "1234",
        amount: 50,
      }),
    ).rejects.toThrow("not found");
    expect(walletService.debitWallet).not.toHaveBeenCalled();
  });

  it("propagates destination PIN failures before debiting the source", async () => {
    settingsService.getCrossAppTransferSettings.mockResolvedValue(enabledSettings());
    getConnectedAppByAppId.mockResolvedValue(destApp);
    makeRequest.mockRejectedValue(new Error("Invalid security PIN"));

    await expect(
      walletTransferService.createTransfer(sourceUser, {
        appId: "app_b",
        identifier: "agent@b.com",
        pin: "9999",
        amount: 50,
      }),
    ).rejects.toThrow("Invalid security PIN");
    expect(walletService.debitWallet).not.toHaveBeenCalled();
  });

  it("debits the source, credits the destination and marks the ledger completed", async () => {
    settingsService.getCrossAppTransferSettings.mockResolvedValue(enabledSettings());
    getConnectedAppByAppId.mockResolvedValue(destApp);
    makeRequest
      .mockResolvedValueOnce({
        success: true,
        data: { userId: "dest-user-1", transferTicket: "ticket.jwt", email: "agent@b.com" },
      })
      .mockResolvedValueOnce({
        success: true,
        transaction: { _id: "txn-credit" },
        reference: "crossapp_uuid",
        status: "completed",
      });
    walletService.debitWallet.mockResolvedValue({ _id: "txn-debit" });
    CrossAppTransfer.findOneAndUpdate.mockResolvedValue({ _id: "ledger" });

    const result = await walletTransferService.createTransfer(sourceUser, {
      appId: "app_b",
      identifier: "agent@b.com",
      pin: "1234",
      amount: 50,
      note: "moving funds",
    });

    expect(walletService.debitWallet).toHaveBeenCalledWith(
      "src-user-1",
      50,
      expect.stringContaining("crossapp_"),
      null,
      expect.objectContaining({ idempotencyKey: expect.stringContaining("crossapp_") }),
    );
    const creditCall = makeRequest.mock.calls[1];
    expect(creditCall[0]).toEqual(destApp);
    expect(creditCall[1]).toBe("POST");
    expect(creditCall[2]).toBe("/api/internal/wallet/transfer-credit");
    expect(creditCall[3]).toMatchObject({
      userId: "dest-user-1",
      amount: 50,
      ticket: "ticket.jwt",
      metadata: {
        sourceAppId: "app_a",
        sourceAppName: "BryteLinks",
        sourceUserEmail: "agent@a.com",
      },
    });
    expect(CrossAppTransfer.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ upsert: true }),
    );
    expect(result.status).toBe("completed");
    expect(result.reference).toMatch(/^crossapp_/);
  });

  it("reverses the source debit and marks the ledger failed on a definitive credit failure", async () => {
    settingsService.getCrossAppTransferSettings.mockResolvedValue(enabledSettings());
    getConnectedAppByAppId.mockResolvedValue(destApp);
    makeRequest
      .mockResolvedValueOnce({
        success: true,
        data: { userId: "dest-user-1", transferTicket: "ticket.jwt", email: "agent@b.com" },
      })
      .mockRejectedValueOnce(new Error("Insufficient wallet balance"));
    walletService.debitWallet.mockResolvedValue({ _id: "txn-debit" });
    walletService.creditWallet.mockResolvedValue({ _id: "txn-reversal" });

    await expect(
      walletTransferService.createTransfer(sourceUser, {
        appId: "app_b",
        identifier: "agent@b.com",
        pin: "1234",
        amount: 50,
      }),
    ).rejects.toThrow("Insufficient wallet balance");

    expect(walletService.creditWallet).toHaveBeenCalledWith(
      "src-user-1",
      50,
      expect.stringContaining("Reversal"),
      null,
      expect.objectContaining({ idempotencyKey: expect.stringContaining("_reversal") }),
    );
    const ledgerUpsert = CrossAppTransfer.findOneAndUpdate.mock.calls[0];
    expect(ledgerUpsert[1].$set.status).toBe("failed");
  });

  it("leaves the transfer pending (no rollback) on an ambiguous network failure", async () => {
    settingsService.getCrossAppTransferSettings.mockResolvedValue(enabledSettings());
    getConnectedAppByAppId.mockResolvedValue(destApp);
    makeRequest
      .mockResolvedValueOnce({
        success: true,
        data: { userId: "dest-user-1", transferTicket: "ticket.jwt", email: "agent@b.com" },
      })
      .mockRejectedValueOnce(new Error("Request to https://directdata.example.com failed: aborted"));
    walletService.debitWallet.mockResolvedValue({ _id: "txn-debit" });

    await expect(
      walletTransferService.createTransfer(sourceUser, {
        appId: "app_b",
        identifier: "agent@b.com",
        pin: "1234",
        amount: 50,
      }),
    ).rejects.toThrow(/Request to/);

    expect(walletService.creditWallet).not.toHaveBeenCalled();
    const ledgerUpsert = CrossAppTransfer.findOneAndUpdate.mock.calls[0];
    expect(ledgerUpsert[1].$set.status).toBe("pending");
  });

  it("is idempotent on the debit leg when retried", async () => {
    settingsService.getCrossAppTransferSettings.mockResolvedValue(enabledSettings());
    getConnectedAppByAppId.mockResolvedValue(destApp);
    makeRequest
      .mockResolvedValueOnce({
        success: true,
        data: { userId: "dest-user-1", transferTicket: "ticket.jwt", email: "agent@b.com" },
      })
      .mockResolvedValueOnce({
        success: true,
        transaction: { _id: "txn-credit" },
        reference: "crossapp_uuid",
        status: "completed",
      });
    walletService.debitWallet.mockResolvedValue({ _id: "existing-debit" });
    CrossAppTransfer.findOneAndUpdate.mockResolvedValue({ _id: "ledger" });

    const result = await walletTransferService.createTransfer(sourceUser, {
      appId: "app_b",
      identifier: "agent@b.com",
      pin: "1234",
      amount: 50,
    });

    expect(walletService.debitWallet).toHaveBeenCalledWith(
      "src-user-1",
      50,
      expect.any(String),
      null,
      expect.objectContaining({ idempotencyKey: expect.stringContaining("crossapp_") }),
    );
    expect(result.status).toBe("completed");
  });
});

describe("recheckTransfer", () => {
  it("throws 404 when the transfer does not exist", async () => {
    CrossAppTransfer.findOne.mockResolvedValue(null);
    await expect(
      walletTransferService.recheckTransfer("src-user-1", "crossapp_x"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("marks a pending transfer completed when the destination confirms", async () => {
    const transfer = {
      reference: "crossapp_x",
      destAppId: "app_b",
      status: "pending",
      save: vi.fn().mockResolvedValue(true),
    };
    CrossAppTransfer.findOne.mockResolvedValue(transfer);
    getConnectedAppByAppId.mockResolvedValue(destApp);
    makeRequest.mockResolvedValue({
      success: true,
      transfer: { reference: "crossapp_x", status: "completed" },
    });

    const result = await walletTransferService.recheckTransfer("src-user-1", "crossapp_x");

    expect(makeRequest).toHaveBeenCalledWith(
      destApp,
      "GET",
      "/api/internal/wallet/transfers/crossapp_x",
    );
    expect(result.status).toBe("completed");
    expect(transfer.save).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/walletTransferService.test.js`
Expected: FAIL — module `./walletTransferService.js` cannot be resolved.

- [ ] **Step 3: Create the service**

Create `backend/src/services/walletTransferService.js`:

```js
import crypto from "crypto";
import { getConnectedAppByAppId, makeRequest } from "../utils/connectedApps.js";
import settingsService from "./settingsService.js";
import walletService from "./walletService.js";
import CrossAppTransfer from "../models/CrossAppTransfer.js";
import { getLocalAppIdentity } from "../utils/appContextResolver.js";
import logger from "../utils/logger.js";
import { logAuditAction } from "../utils/auditLogger.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

class WalletTransferService {
  async isEnabled() {
    const settings = await settingsService.getCrossAppTransferSettings();
    return settings.crossAppWalletTransferEnabled;
  }

  async getTransferTargets() {
    const enabled = await this.isEnabled();
    if (!enabled) return [];
    const apps = await settingsService.getConnectedApps();
    return apps
      .filter((app) => app.enabled)
      .map((app) => ({ appId: app.appId, name: app.name }));
  }

  async createTransfer(sourceUser, { appId, identifier, pin, amount, note }) {
    const enabled = await this.isEnabled();
    if (!enabled) {
      const err = new Error(
        "Cross-app wallet transfers are disabled by the administrator.",
      );
      err.status = 403;
      throw err;
    }

    const app = await getConnectedAppByAppId(appId);

    // 1. Verify the destination account on the destination app
    const verifyResp = await makeRequest(
      app,
      "POST",
      "/api/internal/wallet/verify-destination",
      { identifier, pin },
    );

    const destUserId = verifyResp?.data?.userId;
    const transferTicket = verifyResp?.data?.transferTicket;
    const destUserEmail = verifyResp?.data?.email || "";

    if (!destUserId || !transferTicket) {
      throw new Error("Destination verification returned an invalid response");
    }

    const reference = `crossapp_${crypto.randomUUID()}`;
    const localIdentity = getLocalAppIdentity();

    // 2. Debit the source wallet atomically (idempotent by reference)
    await walletService.debitWallet(
      sourceUser._id,
      amount,
      `Cross-app transfer to ${app.name} (${reference})`,
      null,
      {
        idempotencyKey: reference,
        crossAppTransfer: {
          reference,
          destAppId: appId,
          destAppName: app.name,
        },
      },
    );

    // 3. Credit the destination wallet
    let creditResp;
    try {
      creditResp = await makeRequest(
        app,
        "POST",
        "/api/internal/wallet/transfer-credit",
        {
          userId: destUserId,
          amount,
          reference,
          ticket: transferTicket,
          metadata: {
            sourceAppId: localIdentity.appId,
            sourceAppName: localIdentity.name,
            sourceUserEmail: sourceUser.email || "",
          },
        },
      );
    } catch (err) {
      const isAmbiguous = /^Request to .* failed:/.test(err.message || "");
      if (!isAmbiguous) {
        // 4a. Definitive failure — reverse the source debit
        await walletService.creditWallet(
          sourceUser._id,
          amount,
          `Reversal: cross-app transfer to ${app.name} failed (${reference})`,
          null,
          {
            adminAction: true,
            crossApp: true,
            idempotencyKey: `${reference}_reversal`,
            crossAppTransfer: {
              reference,
              destAppId: appId,
              destAppName: app.name,
              reversal: true,
            },
          },
        );
      }

      await this._persistLedger({
        reference,
        app,
        sourceUser,
        destUserId,
        destUserEmail,
        amount,
        note,
        status: isAmbiguous ? "pending" : "failed",
        error: err.message,
      });

      throw err;
    }

    // 5. Success — mark transfer completed
    await this._persistLedger({
      reference,
      app,
      sourceUser,
      destUserId,
      destUserEmail,
      amount,
      note,
      status: "completed",
    });

    return { reference, status: "completed", credit: creditResp };
  }

  async _persistLedger({
    reference,
    app,
    sourceUser,
    destUserId,
    destUserEmail,
    amount,
    note,
    status,
    error,
  }) {
    const localIdentity = getLocalAppIdentity();
    const doc = await CrossAppTransfer.findOneAndUpdate(
      { reference },
      {
        $set: {
          reference,
          sourceAppId: localIdentity.appId,
          destAppId: app.appId,
          sourceUserId: sourceUser._id,
          destUserId: destUserId || null,
          sourceUserEmail: sourceUser.email || "",
          destUserEmail: destUserEmail || "",
          amount,
          status,
          note: note || "",
          sourceAppName: localIdentity.name,
          destAppName: app.name,
          error: error || null,
          completedAt: status === "completed" ? new Date() : null,
        },
      },
      { upsert: true, setDefaultsOnInsert: true, new: true },
    );

    await logAuditAction(null, {
      userId: sourceUser._id,
      action: AUDIT_ACTIONS.WALLET_CROSS_APP_TRANSFER,
      category: AUDIT_CATEGORIES.WALLET,
      resource: { userId: sourceUser._id },
      metadata: {
        source: "walletTransferService.createTransfer",
        reference,
        amount,
        destAppId: app.appId,
        destAppName: app.name,
        direction: "debit",
        status,
      },
      severity:
        status === "completed"
          ? AUDIT_SEVERITIES.INFO
          : AUDIT_SEVERITIES.WARNING,
    });

    return doc;
  }

  async getTransfersForUser(sourceUserId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [transfers, total] = await Promise.all([
      CrossAppTransfer.find({ sourceUserId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      CrossAppTransfer.countDocuments({ sourceUserId }),
    ]);
    return {
      transfers,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getAdminTransfers(page = 1, limit = 20, status) {
    const filter = {};
    if (status && ["completed", "failed", "pending"].includes(status)) {
      filter.status = status;
    }
    const skip = (page - 1) * limit;
    const [transfers, total] = await Promise.all([
      CrossAppTransfer.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      CrossAppTransfer.countDocuments(filter),
    ]);
    return {
      transfers,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async recheckTransfer(sourceUserId, reference) {
    const transfer = await CrossAppTransfer.findOne({ reference, sourceUserId });
    if (!transfer) {
      const err = new Error("Transfer not found");
      err.status = 404;
      throw err;
    }
    if (transfer.status !== "pending") return transfer;

    const app = await getConnectedAppByAppId(transfer.destAppId);
    try {
      const resp = await makeRequest(
        app,
        "GET",
        `/api/internal/wallet/transfers/${encodeURIComponent(reference)}`,
      );
      const remote = resp?.transfer;
      if (remote && remote.status === "completed") {
        transfer.status = "completed";
        transfer.completedAt = new Date();
        transfer.error = null;
        await transfer.save();
      }
    } catch (err) {
      const wrapped = new Error(`Recheck failed: ${err.message}`);
      wrapped.status = 502;
      throw wrapped;
    }
    return transfer;
  }
}

export default new WalletTransferService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/walletTransferService.test.js`
Expected: PASS (all suites — 11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/walletTransferService.js src/services/walletTransferService.test.js
git commit -m "feat(wallet): orchestrate cross-app transfers with rollback, pending reconciliation and idempotency"
```

---

### Task 7: Agent-Facing Controller + Routes + Validator

**Files:**
- Create: `backend/src/controllers/walletTransferController.js`
- Modify: `backend/src/routes/walletRoutes.js`
- Modify: `backend/src/validators/walletValidator.js`
- Test: `backend/src/controllers/walletTransferController.test.js`

**Interfaces:**
- Consumes: `walletTransferService` (Task 6), `User` model.
- Produces (agent-facing, all under `authenticate` + `authorizeWalletUser`):
  - `GET /api/wallet/transfer/targets` → `{ success: true, targets: [{ appId, name }] }`
  - `POST /api/wallet/transfer` (body `{ appId, identifier, pin, amount, note? }`, rate-limited) → `{ success: true, message, data: { reference, status } }`
  - `GET /api/wallet/transfer/history` → `{ success: true, transfers, pagination }`
  - `POST /api/wallet/transfer/:reference/recheck` → `{ success: true, transfer }`
  - Admin: `GET /api/wallet/transfers` (super_admin) → `{ success: true, transfers, pagination }`

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/walletTransferController.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/walletTransferService.js", () => ({
  default: {
    getTransferTargets: vi.fn(),
    createTransfer: vi.fn(),
    getTransfersForUser: vi.fn(),
    recheckTransfer: vi.fn(),
    getAdminTransfers: vi.fn(),
  },
}));

vi.mock("../models/User.js", () => ({
  default: { findById: vi.fn() },
}));

vi.mock("../utils/logger.js", () => ({
  default: { error: vi.fn() },
}));

import walletTransferService from "../services/walletTransferService.js";
import User from "../models/User.js";
import walletTransferController from "./walletTransferController.js";

function mockReqRes(overrides = {}) {
  const req = { params: {}, query: {}, body: {}, user: { userId: "u1", userType: "agent" }, ...overrides };
  const res = { json: vi.fn(), status: vi.fn(() => res) };
  return { req, res };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getTargets", () => {
  it("returns transfer targets", async () => {
    walletTransferService.getTransferTargets.mockResolvedValue([
      { appId: "app_b", name: "DirectData" },
    ]);

    const { req, res } = mockReqRes();
    await walletTransferController.getTargets(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      targets: [{ appId: "app_b", name: "DirectData" }],
    });
  });
});

describe("createTransfer", () => {
  it("creates a transfer from the JWT user", async () => {
    User.findById.mockResolvedValue({ _id: "u1", email: "agent@a.com" });
    walletTransferService.createTransfer.mockResolvedValue({
      reference: "crossapp_abc",
      status: "completed",
    });

    const { req, res } = mockReqRes({
      body: {
        appId: "app_b",
        identifier: "agent@b.com",
        pin: "1234",
        amount: 50,
        note: "moving funds",
      },
    });
    await walletTransferController.createTransfer(req, res);

    expect(User.findById).toHaveBeenCalledWith("u1");
    expect(walletTransferService.createTransfer).toHaveBeenCalledWith(
      { _id: "u1", email: "agent@a.com" },
      { appId: "app_b", identifier: "agent@b.com", pin: "1234", amount: 50, note: "moving funds" },
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Transfer completed",
      data: { reference: "crossapp_abc", status: "completed" },
    });
  });

  it("returns 404 when the source user is missing", async () => {
    User.findById.mockResolvedValue(null);
    const { req, res } = mockReqRes({ body: { appId: "app_b", identifier: "a@b.com", pin: "1234", amount: 10 } });
    await walletTransferController.createTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("maps a disabled-feature error to 403", async () => {
    User.findById.mockResolvedValue({ _id: "u1", email: "agent@a.com" });
    const err = new Error("Cross-app wallet transfers are disabled by the administrator.");
    err.status = 403;
    walletTransferService.createTransfer.mockRejectedValue(err);

    const { req, res } = mockReqRes({ body: { appId: "app_b", identifier: "a@b.com", pin: "1234", amount: 10 } });
    await walletTransferController.createTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("maps a PIN error to 400", async () => {
    User.findById.mockResolvedValue({ _id: "u1", email: "agent@a.com" });
    walletTransferService.createTransfer.mockRejectedValue(new Error("Invalid security PIN"));

    const { req, res } = mockReqRes({ body: { appId: "app_b", identifier: "a@b.com", pin: "9999", amount: 10 } });
    await walletTransferController.createTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("getHistory", () => {
  it("returns the user's transfers", async () => {
    walletTransferService.getTransfersForUser.mockResolvedValue({
      transfers: [{ reference: "crossapp_1" }],
      pagination: { total: 1, page: 1, limit: 20, pages: 1 },
    });

    const { req, res } = mockReqRes({ query: { page: "1", limit: "20" } });
    await walletTransferController.getHistory(req, res);

    expect(walletTransferService.getTransfersForUser).toHaveBeenCalledWith("u1", 1, 20);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      transfers: [{ reference: "crossapp_1" }],
      pagination: { total: 1, page: 1, limit: 20, pages: 1 },
    });
  });
});

describe("recheck", () => {
  it("rechecks a pending transfer", async () => {
    walletTransferService.recheckTransfer.mockResolvedValue({
      reference: "crossapp_x",
      status: "completed",
    });

    const { req, res } = mockReqRes({ params: { reference: "crossapp_x" } });
    await walletTransferController.recheck(req, res);

    expect(walletTransferService.recheckTransfer).toHaveBeenCalledWith("u1", "crossapp_x");
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      transfer: { reference: "crossapp_x", status: "completed" },
    });
  });

  it("returns 404 when the transfer is not found", async () => {
    const err = new Error("Transfer not found");
    err.status = 404;
    walletTransferService.recheckTransfer.mockRejectedValue(err);

    const { req, res } = mockReqRes({ params: { reference: "crossapp_x" } });
    await walletTransferController.recheck(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("adminList", () => {
  it("returns all transfers with pagination", async () => {
    walletTransferService.getAdminTransfers.mockResolvedValue({
      transfers: [],
      pagination: { total: 0, page: 1, limit: 20, pages: 0 },
    });

    const { req, res } = mockReqRes({ query: { page: "1", limit: "20" } });
    await walletTransferController.adminList(req, res);

    expect(walletTransferService.getAdminTransfers).toHaveBeenCalledWith(1, 20, undefined);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      transfers: [],
      pagination: { total: 0, page: 1, limit: 20, pages: 0 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/controllers/walletTransferController.test.js`
Expected: FAIL — module `./walletTransferController.js` cannot be resolved.

- [ ] **Step 3: Create the controller**

Create `backend/src/controllers/walletTransferController.js`:

```js
import User from "../models/User.js";
import walletTransferService from "../services/walletTransferService.js";
import logger from "../utils/logger.js";

class WalletTransferController {
  async getTargets(req, res) {
    try {
      const targets = await walletTransferService.getTransferTargets();
      return res.json({ success: true, targets });
    } catch (err) {
      logger.error(`[walletTransfer.getTargets] ${err.message}`);
      return res
        .status(500)
        .json({ success: false, message: "Failed to get transfer targets" });
    }
  }

  async createTransfer(req, res) {
    try {
      const { appId, identifier, pin, amount, note } = req.body;

      const sourceUser = await User.findById(req.user.userId);
      if (!sourceUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const result = await walletTransferService.createTransfer(sourceUser, {
        appId,
        identifier,
        pin,
        amount: parseFloat(amount),
        note,
      });

      return res.json({
        success: true,
        message: "Transfer completed",
        data: { reference: result.reference, status: result.status },
      });
    } catch (err) {
      logger.error(`[walletTransfer.createTransfer] ${err.message}`);
      const message = err.message;
      const status =
        err.status ||
        (message.includes("disabled")
          ? 403
          : message.includes("not found")
            ? 404
            : message.includes("PIN")
              ? 400
              : message.includes("Insufficient")
                ? 400
                : /^Request to .* failed:/.test(message) ||
                    message.includes("Request to")
                  ? 502
                  : 400);
      return res.status(status).json({ success: false, message });
    }
  }

  async getHistory(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await walletTransferService.getTransfersForUser(
        req.user.userId,
        parseInt(page, 10),
        parseInt(limit, 10),
      );
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error(`[walletTransfer.getHistory] ${err.message}`);
      return res
        .status(500)
        .json({ success: false, message: "Failed to get transfer history" });
    }
  }

  async recheck(req, res) {
    try {
      const transfer = await walletTransferService.recheckTransfer(
        req.user.userId,
        req.params.reference,
      );
      return res.json({ success: true, transfer });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ success: false, message: err.message });
    }
  }

  async adminList(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const result = await walletTransferService.getAdminTransfers(
        parseInt(page, 10),
        parseInt(limit, 10),
        status,
      );
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error(`[walletTransfer.adminList] ${err.message}`);
      return res
        .status(500)
        .json({ success: false, message: "Failed to get transfers" });
    }
  }
}

export default new WalletTransferController();
```

- [ ] **Step 4: Add the validator**

In `backend/src/validators/walletValidator.js`, inside the `walletValidation` object (after `momoVerify`, line 83), add:

```js
  // ── Cross-App Wallet Transfer (agent self-service) ─────────────────────────
  crossAppTransfer: [
    body('appId')
      .notEmpty().withMessage('Destination app is required')
      .isString().withMessage('Destination app must be a string')
      .trim(),
    body('identifier')
      .notEmpty().withMessage('Destination identifier is required')
      .isString().withMessage('Identifier must be a string')
      .trim()
      .isLength({ min: 3, max: 200 }).withMessage('Identifier must be between 3 and 200 characters'),
    body('pin')
      .notEmpty().withMessage('Security PIN is required')
      .isLength({ min: 4, max: 6 }).withMessage('PIN must be 4 to 6 digits')
      .matches(/^\d{4,6}$/).withMessage('PIN must contain only digits'),
    body('amount')
      .notEmpty().withMessage('Amount is required')
      .isFloat({ min: 0.01 }).withMessage('Amount must be a positive number'),
    body('note')
      .optional()
      .isString().withMessage('Note must be a string')
      .trim()
      .isLength({ max: 200 }).withMessage('Note must be at most 200 characters'),
  ],
```

- [ ] **Step 5: Add the routes**

In `backend/src/routes/walletRoutes.js`, add the import after line 5 (`momoBridgeController`):

```js
import walletTransferController from "../controllers/walletTransferController.js";
```

And add the routes (after the MoMo Bridge block, before the Earnings & payouts block):

```js
// ── Cross-App Wallet Transfer (agent self-service) ───────────────────────────
router.get(
  "/transfer/targets",
  authenticate,
  authorizeWalletUser,
  walletTransferController.getTargets,
);
router.post(
  "/transfer",
  authenticate,
  authorizeWalletUser,
  apiEndpointLimits.highFrequency,
  validate(walletValidation.crossAppTransfer),
  walletTransferController.createTransfer,
);
router.get(
  "/transfer/history",
  authenticate,
  authorizeWalletUser,
  walletTransferController.getHistory,
);
router.post(
  "/transfer/:reference/recheck",
  authenticate,
  authorizeWalletUser,
  walletTransferController.recheck,
);
```

And in the admin block (after `/admin-transactions`, line 133):

```js
router.get(
  "/transfers",
  authenticate,
  authorize("super_admin"),
  walletTransferController.adminList,
);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/controllers/walletTransferController.test.js`
Expected: PASS (all suites — 11 tests).

- [ ] **Step 7: Commit**

```bash
git add src/controllers/walletTransferController.js src/routes/walletRoutes.js src/validators/walletValidator.js src/controllers/walletTransferController.test.js
git commit -m "feat(wallet): agent-facing cross-app transfer endpoints with validation and rate limit"
```

---

### Task 8: Backend Full Suite + Lint

**Files:** none (verification only).

**Interfaces:** n/a.

- [ ] **Step 1: Run the full backend test suite**

Run: `npm test`
Expected: All suites pass (existing ~249 tests + ~34 new tests from this feature). If any pre-existing test fails, stop and investigate — do not fix unrelated failures silently.

- [ ] **Step 2: Lint the new/changed files**

Run: `npx eslint src/models/CrossAppTransfer.js src/controllers/internalWalletTransferController.js src/controllers/walletTransferController.js src/services/walletTransferService.js src/services/settingsService.js src/controllers/settingsController.js src/routes/walletRoutes.js src/routes/internalRoutes.js src/routes/settingsRoutes.js src/validators/walletValidator.js src/utils/appContextResolver.js`
Expected: No errors (existing files may emit pre-existing warnings — only fix issues in the newly added lines).

- [ ] **Step 3: Commit any lint cleanups**

```bash
git add -A src
git commit -m "chore(wallet): lint and finalize backend cross-app transfer feature"
```

---

### Task 9: Frontend Types + Service Methods (BryteLinks)

**Files:**
- Modify: `BryteLinks/src/types/wallet.ts`
- Modify: `BryteLinks/src/services/wallet-service.ts`

**Interfaces:**
- Consumes: existing `apiClient`, `extractApiError`.
- Produces (TypeScript):
  - `type CrossAppTransferStatus = "completed" | "failed" | "pending"`
  - `interface CrossAppTransfer`
  - `walletService.getTransferTargets()` → `Promise<{ appId: string; name: string }[]>`
  - `walletService.crossAppTransfer(appId, { identifier, pin, amount, note? })` → `Promise<{ reference: string; status: string }>`
  - `walletService.getTransferHistory(page, limit)` → `{ transfers, pagination }`
  - `walletService.adminGetTransfers(page, limit, status?)` → `{ transfers, pagination }`
  - `walletService.recheckTransfer(reference)` → `Promise<CrossAppTransfer>`

- [ ] **Step 1: Add the types**

In `BryteLinks/src/types/wallet.ts`, after `TransactionHistoryResponse` (line 38), add:

```ts
export type CrossAppTransferStatus = "completed" | "failed" | "pending";

export interface CrossAppTransfer {
  _id: string;
  reference: string;
  sourceAppId: string;
  destAppId: string;
  sourceUserId?: string | null;
  destUserId?: string | null;
  sourceUserEmail?: string;
  destUserEmail?: string;
  amount: number;
  status: CrossAppTransferStatus;
  note?: string;
  sourceAppName: string;
  destAppName: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}
```

- [ ] **Step 2: Add the service methods**

In `BryteLinks/src/services/wallet-service.ts`:
1. Add `CrossAppTransfer` to the type import from `../types/wallet`.
2. Add these methods after the `crossAppGetUsers` method (end of the object, line 630):

```ts
  // ---------------------------------------------------------------------------
  // Cross-app wallet transfer (agent self-service)
  // ---------------------------------------------------------------------------

  getTransferTargets: async (): Promise<{ appId: string; name: string }[]> => {
    const response = await apiClient.get<{
      success: boolean;
      targets: { appId: string; name: string }[];
    }>("/api/wallet/transfer/targets");
    return response.data.targets || [];
  },

  crossAppTransfer: async (
    appId: string,
    data: { identifier: string; pin: string; amount: number; note?: string }
  ): Promise<{ reference: string; status: string }> => {
    try {
      const response = await apiClient.post<{
        success: boolean;
        data: { reference: string; status: string };
      }>("/api/wallet/transfer", { appId, ...data });
      return response.data.data;
    } catch (err) {
      throw new Error(extractApiError(err));
    }
  },

  getTransferHistory: async (
    page = 1,
    limit = 20
  ): Promise<{
    transfers: CrossAppTransfer[];
    pagination: { total: number; page: number; limit: number; pages: number };
  }> => {
    const response = await apiClient.get<{
      success: boolean;
      transfers: CrossAppTransfer[];
      pagination: { total: number; page: number; limit: number; pages: number };
    }>(`/api/wallet/transfer/history?page=${page}&limit=${limit}`);
    return {
      transfers: response.data.transfers,
      pagination: response.data.pagination,
    };
  },

  adminGetTransfers: async (
    page = 1,
    limit = 20,
    status?: CrossAppTransferStatus
  ): Promise<{
    transfers: CrossAppTransfer[];
    pagination: { total: number; page: number; limit: number; pages: number };
  }> => {
    const params = new URLSearchParams();
    params.append("page", page.toString());
    params.append("limit", limit.toString());
    if (status) params.append("status", status);
    const response = await apiClient.get<{
      success: boolean;
      transfers: CrossAppTransfer[];
      pagination: { total: number; page: number; limit: number; pages: number };
    }>(`/api/wallet/transfers?${params.toString()}`);
    return {
      transfers: response.data.transfers,
      pagination: response.data.pagination,
    };
  },

  recheckTransfer: async (reference: string): Promise<CrossAppTransfer> => {
    const response = await apiClient.post<{
      success: boolean;
      transfer: CrossAppTransfer;
    }>(`/api/wallet/transfer/${encodeURIComponent(reference)}/recheck`);
    return response.data.transfer;
  },
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: TypeScript zero errors, Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/types/wallet.ts src/services/wallet-service.ts
git commit -m "feat(wallet): cross-app transfer types and service methods"
```

---

### Task 10: CrossAppWalletTransferDialog (BryteLinks)

**Files:**
- Create: `BryteLinks/src/components/wallet/CrossAppWalletTransferDialog.tsx`

**Interfaces:**
- Consumes: `walletService.getTransferTargets` / `crossAppTransfer` (Task 9), design-system `Dialog/DialogHeader/DialogBody/DialogFooter/Button/Input/Textarea/Alert`, `useToast`.
- Produces: `CrossAppWalletTransferDialog` with props `{ isOpen, onClose, balance, onSuccess }`. Three steps: form → confirm → success. Fetches targets on open; disables Continue when invalid or amount exceeds balance.

- [ ] **Step 1: Write the component**

Create `BryteLinks/src/components/wallet/CrossAppWalletTransferDialog.tsx`:

```tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, type ReactNode } from "react";
import {
  FaArrowLeft,
  FaArrowRight,
  FaCheck,
  FaExchangeAlt,
} from "react-icons/fa";
import {
  Button,
  Input,
  Textarea,
  Alert,
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "../../design-system";
import { useToast } from "../../design-system/components/toast";
import { walletService } from "../../services/wallet-service";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  balance: number;
  onSuccess: () => void;
}

interface FormState {
  appId: string;
  identifier: string;
  pin: string;
  amount: string;
  note: string;
}

const emptyForm: FormState = {
  appId: "",
  identifier: "",
  pin: "",
  amount: "",
  note: "",
};

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between text-sm">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="font-medium" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  );
}

export function CrossAppWalletTransferDialog({
  isOpen,
  onClose,
  balance,
  onSuccess,
}: Props) {
  const { addToast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [targets, setTargets] = useState<{ appId: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    reference: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setForm(emptyForm);
      setError(null);
      setResult(null);
      return;
    }
    walletService
      .getTransferTargets()
      .then(setTargets)
      .catch(() => setTargets([]));
  }, [isOpen]);

  const amountNum = parseFloat(form.amount) || 0;
  const canContinue =
    form.appId !== "" &&
    form.identifier.trim() !== "" &&
    /^\d{4,6}$/.test(form.pin) &&
    amountNum > 0 &&
    amountNum <= balance;

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await walletService.crossAppTransfer(form.appId, {
        identifier: form.identifier.trim(),
        pin: form.pin,
        amount: amountNum,
        note: form.note.trim() || undefined,
      });
      setResult(res);
      setStep(3);
      addToast("Transfer completed", "success", 5000);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const selectedTarget = targets.find((t) => t.appId === form.appId);

  return (
    <Dialog isOpen={isOpen} onClose={onClose} size="md">
      <DialogHeader>
        <div className="flex items-center gap-2">
          <FaExchangeAlt style={{ color: "var(--color-secondary)" }} />
          <h3
            className="font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Transfer to Another App
          </h3>
        </div>
      </DialogHeader>

      <DialogBody>
        {step === 1 && (
          <div className="space-y-4">
            <Alert status="info">
              <div className="text-sm">
                Move balance from this wallet into your wallet on another
                connected app. You verify the destination with its security PIN.
              </div>
            </Alert>

            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "var(--text-secondary)" }}
              >
                Destination App
              </label>
              <select
                value={form.appId}
                onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}
                className="w-full rounded-lg border px-3 py-2 text-sm bg-[var(--bg-surface)]"
                style={{ borderColor: "var(--border-color)", color: "var(--text-primary)" }}
              >
                <option value="">Select destination app</option>
                {targets.map((t) => (
                  <option key={t.appId} value={t.appId}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "var(--text-secondary)" }}
              >
                Destination Identifier (email / phone / agent code)
              </label>
              <Input
                value={form.identifier}
                onChange={(e) => setForm((f) => ({ ...f, identifier: e.target.value }))}
                placeholder="e.g. agent@directdata.shop or 0244XXXXXX"
              />
            </div>

            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "var(--text-secondary)" }}
              >
                Destination Security PIN
              </label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={form.pin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, "") }))
                }
                placeholder="••••"
              />
            </div>

            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "var(--text-secondary)" }}
              >
                Amount (GHS)
              </label>
              <Input
                type="number"
                min={0.01}
                max={balance}
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder={`Available: ${balance}`}
              />
            </div>

            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "var(--text-secondary)" }}
              >
                Note (optional)
              </label>
              <Textarea
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Optional note for this transfer"
              />
            </div>

            {amountNum > balance && (
              <Alert status="error">
                <div className="text-sm">Amount exceeds your available balance.</div>
              </Alert>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Alert status="info">
              <div className="text-sm">Review your transfer before submitting.</div>
            </Alert>
            <SummaryRow
              label="Destination"
              value={selectedTarget?.name || form.appId}
            />
            <SummaryRow label="Identifier" value={form.identifier} />
            <SummaryRow label="Amount" value={`GHS ${amountNum.toFixed(2)}`} />
            {form.note && <SummaryRow label="Note" value={form.note} />}
            {error && (
              <Alert status="error">
                <div className="text-sm">{error}</div>
              </Alert>
            )}
          </div>
        )}

        {step === 3 && result && (
          <div className="flex flex-col items-center text-center py-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
              style={{
                backgroundColor: "color-mix(in srgb, var(--success) 15%, transparent)",
              }}
            >
              <FaCheck className="text-xl" style={{ color: "var(--success)" }} />
            </div>
            <p
              className="font-semibold text-base"
              style={{ color: "var(--text-primary)" }}
            >
              Transfer Completed
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              Reference: <span className="font-mono">{result.reference}</span>
            </p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Status: {result.status}
            </p>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        {step === 1 && (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              leftIcon={<FaArrowRight />}
              disabled={!canContinue}
              onClick={() => setStep(2)}
            >
              Continue
            </Button>
          </>
        )}
        {step === 2 && (
          <>
            <Button
              variant="outline"
              leftIcon={<FaArrowLeft />}
              onClick={() => setStep(1)}
            >
              Back
            </Button>
            <Button variant="primary" isLoading={loading} onClick={handleSubmit}>
              Confirm Transfer
            </Button>
          </>
        )}
        {step === 3 && (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: TypeScript zero errors, Vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/wallet/CrossAppWalletTransferDialog.tsx
git commit -m "feat(wallet): cross-app transfer dialog with PIN verification and confirmation"
```

---

### Task 11: Wire Transfer Button into Agent Wallet Page (BryteLinks)

**Files:**
- Modify: `BryteLinks/src/pages/wallet-page.tsx`

**Interfaces:**
- Consumes: `CrossAppWalletTransferDialog` (Task 10), `walletService.getTransferTargets`, `useWallet().walletBalance`/`refreshWallet`.
- Produces: a "Transfer" button (shown only when the feature is on and at least one enabled connected app exists) next to "Request Top-up", and the dialog wired to it.

- [ ] **Step 1: Make the edits**

In `BryteLinks/src/pages/wallet-page.tsx`:

1. Add `FaExchangeAlt` to the `react-icons/fa` import (line 24, alongside `FaMobileAlt`):

```tsx
  FaExchangeAlt,
```

2. Add the dialog import after the `TopUpRequestModal` import (line 40):

```tsx
import { CrossAppWalletTransferDialog } from "../components/wallet/CrossAppWalletTransferDialog";
```

3. Add state after `showTopUpModal` (line 60):

```tsx
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTargets, setTransferTargets] = useState<{ appId: string; name: string }[]>([]);
```

4. Add an effect that loads targets (near the existing effects, after the MoMo handlers):

```tsx
  useEffect(() => {
    walletService
      .getTransferTargets()
      .then(setTransferTargets)
      .catch(() => setTransferTargets([]));
  }, []);
```

5. Add the button inside the balance-card action row (after the "Instant Claim" button, line 458):

```tsx
                  {transferTargets.length > 0 && (
                    <Button
                      variant="outline"
                      size="md"
                      leftIcon={<FaExchangeAlt />}
                      onClick={() => setShowTransferModal(true)}
                      className="w-full sm:w-auto"
                    >
                      Transfer
                    </Button>
                  )}
```

6. Render the dialog after the `TopUpRequestModal` block (line 980):

```tsx
      <CrossAppWalletTransferDialog
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        balance={walletBalance}
        onSuccess={() => void refreshWallet()}
      />
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: TypeScript zero errors, Vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/wallet-page.tsx
git commit -m "feat(wallet): show cross-app transfer button on agent wallet page"
```

---

### Task 12: Admin Transfers View (BryteLinks)

**Files:**
- Create: `BryteLinks/src/components/superadmin/CrossAppTransfersView.tsx`
- Modify: `BryteLinks/src/pages/superadmin/wallet-top-ups.tsx`

**Interfaces:**
- Consumes: `walletService.adminGetTransfers` (Task 9), design-system `Card/CardHeader/CardBody/Button/Pagination/Badge/Spinner`, `useToast`.
- Produces: `CrossAppTransfersView` self-contained component listing local `CrossAppTransfer` docs (reference, agent, destination app, amount, status, time). `wallet-top-ups.tsx` gets a two-way section switcher ("Operations" | "Transfers").

- [ ] **Step 1: Write the component**

Create `BryteLinks/src/components/superadmin/CrossAppTransfersView.tsx`:

```tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { FaSync, FaExchangeAlt } from "react-icons/fa";
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  Badge,
  Pagination,
  Spinner,
} from "../../design-system";
import { useToast } from "../../design-system/components/toast";
import { walletService } from "../../services/wallet-service";
import type { CrossAppTransfer, CrossAppTransferStatus } from "../../types/wallet";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(n);

const STATUS_COLORS: Record<CrossAppTransferStatus, string> = {
  completed: "var(--success)",
  failed: "var(--error)",
  pending: "var(--warning)",
};

function statusBadge(status: CrossAppTransferStatus) {
  return (
    <Badge
      variant={status === "completed" ? "success" : status === "failed" ? "error" : "warning"}
    >
      {status}
    </Badge>
  );
}

export function CrossAppTransfersView() {
  const { addToast } = useToast();
  const [transfers, setTransfers] = useState<CrossAppTransfer[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);

  const fetchTransfers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const resp = await walletService.adminGetTransfers(page, pagination.limit);
      setTransfers(resp.transfers);
      setPagination(resp.pagination);
    } catch {
      addToast("Failed to load transfers", "error");
    } finally {
      setLoading(false);
    }
  }, [pagination.limit, addToast]);

  useEffect(() => {
    void fetchTransfers(1);
  }, [fetchTransfers]);

  return (
    <Card>
      <CardHeader
        className="p-4"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FaExchangeAlt style={{ color: "var(--color-secondary)" }} />
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              Cross-App Transfers
            </h2>
          </div>
          <Button
            size="xs"
            variant="outline"
            leftIcon={<FaSync />}
            onClick={() => void fetchTransfers(pagination.page)}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardBody className="p-0">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : transfers.length === 0 ? (
          <p className="text-sm py-10 text-center" style={{ color: "var(--text-muted)" }}>
            No cross-app transfers yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <th className="text-left px-4 py-3 font-medium">Reference</th>
                  <th className="text-left px-4 py-3 font-medium">Agent</th>
                  <th className="text-left px-4 py-3 font-medium">Destination</th>
                  <th className="text-left px-4 py-3 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.reference} style={{ borderTop: "1px solid var(--border-color)" }}>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--text-primary)" }}>
                      {t.reference}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
                      {t.sourceUserEmail || "-"}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
                      {t.destAppName || t.destAppId}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
                      {fmt(t.amount)}
                    </td>
                    <td className="px-4 py-3">{statusBadge(t.status)}</td>
                    <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                      {new Date(t.createdAt).toLocaleString("en-GB")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination.pages > 1 && !loading && (
          <div className="border-t px-4 py-3" style={{ borderColor: "var(--border-color)" }}>
            <Pagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              itemsPerPage={pagination.limit}
              onPageChange={(p) => void fetchTransfers(p)}
              onItemsPerPageChange={(n) => {
                setPagination((prev) => ({ ...prev, limit: n, page: 1 }));
                void fetchTransfers(1);
              }}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into wallet-top-ups.tsx**

In `BryteLinks/src/pages/superadmin/wallet-top-ups.tsx`:

1. Add the import after the `CrossAppSwitcher` import (line 33):

```tsx
import { CrossAppTransfersView } from "../../components/superadmin/CrossAppTransfersView";
```

2. Add a section state near `sourceAppId` (line 246):

```tsx
  const [section, setSection] = useState<"operations" | "transfers">("operations");
```

3. Add a segmented control at the top of the returned JSX (just before the analytics card), then conditionally render the rest. Locate the first child of the page container and insert:

```tsx
      <div className="flex items-center gap-2 mb-4 rounded-lg p-1 w-fit" style={{ backgroundColor: "color-mix(in srgb, var(--text-primary) 8%, transparent)" }}>
        <button
          onClick={() => setSection("operations")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            section === "operations" ? "bg-[var(--bg-surface)] shadow-sm" : ""
          }`}
          style={{
            color: section === "operations" ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          Operations
        </button>
        <button
          onClick={() => setSection("transfers")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            section === "transfers" ? "bg-[var(--bg-surface)] shadow-sm" : ""
          }`}
          style={{
            color: section === "transfers" ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          Transfers
        </button>
      </div>

      {section === "transfers" ? (
        <CrossAppTransfersView />
      ) : (
        <>
          {/* ...existing analytics + pending requests + users content... */}
        </>
      )}
```

Note: the existing JSX from the analytics card through the end of the users table (everything after the segmented control up to the `CrossAppSwitcher` at line 994) must be wrapped inside the fragment shown above. Keep all existing elements unchanged.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: TypeScript zero errors, Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/superadmin/CrossAppTransfersView.tsx src/pages/superadmin/wallet-top-ups.tsx
git commit -m "feat(wallet): admin transfers view with operations/transfers section switcher"
```

---

### Task 13: Directdata Port (Symmetric)

**Files:** Apply Tasks 9–12 to the Directdata app:
- Modify: `Directdata/src/types/wallet.ts`
- Modify: `Directdata/src/services/wallet-service.ts`
- Create: `Directdata/src/components/wallet/CrossAppWalletTransferDialog.tsx`
- Modify: `Directdata/src/pages/wallet-page.tsx`
- Create: `Directdata/src/components/superadmin/CrossAppTransfersView.tsx`
- Modify: `Directdata/src/pages/superadmin/wallet-top-ups.tsx`

**Interfaces:** Identical to Tasks 9–12 (Directdata mirrors BryteLinks — same file paths, same line anchors for `wallet-page.tsx` and `wallet-service.ts`).

- [ ] **Step 1: Add types + service methods (Directdata)**

Repeat Task 9 against the Directdata paths (`Directdata/src/types/wallet.ts`, `Directdata/src/services/wallet-service.ts`), using the identical code.

- [ ] **Step 2: Add the dialog component (Directdata)**

Repeat Task 10, creating `Directdata/src/components/wallet/CrossAppWalletTransferDialog.tsx` with the identical code.

- [ ] **Step 3: Wire the wallet page (Directdata)**

Repeat Task 11 against `Directdata/src/pages/wallet-page.tsx` (identical line anchors: import at line 40, state at line 60, button after line 458, dialog after line 980).

- [ ] **Step 4: Add the admin transfers view (Directdata)**

Repeat Task 12: create `Directdata/src/components/superadmin/CrossAppTransfersView.tsx` and wire `Directdata/src/pages/superadmin/wallet-top-ups.tsx`.

- [ ] **Step 5: Verify both builds**

Run: `npm run build` in `C:\Projects\SAAS_E-COMMERCE\Directdata`
Expected: TypeScript zero errors, Vite build succeeds.

Also re-run in BryteLinks:
Run: `npm run build` in `C:\Projects\SAAS_E-COMMERCE\BryteLinks`
Expected: still clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(wallet): port cross-app transfer to Directdata (types, service, dialog, wallet page, admin view)"
```

---

### Task 14: Final Verification

**Files:** none (verification only).

**Interfaces:** n/a.

- [ ] **Step 1: Run the full backend suite**

Run: `npm test` in `C:\Projects\SAAS_E-COMMERCE\backend`
Expected: all suites pass.

- [ ] **Step 2: Run both frontend builds**

Run: `npm run build` in `C:\Projects\SAAS_E-COMMERCE\BryteLinks` and `C:\Projects\SAAS_E-COMMERCE\Directdata`
Expected: both TypeScript zero errors.

- [ ] **Step 3: Manual smoke checklist (documented in the PR, not automated)**

- In a super-admin session: enable `crossAppWalletTransferEnabled` via `PUT /api/settings/wallet-transfer` (or the new settings UI once exposed).
- Connect a second app (integration key + `connectedApps`).
- From the source app, agent wallet: the "Transfer" button appears.
- Transfer to the destination using a correct PIN → destination wallet credited; source wallet debited; both apps show a `WALLET_CROSS_APP_TRANSFER` audit entry; both DBs have a `crossapptransfer` ledger row with the same `reference`.
- Wrong PIN → 401; unconfigured PIN → 400; feature off → button hidden and API 403; destination offline → source rollback (transfer `failed`) or `pending` on timeout.
