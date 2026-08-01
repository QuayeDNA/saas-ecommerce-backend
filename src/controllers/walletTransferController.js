import User from "../models/User.js";
import walletTransferService from "../services/walletTransferService.js";
import logger from "../utils/logger.js";

class WalletTransferController {
  async getTargets(req, res) {
    try {
      const targets = await walletTransferService.getTransferTargets();
      return res.json({ success: true, targets });
    } catch (err) {
      logger.error(`[walletTransfer.getTargets] ${err.message}`);
      return res
        .status(500)
        .json({ success: false, message: "Failed to get transfer targets" });
    }
  }

  async createTransfer(req, res) {
    try {
      const { appId, identifier, pin, amount, note } = req.body;

      const sourceUser = await User.findById(req.user.userId);
      if (!sourceUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const result = await walletTransferService.createTransfer(sourceUser, {
        appId,
        identifier,
        pin,
        amount: parseFloat(amount),
        note,
      });

      return res.json({
        success: true,
        message: "Transfer completed",
        data: { reference: result.reference, status: result.status },
      });
    } catch (err) {
      logger.error(`[walletTransfer.createTransfer] ${err.message}`);
      const message = err.message;
      const status =
        err.status ||
        (message.includes("disabled")
          ? 403
          : message.includes("not found")
            ? 404
            : message.includes("PIN")
              ? 400
              : message.includes("Insufficient")
                ? 400
                : /^Request to .* failed:/.test(message) ||
                    message.includes("Request to")
                  ? 502
                  : 400);
      return res.status(status).json({ success: false, message });
    }
  }

  async getHistory(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await walletTransferService.getTransfersForUser(
        req.user.userId,
        parseInt(page, 10),
        parseInt(limit, 10),
      );
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error(`[walletTransfer.getHistory] ${err.message}`);
      return res
        .status(500)
        .json({ success: false, message: "Failed to get transfer history" });
    }
  }

  async recheck(req, res) {
    try {
      const transfer = await walletTransferService.recheckTransfer(
        req.user.userId,
        req.params.reference,
      );
      return res.json({ success: true, transfer });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ success: false, message: err.message });
    }
  }

  async adminList(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const result = await walletTransferService.getAdminTransfers(
        parseInt(page, 10),
        parseInt(limit, 10),
        status,
      );
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error(`[walletTransfer.adminList] ${err.message}`);
      return res
        .status(500)
        .json({ success: false, message: "Failed to get transfers" });
    }
  }
}

export default new WalletTransferController();
