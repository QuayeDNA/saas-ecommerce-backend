import { getConnectedAppByAppId, makeRequest } from '../utils/connectedApps.js';

export async function listTransactionsFromApp(appId, queryParams) {
  const app = await getConnectedAppByAppId(appId);
  const qs = new globalThis.URLSearchParams(queryParams).toString();
  return makeRequest(app, 'GET', `/api/internal/wallet/transactions?${qs}`);
}

export async function getAnalyticsFromApp(appId) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'GET', '/api/internal/wallet/analytics');
}

export async function getPendingRequestsFromApp(appId, queryParams) {
  const app = await getConnectedAppByAppId(appId);
  const qs = new globalThis.URLSearchParams(queryParams).toString();
  return makeRequest(app, 'GET', `/api/internal/wallet/pending-requests?${qs}`);
}

export async function topUpWalletOnApp(appId, userId, amount, description) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'POST', '/api/internal/wallet/top-up', { userId, amount, description });
}

export async function debitWalletOnApp(appId, userId, amount, description) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'POST', '/api/internal/wallet/debit', { userId, amount, description });
}

export async function processTopUpRequestOnApp(appId, transactionId, approve) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'POST', `/api/internal/wallet/requests/${transactionId}/process`, { approve });
}

export async function getUsersFromApp(appId, queryParams) {
  const app = await getConnectedAppByAppId(appId);
  const qs = new globalThis.URLSearchParams(queryParams).toString();
  return makeRequest(app, 'GET', `/api/internal/wallet/users?${qs}`);
}
