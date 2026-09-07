import blockedRecipientService from "../services/blockedRecipientService.js";
import logger from "../utils/logger.js";

const blockedRecipientController = {
  async list(req, res) {
    try {
      const { page, limit, search } = req.query;
      const result = await blockedRecipientService.listBlocked({ page, limit, search });
      // paginated shape
      if (result.items) {
        return res.json({ success: true, data: result.items, total: result.total, page: result.page, totalPages: result.totalPages });
      }
      return res.json({ success: true, data: result });
    } catch (error) {
      logger.error("Error listing blocked recipients:", error);
      res.status(500).json({ success: false, error: "Failed to list blocked recipients" });
    }
  },

  async stats(req, res) {
    try {
      const data = await blockedRecipientService.getStats();
      res.json({ success: true, data });
    } catch (error) {
      logger.error("Error getting blocked stats:", error);
      res.status(500).json({ success: false, error: "Failed to get stats" });
    }
  },

  async check(req, res) {
    try {
      const blocked = await blockedRecipientService.isBlocked(req.query.phone);
      res.json({ success: true, data: { phone: blockedRecipientService.normalizePhone(req.query.phone), blocked } });
    } catch (error) {
      logger.error("Error checking blocked recipient:", error);
      res.status(500).json({ success: false, error: "Failed to check" });
    }
  },

  async block(req, res) {
    try {
      let { phones, reason } = req.body;
      if (typeof phones === "string") phones = [phones];
      if (!Array.isArray(phones) || phones.length === 0) {
        return res.status(400).json({ success: false, message: "phones array is required" });
      }
      const result = await blockedRecipientService.blockNumbers(phones, { reason, addedBy: req.user?._id || null });
      // Return fresh list info for UI
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      logger.error("Error blocking recipients:", error);
      res.status(500).json({ success: false, error: "Failed to block numbers" });
    }
  },

  async unblock(req, res) {
    try {
      const phone = req.params.phone;
      const result = await blockedRecipientService.unblockNumbers([phone]);
      if (result.removed === 0) return res.status(404).json({ success: false, message: "Number not found in blocklist" });
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error("Error unblocking recipient:", error);
      res.status(500).json({ success: false, error: "Failed to unblock" });
    }
  },

  async bulkUnblock(req, res) {
    try {
      const { phones } = req.body;
      const result = await blockedRecipientService.unblockNumbers(phones);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error("Error bulk unblocking:", error);
      res.status(500).json({ success: false, error: "Failed to bulk unblock" });
    }
  },
};

export default blockedRecipientController;
