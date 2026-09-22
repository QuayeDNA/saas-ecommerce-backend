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
    insertMany: vi.fn(),
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
    updateMany: vi.fn(),
    findByIDAndDelete: vi.fn(),
  },
}));

vi.mock("../models/VerificationBatch.js", () => ({
  default: {
    findOne: vi.fn(),
    find: vi.fn(() => ({
      populate: vi.fn(() => ({
        sort: vi.fn(),
      })),
    })),
    create: vi.fn(),
    findById: vi.fn(),
    updateOne: vi.fn(),
  },
}));

import KnownMtnNumber from "../models/KnownMtnNumber.js";
import VerificationRequest from "../models/VerificationRequest.js";
import VerificationBatch from "../models/VerificationBatch.js";
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
        status: "submitted",
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
        status: "submitted",
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

  describe("approveAllPending (submit-all-pending)", () => {
    it("returns zero counts when there are no pending requests", async () => {
      VerificationRequest.find.mockReturnValue({
        distinct: vi.fn().mockResolvedValue([]),
      });

      const result = await verificationRequestService.approveAllPending("admin1");

      expect(result).toEqual({ submitted: 0, errors: [] });
      expect(VerificationRequest.findById).not.toHaveBeenCalled();
    });

    it("creates a single submitted batch from all pending requests", async () => {
      VerificationRequest.find
        .mockReturnValueOnce({
          distinct: vi.fn().mockResolvedValue(["req1", "req2"]),
        })
        .mockResolvedValue([
          { _id: "req1", phone: "0241111111", status: "pending", save: vi.fn() },
          { _id: "req2", phone: "0242222222", status: "pending", save: vi.fn() },
        ]);
      VerificationBatch.findOne.mockReturnValue({
        sort: vi.fn().mockResolvedValue(null),
      });
      VerificationBatch.create.mockResolvedValue({
        _id: "batch1",
        batchNumber: 1,
      });
      VerificationRequest.updateMany.mockResolvedValue({ modifiedCount: 2 });

      const result = await verificationRequestService.approveAllPending("admin1");

      expect(VerificationBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({ batchNumber: 1 }),
      );
      expect(VerificationRequest.updateMany).toHaveBeenCalled();
      expect(result.submitted).toBe(2);
    });
  });

  describe("submit-to-approved strict workflow", () => {
    it("refuses to approve a request that is still pending", async () => {
      const request = {
        _id: "req1",
        phone: "0241234567",
        status: "pending",
        save: vi.fn().mockResolvedValue({}),
      };
      VerificationRequest.findById.mockResolvedValue(request);

      await expect(
        verificationRequestService.approveRequest("req1", "admin1"),
      ).rejects.toThrow("must be submitted");

      expect(request.save).not.toHaveBeenCalled();
      expect(KnownMtnNumber.create).not.toHaveBeenCalled();
    });

    it("approves a request that is in submitted status", async () => {
      const request = {
        _id: "req1",
        phone: "0241234567",
        status: "submitted",
        save: vi.fn().mockResolvedValue({}),
      };
      VerificationRequest.findById.mockResolvedValue(request);
      KnownMtnNumber.exists.mockResolvedValue(false);
      KnownMtnNumber.create.mockResolvedValue({});

      const result = await verificationRequestService.approveRequest("req1", "admin1");

      expect(result.status).toBe("approved");
      expect(KnownMtnNumber.create).toHaveBeenCalledWith({ phone: "0241234567" });
    });

    it("allows rejecting a pending request directly", async () => {
      const request = {
        _id: "req1",
        phone: "0241234567",
        status: "pending",
        save: vi.fn().mockResolvedValue({}),
      };
      VerificationRequest.findById.mockResolvedValue(request);

      const result = await verificationRequestService.rejectRequest("req1", "admin1");

      expect(result.status).toBe("rejected");
    });

    it("blocks rejecting an approved request", async () => {
      const request = {
        _id: "req1",
        phone: "0241234567",
        status: "approved",
        save: vi.fn().mockResolvedValue({}),
      };
      VerificationRequest.findById.mockResolvedValue(request);

      await expect(
        verificationRequestService.rejectRequest("req1", "admin1"),
      ).rejects.toThrow("cannot be rejected");
    });

    it("deduplicates a fresh submit when a submitted request already exists", async () => {
      const existing = { _id: "req1", phone: "0241234567", status: "submitted" };
      VerificationRequest.findOne.mockResolvedValue(existing);

      const result = await verificationRequestService.submitRequest("0241234567", "agent", "u1");

      expect(result).toBe(existing);
      expect(VerificationRequest.findOne).toHaveBeenCalledWith({
        phone: "0241234567",
        status: { $in: ["pending", "submitted"] },
      });
      expect(VerificationRequest.create).not.toHaveBeenCalled();
    });

    it("includes submitted in the request stats", async () => {
      VerificationRequest.countDocuments.mockResolvedValueOnce(3).mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const stats = await verificationRequestService.getRequestStats();

      expect(stats).toEqual({ pending: 3, submitted: 5, approved: 2, rejected: 1 });
    });
  });

  describe("batches", () => {
    it("creates a batch only from pending requests and assigns submitted status", async () => {
      VerificationRequest.find.mockResolvedValue([
        { _id: "req1", phone: "0241111111", status: "pending" },
        { _id: "req2", phone: "0242222222", status: "pending" },
      ]);
      VerificationBatch.findOne.mockReturnValue({
        sort: vi.fn().mockResolvedValue({ batchNumber: 2 }),
      });
      VerificationBatch.create.mockResolvedValue({ _id: "batch1", batchNumber: 3 });
      VerificationRequest.updateMany.mockResolvedValue({ modifiedCount: 2 });

      const result = await verificationRequestService.createBatchFromPending(["req1", "req2"], "admin1");

      expect(VerificationBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({ batchNumber: 3 }),
      );
      expect(VerificationRequest.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ["req1", "req2"] } },
        expect.objectContaining({
          $set: expect.objectContaining({ status: "submitted", batchId: "batch1" }),
        }),
      );
      expect(result.submitted).toBe(2);
    });

    it("approves the whole batch and marks batch status approved", async () => {
      const members = [
        { _id: "req1", phone: "0241111111", status: "submitted", save: vi.fn().mockResolvedValue({}) },
        { _id: "req2", phone: "0242222222", status: "submitted", save: vi.fn().mockResolvedValue({}) },
      ];
      VerificationRequest.find.mockResolvedValue(members);
      VerificationRequest.findById.mockImplementation((id) =>
        Promise.resolve(members.find((m) => m._id === id)),
      );
      KnownMtnNumber.exists.mockResolvedValue(false);
      KnownMtnNumber.create.mockResolvedValue({});
      VerificationBatch.updateOne.mockResolvedValue({});

      const result = await verificationRequestService.approveBatch("batch1", "admin1");

      expect(result.approved).toBe(2);
      expect(KnownMtnNumber.create).toHaveBeenCalledTimes(2);
      expect(VerificationBatch.updateOne).toHaveBeenCalled();
    });

    it("rejects the whole batch", async () => {
      const members = [
        { _id: "req1", phone: "0241111111", status: "submitted", save: vi.fn().mockResolvedValue({}) },
      ];
      VerificationRequest.find.mockResolvedValue(members);
      VerificationRequest.findById.mockImplementation((id) =>
        Promise.resolve(members.find((m) => m._id === id)),
      );
      VerificationBatch.updateOne.mockResolvedValue({});

      const result = await verificationRequestService.rejectBatch("batch1", "admin1");

      expect(result.rejected).toBe(1);
      expect(VerificationBatch.updateOne).toHaveBeenCalled();
    });

    it("handles mixed approve/reject within a batch per-number", async () => {
      const approveMember = { _id: "req1", phone: "0241111111", status: "submitted", save: vi.fn().mockResolvedValue({}) };
      const rejectMember = { _id: "req2", phone: "0242222222", status: "submitted", save: vi.fn().mockResolvedValue({}) };
      VerificationBatch.findById.mockResolvedValue({ _id: "batch1" });
      VerificationRequest.findOne
        .mockResolvedValueOnce(approveMember)
        .mockResolvedValueOnce(rejectMember);
      VerificationRequest.findById.mockImplementation((id) => {
        if (id === "req1") return Promise.resolve(approveMember);
        return Promise.resolve(rejectMember);
      });
      VerificationRequest.find.mockResolvedValue([
        { status: "approved" },
        { status: "rejected" },
      ]);
      KnownMtnNumber.exists.mockResolvedValue(false);
      KnownMtnNumber.create.mockResolvedValue({});
      VerificationBatch.updateOne.mockResolvedValue({});

      const result = await verificationRequestService.updateBatchNumbers(
        "batch1",
        { approve: ["req1"], reject: ["req2"] },
        "admin1",
      );

      expect(result.approved).toBe(1);
      expect(result.rejected).toBe(1);
      expect(VerificationRequest.findOne).toHaveBeenCalledTimes(2);
    });

    it("lists batches and derives member counts", async () => {
      VerificationBatch.find.mockReturnValue({
        populate: vi.fn().mockReturnValue({
          sort: vi.fn().mockResolvedValue([
            { _id: "batch1", batchNumber: 1, submittedAt: new Date(), status: "partial", createdBy: "admin1" },
          ]),
        }),
      });
      VerificationRequest.find.mockResolvedValue([
        { batchId: "batch1", status: "approved" },
        { batchId: "batch1", status: "rejected" },
        { batchId: "batch1", status: "submitted" },
      ]);

      const batches = await verificationRequestService.listBatches();

      expect(batches[0].counts).toEqual({ submitted: 1, approved: 1, rejected: 1 });
      expect(batches[0].total).toBe(3);
    });
  });

  describe("bulkAddKnownNumbers", () => {
    it("adds multiple new numbers with a single insertMany call", async () => {
      KnownMtnNumber.find.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      });
      KnownMtnNumber.insertMany.mockResolvedValue([
        { phone: "0241234567" },
        { phone: "0201234567" },
      ]);

      const result = await verificationRequestService.bulkAddKnownNumbers([
        "0241234567",
        "0201234567",
      ]);

      expect(KnownMtnNumber.insertMany).toHaveBeenCalledTimes(1);
      expect(KnownMtnNumber.insertMany).toHaveBeenCalledWith(
        [{ phone: "0241234567" }, { phone: "0201234567" }],
        expect.objectContaining({ ordered: false })
      );
      expect(result.addedCount).toBe(2);
      expect(result.duplicateCount).toBe(0);
      expect(result.invalidCount).toBe(0);
    });

    it("reports existing numbers as duplicates and invalid numbers without inserting them", async () => {
      KnownMtnNumber.find.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([{ phone: "0241234567" }]),
        }),
      });
      KnownMtnNumber.insertMany.mockResolvedValue([{ phone: "0201234567" }]);

      const result = await verificationRequestService.bulkAddKnownNumbers([
        "0241234567",
        "0201234567",
        "not-a-number",
        "0201234567",
      ]);

      expect(KnownMtnNumber.insertMany).toHaveBeenCalledTimes(1);
      expect(KnownMtnNumber.insertMany).toHaveBeenCalledWith(
        [{ phone: "0201234567" }],
        expect.objectContaining({ ordered: false })
      );
      expect(result.added).toEqual(["0201234567"]);
      expect(result.duplicates).toEqual(["0241234567"]);
      expect(result.invalid).toEqual(["notanumber"]);
      expect(result.addedCount).toBe(1);
      expect(result.duplicateCount).toBe(1);
      expect(result.invalidCount).toBe(1);
    });
  });
});
