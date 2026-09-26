import Order from '../models/Order.js';
import orderService from '../services/orderService.js';
import commissionService from '../services/commissionService.js';
import logger from '../utils/logger.js';
import { logAuditAction } from '../utils/auditLogger.js';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from '../constants/audit.js';
import { ORDER_STATUSES } from '../constants/orderStatuses.js';

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

    const existing = await Order.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Order not found' });
    const previousStatus = existing.status;

    if (status === ORDER_STATUSES.COMPLETED && !existing.processingCompletedAt) {
      updateData.processingCompletedAt = new Date();
    }

    const order = await Order.findByIdAndUpdate(id, updateData, { new: true });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    await logAuditAction(req, {
      userId: null,
      userType: 'system',
      action: AUDIT_ACTIONS.ORDER_STATUS_UPDATED,
      category: AUDIT_CATEGORIES.ORDER,
      resource: {
        orderId: order._id,
        orderNumber: order.orderNumber,
      },
      changes: {
        before: { status: previousStatus },
        after: { status },
      },
      metadata: {
        source: 'internalOrderController.updateOrderStatus',
        notes: notes || null,
      },
      severity: AUDIT_SEVERITIES.INFO,
    });

    // If order moved to completed, credit referral commission and storefront profit
    if (status === ORDER_STATUSES.COMPLETED) {
      try {
        await commissionService.creditOrderCommission(order._id);
      } catch (err) {
        logger.error(
          `[InternalOrderController] failed to credit referral commission after status update for order ${order._id}: ${err.message}`,
        );
      }
      if (order.orderType === 'storefront') {
        try {
          await orderService._creditStorefrontProfit(order);
        } catch (err) {
          logger.error(
            `[InternalOrderController] failed to credit storefront profit after status update for order ${order._id}: ${err.message}`,
          );
        }
      }
    }

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

    const orders = await Order.find({ _id: { $in: orderIds } });
    const foundIds = new Set(orders.map((o) => String(o._id)));
    let successful = 0;
    let failed = 0;

    for (const id of orderIds) {
      if (!foundIds.has(String(id))) {
        failed += 1;
        continue;
      }
    }

    for (const order of orders) {
      try {
        const previousStatus = order.status;
        order.status = action;
        // NOTE: processedBy is intentionally left untouched — the internal
        // key-authenticated API has no actor identity, and clearing it
        // destroys attribution. See profit-loss fix.
        if (action === ORDER_STATUSES.PROCESSING && !order.processingStartedAt) {
          order.processingStartedAt = new Date();
        } else if (action === ORDER_STATUSES.COMPLETED && !order.processingCompletedAt) {
          order.processingCompletedAt = new Date();
        }

        await order.save();

        if (action === ORDER_STATUSES.COMPLETED) {
          try {
            await commissionService.creditOrderCommission(order._id);
          } catch (commissionError) {
            logger.error(
              `[InternalBulkProcess] Failed to credit commission for order ${order._id}: ${commissionError.message}`,
            );
          }
          if (order.orderType === 'storefront') {
            try {
              await orderService._creditStorefrontProfit(order);
            } catch (profitError) {
              logger.error(
                `[InternalBulkProcess] Failed to credit storefront profit for order ${order._id}: ${profitError.message}`,
              );
            }
          }
        }

        await logAuditAction(req, {
          userId: null,
          userType: 'system',
          action: AUDIT_ACTIONS.ORDER_STATUS_UPDATED,
          category: AUDIT_CATEGORIES.ORDER,
          resource: {
            orderId: order._id,
            orderNumber: order.orderNumber,
          },
          changes: {
            before: { status: previousStatus },
            after: { status: action },
          },
          metadata: {
            source: 'internalOrderController.bulkProcessOrders',
          },
          severity: AUDIT_SEVERITIES.INFO,
        });

        successful += 1;
      } catch (err) {
        failed += 1;
        logger.error(
          `[InternalBulkProcess] Failed to ${action} order ${order._id}: ${err.message}`,
        );
      }
    }

    return res.json({
      success: true,
      successful,
      failed,
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

export async function getOrderIds(req, res) {
  try {
    const result = await orderService.getMatchingOrderIds(req.query, null, {
      limit: Number(req.query.limit) || 2000,
    });
    return res.json({
      success: true,
      orderIds: result.orderIds,
      total: result.total,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to get matching order IDs' });
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
