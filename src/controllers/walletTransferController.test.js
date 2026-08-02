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

  it("returns 202 with the reference when the transfer is pending", async () => {
    User.findById.mockResolvedValue({ _id: "u1", email: "agent@a.com" });
    walletTransferService.createTransfer.mockResolvedValue({
      reference: "crossapp_x",
      status: "pending",
    });

    const { req, res } = mockReqRes({
      body: {
        appId: "app_b",
        identifier: "agent@b.com",
        pin: "1234",
        amount: 50,
      },
    });
    await walletTransferController.createTransfer(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Transfer submitted; pending confirmation",
      data: { reference: "crossapp_x", status: "pending" },
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

  it("maps a PIN error to 400 even when the service error carries a 401 status", async () => {
    User.findById.mockResolvedValue({ _id: "u1", email: "agent@a.com" });
    const err = new Error("Invalid security PIN");
    err.status = 401;
    walletTransferService.createTransfer.mockRejectedValue(err);

    const { req, res } = mockReqRes({ body: { appId: "app_b", identifier: "a@b.com", pin: "9999", amount: 10 } });
    await walletTransferController.createTransfer(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(401);
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
