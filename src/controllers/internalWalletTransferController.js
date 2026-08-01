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

export async function creditTransfer(req, res) {
  try {
    const { userId, amount, reference, ticket, metadata } = req.body;

    if (!userId || !amount || amount <= 0 || !reference || !ticket) {
      return res.status(400).json({
        success: false,
        message: "userId, amount, reference and ticket are required",
      });
    }

    const referenceStr = String(reference);

    // ── Ticket verification ────────────────────────────────────────────────
    let ticketPayload;
    try {
      ticketPayload = jwt.verify(ticket, process.env.JWTSECRET);
    } catch (err) {
      return res
        .status(401)
        .json({ success: false, message: "Transfer ticket is invalid or expired" });
    }

    if (
      ticketPayload.purpose !== "wallet_transfer" ||
      ticketPayload.scope !== "credit_only" ||
      String(ticketPayload.userId) !== String(userId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Transfer ticket does not match the destination account",
      });
    }

    // ── Idempotency guard (completed credits only) ─────────────────────────
    const existing = await WalletTransaction.findOne({
      reference: referenceStr,
      status: "completed",
    });
    if (existing) {
      return res.json({
        success: true,
        alreadyProcessed: true,
        transaction: existing,
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (!canHaveWallet(user.userType) || user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Destination account is not wallet-enabled or is inactive",
      });
    }

    const sourceAppId = metadata?.sourceAppId || "unknown";
    const sourceAppName = metadata?.sourceAppName || sourceAppId;
    const sourceUserEmail = metadata?.sourceUserEmail || "";

    const transaction = await walletService.creditWallet(
      userId,
      parseFloat(amount),
      `Cross-app transfer from ${sourceAppName} (${referenceStr})`,
      null,
      {
        adminAction: true,
        crossApp: true,
        crossAppTransfer: {
          reference: referenceStr,
          fromAppId: sourceAppId,
          sourceAppName,
        },
      },
    );

    // ── Best-effort destination ledger (idempotent by reference) ───────────
    const localIdentity = getLocalAppIdentity();
    await CrossAppTransfer.findOneAndUpdate(
      { reference: referenceStr },
      {
        $set: {
          reference: referenceStr,
          sourceAppId,
          destAppId: localIdentity.appId,
          sourceUserEmail,
          destUserEmail: user.email || "",
          amount: parseFloat(amount),
          status: "completed",
          sourceAppName,
          destAppName: localIdentity.name,
          error: null,
          completedAt: new Date(),
        },
        $setOnInsert: {
          sourceUserId: null,
          destUserId: userId,
        },
      },
      { upsert: true, setDefaultsOnInsert: true, new: true },
    );

    await logAuditAction(null, {
      userId,
      action: AUDIT_ACTIONS.WALLET_CROSS_APP_TRANSFER,
      category: AUDIT_CATEGORIES.WALLET,
      resource: { userId },
      metadata: {
        source: "internal.creditTransfer",
        reference: referenceStr,
        amount: parseFloat(amount),
        fromAppId: sourceAppId,
        fromAppName: sourceAppName,
        direction: "credit",
      },
      severity: AUDIT_SEVERITIES.INFO,
    });

    return res.json({
      success: true,
      transaction,
      reference: referenceStr,
      status: "completed",
    });
  } catch (err) {
    logger.error(`[internal.creditTransfer] ${err.message}`);
    const status = err.message.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message: err.message });
  }
}

export async function getTransferStatus(req, res) {
  try {
    const { reference } = req.params;
    const transfer = await CrossAppTransfer.findOne({ reference });
    if (!transfer) {
      return res
        .status(404)
        .json({ success: false, message: "Transfer not found" });
    }
    return res.json({ success: true, transfer });
  } catch (err) {
    logger.error(`[internal.getTransferStatus] ${err.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get transfer status" });
  }
}
