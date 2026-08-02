import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/User.js", () => ({
  default: {
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock("../models/WalletTransaction.js", () => {
  const WalletTransaction = vi.fn();
  WalletTransaction.findOne = vi.fn().mockImplementation(() => ({
    lean: vi.fn().mockResolvedValue(null),
  }));
  WalletTransaction.find = vi.fn();
  WalletTransaction.create = vi.fn();
  WalletTransaction.countDocuments = vi.fn();
  WalletTransaction.prototype.save = vi.fn();
  return { default: WalletTransaction };
});

vi.mock("../models/PaystackVerificationTask.js", () => ({
  default: {
    create: vi.fn(),
    findOne: vi.fn().mockImplementation(() => ({
      lean: vi.fn().mockResolvedValue(null),
    })),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../utils/auditLogger.js", () => ({
  logAuditAction: vi.fn(),
}));

vi.mock("../services/paystackService.js", () => ({
  default: {
    ensureKeys: vi.fn().mockResolvedValue(),
    getPublicKey: vi.fn(() => "pk_test_xxx"),
    convertToPesewas: vi.fn((ghs) => Math.round(ghs * 100)),
    createCustomer: vi.fn().mockResolvedValue({ customer_code: "CUS_xxx" }),
    initializeTransaction: vi.fn().mockResolvedValue({}),
    verifyTransaction: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../utils/paystackHelpers.js", () => ({
  getWalletTopUpFeeConfig: vi.fn(),
  calculateChargeWithFees: vi.fn(),
}));

import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import walletService from "./walletService.js";

const mockUser = {
  _id: "user123",
  walletBalance: 500,
  save: vi.fn().mockResolvedValue(true),
};

describe("WalletService — creditWallet idempotency", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    WalletTransaction.findOne.mockImplementation(() => ({
      lean: vi.fn().mockResolvedValue(null),
    }));
    WalletTransaction.mockImplementation(function (data) {
      return {
        ...data,
        save: WalletTransaction.prototype.save,
      };
    });
  });

  it("returns the existing transaction without re-crediting when idempotencyKey matches", async () => {
    const existing = { _id: "txn-credit-1", status: "completed" };
    User.findById.mockResolvedValue({ ...mockUser });
    WalletTransaction.findOne.mockResolvedValue(existing);

    const result = await walletService.creditWallet(
      "user123",
      100,
      "Credit",
      null,
      { idempotencyKey: "crossapp_x" },
    );

    expect(WalletTransaction.findOne).toHaveBeenCalledWith({
      user: "user123",
      type: "credit",
      status: "completed",
      "metadata.idempotencyKey": "crossapp_x",
    });
    expect(WalletTransaction.prototype.save).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it("credits normally when no completed transaction matches the idempotencyKey", async () => {
    WalletTransaction.findOne.mockResolvedValue(null);
    const user = { ...mockUser };
    User.findById.mockResolvedValue(user);

    const result = await walletService.creditWallet(
      "user123",
      100,
      "Credit",
      null,
      { idempotencyKey: "crossapp_x" },
    );

    expect(user.walletBalance).toBe(600);
    expect(result.type).toBe("credit");
    expect(result.amount).toBe(100);
    expect(result.metadata.idempotencyKey).toBe("crossapp_x");
  });

  it("does not look up idempotency when no idempotencyKey is supplied", async () => {
    WalletTransaction.findOne.mockResolvedValue(null);
    User.findById.mockResolvedValue({ ...mockUser });

    await walletService.creditWallet("user123", 100, "Credit");

    expect(WalletTransaction.findOne).not.toHaveBeenCalled();
  });
});
