// src/utils/paystackHelpers.js
import paystackService from '../services/paystackService.js';
import Settings from '../models/Settings.js';

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
 * Get current fee configuration from Settings.
 * Returns defaults if Settings cannot be loaded.
 */
export async function getFeeConfig() {
  try {
    const settings = await Settings.getInstance();
    return {
      paystackCollectionFeePercent: settings.paystackCollectionFeePercent ?? 1.95,
      platformFeePercent: settings.platformFeePercent ?? 0,
      delegateFeesToCustomer: settings.delegateFeesToCustomer ?? true,
      paystackTransferFees: {
        mobile_money: settings.paystackTransferFees?.mobile_money ?? 1.0,
        bank_account: settings.paystackTransferFees?.bank_account ?? 8.0,
      },
      payoutFeeBearer: settings.payoutFeeBearer ?? 'agent',
    };
  } catch {
    return {
      paystackCollectionFeePercent: 1.95,
      platformFeePercent: 0,
      delegateFeesToCustomer: true,
      paystackTransferFees: { mobile_money: 1.0, bank_account: 8.0 },
      payoutFeeBearer: 'agent',
    };
  }
}

/**
 * Calculate the total amount to charge the customer so that after Paystack
 * takes its 1.95% (or configured %) the platform receives the full base
 * amount.  Optionally adds a platform surcharge.
 *
 * Formula to reverse Paystack's fee:
 *   chargeAmount = baseAmount / (1 - (paystackFee% + platformFee%) / 100)
 *
 * @param {number} baseAmount - The intended amount in GHS (product total)
 * @param {Object} feeConfig - From getFeeConfig()
 * @returns {{ chargeAmount: number, paystackFee: number, platformFee: number, totalFee: number }}
 */
export function calculateChargeWithFees(baseAmount, feeConfig) {
  const { paystackCollectionFeePercent, platformFeePercent, delegateFeesToCustomer } = feeConfig;

  if (!delegateFeesToCustomer) {
    // Fees are absorbed; customer pays base price
    const paystackFee = round2(baseAmount * paystackCollectionFeePercent / 100);
    const platformFee = round2(baseAmount * platformFeePercent / 100);
    return {
      chargeAmount: baseAmount,
      paystackFee,
      platformFee,
      totalFee: round2(paystackFee + platformFee),
    };
  }

  const totalFeePercent = paystackCollectionFeePercent + platformFeePercent;
  // Reverse-calculate: chargeAmount such that chargeAmount * (1 - fee%) = baseAmount
  const chargeAmount = round2(baseAmount / (1 - totalFeePercent / 100));
  const paystackFee = round2(chargeAmount * paystackCollectionFeePercent / 100);
  const platformFee = round2(chargeAmount * platformFeePercent / 100);

  return {
    chargeAmount,
    paystackFee,
    platformFee,
    totalFee: round2(paystackFee + platformFee),
  };
}

/** Round to 2 decimal places */
function round2(n) {
  return Math.round(n * 100) / 100;
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