import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/User.js", () => ({
  default: { findByIdAndUpdate: vi.fn() },
}));

vi.mock("../models/WalletTransaction.js", () => ({
  default: {
    findOne: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock("./settingsService.js", () => ({
  default: { getMomoBridgeSettings: vi.fn() },
}));

vi.mock("./websocketService.js", () => ({
  default: { sendToUser: vi.fn() },
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../utils/auditLogger.js", () => ({
  logAuditAction: vi.fn(),
}));

import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import settingsService from "./settingsService.js";
import momoBridgeService from "./momoBridgeService.js";

const SETTINGS = {
  momoBridgeRelayUrl: "https://relay.test",
  momoBridgeApiKey: "mb_test",
  momoBridgeEnabled: true,
  momoBridgeClaimFeePercent: 0,
};

function relayOk(overrides = {}) {
  return {
    confirmed: true,
    code: "confirmed",
    message: "Payment confirmed",
    transaction: { reference: "REF1", amount: 100, network: "MTN" },
    ...overrides,
  };
}

describe("MomoBridgeService hardening", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    settingsService.getMomoBridgeSettings.mockResolvedValue({ ...SETTINGS });
  });

  it("credits the wallet once on relay confirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => relayOk(),
      }),
    );
    WalletTransaction.findOne.mockResolvedValue(null);
    WalletTransaction.create.mockImplementation(async (doc) => ({
      _id: "doc1",
      ...doc,
    }));
    WalletTransaction.findOneAndUpdate.mockImplementation(async () => ({
      _id: "doc1",
      reference: "momobridge_REF1",
      status: "completed",
      metadata: { credited: false },
    }));
    User.findByIdAndUpdate.mockResolvedValue({
      _id: "user1",
      walletBalance: 100,
    });

    const result = await momoBridgeService.verifyAndCredit("user1", "REF1");

    expect(result.success).toBe(true);
    expect(result.netAmount).toBe(100);
    expect(User.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      "user1",
      expect.objectContaining({ $inc: { walletBalance: 100 } }),
      expect.anything(),
    );
    vi.unstubAllGlobals();
  });

  it("treats already_confirmed WITH amount as success and credits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          relayOk({
            confirmed: true,
            code: "already_confirmed",
            message: "Transaction already confirmed",
          }),
      }),
    );
    WalletTransaction.findOne.mockResolvedValue(null);
    WalletTransaction.create.mockImplementation(async (doc) => ({
      _id: "doc2",
      ...doc,
    }));
    WalletTransaction.findOneAndUpdate.mockResolvedValue({
      _id: "doc2",
      status: "completed",
      metadata: { credited: false },
    });
    User.findByIdAndUpdate.mockResolvedValue({
      _id: "user1",
      walletBalance: 100,
    });

    const result = await momoBridgeService.verifyAndCredit("user1", "REF1");

    expect(result.success).toBe(true);
    expect(result.netAmount).toBe(100);
    expect(User.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("returns idempotent success without re-crediting when already completed+credited", async () => {
    WalletTransaction.findOne.mockResolvedValue({
      _id: "doc3",
      reference: "momobridge_REF1",
      status: "completed",
      amount: 100,
      balanceAfter: 500,
      metadata: {
        credited: true,
        grossAmount: 100,
        feeAmount: 0,
        netAmount: 100,
        feePercent: 0,
        momoReference: "REF1",
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await momoBridgeService.verifyAndCredit("user1", "REF1");

    expect(result.success).toBe(true);
    expect(result.netAmount).toBe(100);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("recovers credit when doc is completed but not yet credited", async () => {
    WalletTransaction.findOne.mockResolvedValue({
      _id: "doc4",
      reference: "momobridge_REF1",
      status: "completed",
      metadata: {
        credited: false,
        grossAmount: 100,
        feeAmount: 0,
        netAmount: 100,
        feePercent: 0,
        momoReference: "REF1",
      },
    });
    User.findByIdAndUpdate.mockResolvedValue({
      _id: "user1",
      walletBalance: 600,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await momoBridgeService.verifyAndCredit("user1", "REF1");

    expect(result.success).toBe(true);
    expect(User.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("blocks retry while another claim is freshly in flight", async () => {
    WalletTransaction.findOne.mockResolvedValue({
      _id: "doc5",
      reference: "momobridge_REF1",
      status: "processing",
      metadata: { startedAt: Date.now() },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      momoBridgeService.verifyAndCredit("user1", "REF1"),
    ).rejects.toThrow(/being processed/i);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does NOT credit when relay reports already WITHOUT an amount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          confirmed: false,
          code: "already_confirmed",
          message: "Transaction already confirmed",
          transaction: null,
        }),
      }),
    );
    WalletTransaction.findOne.mockResolvedValue(null);
    WalletTransaction.create.mockImplementation(async (doc) => ({
      _id: "doc6",
      ...doc,
    }));

    await expect(
      momoBridgeService.verifyAndCredit("user1", "REF1"),
    ).rejects.toThrow(/amount/i);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("marks failed and throws relay message on business rejection (no credit)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          confirmed: false,
          code: "invalid",
          message: "Transaction not found",
          transaction: null,
        }),
      }),
    );
    WalletTransaction.findOne.mockResolvedValue(null);
    WalletTransaction.create.mockImplementation(async (doc) => ({
      _id: "doc7",
      ...doc,
    }));

    await expect(
      momoBridgeService.verifyAndCredit("user1", "NOPE"),
    ).rejects.toThrow(/not found/i);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("leaves a retryable marker and throws transient on relay timeout", async () => {
    const timeoutErr = new Error("The operation was aborted");
    timeoutErr.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutErr));
    WalletTransaction.findOne.mockResolvedValue(null);
    WalletTransaction.create.mockImplementation(async (doc) => ({
      _id: "doc8",
      ...doc,
    }));

    await expect(
      momoBridgeService.verifyAndCredit("user1", "REF1"),
    ).rejects.toThrow(/offline|timed out|try again/i);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    // Marker must be retryable (failed/transient), never terminal.
    expect(WalletTransaction.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "doc8" }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "failed" }),
      }),
    );
    vi.unstubAllGlobals();
  });
});
