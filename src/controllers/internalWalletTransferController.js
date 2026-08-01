import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import CrossAppTransfer from "../models/CrossAppTransfer.js";
import walletService from "../services/walletService.js";
import { canHaveWallet } from "../utils/userTypeHelpers.js";
import { getLocalAppIdentity } from "../utils/appContextResolver.js";
import logger from "../utils/logger.js";
import { logAuditAction } from "../utils/auditLogger.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

const isValidPin = (pin) => /^\d{4,6}$/.test(String(pin || ""));

export async function verifyDestination(req, res) {
  try {
    const { identifier, pin } = req.body;

    if (!identifier || !identifier.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Destination identifier is required" });
    }
    if (!isValidPin(pin)) {
      return res.status(400).json({
        success: false,
        message: "Security PIN must be 4 to 6 digits",
      });
    }

    const trimmed = identifier.trim();
    const user = await User.findOne({
      $or: [
        { email: trimmed.toLowerCase() },
        { phone: trimmed },
        { agentCode: trimmed },
      ],
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Destination account not found" });
    }

    if (!canHaveWallet(user.userType) || user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Destination account is not wallet-enabled or is inactive",
      });
    }

    if (user.requiresPinSetup || !user.securityPin) {
      return res.status(400).json({
        success: false,
        message: "Security PIN not configured",
      });
    }

    const isPinMatch = await bcrypt.compare(String(pin), user.securityPin);
    if (!isPinMatch) {
      logger.warn(`Invalid destination PIN attempt for identifier: ${trimmed}`);
      return res
        .status(401)
        .json({ success: false, message: "Invalid security PIN" });
    }

    const transferTicket = jwt.sign(
      { userId: user._id, purpose: "wallet_transfer", scope: "credit_only" },
      process.env.JWTSECRET,
      { expiresIn: "5m" },
    );

    return res.json({
      success: true,
      data: { userId: user._id, transferTicket, email: user.email },
    });
  } catch (err) {
    logger.error(`[internal.verifyDestination] ${err.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to verify destination" });
  }
}
