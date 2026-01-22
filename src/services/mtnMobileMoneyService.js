// src/services/mtnMobileMoneyService.js
import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger.js';

class MTNMobileMoneyService {
  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    this.baseUrl = this.isProduction
      ? process.env.MTN_BASE_URL_PRODUCTION
      : process.env.MTN_BASE_URL_SANDBOX;
    this.subscriptionKey = process.env.MTN_SUBSCRIPTION_KEY;
    this.apiUser = process.env.MTN_API_USER;
    this.apiKey = process.env.MTN_API_KEY;
    this.merchantPhone = process.env.MTN_MERCHANT_PHONE;
    this.callbackUrl = this.isProduction
      ? process.env.MTN_CALLBACK_URL_PRODUCTION
      : process.env.MTN_CALLBACK_URL_SANDBOX;
    
    // Validate required config
    if (!this.subscriptionKey || !this.apiUser || !this.apiKey) {
      logger.error('MTN MoMo: Missing required configuration');
    }
  }

  /**
   * Get access token for MTN API using OAuth2
   * Endpoint: /collection/oauth2/token/
   */
  async getAccessToken() {
    try {
      const auth = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString('base64');
      
      // CORRECT endpoint per official docs: /collection/oauth2/token/
      const response = await axios.post(
        `${this.baseUrl}/collection/oauth2/token/`,
        {},
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'X-Target-Environment': this.isProduction ? 'production' : 'sandbox',
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
          }
        }
      );
      
      logger.info('MTN Access Token obtained successfully');
      return response.data.access_token;
    } catch (error) {
      logger.error('MTN Access Token Error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url,
        headers: {
          'X-Target-Environment': error.config?.headers['X-Target-Environment'],
          'Ocp-Apim-Subscription-Key': error.config?.headers['Ocp-Apim-Subscription-Key'] ? '***' : 'missing'
        }
      });
      throw new Error('Failed to get MTN access token');
    }
  }

  /**
   * Initiate a collection request (Request to Pay)
   * Endpoint: /collection/v1_0/requesttopay
   * @param {string} phoneNumber - Agent's phone number (payer)
   * @param {number} amount - Amount to collect
   * @param {string} referenceId - Unique reference for the transaction (UUID v4)
   */
  async requestToPay(phoneNumber, amount, referenceId) {
    try {
      const accessToken = await this.getAccessToken();
      
      // Clean phone number - remove spaces and ensure proper format
      const cleanPhone = phoneNumber.replace(/\s+/g, '');
      
      const requestBody = {
        amount: amount.toString(),
        currency: this.isProduction ? 'GHS' : 'EUR', // Sandbox uses EUR
        externalId: referenceId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: cleanPhone
        },
        payerMessage: 'Wallet Topup',
        payeeNote: 'Instant Topup'
      };

      logger.info('MTN Request to Pay - Initiating:', {
        referenceId,
        amount: requestBody.amount,
        currency: requestBody.currency,
        phone: cleanPhone.substring(0, 4) + '****', // Log masked phone
        url: `${this.baseUrl}/collection/v1_0/requesttopay`
      });

      const response = await axios.post(
        `${this.baseUrl}/collection/v1_0/requesttopay`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-Reference-Id': referenceId,
            'X-Target-Environment': this.isProduction ? 'production' : 'sandbox',
            'X-Callback-Url': this.callbackUrl,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`MTN Request to Pay initiated successfully: ${referenceId}`, {
        status: response.status,
        statusText: response.statusText
      });
      
      return { success: true, referenceId };
    } catch (error) {
      logger.error('MTN Request to Pay Error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        referenceId
      });
      
      // Handle specific error cases
      if (error.response?.status === 409) {
        throw new Error('Reference ID already in use. Please try again.');
      }
      if (error.response?.status === 400) {
        throw new Error('Invalid payment request data. Please check phone number and amount.');
      }
      
      throw new Error(error.response?.data?.message || 'Failed to initiate payment request');
    }
  }

  /**
   * Get payment status
   * Endpoint: /collection/v2_0/payment/{x-referenceId}
   * @param {string} referenceId - Transaction reference (UUID)
   */
  async getPaymentStatus(referenceId) {
    try {
      const accessToken = await this.getAccessToken();
      
      // CORRECT endpoint per official docs: /collection/v2_0/payment/{x-referenceId}
      const response = await axios.get(
        `${this.baseUrl}/collection/v2_0/payment/${referenceId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-Target-Environment': this.isProduction ? 'production' : 'sandbox',
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
          }
        }
      );

      logger.info(`MTN Payment Status retrieved: ${referenceId}`, {
        status: response.data.status,
        financialTransactionId: response.data.financialTransactionId
      });

      return response.data;
    } catch (error) {
      logger.error('MTN Get Payment Status Error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        referenceId
      });
      
      if (error.response?.status === 404) {
        throw new Error('Payment request not found');
      }
      
      throw new Error('Failed to get payment status');
    }
  }

  /**
   * Provision API User (Sandbox only)
   * Endpoint: /v1_0/apiuser
   * @param {string} referenceId - UUID for the API user
   * @param {string} callbackHost - Your callback host
   */
  async createApiUser(referenceId, callbackHost = 'webhook.site') {
    try {
      const response = await axios.post(
        `${this.baseUrl}/v1_0/apiuser`,
        {
          providerCallbackHost: callbackHost
        },
        {
          headers: {
            'X-Reference-Id': referenceId,
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`MTN API User created: ${referenceId}`);
      return { success: true, apiUser: referenceId };
    } catch (error) {
      // 409 means user already exists - this is okay
      if (error.response?.status === 409) {
        logger.info(`MTN API User already exists: ${referenceId}`);
        return { success: true, apiUser: referenceId };
      }
      
      logger.error('MTN Create API User Error:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw new Error('Failed to create API user');
    }
  }

  /**
   * Create API Key for API User (Sandbox only)
   * Endpoint: /v1_0/apiuser/{apiUser}/apikey
   * @param {string} apiUser - The API user ID
   */
  async createApiKey(apiUser) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/v1_0/apiuser/${apiUser}/apikey`,
        {},
        {
          headers: {
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
          }
        }
      );

      logger.info(`MTN API Key created for user: ${apiUser}`);
      return { success: true, apiKey: response.data.apiKey };
    } catch (error) {
      logger.error('MTN Create API Key Error:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw new Error('Failed to create API key');
    }
  }

  /**
   * Validate MTN phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} True if valid phone number
   */
  validatePhoneNumber(phoneNumber) {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    
    // For sandbox: Accept MTN test numbers (46733123450-46733123459)
    // For production: Ghana MTN numbers starting with 024, 054, 055, 059
    if (!this.isProduction) {
      // Sandbox test numbers
      const sandboxRegex = /^46733123(45[0-9])$/;
      if (sandboxRegex.test(cleanPhone)) {
        return true;
      }
    }
    
    // Ghana MTN format: 024/054/055/059 followed by 7 digits
    // Can optionally start with +233 or 0
    const ghanaRegex = /^(\+?233|0)[2459]\d{8}$/;
    return ghanaRegex.test(cleanPhone);
  }

  /**
   * Format phone number for MTN API
   * @param {string} phoneNumber - Phone number to format
   * @returns {string} Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    let cleanPhone = phoneNumber.replace(/\s+/g, '');
    
    // For Ghana numbers starting with 0, remove the 0
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '233' + cleanPhone.substring(1);
    }
    
    // Remove + if present
    if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }
    
    return cleanPhone;
  }
}

export default new MTNMobileMoneyService();