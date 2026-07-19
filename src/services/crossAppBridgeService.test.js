import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/connectedApps.js', () => ({
  getConnectedAppByAppId: vi.fn(),
  makeRequest: vi.fn(),
}));

import { getConnectedAppByAppId, makeRequest } from '../utils/connectedApps.js';
import * as crossAppBridgeService from './crossAppBridgeService.js';

describe('crossAppBridgeService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const appId = 'app-directdata';
  const mockApp = {
    appId: 'app-directdata',
    name: 'DirectData',
    baseUrl: 'https://directdata.example.com',
    apiKey: 'sk_test_key',
    enabled: true,
  };

  describe('listOrdersFromApp', () => {
    it('should list orders with query params', async () => {
      const expected = { success: true, orders: [] };
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue(expected);

      const result = await crossAppBridgeService.listOrdersFromApp(appId, { page: '1', limit: '20' });

      expect(getConnectedAppByAppId).toHaveBeenCalledWith(appId);
      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'GET', '/api/internal/orders?page=1&limit=20');
      expect(result).toEqual(expected);
    });

    it('should handle empty query params', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true, orders: [] });

      const result = await crossAppBridgeService.listOrdersFromApp(appId, {});

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'GET', '/api/internal/orders?');
    });
  });

  describe('getOrderFromApp', () => {
    it('should get a single order', async () => {
      const expected = { success: true, order: { _id: 'order1' } };
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue(expected);

      const result = await crossAppBridgeService.getOrderFromApp(appId, 'order1');

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'GET', '/api/internal/orders/order1');
      expect(result).toEqual(expected);
    });
  });

  describe('updateOrderStatusOnApp', () => {
    it('should update order status', async () => {
      const expected = { success: true, order: { _id: 'order1', status: 'processing' } };
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue(expected);

      const result = await crossAppBridgeService.updateOrderStatusOnApp(appId, 'order1', 'processing', 'Processing order');

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'PATCH', '/api/internal/orders/order1/status', {
        status: 'processing',
        notes: 'Processing order',
      });
      expect(result).toEqual(expected);
    });

    it('should update without notes', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true });

      await crossAppBridgeService.updateOrderStatusOnApp(appId, 'order1', 'completed', undefined);

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'PATCH', '/api/internal/orders/order1/status', {
        status: 'completed',
        notes: undefined,
      });
    });
  });

  describe('updateReceptionStatusOnApp', () => {
    it('should update reception status', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true });

      await crossAppBridgeService.updateReceptionStatusOnApp(appId, 'order1', 'received');

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'PATCH', '/api/internal/orders/order1/reception-status', {
        receptionStatus: 'received',
      });
    });
  });

  describe('cancelOrderOnApp', () => {
    it('should cancel order with reason', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true });

      await crossAppBridgeService.cancelOrderOnApp(appId, 'order1', 'Customer request');

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'POST', '/api/internal/orders/order1/cancel', {
        reason: 'Customer request',
      });
    });

    it('should cancel without reason', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true });

      await crossAppBridgeService.cancelOrderOnApp(appId, 'order1', undefined);

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'POST', '/api/internal/orders/order1/cancel', {
        reason: undefined,
      });
    });
  });

  describe('reportOrderOnApp', () => {
    it('should report order with description', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true });

      await crossAppBridgeService.reportOrderOnApp(appId, 'order1', 'Not delivered');

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'POST', '/api/internal/orders/order1/report', {
        description: 'Not delivered',
      });
    });
  });

  describe('processOrderItemOnApp', () => {
    it('should process order item', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true });

      await crossAppBridgeService.processOrderItemOnApp(appId, 'order1', 'item1');

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'POST', '/api/internal/orders/order1/items/item1/process');
    });
  });

  describe('processBulkOrderOnApp', () => {
    it('should process bulk order', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true });

      await crossAppBridgeService.processBulkOrderOnApp(appId, 'order1');

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'POST', '/api/internal/orders/order1/process-bulk');
    });
  });

  describe('bulkProcessOrdersOnApp', () => {
    it('should bulk process orders', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true });

      await crossAppBridgeService.bulkProcessOrdersOnApp(appId, ['order1', 'order2'], 'completed');

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'POST', '/api/internal/orders/bulk-process', {
        orderIds: ['order1', 'order2'],
        action: 'completed',
      });
    });
  });

  describe('bulkUpdateReceptionStatusOnApp', () => {
    it('should bulk update reception status', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue({ success: true });

      await crossAppBridgeService.bulkUpdateReceptionStatusOnApp(appId, ['order1', 'order2'], 'resolved');

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'POST', '/api/internal/orders/bulk-reception-status', {
        orderIds: ['order1', 'order2'],
        receptionStatus: 'resolved',
      });
    });
  });

  describe('getReportedOrdersFromApp', () => {
    it('should get reported orders with query params', async () => {
      const expected = { success: true, orders: [] };
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockResolvedValue(expected);

      const result = await crossAppBridgeService.getReportedOrdersFromApp(appId, { page: '1' });

      expect(makeRequest).toHaveBeenCalledWith(mockApp, 'GET', '/api/internal/orders/reported?page=1');
      expect(result).toEqual(expected);
    });
  });

  describe('error handling — app not found or disabled', () => {
    it('should throw when app is not found', async () => {
      getConnectedAppByAppId.mockRejectedValue(new Error("Connected app 'nonexistent' not found"));

      await expect(crossAppBridgeService.listOrdersFromApp('nonexistent', {}))
        .rejects.toThrow("Connected app 'nonexistent' not found");
    });

    it('should throw when app is disabled', async () => {
      getConnectedAppByAppId.mockRejectedValue(new Error("Connected app 'app-directdata' is disabled"));

      await expect(crossAppBridgeService.listOrdersFromApp(appId, {}))
        .rejects.toThrow("Connected app 'app-directdata' is disabled");
    });
  });

  describe('error handling — request failures', () => {
    it('should propagate makeRequest errors', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockRejectedValue(new Error('Request failed with status 500'));

      await expect(crossAppBridgeService.listOrdersFromApp(appId, {}))
        .rejects.toThrow('Request failed with status 500');
    });

    it('should propagate network errors', async () => {
      getConnectedAppByAppId.mockResolvedValue(mockApp);
      makeRequest.mockRejectedValue(new Error('fetch failed'));

      await expect(crossAppBridgeService.listOrdersFromApp(appId, {}))
        .rejects.toThrow('fetch failed');
    });
  });
});
