import Order from '../models/Order.js';
import orderService from '../services/orderService.js';

export async function listOrders(req, res) {
  try {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = req.query;
    const result = await orderService.getOrders(null, req.query, { page, limit, sortBy, sortOrder }, null);
    return res.json({ success: true, orders: result.orders, pagination: result.pagination });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to list orders' });
  }
}

export async function getOrder(req, res) {
  try {
    const order = await orderService.getOrderById(req.params.id, null);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    return res.json({ success: true, order });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to get order' });
  }
}

export async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (status === 'failed') {
      return res.status(400).json({ success: false, message: 'Cannot manually set status to failed' });
    }

    if (status === 'cancelled') {
      const result = await orderService.cancelOrder(id, null, null, notes || 'Cancelled via internal API');
      return res.json({ success: true, order: result.order || result });
    }

    const updateData = { status };
    if (notes) updateData.statusNotes = notes;

    const order = await Order.findByIdAndUpdate(id, updateData, { new: true });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    return res.json({ success: true, order });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to update order status' });
  }
}

export async function processOrderItem(req, res) {
  try {
    const result = await orderService.processOrderItem(req.params.orderId, req.params.itemId, null, null);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to process order item' });
  }
}

export async function processBulkOrder(req, res) {
  try {
    const result = await orderService.processBulkOrder(req.params.id, null, null);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to process bulk order' });
  }
}

export async function bulkProcessOrders(req, res) {
  try {
    const { orderIds, action } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Order IDs array is required' });
    }

    const validActions = ['processing', 'completed'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ success: false, message: `Action must be one of: ${validActions.join(', ')}` });
    }

    const result = await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { status: action, processedBy: null } },
    );

    return res.json({
      success: true,
      successful: result.modifiedCount,
      failed: 0,
      total: orderIds.length,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to bulk process orders' });
  }
}

export async function cancelOrder(req, res) {
  try {
    const result = await orderService.cancelOrder(req.params.id, null, null, req.body.reason || '');
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to cancel order' });
  }
}

export async function reportOrder(req, res) {
  try {
    const result = await orderService.reportOrder(req.params.id, null, null, req.body.description);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to report order' });
  }
}

export async function updateReceptionStatus(req, res) {
  try {
    const result = await orderService.updateReceptionStatus(req.params.id, req.body.receptionStatus, null, null);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to update reception status' });
  }
}

export async function bulkUpdateReceptionStatus(req, res) {
  try {
    const { orderIds, receptionStatus } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Order IDs array is required' });
    }

    const validStatuses = ['not_received', 'received', 'checking', 'resolved'];
    if (!validStatuses.includes(receptionStatus)) {
      return res.status(400).json({ success: false, message: `Invalid reception status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const result = await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { receptionStatus } },
    );

    return res.json({
      success: true,
      successful: result.modifiedCount,
      failed: 0,
      total: orderIds.length,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to bulk update reception status' });
  }
}

export async function getReportedOrders(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await orderService.getOrders(null, { ...req.query, reported: true }, { page, limit }, null);
    return res.json({ success: true, orders: result.orders, pagination: result.pagination });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to get reported orders' });
  }
}

export async function getAnalytics(req, res) {
  try {
    const { timeframe } = req.query;
    const analytics = await orderService.getOrderAnalytics(null, timeframe);
    return res.json({ success: true, analytics });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to get analytics' });
  }
}
