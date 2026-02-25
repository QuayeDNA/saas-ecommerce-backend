// src/utils/paystackHelpers.js
import paystackService from '../services/paystackService.js';

/**
 * Initialize a Paystack checkout transaction with sensible defaults.
 *
 * @param {Object} opts
 * @param {string} opts.email - Customer email (required by Paystack)
 * @param {number} opts.amountPesewas - Amount in pesewas (integer)
 * @param {string} opts.reference - Unique reference string
 * @param {string} opts.callbackUrl - URL Paystack should redirect to after payment
 * @param {Object} [opts.metadata={}] - Additional metadata to pass through
 * @returns {Promise<Object>} The object returned by Paystack.initializeTransaction
 */
export async function initializePaystackCheckout({
  email,
  amountPesewas,
  reference,
  callbackUrl,
  metadata = {},
  channels = ['card', 'mobile_money', 'bank_transfer'],
}) {
  if (!email) throw new Error('Email is required for Paystack checkout');
  if (!reference) throw new Error('Reference is required for Paystack checkout');

  const payload = {
    email,
    amount: amountPesewas,
    reference,
    currency: 'GHS',
    callback_url: callbackUrl,
    metadata,
    channels,
  };

  return paystackService.initializeTransaction(payload);
}

/**
 * Calculate split information for a storefront order based on the amounts involved.
 *
 * @param {Object} opts
 * @param {number} opts.customerTotal - total paid by customer (GHS)
 * @param {number} opts.paystackFeePesewas - fee charged by Paystack (pesewas)
 * @param {number} opts.tierCost - cost to agent (GHS)
 * @returns {Object} { netReceived, shortfall, markup }
 */
export function calculateStorefrontSplit({ customerTotal, paystackFeePesewas, tierCost }) {
  const customerPesewas = Math.round(customerTotal * 100);
  const netReceivedPesewas = customerPesewas - Number(paystackFeePesewas || 0);
  const netReceived = netReceivedPesewas / 100;
  const markup = customerTotal - tierCost;
  const shortfall = netReceived < tierCost ? tierCost - netReceived : 0;
  return { netReceived, shortfall, markup };
}

/**
 * Create or ensure a Paystack customer exists for the given user data.
 *
 * @param {Object} opts
 * @param {string} opts.email
 * @param {string} [opts.first_name]
 * @param {string} [opts.last_name]
 * @param {string} [opts.phone]
 * @param {Object} [opts.metadata]
 * @returns {Promise<Object>} Paystack customer object
 */
export async function ensurePaystackCustomer(opts = {}) {
  return paystackService.createCustomer(opts);
}