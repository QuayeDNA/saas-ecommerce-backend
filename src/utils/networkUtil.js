// src/utils/networkUtil.js
// ---------------------------------------------------------------------------
// Logs useful network information at server startup.
// In development, set NGROK_URL (or PUBLIC_URL) in your .env to expose
// your local server to Paystack webhooks and callbacks.
//
// Example .env:
//   NGROK_URL=https://abcd-1234.ngrok-free.app
//
// Then start ngrok separately in a terminal:
//   npx ngrok http 5050
// ---------------------------------------------------------------------------
import logger from './logger.js';

/**
 * Returns the externally-reachable base URL for this server.
 * Priority:
 *   1. NGROK_URL   — set this when running ngrok locally
 *   2. PUBLIC_URL  — generic override (e.g. a VPS with a domain)
 *   3. null        — no public URL configured (webhooks won't work externally)
 */
export function getPublicBaseUrl() {
  const url = process.env.NGROK_URL || process.env.PUBLIC_URL || null;
  // Strip trailing slash for consistent URL building
  return url ? url.replace(/\/$/, '') : null;
}

/**
 * Returns the full Paystack webhook URL.
 * Used when logging startup info or auto-registering the webhook.
 */
export function getPaystackWebhookUrl() {
  const base = getPublicBaseUrl();
  return base ? `${base}/api/webhooks/paystack` : null;
}

/**
 * Returns the Paystack callback URL (after user completes payment in browser).
 */
export function getPaystackCallbackUrl() {
  const base = getPublicBaseUrl();
  if (base) return `${base}/wallet/topup/callback`;
  // Fallback for local testing without ngrok (redirect goes to frontend dev server)
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${frontendUrl}/wallet/topup/callback`;
}

/**
 * Called once at server startup. Logs webhook/callback URLs so you know
 * exactly what to paste into the Paystack dashboard.
 */
export function logNetworkInfo() {
  const publicBase = getPublicBaseUrl();
  const webhookUrl = getPaystackWebhookUrl();
  const callbackUrl = getPaystackCallbackUrl();

  if (publicBase) {
    logger.info('─────────────────────────────────────────────');
    logger.info('[Network] Public base URL   : ' + publicBase);
    logger.info('[Network] Paystack webhook  : ' + webhookUrl);
    logger.info('[Network] Paystack callback : ' + callbackUrl);
    logger.info('─────────────────────────────────────────────');
  } else {
    logger.warn('[Network] No NGROK_URL / PUBLIC_URL set.');
    logger.warn('[Network] Paystack webhooks will NOT reach this server externally.');
    logger.warn('[Network] To fix: run `npx ngrok http 5050` and set NGROK_URL=<url> in .env');
  }
}