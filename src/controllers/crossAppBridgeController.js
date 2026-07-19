import * as crossAppBridgeService from '../services/crossAppBridgeService.js';
import logger from '../utils/logger.js';

function getStatusFromError(error) {
  const msg = error.message;
  if (msg.includes('not found') || msg.includes('disabled')) return 404;
  return 502;
}

export async function listConnectedAppOrders(req, res) {
  try {
    const result = await crossAppBridgeService.listOrdersFromApp(req.params.appId, req.query);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app list orders error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function getConnectedAppOrder(req, res) {
  try {
    const result = await crossAppBridgeService.getOrderFromApp(req.params.appId, req.params.id);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app get order error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function updateConnectedAppOrderStatus(req, res) {
  try {
    const { status, notes } = req.body;
    const result = await crossAppBridgeService.updateOrderStatusOnApp(req.params.appId, req.params.id, status, notes);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app update order status error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function updateConnectedAppReceptionStatus(req, res) {
  try {
    const { receptionStatus } = req.body;
    const result = await crossAppBridgeService.updateReceptionStatusOnApp(req.params.appId, req.params.id, receptionStatus);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app update reception status error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function cancelConnectedAppOrder(req, res) {
  try {
    const { reason } = req.body;
    const result = await crossAppBridgeService.cancelOrderOnApp(req.params.appId, req.params.id, reason);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app cancel order error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function reportConnectedAppOrder(req, res) {
  try {
    const { description } = req.body;
    const result = await crossAppBridgeService.reportOrderOnApp(req.params.appId, req.params.id, description);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app report order error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function processConnectedAppOrderItem(req, res) {
  try {
    const result = await crossAppBridgeService.processOrderItemOnApp(req.params.appId, req.params.orderId, req.params.itemId);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app process order item error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function processConnectedAppBulkOrder(req, res) {
  try {
    const result = await crossAppBridgeService.processBulkOrderOnApp(req.params.appId, req.params.id);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app process bulk order error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function bulkProcessConnectedAppOrders(req, res) {
  try {
    const { orderIds, action } = req.body;
    const result = await crossAppBridgeService.bulkProcessOrdersOnApp(req.params.appId, orderIds, action);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app bulk process orders error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function bulkUpdateConnectedAppReceptionStatus(req, res) {
  try {
    const { orderIds, receptionStatus } = req.body;
    const result = await crossAppBridgeService.bulkUpdateReceptionStatusOnApp(req.params.appId, orderIds, receptionStatus);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app bulk update reception status error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function getConnectedAppReportedOrders(req, res) {
  try {
    const result = await crossAppBridgeService.getReportedOrdersFromApp(req.params.appId, req.query);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app get reported orders error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}
