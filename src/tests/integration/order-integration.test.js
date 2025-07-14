// src/tests/integration/order-integration.test.js
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import Order from '../../models/Order.js';
import Bundle from '../../models/Bundle.js';
import Provider from '../../models/Provider.js';
import orderService from '../../services/orderService.js';

// Mock data for testing
const mockTenantId = new mongoose.Types.ObjectId();
const mockUserId = new mongoose.Types.ObjectId();
const mockPackageGroupId = new mongoose.Types.ObjectId();
const mockPackageItemId = new mongoose.Types.ObjectId();

describe('Order Integration Tests', () => {
  let mockProvider;
  let mockBundle;

  beforeAll(async () => {
    // Connect to test database
    await mongoose.connect(process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/test-db');
  });

  afterAll(async () => {
    // Cleanup and close connection
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Clean up collections
    await Order.deleteMany({});
    await Bundle.deleteMany({});
    await Provider.deleteMany({});

    // Create mock provider
    mockProvider = await Provider.create({
      name: 'MTN Ghana',
      code: 'MTN',
      description: 'Leading telecom provider in Ghana',
      isActive: true,
      createdBy: mockUserId
    });

    // Create mock bundle
    mockBundle = await Bundle.create({
      name: '1GB Daily',
      description: '1GB daily data bundle',
      dataVolume: 1,
      dataUnit: 'GB',
      validity: 1,
      validityUnit: 'days',
      price: 5.00,
      currency: 'GHS',
      category: 'daily',
      packageId: mockPackageGroupId,
      providerId: mockProvider._id,
      tenantId: mockTenantId,
      createdBy: mockUserId,
      isActive: true
    });
  });

  describe('Single Order Creation', () => {
    it('should create a single order successfully', async () => {
      const orderData = {
        packageGroupId: mockBundle.packageId,
        packageItemId: mockBundle._id,
        customerPhone: '+233551234567',
        bundleSize: { value: 1, unit: 'GB' },
        quantity: 1
      };

      const order = await orderService.createSingleOrder(orderData, mockTenantId, mockUserId);

      expect(order).toBeDefined();
      expect(order.orderType).toBe('single');
      expect(order.items).toHaveLength(1);
      expect(order.items[0].packageGroup.toString()).toBe(mockBundle.packageId.toString());
      expect(order.items[0].packageItem.toString()).toBe(mockBundle._id.toString());
      expect(order.items[0].customerPhone).toBe('+233551234567');
      expect(order.total).toBe(5.00);
      expect(order.status).toBe('confirmed');
    });

    it('should create order successfully', async () => {
      const orderData = {
        packageGroupId: mockBundle.packageId,
        packageItemId: mockBundle._id,
        customerPhone: '+233551234567',
        quantity: 3
      };

      const order = await orderService.createSingleOrder(orderData, mockTenantId, mockUserId);

      expect(order).toBeDefined();
      expect(order.orderType).toBe('single');
      expect(order.items).toHaveLength(1);
      expect(order.total).toBe(15.00); // 3 × 5.00
    });

    it('should throw error for invalid bundle', async () => {
      const orderData = {
        packageGroupId: new mongoose.Types.ObjectId(),
        packageItemId: new mongoose.Types.ObjectId(),
        customerPhone: '+233551234567',
        quantity: 1
      };

      await expect(
        orderService.createSingleOrder(orderData, mockTenantId, mockUserId)
      ).rejects.toThrow('Bundle not found or inactive');
    });
  });

  describe('Bulk Order Creation', () => {
    it('should create a bulk order successfully', async () => {
      const bulkData = {
        packageGroupId: mockBundle.packageId,
        packageItemId: mockBundle._id,
        bulkData: '0241234567\n0241234568\n0241234569'
      };

      const result = await orderService.createBulkOrder(bulkData, mockTenantId, mockUserId);

      expect(result).toBeDefined();
      expect(result.totalItems).toBe(3);
      expect(result.items).toHaveLength(3);
    });


  });

  describe('Order Processing', () => {
    let testOrder;

    beforeEach(async () => {
      // Create a test order
      const orderData = {
        packageGroupId: mockBundle.packageId,
        packageItemId: mockBundle._id,
        customerPhone: '+233551234567',
        quantity: 2
      };

      testOrder = await orderService.createSingleOrder(orderData, mockTenantId, mockUserId);
    });

    it('should process order item successfully', async () => {
      const itemId = testOrder.items[0]._id;
      
      const processedOrder = await orderService.processOrderItem(
        testOrder._id,
        itemId,
        mockTenantId,
        mockUserId
      );

      expect(processedOrder.items[0].processingStatus).toBe('completed');
      expect(processedOrder.items[0].processedAt).toBeDefined();
      expect(processedOrder.status).toBe('completed');
    });

    it('should handle processing failures correctly', async () => {
      const itemId = testOrder.items[0]._id;
      
      // Mock processing failure
      const originalMethod = orderService.processMobileBundle;
      orderService.processMobileBundle = async () => {
        throw new Error('Network provider API error');
      };

      const processedOrder = await orderService.processOrderItem(
        testOrder._id,
        itemId,
        mockTenantId,
        mockUserId
      );

      expect(processedOrder.items[0].processingStatus).toBe('failed');
      expect(processedOrder.items[0].processingError).toBe('Network provider API error');
      expect(processedOrder.status).toBe('failed');

      // Restore original method
      orderService.processMobileBundle = originalMethod;
    });
  });

  describe('Order Cancellation', () => {
    let testOrder;

    beforeEach(async () => {
      // Create a test order
      const orderData = {
        packageGroupId: mockBundle.packageId,
        packageItemId: mockBundle._id,
        customerPhone: '+233551234567',
        quantity: 3
      };

      testOrder = await orderService.createSingleOrder(orderData, mockTenantId, mockUserId);
    });

    it('should cancel order successfully', async () => {
      const cancelledOrder = await orderService.cancelOrder(
        testOrder._id,
        mockTenantId,
        mockUserId,
        'Customer requested cancellation'
      );

      expect(cancelledOrder.status).toBe('cancelled');
      expect(cancelledOrder.notes).toBe('Customer requested cancellation');
      expect(cancelledOrder.items[0].processingStatus).toBe('cancelled');
    });

    it('should not allow cancellation of processed orders', async () => {
      // First process the order
      const itemId = testOrder.items[0]._id;
      await orderService.processOrderItem(testOrder._id, itemId, mockTenantId, mockUserId);

      // Try to cancel - should fail
      await expect(
        orderService.cancelOrder(testOrder._id, mockTenantId, mockUserId, 'Test cancellation')
      ).rejects.toThrow('Order cannot be cancelled in current status');
    });
  });

  describe('Order Analytics', () => {
    beforeEach(async () => {
      // Create test orders for analytics
      const orderData = {
        packageGroupId: mockBundle.packageId,
        packageItemId: mockBundle._id,
        customerPhone: '+233551234567',
        quantity: 1
      };

      // Create completed order
      const completedOrder = await orderService.createSingleOrder(orderData, mockTenantId, mockUserId);
      completedOrder.status = 'completed';
      await completedOrder.save();

      // Create pending order
      await orderService.createSingleOrder({
        ...orderData,
        customerPhone: '+233552345678'
      }, mockTenantId, mockUserId);
    });

    it('should calculate analytics correctly', async () => {
      const analytics = await orderService.getOrderAnalytics(mockTenantId, '30d');

      expect(analytics.totalOrders).toBe(2);
      expect(analytics.completedOrders).toBe(1);
      expect(analytics.pendingOrders).toBe(1);
      expect(analytics.totalRevenue).toBe(5.00);
      expect(analytics.completionRate).toBe(50);
    });
  });

  describe('Order Retrieval', () => {
    beforeEach(async () => {
      // Create test orders
      await orderService.createSingleOrder({
        packageGroupId: mockBundle.packageId,
        packageItemId: mockBundle._id,
        customerPhone: '+233551234567',
        quantity: 1
      }, mockTenantId, mockUserId);

      await orderService.createBulkOrder({
        packageGroupId: mockBundle.packageId,
        packageItemId: mockBundle._id,
        bulkData: '0241234567\n0241234568'
      }, mockTenantId, mockUserId);
    });

    it('should retrieve orders with filtering', async () => {
      const result = await orderService.getOrders(mockTenantId, { orderType: 'single' });

      expect(result.orders).toHaveLength(1);
      expect(result.orders[0].orderType).toBe('single');
      expect(result.pagination.total).toBe(1);
    });

    it('should retrieve orders with pagination', async () => {
      const result = await orderService.getOrders(mockTenantId, {}, { page: 1, limit: 1 });

      expect(result.orders).toHaveLength(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.pages).toBe(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should search orders by phone number', async () => {
      const result = await orderService.getOrders(mockTenantId, { search: '+233551234567' });

      expect(result.orders.length).toBeGreaterThan(0);
      expect(result.orders[0].items[0].customerPhone).toContain('+233551234567');
    });
  });
});
