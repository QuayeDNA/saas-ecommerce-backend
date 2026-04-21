// src/services/mtnMomoService.js
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger.js";
import sanitizeForMtn from "../utils/mtnSanitizer.js";

class MtnMomoService {
  constructor() {
    this.subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
    this.apiUserId = process.env.MTN_MOMO_API_USER_ID; // ← was API_USER
    this.apiKey = process.env.MTN_MOMO_API_KEY;
    this.targetEnvironment = process.env.MTN_MOMO_ENVIRONMENT || "sandbox";
    this.baseUrl =
      process.env.MTN_MOMO_BASE_URL || "https://sandbox.momodeveloper.mtn.com";
  }

  async _getAccessToken() {
    // Basic Auth = base64(apiUserId:apiKey)  ← THIS was the bug
    const credentials = Buffer.from(
      `${this.apiUserId}:${this.apiKey}`,
    ).toString("base64");
    try {
      const { data } = await axios.post(
        `${this.baseUrl}/collection/token/`, // trailing slash is required
        {}, // empty body — NOT null
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            "Ocp-Apim-Subscription-Key": this.subscriptionKey,
          },
        },
      );
      return data.access_token;
    } catch (err) {
      const status = err.response?.status;
      const detail = JSON.stringify(err.response?.data);
      logger.error(
        `[MtnMomoService] failed to get access token HTTP ${status}: ${detail}`,
        { targetEnvironment: this.targetEnvironment },
      );
      throw err;
    }
  }

  async requestToPay({ amount, partyId, externalId, payerMessage, payeeNote }) {
    const token = await this._getAccessToken();
    const referenceId = uuidv4();
    const currency = this.targetEnvironment === "sandbox" ? "EUR" : "GHS";

    const url = `${this.baseUrl}/collection/v1_0/requesttopay`;
    // Sanitize message fields to avoid MTN sandbox rejecting non-ASCII chars
    const payload = {
      amount: String(amount),
      currency,
      externalId: sanitizeForMtn(externalId),
      payer: { partyIdType: "MSISDN", partyId },
      payerMessage: sanitizeForMtn(payerMessage),
      payeeNote: sanitizeForMtn(payeeNote),
    };

    const headers = {
      Authorization: `Bearer ${token}`,
      "X-Reference-Id": referenceId,
      "X-Target-Environment": this.targetEnvironment,
      "X-Callback-Url": process.env.MTN_MOMO_CALLBACK_URL,
      "Ocp-Apim-Subscription-Key": this.subscriptionKey,
      "Content-Type": "application/json",
    };

    // Keep request logging concise at info-level (no payload/headers)
    logger.info(`[MtnMomoService] Sending RequestToPay ref=${referenceId}`, {
      url,
      referenceId,
    });

    try {
      const res = await axios.post(url, payload, { headers });
      logger.info(
        `[MtnMomoService] RequestToPay initiated ref=${referenceId}`,
        { status: res.status, statusText: res.statusText },
      );
      return referenceId;
    } catch (err) {
      const httpStatus = err.response?.status;
      const mtResponseData = err.response?.data;
      const mtResponseHeaders = err.response?.headers;
      const statusText = err.response?.statusText;

      logger.error(`[MtnMomoService] requestToPay failed`, {
        httpStatus,
        statusText,
        mtResponseData,
        mtResponseHeaders,
        referenceId,
        partyId,
        currency,
        targetEnvironment: this.targetEnvironment,
        message: err.message,
      });

      const message = `MTN RequestToPay failed ${httpStatus || ""} ${statusText || ""} - ${mtResponseData ? JSON.stringify(mtResponseData) : err.message}`;
      const error = new Error(message);
      error.original = err;
      throw error;
    }
  }

  async getTransactionStatus(referenceId) {
    const token = await this._getAccessToken();
    const { data } = await axios.get(
      `${this.baseUrl}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Target-Environment": this.targetEnvironment,
          "Ocp-Apim-Subscription-Key": this.subscriptionKey,
        },
      },
    );
    return data;
  }
}

export default new MtnMomoService();
