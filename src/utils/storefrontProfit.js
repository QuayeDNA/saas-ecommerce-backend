// src/utils/storefrontProfit.js

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Compute storefront profit for a completed order.
 * Profit = (customerTotal - paystackFee) - tierCost.
 * Falls back to per-item calculations if aggregate fields are missing.
 */
export function computeStorefrontProfit(order) {
  const items = order?.storefrontData?.items || [];

  const itemTierCost = items.reduce(
    (sum, item) =>
      sum + toNumber(item.tierPrice) * toNumber(item.quantity || 1),
    0,
  );

  const itemMarkup = items.reduce((sum, item) => {
    const unitPrice = toNumber(item.unitPrice);
    const tierPrice = toNumber(item.tierPrice);
    const qty = toNumber(item.quantity || 1);
    return sum + Math.max(0, unitPrice - tierPrice) * qty;
  }, 0);

  const totalTierCost =
    toNumber(order?.storefrontData?.totalTierCost) || itemTierCost;
  const totalMarkup =
    toNumber(order?.storefrontData?.totalMarkup) || itemMarkup;

  const itemTotal = items.reduce(
    (sum, item) => sum + toNumber(item.totalPrice),
    0,
  );
  const customerTotal = toNumber(order?.total) || itemTotal;

  const feeBreakdown = order?.storefrontData?.feeBreakdown || {};
  const storedPaystackFee = toNumber(
    order?.metadata?.paystack?.paystackCollectionFee ??
      feeBreakdown.paystackFee ??
      feeBreakdown.totalFee,
  );

  let baseProfit = customerTotal - totalTierCost;
  if (!Number.isFinite(baseProfit) || baseProfit <= 0) {
    baseProfit = totalMarkup;
  }

  const inferredFee = Math.max(
    0,
    customerTotal - (totalTierCost + totalMarkup),
  );
  const resolvedPaystackFee =
    storedPaystackFee > 0 ? storedPaystackFee : inferredFee;
  const profit = round2(Math.max(0, baseProfit - resolvedPaystackFee));

  return {
    customerTotal: round2(customerTotal),
    tierCost: round2(totalTierCost),
    totalMarkup: round2(totalMarkup),
    feeBreakdown: {
      paystackFee: round2(toNumber(feeBreakdown.paystackFee)),
      platformFee: round2(toNumber(feeBreakdown.platformFee)),
      totalFee: round2(toNumber(feeBreakdown.totalFee)),
    },
    paystackFee: round2(resolvedPaystackFee),
    profit,
  };
}
