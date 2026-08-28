// src/utils/phoneNumber.js
// Canonical phone normalization used by the MTN allowlist and order-gating.
// Behavior mirrors orderService.checkMtnOrderRestriction and storefrontService
// so lookups always agree with the runtime order check:
//   - strip spaces, hyphens, parentheses, plus signs
//   - convert a leading "233" country code to "0" (local 10-digit format)

const SEPARATOR_PATTERN = /[\s\-\(\)\+]/g;

export const PHONE_PATTERN = /^0\d{9}$/;

export function normalizePhoneNumber(input) {
  if (input == null) return "";
  let normalized = String(input).replace(SEPARATOR_PATTERN, "");
  if (normalized.startsWith("233")) normalized = "0" + normalized.slice(3);
  return normalized;
}

export default normalizePhoneNumber;
