import momoBridgeService from "../services/momoBridgeService.js";
import settingsService from "../services/settingsService.js";
import logger from "../utils/logger.js";
import { logAuditAction } from "../utils/auditLogger.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

class MomoBridgeController {

  async getConfig(req, res) {
    try {
      const { userId } = req.user;

      const config = await momoBridgeService.getCheckoutConfig(userId);

      res.json({ success: true, data: config });
    } catch (err) {
      logger.error(`[momoBridge.getConfig] ${err.message}`);
      const status =
        err.message.includes("disabled") ||
        err.message.includes("not configured")
          ? 400
          : 500;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async verifyClaim(req, res) {
    try {
      const { userId, userType } = req.user;
      const { reference } = req.body;

      if (!reference || !reference.trim()) {
        return res.status(400).json({
          success: false,
          message: "Transaction reference is required",
        });
      }

      const result = await momoBridgeService.verifyAndCredit(
        userId,
        reference.trim(),
      );

      await logAuditAction(req, {
        userId,
        userType,
        action: AUDIT_ACTIONS.WALLET_CREDITED,
        category: AUDIT_CATEGORIES.WALLET,
        resource: { userId },
        metadata: {
          source: "momoBridgeController.verifyClaim",
          grossAmount: result.grossAmount,
          netAmount: result.netAmount,
          feeAmount: result.feeAmount,
          feePercent: result.feePercent,
          momoReference: reference.trim(),
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      res.json({
        success: true,
        message: "Payment verified and wallet credited",
        data: {
          grossAmount: result.grossAmount,
          feeAmount: result.feeAmount,
          netAmount: result.netAmount,
          feePercent: result.feePercent,
          reference: result.reference,
        },
      });
    } catch (err) {
      logger.error(`[momoBridge.verifyClaim] ${err.message}`);
      const message = err.message;
      const status =
        message.includes("already been claimed") ||
        message.includes("being processed")
          ? 409
          : message.includes("not found")
            ? 404
            : message.includes("disabled") ||
                message.includes("not configured")
              ? 400
              : 400;
      res.status(status).json({ success: false, message });
    }
  }
}

export default new MomoBridgeController();
