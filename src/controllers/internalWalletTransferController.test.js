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

  it("rejects a non-numeric amount", async () => {
    jwt.verify.mockReturnValue({
      userId: "u1",
      purpose: "wallet_transfer",
      scope: "credit_only",
    });
    WalletTransaction.findOne.mockResolvedValue(null);
    User.findById.mockResolvedValue(makeUser());

    const { req, res } = mockReqRes({
      body: { userId: "u1", amount: "abc", reference: "crossapp_x", ticket: "tk" },
    });
    await controller.creditTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(walletService.creditWallet).not.toHaveBeenCalled();
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
        idempotencyKey: "crossapp_x",
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
