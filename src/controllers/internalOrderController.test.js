import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/orderService.js', () => ({
  default: {
    getOrders: vi.fn(),
    getOrderById: vi.fn(),
    cancelOrder: vi.fn(),
    processOrderItem: vi.fn(),
    processBulkOrder: vi.fn(),
    reportOrder: vi.fn(),
    updateReceptionStatus: vi.fn(),
    getMatchingOrderIds: vi.fn(),
  },
}));

vi.mock('../models/Order.js', () => ({
  default: {
    findByIdAndUpdate: vi.fn(),
    updateMany: vi.fn(),
  },
}));

import orderService from '../services/orderService.js';
import Order from '../models/Order.js';
import * as internalOrderController from './internalOrderController.js';

function mockReqRes(overrides = {}) {
  const req = { params: {}, query: {}, body: {}, ...overrides };
  const res = { json: vi.fn(), status: vi.fn(() => res) };
  return { req, res };
}

describe('internalOrderController', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('listOrders', () => {
    it('should return orders with default pagination', async () => {
      const orders = [{ _id: '1' }, { _id: '2' }];
      const pagination = { total: 2, page: 1, pages: 1, limit: 20 };
      orderService.getOrders.mockResolvedValue({ orders, pagination });

      const { req, res } = mockReqRes();
      await internalOrderController.listOrders(req, res);

      expect(orderService.getOrders).toHaveBeenCalledWith(null, req.query, {
        page: 1, limit: 20, sortBy: 'createdAt', sortOrder: -1,
      }, null);
      expect(res.json).toHaveBeenCalledWith({ success: true, orders, pagination });
    });

    it('should use custom pagination from query', async () => {
      const orders = [{ _id: '1' }];
      const pagination = { total: 1, page: 2, pages: 1, limit: 10 };
      orderService.getOrders.mockResolvedValue({ orders, pagination });

      const { req, res } = mockReqRes({ query: { page: 2, limit: 10, sortBy: 'orderNumber', sortOrder: 1 } });
      await internalOrderController.listOrders(req, res);

      expect(orderService.getOrders).toHaveBeenCalledWith(null, req.query, {
        page: 2, limit: 10, sortBy: 'orderNumber', sortOrder: 1,
      }, null);
    });

    it('should handle service errors', async () => {
      orderService.getOrders.mockRejectedValue(new Error('DB error'));

      const { req, res } = mockReqRes();
      await internalOrderController.listOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'DB error' });
    });
  });

  describe('getOrder', () => {
    it('should return order when found', async () => {
      const order = { _id: '123', orderNumber: 'ORD-001' };
      orderService.getOrderById.mockResolvedValue(order);

      const { req, res } = mockReqRes({ params: { id: '123' } });
      await internalOrderController.getOrder(req, res);

      expect(orderService.getOrderById).toHaveBeenCalledWith('123', null);
      expect(res.json).toHaveBeenCalledWith({ success: true, order });
    });

    it('should return 404 when not found', async () => {
      orderService.getOrderById.mockResolvedValue(null);

      const { req, res } = mockReqRes({ params: { id: '999' } });
      await internalOrderController.getOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Order not found' });
    });

    it('should handle service errors', async () => {
      orderService.getOrderById.mockRejectedValue(new Error('DB error'));

      const { req, res } = mockReqRes({ params: { id: '123' } });
      await internalOrderController.getOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'DB error' });
    });
  });

  describe('updateOrderStatus', () => {
    it('should update status successfully', async () => {
      const order = { _id: '123', status: 'processing' };
      Order.findByIdAndUpdate.mockResolvedValue(order);

      const { req, res } = mockReqRes({ params: { id: '123' }, body: { status: 'processing' } });
      await internalOrderController.updateOrderStatus(req, res);

      expect(Order.findByIdAndUpdate).toHaveBeenCalledWith('123', { status: 'processing' }, { new: true });
      expect(res.json).toHaveBeenCalledWith({ success: true, order });
    });

    it('should return 400 for failed status', async () => {
      const { req, res } = mockReqRes({ params: { id: '123' }, body: { status: 'failed' } });
      await internalOrderController.updateOrderStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Cannot manually set status to failed' });
    });

    it('should delegate to cancelOrder for cancelled status', async () => {
      const cancelResult = { order: { _id: '123', status: 'cancelled' } };
      orderService.cancelOrder.mockResolvedValue(cancelResult);

      const { req, res } = mockReqRes({ params: { id: '123' }, body: { status: 'cancelled', notes: 'Customer request' } });
      await internalOrderController.updateOrderStatus(req, res);

      expect(orderService.cancelOrder).toHaveBeenCalledWith('123', null, null, 'Customer request');
      expect(res.json).toHaveBeenCalledWith({ success: true, order: cancelResult.order });
    });

    it('should return 404 when order not found', async () => {
      Order.findByIdAndUpdate.mockResolvedValue(null);

      const { req, res } = mockReqRes({ params: { id: '999' }, body: { status: 'processing' } });
      await internalOrderController.updateOrderStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Order not found' });
    });

    it('should include notes in update when provided', async () => {
      Order.findByIdAndUpdate.mockResolvedValue({ _id: '123' });

      const { req, res } = mockReqRes({ params: { id: '123' }, body: { status: 'completed', notes: 'Done' } });
      await internalOrderController.updateOrderStatus(req, res);

      expect(Order.findByIdAndUpdate).toHaveBeenCalledWith(
        '123',
        { status: 'completed', statusNotes: 'Done' },
        { new: true },
      );
    });

    it('should handle service errors from cancelOrder', async () => {
      orderService.cancelOrder.mockRejectedValue(new Error('Cannot cancel'));

      const { req, res } = mockReqRes({ params: { id: '123' }, body: { status: 'cancelled' } });
      await internalOrderController.updateOrderStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Cannot cancel' });
    });
  });

  describe('processOrderItem', () => {
    it('should process order item successfully', async () => {
      const result = { _id: '123', status: 'processing' };
      orderService.processOrderItem.mockResolvedValue(result);

      const { req, res } = mockReqRes({ params: { orderId: 'order1', itemId: 'item1' } });
      await internalOrderController.processOrderItem(req, res);

      expect(orderService.processOrderItem).toHaveBeenCalledWith('order1', 'item1', null, null);
      expect(res.json).toHaveBeenCalledWith({ success: true, ...result });
    });

    it('should handle service errors', async () => {
      orderService.processOrderItem.mockRejectedValue(new Error('Item not found'));

      const { req, res } = mockReqRes({ params: { orderId: 'order1', itemId: 'item1' } });
      await internalOrderController.processOrderItem(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Item not found' });
    });
  });

  describe('processBulkOrder', () => {
    it('should process bulk order successfully', async () => {
      const result = { _id: '123', status: 'processing' };
      orderService.processBulkOrder.mockResolvedValue(result);

      const { req, res } = mockReqRes({ params: { id: '123' } });
      await internalOrderController.processBulkOrder(req, res);

      expect(orderService.processBulkOrder).toHaveBeenCalledWith('123', null, null);
      expect(res.json).toHaveBeenCalledWith({ success: true, ...result });
    });

    it('should handle service errors', async () => {
      orderService.processBulkOrder.mockRejectedValue(new Error('Not a bulk order'));

      const { req, res } = mockReqRes({ params: { id: '123' } });
      await internalOrderController.processBulkOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Not a bulk order' });
    });
  });

  describe('bulkProcessOrders', () => {
    it('should bulk process orders successfully', async () => {
      Order.updateMany.mockResolvedValue({ modifiedCount: 3 });

      const { req, res } = mockReqRes({ body: { orderIds: ['1', '2', '3'], action: 'completed' } });
      await internalOrderController.bulkProcessOrders(req, res);

      expect(Order.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['1', '2', '3'] } },
        { $set: { status: 'completed', processedBy: null } },
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, successful: 3, failed: 0, total: 3 });
    });

    it('should return 400 when orderIds missing', async () => {
      const { req, res } = mockReqRes({ body: {} });
      await internalOrderController.bulkProcessOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Order IDs array is required' });
    });

    it('should return 400 when orderIds is not an array', async () => {
      const { req, res } = mockReqRes({ body: { orderIds: 'not-an-array' } });
      await internalOrderController.bulkProcessOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid action', async () => {
      const { req, res } = mockReqRes({ body: { orderIds: ['1'], action: 'invalid' } });
      await internalOrderController.bulkProcessOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Action must be one of: processing, completed' });
    });

    it('should handle update errors', async () => {
      Order.updateMany.mockRejectedValue(new Error('DB error'));

      const { req, res } = mockReqRes({ body: { orderIds: ['1'], action: 'processing' } });
      await internalOrderController.bulkProcessOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'DB error' });
    });
  });

  describe('cancelOrder', () => {
    it('should cancel order successfully', async () => {
      const result = { order: { _id: '123', status: 'cancelled' } };
      orderService.cancelOrder.mockResolvedValue(result);

      const { req, res } = mockReqRes({ params: { id: '123' }, body: { reason: 'Test cancel' } });
      await internalOrderController.cancelOrder(req, res);

      expect(orderService.cancelOrder).toHaveBeenCalledWith('123', null, null, 'Test cancel');
      expect(res.json).toHaveBeenCalledWith({ success: true, ...result });
    });

    it('should use empty string when no reason provided', async () => {
      orderService.cancelOrder.mockResolvedValue({});

      const { req, res } = mockReqRes({ params: { id: '123' }, body: {} });
      await internalOrderController.cancelOrder(req, res);

      expect(orderService.cancelOrder).toHaveBeenCalledWith('123', null, null, '');
    });

    it('should handle service errors', async () => {
      orderService.cancelOrder.mockRejectedValue(new Error('Cannot cancel'));

      const { req, res } = mockReqRes({ params: { id: '123' } });
      await internalOrderController.cancelOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Cannot cancel' });
    });
  });

  describe('reportOrder', () => {
    it('should report order successfully', async () => {
      const result = { order: { _id: '123' }, reportId: 'rep1' };
      orderService.reportOrder.mockResolvedValue(result);

      const { req, res } = mockReqRes({ params: { id: '123' }, body: { description: 'Not delivered' } });
      await internalOrderController.reportOrder(req, res);

      expect(orderService.reportOrder).toHaveBeenCalledWith('123', null, null, 'Not delivered');
      expect(res.json).toHaveBeenCalledWith({ success: true, ...result });
    });

    it('should handle service errors', async () => {
      orderService.reportOrder.mockRejectedValue(new Error('Order not found'));

      const { req, res } = mockReqRes({ params: { id: '999' }, body: { description: 'Not delivered' } });
      await internalOrderController.reportOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Order not found' });
    });
  });

  describe('updateReceptionStatus', () => {
    it('should update reception status successfully', async () => {
      const result = { _id: '123', receptionStatus: 'received' };
      orderService.updateReceptionStatus.mockResolvedValue(result);

      const { req, res } = mockReqRes({ params: { id: '123' }, body: { receptionStatus: 'received' } });
      await internalOrderController.updateReceptionStatus(req, res);

      expect(orderService.updateReceptionStatus).toHaveBeenCalledWith('123', 'received', null, null);
      expect(res.json).toHaveBeenCalledWith({ success: true, ...result });
    });

    it('should handle service errors', async () => {
      orderService.updateReceptionStatus.mockRejectedValue(new Error('Invalid status'));

      const { req, res } = mockReqRes({ params: { id: '123' }, body: { receptionStatus: 'invalid' } });
      await internalOrderController.updateReceptionStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid status' });
    });
  });

  describe('bulkUpdateReceptionStatus', () => {
    it('should bulk update reception status successfully', async () => {
      Order.updateMany.mockResolvedValue({ modifiedCount: 2 });

      const { req, res } = mockReqRes({ body: { orderIds: ['1', '2'], receptionStatus: 'resolved' } });
      await internalOrderController.bulkUpdateReceptionStatus(req, res);

      expect(Order.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['1', '2'] } },
        { $set: { receptionStatus: 'resolved' } },
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, successful: 2, failed: 0, total: 2 });
    });

    it('should return 400 when orderIds missing', async () => {
      const { req, res } = mockReqRes({ body: {} });
      await internalOrderController.bulkUpdateReceptionStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Order IDs array is required' });
    });

    it('should return 400 for invalid reception status', async () => {
      const { req, res } = mockReqRes({ body: { orderIds: ['1'], receptionStatus: 'bogus' } });
      await internalOrderController.bulkUpdateReceptionStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid reception status. Must be one of: not_received, received, checking, resolved',
      });
    });

    it('should handle update errors', async () => {
      Order.updateMany.mockRejectedValue(new Error('DB error'));

      const { req, res } = mockReqRes({ body: { orderIds: ['1'], receptionStatus: 'received' } });
      await internalOrderController.bulkUpdateReceptionStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'DB error' });
    });
  });

  describe('getReportedOrders', () => {
    it('should return reported orders', async () => {
      const orders = [{ _id: '1', reported: true }];
      const pagination = { total: 1, page: 1, pages: 1, limit: 20 };
      orderService.getOrders.mockResolvedValue({ orders, pagination });

      const { req, res } = mockReqRes();
      await internalOrderController.getReportedOrders(req, res);

      expect(orderService.getOrders).toHaveBeenCalledWith(
        null,
        { ...req.query, reported: true },
        { page: 1, limit: 20 },
        null,
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, orders, pagination });
    });

    it('should use custom pagination from query', async () => {
      orderService.getOrders.mockResolvedValue({ orders: [], pagination: {} });

      const { req, res } = mockReqRes({ query: { page: 3, limit: 50 } });
      await internalOrderController.getReportedOrders(req, res);

      expect(orderService.getOrders).toHaveBeenCalledWith(
        null,
        { page: 3, limit: 50, reported: true },
        { page: 3, limit: 50 },
        null,
      );
    });

    it('should handle service errors', async () => {
      orderService.getOrders.mockRejectedValue(new Error('DB error'));

      const { req, res } = mockReqRes();
      await internalOrderController.getReportedOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'DB error' });
    });
  });

  describe('getOrderIds', () => {
    it('should return matching order IDs', async () => {
      orderService.getMatchingOrderIds.mockResolvedValue({
        orderIds: ['1', '2'],
        total: 2,
      });

      const { req, res } = mockReqRes({
        query: { packageId: '507f1f77bcf86cd799439011' },
      });
      await internalOrderController.getOrderIds(req, res);

      expect(orderService.getMatchingOrderIds).toHaveBeenCalledWith(
        req.query,
        null,
        { limit: 2000 },
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        orderIds: ['1', '2'],
        total: 2,
      });
    });

    it('should use custom limit from query', async () => {
      orderService.getMatchingOrderIds.mockResolvedValue({
        orderIds: [],
        total: 0,
      });

      const { req, res } = mockReqRes({ query: { limit: '500' } });
      await internalOrderController.getOrderIds(req, res);

      expect(orderService.getMatchingOrderIds).toHaveBeenCalledWith(
        req.query,
        null,
        { limit: 500 },
      );
    });

    it('should handle service errors', async () => {
      orderService.getMatchingOrderIds.mockRejectedValue(new Error('DB error'));

      const { req, res } = mockReqRes();
      await internalOrderController.getOrderIds(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'DB error' });
    });
  });
});
