import { getConnectedAppByAppId, makeRequest } from '../utils/connectedApps.js';

export async function listOrdersFromApp(appId, queryParams) {
  const app = await getConnectedAppByAppId(appId);
  const qs = new globalThis.URLSearchParams(queryParams).toString();
  return makeRequest(app, 'GET', `/api/internal/orders?${qs}`);
}

export async function getOrderFromApp(appId, orderId) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'GET', `/api/internal/orders/${orderId}`);
}

export async function updateOrderStatusOnApp(appId, orderId, status, notes) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'PATCH', `/api/internal/orders/${orderId}/status`, { status, notes });
}

export async function updateReceptionStatusOnApp(appId, orderId, receptionStatus) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'PATCH', `/api/internal/orders/${orderId}/reception-status`, { receptionStatus });
}

export async function cancelOrderOnApp(appId, orderId, reason) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'POST', `/api/internal/orders/${orderId}/cancel`, { reason });
}

export async function reportOrderOnApp(appId, orderId, description) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'POST', `/api/internal/orders/${orderId}/report`, { description });
}

export async function processOrderItemOnApp(appId, orderId, itemId) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'POST', `/api/internal/orders/${orderId}/items/${itemId}/process`);
}

export async function processBulkOrderOnApp(appId, orderId) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'POST', `/api/internal/orders/${orderId}/process-bulk`);
}

export async function bulkProcessOrdersOnApp(appId, orderIds, action) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'POST', `/api/internal/orders/bulk-process`, { orderIds, action });
}

export async function bulkUpdateReceptionStatusOnApp(appId, orderIds, receptionStatus) {
  const app = await getConnectedAppByAppId(appId);
  return makeRequest(app, 'POST', `/api/internal/orders/bulk-reception-status`, { orderIds, receptionStatus });
}

export async function getReportedOrdersFromApp(appId, queryParams) {
  const app = await getConnectedAppByAppId(appId);
  const qs = new globalThis.URLSearchParams(queryParams).toString();
  return makeRequest(app, 'GET', `/api/internal/orders/reported?${qs}`);
}

export async function getAnalyticsFromApp(appId, timeframe) {
  const app = await getConnectedAppByAppId(appId);
  const qs = timeframe ? `?timeframe=${encodeURIComponent(timeframe)}` : '';
  return makeRequest(app, 'GET', `/api/internal/orders/analytics/summary${qs}`);
}
