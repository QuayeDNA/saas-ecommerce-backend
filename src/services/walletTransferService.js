import crypto from "crypto";
import { getConnectedAppByAppId, makeRequest } from "../utils/connectedApps.js";
import settingsService from "./settingsService.js";
import walletService from "./walletService.js";
import CrossAppTransfer from "../models/CrossAppTransfer.js";
import { getLocalAppIdentity } from "../utils/appContextResolver.js";
import { logAuditAction } from "../utils/auditLogger.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

class WalletTransferService {
  async isEnabled() {
    const settings = await settingsService.getCrossAppTransferSettings();
    return settings.crossAppWalletTransferEnabled;
  }

  async getTransferTargets() {
    const enabled = await this.isEnabled();
    if (!enabled) return [];
    const apps = await settingsService.getConnectedApps();
    return apps
      .filter((app) => app.enabled)
      .map((app) => ({ appId: app.appId, name: app.name }));
  }

  async createTransfer(sourceUser, { appId, identifier, pin, amount, note }) {
    const enabled = await this.isEnabled();
    if (!enabled) {
      const err = new Error(
        "Cross-app wallet transfers are disabled by the administrator.",
      );
      err.status = 403;
      throw err;
    }

    const app = await getConnectedAppByAppId(appId);

    // 1. Verify the destination account on the destination app
    const verifyResp = await makeRequest(
      app,
      "POST",
      "/api/internal/wallet/verify-destination",
      { identifier, pin },
    );

    const destUserId = verifyResp?.data?.userId;
    const transferTicket = verifyResp?.data?.transferTicket;
    const destUserEmail = verifyResp?.data?.email || "";

    if (!destUserId || !transferTicket) {
      throw new Error("Destination verification returned an invalid response");
    }

    const reference = `crossapp_${crypto.randomUUID()}`;
    const localIdentity = getLocalAppIdentity();

    // 2. Debit the source wallet atomically (idempotent by reference)
    await walletService.debitWallet(
      sourceUser._id,
      amount,
      `Cross-app transfer to ${app.name} (${reference})`,
      null,
      {
        idempotencyKey: reference,
        crossAppTransfer: {
          reference,
          destAppId: appId,
          destAppName: app.name,
        },
      },
    );

    // 3. Credit the destination wallet
    let creditResp;
    try {
      creditResp = await makeRequest(
        app,
        "POST",
        "/api/internal/wallet/transfer-credit",
        {
          userId: destUserId,
          amount,
          reference,
          ticket: transferTicket,
          metadata: {
            sourceAppId: localIdentity.appId,
            sourceAppName: localIdentity.name,
            sourceUserEmail: sourceUser.email || "",
          },
        },
      );
    } catch (err) {
      const isAmbiguous = /^Request to .* failed:/.test(err.message || "");
      if (!isAmbiguous) {
        // 4a. Definitive failure — reverse the source debit
        await walletService.creditWallet(
          sourceUser._id,
          amount,
          `Reversal: cross-app transfer to ${app.name} failed (${reference})`,
          null,
          {
            adminAction: true,
            crossApp: true,
            idempotencyKey: `${reference}_reversal`,
            crossAppTransfer: {
              reference,
              destAppId: appId,
              destAppName: app.name,
              reversal: true,
            },
          },
        );
      }

      await this._persistLedger({
        reference,
        app,
        sourceUser,
        destUserId,
        destUserEmail,
        amount,
        note,
        status: isAmbiguous ? "pending" : "failed",
        error: err.message,
      });

      throw err;
    }

    // 5. Success — mark transfer completed
    await this._persistLedger({
      reference,
      app,
      sourceUser,
      destUserId,
      destUserEmail,
      amount,
      note,
      status: "completed",
    });

    return { reference, status: "completed", credit: creditResp };
  }

  async _persistLedger({
    reference,
    app,
    sourceUser,
    destUserId,
    destUserEmail,
    amount,
    note,
    status,
    error,
  }) {
    const localIdentity = getLocalAppIdentity();
    const doc = await CrossAppTransfer.findOneAndUpdate(
      { reference },
      {
        $set: {
          reference,
          sourceAppId: localIdentity.appId,
          destAppId: app.appId,
          sourceUserId: sourceUser._id,
          destUserId: destUserId || null,
          sourceUserEmail: sourceUser.email || "",
          destUserEmail: destUserEmail || "",
          amount,
          status,
          note: note || "",
          sourceAppName: localIdentity.name,
          destAppName: app.name,
          error: error || null,
          completedAt: status === "completed" ? new Date() : null,
        },
      },
      { upsert: true, setDefaultsOnInsert: true, new: true },
    );

    await logAuditAction(null, {
      userId: sourceUser._id,
      action: AUDIT_ACTIONS.WALLET_CROSS_APP_TRANSFER,
      category: AUDIT_CATEGORIES.WALLET,
      resource: { userId: sourceUser._id },
      metadata: {
        source: "walletTransferService.createTransfer",
        reference,
        amount,
        destAppId: app.appId,
        destAppName: app.name,
        direction: "debit",
        status,
      },
      severity:
        status === "completed"
          ? AUDIT_SEVERITIES.INFO
          : AUDIT_SEVERITIES.WARNING,
    });

    return doc;
  }

  async getTransfersForUser(sourceUserId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [transfers, total] = await Promise.all([
      CrossAppTransfer.find({ sourceUserId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      CrossAppTransfer.countDocuments({ sourceUserId }),
    ]);
    return {
      transfers,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getAdminTransfers(page = 1, limit = 20, status) {
    const filter = {};
    if (status && ["completed", "failed", "pending"].includes(status)) {
      filter.status = status;
    }
    const skip = (page - 1) * limit;
    const [transfers, total] = await Promise.all([
      CrossAppTransfer.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      CrossAppTransfer.countDocuments(filter),
    ]);
    return {
      transfers,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async recheckTransfer(sourceUserId, reference) {
    const transfer = await CrossAppTransfer.findOne({ reference, sourceUserId });
    if (!transfer) {
      const err = new Error("Transfer not found");
      err.status = 404;
      throw err;
    }
    if (transfer.status !== "pending") return transfer;

    const app = await getConnectedAppByAppId(transfer.destAppId);
    try {
      const resp = await makeRequest(
        app,
        "GET",
        `/api/internal/wallet/transfers/${encodeURIComponent(reference)}`,
      );
      const remote = resp?.transfer;
      if (remote && remote.status === "completed") {
        transfer.status = "completed";
        transfer.completedAt = new Date();
        transfer.error = null;
        await transfer.save();
      }
    } catch (err) {
      const wrapped = new Error(`Recheck failed: ${err.message}`);
      wrapped.status = 502;
      throw wrapped;
    }
    return transfer;
  }
}

export default new WalletTransferService();
