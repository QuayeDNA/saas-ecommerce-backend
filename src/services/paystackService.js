import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger.js';

import Settings from '../models/Settings.js';

class PaystackService {
  constructor() {
    this.baseUrl = 'https://api.paystack.co';

    // Prefer env vars but allow runtime override from Settings (DB).
    this.secretKey = process.env.NODE_ENV === 'production'
      ? process.env.PAYSTACK_LIVE_SECRET_KEY
      : process.env.PAYSTACK_TEST_SECRET_KEY;

    this.publicKey = process.env.NODE_ENV === 'production'
      ? process.env.PAYSTACK_LIVE_PUBLIC_KEY
      : process.env.PAYSTACK_TEST_PUBLIC_KEY;

    // lastLoaded indicates whether we've attempted to read Settings
    this._lastLoaded = null;
  }

  // Ensure keys are available — check env first, then Settings (DB)
  async ensureKeys() {
    // If env vars are present, keep them (highest priority)
    if (this.secretKey && this.publicKey) return;

    // Avoid repeated DB reads within short time
    const now = Date.now();
    if (this._lastLoaded && now - this._lastLoaded < 5000) return; // 5s cache

    try {
      const settings = await Settings.getInstance();
      if (!this.publicKey) {
        this.publicKey = process.env.NODE_ENV === 'production'
          ? settings.paystackLivePublicKey || process.env.PAYSTACK_LIVE_PUBLIC_KEY
          : settings.paystackTestPublicKey || process.env.PAYSTACK_TEST_PUBLIC_KEY;
      }

      if (!this.secretKey) {
        this.secretKey = process.env.NODE_ENV === 'production'
          ? settings.paystackLiveSecretKey || process.env.PAYSTACK_LIVE_SECRET_KEY
          : settings.paystackTestSecretKey || process.env.PAYSTACK_TEST_SECRET_KEY;
      }

      this._lastLoaded = Date.now();
    } catch (err) {
      // If Settings read fails, leave existing keys as-is
      logger.warn('[Paystack] ensureKeys: failed to read Settings', { message: err.message });
    }
  }

  isConfigured() {
    return Boolean(this.secretKey && this.publicKey);
  }

  async initializeTransaction(data) {
    const payload = { ...data };
    // Ensure keys are available (may read Settings)
    await this.ensureKeys();

    if (!this.secretKey) throw new Error('Paystack secret key is not configured');

    try {
      logger.info('[Paystack] initializeTransaction', { reference: data.reference });
      const resp = await axios.post(`${this.baseUrl}/transaction/initialize`, payload, {
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      if (!resp?.data?.status) {
        throw new Error(resp?.data?.message || 'Failed to initialize Paystack transaction');
      }

      return resp.data.data;
    } catch (err) {
      logger.error('[Paystack] initializeTransaction error', { message: err.message, data: err.response?.data });
      throw err;
    }
  }

  /**
   * Create a Paystack customer (idempotent-like: Paystack will return existing customer for same email)
   * This allows Paystack's hosted checkout to show the customer's name (first/last) instead of just email.
   */
  async createCustomer({ email, first_name, last_name, phone, metadata } = {}) {
    await this.ensureKeys();
    if (!this.secretKey) throw new Error('Paystack secret key is not configured');

    try {
      const payload = { email };
      if (first_name) payload.first_name = first_name;
      if (last_name) payload.last_name = last_name;
      if (phone) payload.phone = phone;
      if (metadata) payload.metadata = metadata;

      logger.info('[Paystack] createCustomer', { email });
      const resp = await axios.post(`${this.baseUrl}/customer`, payload, {
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      if (!resp?.data?.status) {
        throw new Error(resp?.data?.message || 'Failed to create Paystack customer');
      }

      return resp.data.data;
    } catch (err) {
      // Paystack may return an error if customer exists — try to fallback to a query by email
      logger.warn('[Paystack] createCustomer failed, attempting lookup', { email, message: err.message });
      try {
        const q = await axios.get(`${this.baseUrl}/customer`, {
          headers: { Authorization: `Bearer ${this.secretKey}` },
          params: { email },
          timeout: 8000,
        });
        if (q?.data?.status && q.data.data && q.data.data.length > 0) return q.data.data[0];
      } catch (lookupErr) {
        logger.warn('[Paystack] fallback customer lookup failed', { email, message: lookupErr.message });
      }
      throw err;
    }
  }

  async verifyTransaction(reference) {
    await this.ensureKeys();
    if (!this.secretKey) throw new Error('Paystack secret key is not configured');

    try {
      logger.info('[Paystack] verifyTransaction', { reference });
      const resp = await axios.get(`${this.baseUrl}/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
        timeout: 15000,
      });

      if (!resp?.data?.status) throw new Error(resp?.data?.message || 'Paystack verification failed');
      return resp.data.data;
    } catch (err) {
      logger.error('[Paystack] verifyTransaction error', { reference, message: err.message });
      throw err;
    }
  }

  verifyWebhookSignature(rawBody, signature) {
    // Note: ensureKeys is async so signature verification relies on whatever secretKey is currently loaded
    if (!rawBody || !signature || !this.secretKey) return false;
    const hash = crypto.createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const isValid = hash === signature;
    if (!isValid) logger.warn('[Paystack] webhook signature mismatch');
    return isValid;
  }

  convertToPesewas(amountGHS) {
    return Math.round(Number(amountGHS) * 100);
  }

  convertToGHS(pesewas) {
    return Number(pesewas) / 100;
  }

  getPublicKey() {
    return this.publicKey;
  }

  async createSubaccount(data) {
    await this.ensureKeys();
    if (!this.secretKey) throw new Error('Paystack secret key is not configured');

    try {
      const resp = await axios.post(`${this.baseUrl}/subaccount`, data, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
        timeout: 15000,
      });
      if (!resp?.data?.status) throw new Error(resp?.data?.message || 'Failed to create subaccount');
      return resp.data.data;
    } catch (err) {
      logger.error('[Paystack] createSubaccount error', { message: err.message });
      throw err;
    }
  }

  /**
   * Create a transfer recipient (mobile money or bank) for payouts.
   * Ghana: type 'mobile_money' with bank_code MTN|VOD|ATL; type 'nuban' for bank.
   */
  async createTransferRecipient(data) {
    await this.ensureKeys();
    if (!this.secretKey) throw new Error('Paystack secret key is not configured');

    try {
      const payload = {
        type: data.type === 'mobile_money' ? 'mobile_money' : 'nuban',
        name: data.name,
        currency: data.currency || 'GHS',
        account_number: data.account_number,
        bank_code: data.bank_code,
      };
      const resp = await axios.post(`${this.baseUrl}/transferrecipient`, payload, {
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      if (!resp?.data?.status) throw new Error(resp?.data?.message || 'Failed to create transfer recipient');
      return resp.data.data;
    } catch (err) {
      logger.error('[Paystack] createTransferRecipient error', { message: err.message, data: err.response?.data });
      throw err;
    }
  }

  /**
   * Initiate a transfer to a recipient.
   * @param {Object} opts - { source: 'balance', amount (pesewas), recipient (recipient_code), reference, reason }
   */
  async initiateTransfer(opts) {
    await this.ensureKeys();
    if (!this.secretKey) throw new Error('Paystack secret key is not configured');

    try {
      const payload = {
        source: opts.source || 'balance',
        amount: Number(opts.amount),
        recipient: opts.recipient,
        reference: opts.reference,
        reason: opts.reason || 'Payout',
      };
      const resp = await axios.post(`${this.baseUrl}/transfer`, payload, {
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      if (!resp?.data?.status) throw new Error(resp?.data?.message || 'Failed to initiate transfer');
      return resp.data.data;
    } catch (err) {
      logger.error('[Paystack] initiateTransfer error', { message: err.message, data: err.response?.data });
      throw err;
    }
  }

  /**
   * Resolve bank account number to get account name (Ghana banks).
   */
  async resolveAccountNumber(accountNumber, bankCode) {
    await this.ensureKeys();
    if (!this.secretKey) throw new Error('Paystack secret key is not configured');

    try {
      const resp = await axios.get(`${this.baseUrl}/bank/resolve`, {
        params: { account_number: accountNumber, bank_code: bankCode },
        headers: { Authorization: `Bearer ${this.secretKey}` },
        timeout: 10000,
      });
      if (!resp?.data?.status) throw new Error(resp?.data?.message || 'Failed to resolve account');
      return resp.data.data;
    } catch (err) {
      logger.error('[Paystack] resolveAccountNumber error', { message: err.message });
      throw err;
    }
  }
}

export default new PaystackService();
