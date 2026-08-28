import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/KnownMtnNumber.js", () => ({
  default: {
    exists: vi.fn(),
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        skip: vi.fn(() => ({
          limit: vi.fn(),
        })),
      })),
    })),
    countDocuments: vi.fn(),
    create: vi.fn(),
    findByIdAndDelete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("../models/VerificationRequest.js", () => ({
  default: {
    findOne: vi.fn(),
    create: vi.fn(),
    find: vi.fn(() => ({
      populate: vi.fn(() => ({
        populate: vi.fn(() => ({
          sort: vi.fn(() => ({
            skip: vi.fn(() => ({
              limit: vi.fn(),
            })),
          })),
        })),
      })),
    })),
    countDocuments: vi.fn(),
    findById: vi.fn(),
  },
}));

import KnownMtnNumber from "../models/KnownMtnNumber.js";
import VerificationRequest from "../models/VerificationRequest.js";
import verificationRequestService from "./verificationRequestService.js";

describe("VerificationRequestService phone normalization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("checkPhoneStatus", () => {
    it("normalizes +233 prefix before checking the known list (should treat +233241234567 as 0241234567)", async () => {
      KnownMtnNumber.exists.mockResolvedValue(true);
      await verificationRequestService.checkPhoneStatus("+233241234567");
      expect(KnownMtnNumber.exists).toHaveBeenCalledWith({
        phone: "0241234567",
      });
    });

    it("normalizes 233 prefix and separators before checking the known list", async () => {
      KnownMtnNumber.exists.mockResolvedValue(false);
      VerificationRequest.findOne.mockReturnValue({
        sort: vi.fn().mockResolvedValue(null),
      });
      await verificationRequestService.checkPhoneStatus("233-241-234-567");
      expect(KnownMtnNumber.exists).toHaveBeenCalledWith({
        phone: "0241234567",
      });
    });

    it("checks the normalized phone in the pending request lookup", async () => {
      KnownMtnNumber.exists.mockResolvedValue(false);
      VerificationRequest.findOne.mockReturnValue({
        sort: vi.fn().mockResolvedValue(null),
      });
      await verificationRequestService.checkPhoneStatus("0241234567");
      expect(VerificationRequest.findOne).toHaveBeenCalledWith({
        phone: "0241234567",
        status: "pending",
      });
    });
  });

  describe("submitRequest", () => {
    it("stores normalized phone so 233 and 0 formats dedup to the same record", async () => {
      VerificationRequest.findOne.mockResolvedValue(null);
      VerificationRequest.create.mockResolvedValue({
        _id: "req1",
        phone: "0241234567",
        source: "agent",
        submittedBy: "u1",
      });
      await verificationRequestService.submitRequest("233241234567", "agent", "u1");
      expect(VerificationRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "0241234567", source: "agent", submittedBy: "u1" }),
      );
    });

    it("treats a duplicate-key race as success and returns the existing pending request", async () => {
      const dupErr = new Error("E11000 duplicate key error");
      dupErr.code = 11000;
      const existingReq = { _id: "req-dup", phone: "0241234567", status: "pending" };

      VerificationRequest.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingReq);
      VerificationRequest.create.mockRejectedValue(dupErr);

      const result = await verificationRequestService.submitRequest("0241234567", "customer", null);

      expect(result).toBe(existingReq);
      expect(VerificationRequest.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("approveRequest", () => {
    it("adds a normalized phone to the known list on approval", async () => {
      const request = {
        _id: "req1",
        phone: "233241234567",
        status: "pending",
        save: vi.fn().mockResolvedValue({}),
      };
      VerificationRequest.findById.mockResolvedValue(request);
      KnownMtnNumber.exists.mockResolvedValue(false);
      KnownMtnNumber.create.mockResolvedValue({});

      await verificationRequestService.approveRequest("req1", "admin1");

      expect(KnownMtnNumber.create).toHaveBeenCalledWith({
        phone: "0241234567",
      });
    });

    it("does not re-add a known number that already exists (normalized match)", async () => {
      const request = {
        _id: "req1",
        phone: "233241234567",
        status: "pending",
        save: vi.fn().mockResolvedValue({}),
      };
      VerificationRequest.findById.mockResolvedValue(request);
      KnownMtnNumber.exists.mockResolvedValue(true);

      await verificationRequestService.approveRequest("req1", "admin1");

      expect(KnownMtnNumber.create).not.toHaveBeenCalled();
    });
  });

  describe("addKnownNumber", () => {
    it("normalizes and stores the canonical 0XXXXXXXXX format", async () => {
      KnownMtnNumber.exists.mockResolvedValue(false);
      KnownMtnNumber.create.mockResolvedValue({ _id: "k1", phone: "0241234567" });
      await verificationRequestService.addKnownNumber("+233 24 123 4567");
      expect(KnownMtnNumber.create).toHaveBeenCalledWith({
        phone: "0241234567",
      });
    });

    it("rejects numbers shorter than 10 digits after normalization", async () => {
      await expect(
        verificationRequestService.addKnownNumber("02412"),
      ).rejects.toThrow("Invalid phone number");
      expect(KnownMtnNumber.create).not.toHaveBeenCalled();
    });
  });

  describe("approveAllPending", () => {
    it("returns zero counts when there are no pending requests", async () => {
      VerificationRequest.find.mockReturnValue({
        distinct: vi.fn().mockResolvedValue([]),
      });

      const result = await verificationRequestService.approveAllPending("admin1");

      expect(result).toEqual({ approved: 0, errors: [] });
      expect(VerificationRequest.findById).not.toHaveBeenCalled();
    });

    it("approves every currently pending request", async () => {
      VerificationRequest.find.mockReturnValue({
        distinct: vi.fn().mockResolvedValue(["req1", "req2"]),
      });
      VerificationRequest.findById.mockImplementation((id) =>
        Promise.resolve({
          _id: id,
          phone: "0241234567",
          status: "pending",
          save: vi.fn().mockResolvedValue({}),
        }),
      );
      KnownMtnNumber.exists.mockResolvedValue(false);
      KnownMtnNumber.create.mockResolvedValue({});

      const result = await verificationRequestService.approveAllPending("admin1");

      expect(result.approved).toBe(2);
      expect(result.errors).toEqual([]);
      expect(VerificationRequest.findById).toHaveBeenCalledTimes(2);
      expect(KnownMtnNumber.create).toHaveBeenCalledTimes(2);
    });

    it("does not double-approve numbers already in the known list", async () => {
      VerificationRequest.find.mockReturnValue({
        distinct: vi.fn().mockResolvedValue(["req1"]),
      });
      VerificationRequest.findById.mockResolvedValue({
        _id: "req1",
        phone: "0241234567",
        status: "pending",
        save: vi.fn().mockResolvedValue({}),
      });
      KnownMtnNumber.exists.mockResolvedValue(true);

      const result = await verificationRequestService.approveAllPending("admin1");

      expect(result.approved).toBe(1);
      expect(KnownMtnNumber.create).not.toHaveBeenCalled();
    });
  });
});
