import logger from "../utils/logger.js";
import { normalizePhoneNumber, PHONE_PATTERN } from "../utils/phoneNumber.js";

const verificationRequestService = {
  async submitRequest(phone, source, userId) {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const normalizedPhone = normalizePhoneNumber(phone);

      const existing = await VerificationRequest.findOne({
        phone: normalizedPhone,
        status: { $in: ["pending", "submitted"] },
      });
      if (existing) return existing;

      let request;
      try {
        request = await VerificationRequest.create({
          phone: normalizedPhone,
          source,
          ...(userId ? { submittedBy: userId } : {}),
        });
      } catch (error) {
        if (error.code === 11000) {
          const dup = await VerificationRequest.findOne({
            phone: normalizedPhone,
            status: { $in: ["pending", "submitted"] },
          });
          if (dup) return dup;
        }
        throw error;
      }

      logger.info(`Verification request created: ${request._id} for phone ${normalizedPhone}`);
      return request;
    } catch (error) {
      logger.error(`Error submitting verification request: ${error.message}`);
      throw error;
    }
  },

  async checkPhoneStatus(phone) {
    try {
      const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const normalizedPhone = normalizePhoneNumber(phone);

      const known = await KnownMtnNumber.exists({ phone: normalizedPhone });
      if (known) return { known: true, request: null };

      const request = await VerificationRequest.findOne({
        phone: normalizedPhone,
        status: "pending",
      }).sort({ createdAt: -1 });

      return { known: false, request };
    } catch (error) {
      logger.error(`Error checking phone status: ${error.message}`);
      throw error;
    }
  },

  async listRequests(page = 1, limit = 20, search = "", status = "", source = "") {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const filter = {};
      if (status) filter.status = status;
      if (source) filter.source = source;
      if (search) filter.phone = { $regex: search, $options: "i" };

      const total = await VerificationRequest.countDocuments(filter);
      const requests = await VerificationRequest.find(filter)
        .populate("submittedBy", "name email phone")
        .populate("reviewedBy", "name email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      return { requests, total, page, totalPages: Math.ceil(total / limit) };
    } catch (error) {
      logger.error(`Error listing verification requests: ${error.message}`);
      throw error;
    }
  },

  async listPendingPhones() {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;
      const docs = await VerificationRequest.find({ status: "pending" })
        .select("phone")
        .sort({ createdAt: -1 });
      return docs.map((d) => d.phone);
    } catch (error) {
      logger.error(`Error listing pending phones: ${error.message}`);
      throw error;
    }
  },

  async getRequestStats() {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const [pending, submitted, approved, rejected] = await Promise.all([
        VerificationRequest.countDocuments({ status: "pending" }),
        VerificationRequest.countDocuments({ status: "submitted" }),
        VerificationRequest.countDocuments({ status: "approved" }),
        VerificationRequest.countDocuments({ status: "rejected" }),
      ]);

      return { pending, submitted, approved, rejected };
    } catch (error) {
      logger.error(`Error getting verification request stats: ${error.message}`);
      throw error;
    }
  },

  async approveRequest(id, adminId) {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;
      const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;

      const request = await VerificationRequest.findById(id);
      if (!request) throw new Error("Verification request not found");
      if (request.status === "approved") return request;
      if (request.status !== "submitted") {
        throw new Error("Request must be submitted before it can be approved");
      }

      request.status = "approved";
      request.reviewedBy = adminId;
      await request.save();

      const normalizedPhone = normalizePhoneNumber(request.phone);
      const exists = await KnownMtnNumber.exists({ phone: normalizedPhone });
      if (!exists) {
        await KnownMtnNumber.create({ phone: normalizedPhone });
      }

      logger.info(`Verification request approved: ${id} by admin ${adminId}`);
      return request;
    } catch (error) {
      logger.error(`Error approving verification request: ${error.message}`);
      throw error;
    }
  },

  async rejectRequest(id, adminId) {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const request = await VerificationRequest.findById(id);
      if (!request) throw new Error("Verification request not found");
      if (request.status === "rejected") return request;
      if (request.status === "approved") {
        throw new Error("Approved request cannot be rejected");
      }

      request.status = "rejected";
      request.reviewedBy = adminId;
      await request.save();

      logger.info(`Verification request rejected: ${id} by admin ${adminId}`);
      return request;
    } catch (error) {
      logger.error(`Error rejecting verification request: ${error.message}`);
      throw error;
    }
  },

  async bulkApprove(ids, adminId) {
    const approved = [];
    const errors = [];

    for (const id of ids) {
      try {
        await this.approveRequest(id, adminId);
        approved.push(id);
      } catch (error) {
        errors.push({ id, error: error.message });
      }
    }

    return { approved: approved.length, errors };
  },

  async approveAllPending(adminId) {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const pendingIds = await VerificationRequest.find({
        status: "pending",
      }).distinct("_id");

      if (pendingIds.length === 0) {
        return { submitted: 0, errors: [] };
      }

      return await this.createBatchFromPending(pendingIds, adminId);
    } catch (error) {
      logger.error(`Error submitting all pending requests: ${error.message}`);
      throw error;
    }
  },

  async bulkReject(ids, adminId) {
    const rejected = [];
    const errors = [];

    for (const id of ids) {
      try {
        await this.rejectRequest(id, adminId);
        rejected.push(id);
      } catch (error) {
        errors.push({ id, error: error.message });
      }
    }

    return { rejected: rejected.length, errors };
  },

  // ─── Batches (submitted) ─────────────────────────────────────────────────

  async getNextBatchNumber() {
    const VerificationBatch = (await import("../models/VerificationBatch.js")).default;
    const last = await VerificationBatch.findOne({}).sort({ batchNumber: -1 });
    return (last ? last.batchNumber : 0) + 1;
  },

  async createBatchFromPending(ids, adminId) {
    try {
      const VerificationBatch = (await import("../models/VerificationBatch.js")).default;
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const requests = await VerificationRequest.find({ _id: { $in: ids } });
      const valid = requests.filter((r) => r.status === "pending");
      const invalidIds = ids.filter(
        (id) => !requests.some((r) => String(r._id) === String(id) || r.status === "pending"),
      );

      if (valid.length === 0) {
        return { batchId: null, submitted: 0, errors: invalidIds.map((id) => ({ id, error: "No pending requests found" })) };
      }

      const batchNumber = await this.getNextBatchNumber();
      const batch = await VerificationBatch.create({
        batchNumber,
        createdBy: adminId,
        submittedAt: new Date(),
        status: "submitted",
      });

      const submittedAt = new Date();
      const updated = await VerificationRequest.updateMany(
        { _id: { $in: valid.map((r) => r._id) } },
        {
          $set: { status: "submitted", batchId: batch._id, submittedAt },
        },
      );

      const errors = [];
      for (const id of ids) {
        const r = requests.find((x) => String(x._id) === String(id));
        if (!r || r.status !== "pending") errors.push({ id, error: "Request is not pending" });
      }

      logger.info(`Created verification batch ${batchNumber} with ${valid.length} numbers`);
      return {
        batchId: batch._id,
        batchNumber,
        submitted: updated.modifiedCount ?? valid.length,
        errors,
      };
    } catch (error) {
      logger.error(`Error creating verification batch: ${error.message}`);
      throw error;
    }
  },

  async listBatches() {
    try {
      const VerificationBatch = (await import("../models/VerificationBatch.js")).default;
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const batches = await VerificationBatch.find({})
        .populate("createdBy", "name email")
        .sort({ submittedAt: -1 });

      const batchIds = batches.map((b) => b._id);
      const members = await VerificationRequest.find({
        batchId: { $in: batchIds },
        status: { $in: ["submitted", "approved", "rejected"] },
      });

      const grouped = {};
      for (const m of members) {
        const key = String(m.batchId);
        if (!grouped[key]) grouped[key] = { submitted: 0, approved: 0, rejected: 0 };
        if (m.status === "submitted") grouped[key].submitted += 1;
        else if (m.status === "approved") grouped[key].approved += 1;
        else if (m.status === "rejected") grouped[key].rejected += 1;
      }

      return batches.map((b) => {
        const counts = grouped[String(b._id)] || { submitted: 0, approved: 0, rejected: 0 };
        return {
          _id: b._id,
          batchNumber: b.batchNumber,
          submittedAt: b.submittedAt,
          createdBy: b.createdBy,
          status: b.status,
          counts,
          total: counts.submitted + counts.approved + counts.rejected,
        };
      });
    } catch (error) {
      logger.error(`Error listing verification batches: ${error.message}`);
      throw error;
    }
  },

  async refreshBatchStatus(batchId) {
    const VerificationBatch = (await import("../models/VerificationBatch.js")).default;
    const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

    const members = await VerificationRequest.find({ batchId });
    const statuses = members.map((m) => m.status);
    const hasPendingSubmit = statuses.includes("submitted");
    const allApproved = statuses.length > 0 && statuses.every((s) => s === "approved");
    const allRejected = statuses.length > 0 && statuses.every((s) => s === "rejected");

    let status = "submitted";
    if (allApproved) status = "approved";
    else if (allRejected) status = "rejected";
    else if (hasPendingSubmit && (statuses.includes("approved") || statuses.includes("rejected"))) status = "partial";

    await VerificationBatch.updateOne({ _id: batchId }, { $set: { status } });
    return status;
  },

  async approveBatch(batchId, adminId) {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;
      const members = await VerificationRequest.find({ batchId, status: "submitted" });
      if (members.length === 0) return { approved: 0, errors: [] };

      let approved = 0;
      const errors = [];
      for (const m of members) {
        try {
          await this.approveRequest(m._id, adminId);
          approved += 1;
        } catch (error) {
          errors.push({ id: m._id, error: error.message });
        }
      }

      await this.refreshBatchStatus(batchId);
      return { approved, errors };
    } catch (error) {
      logger.error(`Error approving batch: ${error.message}`);
      throw error;
    }
  },

  async rejectBatch(batchId, adminId) {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;
      const members = await VerificationRequest.find({ batchId, status: "submitted" });
      if (members.length === 0) return { rejected: 0, errors: [] };

      let rejected = 0;
      const errors = [];
      for (const m of members) {
        try {
          await this.rejectRequest(m._id, adminId);
          rejected += 1;
        } catch (error) {
          errors.push({ id: m._id, error: error.message });
        }
      }

      await this.refreshBatchStatus(batchId);
      return { rejected, errors };
    } catch (error) {
      logger.error(`Error rejecting batch: ${error.message}`);
      throw error;
    }
  },

  async updateBatchNumbers(batchId, { approve = [], reject = [] }, adminId) {
    try {
      const VerificationBatch = (await import("../models/VerificationBatch.js")).default;
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const batch = await VerificationBatch.findById(batchId);
      if (!batch) throw new Error("Verification batch not found");

      let approved = 0;
      let rejected = 0;
      const errors = [];

      for (const id of approve) {
        const m = await VerificationRequest.findOne({ _id: id, batchId });
        if (!m) { errors.push({ id, error: "Number not found in batch" }); continue; }
        try {
          await this.approveRequest(m._id, adminId);
          approved += 1;
        } catch (error) {
          errors.push({ id, error: error.message });
        }
      }

      for (const id of reject) {
        const m = await VerificationRequest.findOne({ _id: id, batchId });
        if (!m) { errors.push({ id, error: "Number not found in batch" }); continue; }
        try {
          await this.rejectRequest(m._id, adminId);
          rejected += 1;
        } catch (error) {
          errors.push({ id, error: error.message });
        }
      }

      await this.refreshBatchStatus(batchId);
      return { approved, rejected, errors };
    } catch (error) {
      logger.error(`Error updating batch numbers: ${error.message}`);
      throw error;
    }
  },

  async listBatchMembers(batchId) {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;
      return await VerificationRequest.find({ batchId })
        .populate("submittedBy", "name email phone")
        .populate("reviewedBy", "name email")
        .sort({ createdAt: -1 });
    } catch (error) {
      logger.error(`Error listing batch members: ${error.message}`);
      throw error;
    }
  },

  async listMyRequests(userId, page = 1, limit = 20, status = "") {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const filter = { submittedBy: userId };
      if (status) filter.status = status;

      const total = await VerificationRequest.countDocuments(filter);
      const requests = await VerificationRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      return { requests, total, page, totalPages: Math.ceil(total / limit) };
    } catch (error) {
      logger.error(`Error listing my verification requests: ${error.message}`);
      throw error;
    }
  },

  // ─── Known Numbers CRUD ──────────────────────────────────────────────────

  async listKnownNumbers(page = 1, limit = 20, search = "") {
    try {
      const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;

      const filter = {};
      if (search) filter.phone = { $regex: search, $options: "i" };

      const total = await KnownMtnNumber.countDocuments(filter);
      const numbers = await KnownMtnNumber.find(filter)
        .sort({ importedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      return { numbers, total, page, totalPages: Math.ceil(total / limit) };
    } catch (error) {
      logger.error(`Error listing known numbers: ${error.message}`);
      throw error;
    }
  },

  async getKnownNumberStats() {
    try {
      const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
      const total = await KnownMtnNumber.countDocuments();
      return { totalKnownNumbers: total };
    } catch (error) {
      logger.error(`Error getting known number stats: ${error.message}`);
      throw error;
    }
  },

  async addKnownNumber(phone) {
    try {
      const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;

      const normalized = normalizePhoneNumber(phone);
      if (!PHONE_PATTERN.test(normalized)) {
        throw new Error("Invalid phone number");
      }

      const exists = await KnownMtnNumber.exists({ phone: normalized });
      if (exists) throw new Error("Number already exists in known list");

      const result = await KnownMtnNumber.create({ phone: normalized });
      logger.info(`Known number added: ${normalized}`);
      return result;
    } catch (error) {
      logger.error(`Error adding known number: ${error.message}`);
      throw error;
    }
  },

  async deleteKnownNumber(id) {
    try {
      const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
      const result = await KnownMtnNumber.findByIdAndDelete(id);
      if (!result) throw new Error("Known number not found");
      logger.info(`Known number deleted: ${id}`);
      return result;
    } catch (error) {
      logger.error(`Error deleting known number: ${error.message}`);
      throw error;
    }
  },

  async bulkDeleteKnownNumbers(ids) {
    try {
      const KnownMtnNumber = (await import("../models/KnownMtnNumber.js")).default;
      const result = await KnownMtnNumber.deleteMany({ _id: { $in: ids } });
      logger.info(`Bulk deleted known numbers: ${result.deletedCount}`);
      return { deletedCount: result.deletedCount };
    } catch (error) {
      logger.error(`Error bulk deleting known numbers: ${error.message}`);
      throw error;
    }
  },
};

export default verificationRequestService;
