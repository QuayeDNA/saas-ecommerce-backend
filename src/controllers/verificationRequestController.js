import verificationRequestService from "../services/verificationRequestService.js";
import logger from "../utils/logger.js";

const verificationRequestController = {
  async submitRequest(req, res) {
    try {
      const request = await verificationRequestService.submitRequest(
        req.body.phone,
        req.body.source,
        req.user._id,
      );
      res.status(201).json({ success: true, data: request });
    } catch (error) {
      logger.error("Error submitting verification request:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to submit verification request" });
    }
  },

  async checkPhoneStatus(req, res) {
    try {
      const data = await verificationRequestService.checkPhoneStatus(req.query.phone);
      res.json({ success: true, data });
    } catch (error) {
      logger.error("Error checking phone status:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to check phone status" });
    }
  },

  async listRequests(req, res) {
    try {
      const { page, limit, search, status, source } = req.query;
      const result = await verificationRequestService.listRequests(
        page ? parseInt(page, 10) : undefined,
        limit ? parseInt(limit, 10) : undefined,
        search,
        status,
        source,
      );
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error("Error listing verification requests:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to list verification requests" });
    }
  },

  async listPendingPhones(req, res) {
    try {
      const phones = await verificationRequestService.listPendingPhones();
      res.json({ success: true, data: phones });
    } catch (error) {
      logger.error("Error listing pending phones:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to list pending phones" });
    }
  },

  async getRequestStats(req, res) {
    try {
      const stats = await verificationRequestService.getRequestStats();
      res.json({ success: true, data: stats });
    } catch (error) {
      logger.error("Error getting verification request stats:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to get verification request stats" });
    }
  },

  async approveRequest(req, res) {
    try {
      const request = await verificationRequestService.approveRequest(
        req.params.id,
        req.user._id,
      );
      res.json({ success: true, data: request });
    } catch (error) {
      logger.error("Error approving verification request:", error);
      const status = error.message.includes("not found") ? 404 : 500;
      res
        .status(status)
        .json({ success: false, error: error.message });
    }
  },

  async rejectRequest(req, res) {
    try {
      const request = await verificationRequestService.rejectRequest(
        req.params.id,
        req.user._id,
      );
      res.json({ success: true, data: request });
    } catch (error) {
      logger.error("Error rejecting verification request:", error);
      const status = error.message.includes("not found") ? 404 : 500;
      res
        .status(status)
        .json({ success: false, error: error.message });
    }
  },

  async bulkApprove(req, res) {
    try {
      const result = await verificationRequestService.bulkApprove(
        req.body.ids,
        req.user._id,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error("Error bulk approving verification requests:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to bulk approve verification requests" });
    }
  },

  async approveAllPending(req, res) {
    try {
      const result = await verificationRequestService.approveAllPending(
        req.user._id,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error("Error approving all pending verification requests:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to approve all pending verification requests" });
    }
  },

  async bulkReject(req, res) {
    try {
      const result = await verificationRequestService.bulkReject(
        req.body.ids,
        req.user._id,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error("Error bulk rejecting verification requests:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to bulk reject verification requests" });
    }
  },

  async submitPublicRequest(req, res) {
    try {
      const request = await verificationRequestService.submitRequest(
        req.body.phone,
        "customer",
        null,
      );
      res.status(201).json({ success: true, data: request });
    } catch (error) {
      logger.error("Error submitting public verification request:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to submit verification request" });
    }
  },

  async listMyRequests(req, res) {
    try {
      const { page, limit, status } = req.query;
      const result = await verificationRequestService.listMyRequests(
        req.user._id,
        page ? parseInt(page, 10) : undefined,
        limit ? parseInt(limit, 10) : undefined,
        status,
      );
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error("Error listing my verification requests:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to list verification requests" });
    }
  },

  // ─── Known Numbers ─────────────────────────────────────────────────────

  async listKnownNumbers(req, res) {
    try {
      const { page, limit, search } = req.query;
      const result = await verificationRequestService.listKnownNumbers(
        page ? parseInt(page, 10) : undefined,
        limit ? parseInt(limit, 10) : undefined,
        search,
      );
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error("Error listing known numbers:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to list known numbers" });
    }
  },

  async getKnownNumberStats(req, res) {
    try {
      const data = await verificationRequestService.getKnownNumberStats();
      res.json({ success: true, data });
    } catch (error) {
      logger.error("Error getting known number stats:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to get known number stats" });
    }
  },

  async addKnownNumber(req, res) {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ success: false, message: "Phone number is required" });
      }
      const result = await verificationRequestService.addKnownNumber(phone);
      res.status(201).json({ success: true, number: result });
    } catch (error) {
      const status = error.message.includes("Invalid") || error.message.includes("already") ? 400 : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  },

  async deleteKnownNumber(req, res) {
    try {
      await verificationRequestService.deleteKnownNumber(req.params.id);
      res.json({ success: true, message: "Number removed from known list" });
    } catch (error) {
      const status = error.message.includes("not found") ? 404 : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  },

  async bulkDeleteKnownNumbers(req, res) {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "IDs array is required" });
      }
      const result = await verificationRequestService.bulkDeleteKnownNumbers(ids);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

export default verificationRequestController;
