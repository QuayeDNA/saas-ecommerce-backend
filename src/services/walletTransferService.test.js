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
