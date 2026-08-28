import logger from "../utils/logger.js";
import { normalizePhoneNumber, PHONE_PATTERN } from "../utils/phoneNumber.js";

const verificationRequestService = {
  async submitRequest(phone, source, userId) {
    try {
      const VerificationRequest = (await import("../models/VerificationRequest.js")).default;

      const normalizedPhone = normalizePhoneNumber(phone);

      const existing = await VerificationRequest.findOne({
        phone: normalizedPhone,
        status: "pending",
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
            status: "pending",
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

      const [pending, approved, rejected] = await Promise.all([
        VerificationRequest.countDocuments({ status: "pending" }),
        VerificationRequest.countDocuments({ status: "approved" }),
        VerificationRequest.countDocuments({ status: "rejected" }),
      ]);

      return { pending, approved, rejected };
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
        return { approved: 0, errors: [] };
      }

      return await this.bulkApprove(pendingIds, adminId);
    } catch (error) {
      logger.error(`Error approving all pending requests: ${error.message}`);
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
