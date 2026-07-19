import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/crossAppBridgeService.js', () => ({
  listOrdersFromApp: vi.fn(),
  getOrderFromApp: vi.fn(),
  updateOrderStatusOnApp: vi.fn(),
  updateReceptionStatusOnApp: vi.fn(),
  cancelOrderOnApp: vi.fn(),
  reportOrderOnApp: vi.fn(),
  processOrderItemOnApp: vi.fn(),
  processBulkOrderOnApp: vi.fn(),
  bulkProcessOrdersOnApp: vi.fn(),
  bulkUpdateReceptionStatusOnApp: vi.fn(),
  getReportedOrdersFromApp: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  default: { error: vi.fn() },
}));

import * as crossAppBridgeService from '../services/crossAppBridgeService.js';
import * as crossAppBridgeController from './crossAppBridgeController.js';

function mockReqRes(overrides = {}) {
  const req = { params: {}, query: {}, body: {}, ...overrides };
  const res = { json: vi.fn(), status: vi.fn(() => res) };
  return { req, res };
}

describe('crossAppBridgeController', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('listConnectedAppOrders', () => {
    it('should return orders list', async () => {
      const expected = { success: true, orders: [{ _id: '1' }] };
      crossAppBridgeService.listOrdersFromApp.mockResolvedValue(expected);

      const { req, res } = mockReqRes({ params: { appId: 'app-1' }, query: { page: '1' } });
      await crossAppBridgeController.listConnectedAppOrders(req, res);

      expect(crossAppBridgeService.listOrdersFromApp).toHaveBeenCalledWith('app-1', req.query);
      expect(res.json).toHaveBeenCalledWith(expected);
    });

    it('should return 404 when app not found', async () => {
      crossAppBridgeService.listOrdersFromApp.mockRejectedValue(new Error("Connected app 'app-x' not found"));

      const { req, res } = mockReqRes({ params: { appId: 'app-x' } });
      await crossAppBridgeController.listConnectedAppOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: "Connected app 'app-x' not found" });
    });

    it('should return 404 when app disabled', async () => {
      crossAppBridgeService.listOrdersFromApp.mockRejectedValue(new Error("Connected app 'app-x' is disabled"));

      const { req, res } = mockReqRes({ params: { appId: 'app-x' } });
      await crossAppBridgeController.listConnectedAppOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 502 on proxy failure', async () => {
      crossAppBridgeService.listOrdersFromApp.mockRejectedValue(new Error('Request failed with status 500'));

      const { req, res } = mockReqRes({ params: { appId: 'app-1' } });
      await crossAppBridgeController.listConnectedAppOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Request failed with status 500' });
    });
  });

  describe('getConnectedAppOrder', () => {
    it('should return a single order', async () => {
      const expected = { success: true, order: { _id: '123' } };
      crossAppBridgeService.getOrderFromApp.mockResolvedValue(expected);

      const { req, res } = mockReqRes({ params: { appId: 'app-1', id: '123' } });
      await crossAppBridgeController.getConnectedAppOrder(req, res);

      expect(crossAppBridgeService.getOrderFromApp).toHaveBeenCalledWith('app-1', '123');
      expect(res.json).toHaveBeenCalledWith(expected);
    });

    it('should return 502 on failure', async () => {
      crossAppBridgeService.getOrderFromApp.mockRejectedValue(new Error('Network error'));

      const { req, res } = mockReqRes({ params: { appId: 'app-1', id: '123' } });
      await crossAppBridgeController.getConnectedAppOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(502);
    });
  });

  describe('updateConnectedAppOrderStatus', () => {
    it('should update status', async () => {
      const expected = { success: true, order: { _id: '123', status: 'processing' } };
      crossAppBridgeService.updateOrderStatusOnApp.mockResolvedValue(expected);

      const { req, res } = mockReqRes({
        params: { appId: 'app-1', id: '123' },
        body: { status: 'processing', notes: 'Processing' },
      });
      await crossAppBridgeController.updateConnectedAppOrderStatus(req, res);

      expect(crossAppBridgeService.updateOrderStatusOnApp).toHaveBeenCalledWith('app-1', '123', 'processing', 'Processing');
      expect(res.json).toHaveBeenCalledWith(expected);
    });
  });

  describe('updateConnectedAppReceptionStatus', () => {
    it('should update reception status', async () => {
      crossAppBridgeService.updateReceptionStatusOnApp.mockResolvedValue({ success: true });

      const { req, res } = mockReqRes({
        params: { appId: 'app-1', id: '123' },
        body: { receptionStatus: 'received' },
      });
      await crossAppBridgeController.updateConnectedAppReceptionStatus(req, res);

      expect(crossAppBridgeService.updateReceptionStatusOnApp).toHaveBeenCalledWith('app-1', '123', 'received');
    });
  });

  describe('cancelConnectedAppOrder', () => {
    it('should cancel order', async () => {
      crossAppBridgeService.cancelOrderOnApp.mockResolvedValue({ success: true });

      const { req, res } = mockReqRes({
        params: { appId: 'app-1', id: '123' },
        body: { reason: 'Customer request' },
      });
      await crossAppBridgeController.cancelConnectedAppOrder(req, res);

      expect(crossAppBridgeService.cancelOrderOnApp).toHaveBeenCalledWith('app-1', '123', 'Customer request');
    });
  });

  describe('reportConnectedAppOrder', () => {
    it('should report order', async () => {
      crossAppBridgeService.reportOrderOnApp.mockResolvedValue({ success: true });

      const { req, res } = mockReqRes({
        params: { appId: 'app-1', id: '123' },
        body: { description: 'Not delivered' },
      });
      await crossAppBridgeController.reportConnectedAppOrder(req, res);

      expect(crossAppBridgeService.reportOrderOnApp).toHaveBeenCalledWith('app-1', '123', 'Not delivered');
    });
  });

  describe('processConnectedAppOrderItem', () => {
    it('should process order item', async () => {
      crossAppBridgeService.processOrderItemOnApp.mockResolvedValue({ success: true });

      const { req, res } = mockReqRes({
        params: { appId: 'app-1', orderId: 'order1', itemId: 'item1' },
      });
      await crossAppBridgeController.processConnectedAppOrderItem(req, res);

      expect(crossAppBridgeService.processOrderItemOnApp).toHaveBeenCalledWith('app-1', 'order1', 'item1');
    });
  });

  describe('processConnectedAppBulkOrder', () => {
    it('should process bulk order', async () => {
      crossAppBridgeService.processBulkOrderOnApp.mockResolvedValue({ success: true });

      const { req, res } = mockReqRes({
        params: { appId: 'app-1', id: 'order1' },
      });
      await crossAppBridgeController.processConnectedAppBulkOrder(req, res);

      expect(crossAppBridgeService.processBulkOrderOnApp).toHaveBeenCalledWith('app-1', 'order1');
    });
  });

  describe('bulkProcessConnectedAppOrders', () => {
    it('should bulk process orders', async () => {
      crossAppBridgeService.bulkProcessOrdersOnApp.mockResolvedValue({ success: true, successful: 2, failed: 0 });

      const { req, res } = mockReqRes({
        params: { appId: 'app-1' },
        body: { orderIds: ['1', '2'], action: 'completed' },
      });
      await crossAppBridgeController.bulkProcessConnectedAppOrders(req, res);

      expect(crossAppBridgeService.bulkProcessOrdersOnApp).toHaveBeenCalledWith('app-1', ['1', '2'], 'completed');
    });
  });

  describe('bulkUpdateConnectedAppReceptionStatus', () => {
    it('should bulk update reception status', async () => {
      crossAppBridgeService.bulkUpdateReceptionStatusOnApp.mockResolvedValue({ success: true, successful: 2, failed: 0 });

      const { req, res } = mockReqRes({
        params: { appId: 'app-1' },
        body: { orderIds: ['1', '2'], receptionStatus: 'resolved' },
      });
      await crossAppBridgeController.bulkUpdateConnectedAppReceptionStatus(req, res);

      expect(crossAppBridgeService.bulkUpdateReceptionStatusOnApp).toHaveBeenCalledWith('app-1', ['1', '2'], 'resolved');
    });
  });

  describe('getConnectedAppReportedOrders', () => {
    it('should return reported orders', async () => {
      const expected = { success: true, orders: [{ _id: '1' }] };
      crossAppBridgeService.getReportedOrdersFromApp.mockResolvedValue(expected);

      const { req, res } = mockReqRes({ params: { appId: 'app-1' }, query: { page: '1' } });
      await crossAppBridgeController.getConnectedAppReportedOrders(req, res);

      expect(crossAppBridgeService.getReportedOrdersFromApp).toHaveBeenCalledWith('app-1', req.query);
      expect(res.json).toHaveBeenCalledWith(expected);
    });

    it('should return 502 on failure', async () => {
      crossAppBridgeService.getReportedOrdersFromApp.mockRejectedValue(new Error('fetch failed'));

      const { req, res } = mockReqRes({ params: { appId: 'app-1' } });
      await crossAppBridgeController.getConnectedAppReportedOrders(req, res);

      expect(res.status).toHaveBeenCalledWith(502);
    });
  });
});
