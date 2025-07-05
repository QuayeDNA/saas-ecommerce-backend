// src/tests/integration/order-integration.test.js
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import Order from '../../models/Order.js';
import Product from '../../models/Product.js';
import Provider from '../../models/Provider.js';
import orderService from '../../services/orderService.js';

// Mock data for testing
const mockTenantId = new mongoose.Types.ObjectId();
const mockUserId = new mongoose.Types.ObjectId();
const mockPackageGroupId = new mongoose.Types.ObjectId();
const mockPackageItemId = new mongoose.Types.ObjectId();

describe('Order Integration Tests', () => {
  let mockPackageGroup;

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
    await Product.deleteMany({});
    await Provider.deleteMany({});

    // Create mock provider
    await Provider.create({
      name: 'MTN Ghana',
      code: 'MTN',
      description: 'Leading telecom provider in Ghana',
      isActive: true,
      createdBy: mockUserId
    });

    // Create mock package group with items
    mockPackageGroup = await Product.create({
      name: 'Daily Data Bundles',
      description: 'Affordable daily data packages',
      provider: 'MTN',
      tenantId: mockTenantId,
      createdBy: mockUserId,
      packageItems: [
        {
          _id: mockPackageItemId,
          name: '1GB Daily',
          code: 'MTN-1GB-DAILY',
          price: 5.00,
          costPrice: 4.00,
          inventory: 100,
          reservedInventory: 0,
          dataVolume: 1,
          validity: 1,
          isActive: true
        },
        {
          name: '2GB Daily',
          code: 'MTN-2GB-DAILY',
          price: 9.00,
          costPrice: 7.50,
          inventory: 50,
          reservedInventory: 0,
          dataVolume: 2,
          validity: 1,
          isActive: true
        }
      ],
      isActive: true
    });
  });

  describe('Single Order Creation', () => {
    it('should create a single order successfully', async () => {
      const orderData = {
        packageGroupId: mockPackageGroup._id,
        packageItemId: mockPackageItemId,
        customerPhone: '+233551234567',
        bundleSize: { value: 1, unit: 'GB' },
        quantity: 1
      };

      const order = await orderService.createSingleOrder(orderData, mockTenantId, mockUserId);

      expect(order).toBeDefined();
      expect(order.orderType).toBe('single');
      expect(order.items).toHaveLength(1);
      expect(order.items[0].packageGroup.toString()).toBe(mockPackageGroup._id.toString());
      expect(order.items[0].packageItem.toString()).toBe(mockPackageItemId.toString());
      expect(order.items[0].customerPhone).toBe('+233551234567');
      expect(order.total).toBe(5.00);
      expect(order.status).toBe('confirmed');
    });

    it('should reserve inventory when creating order', async () => {
      const orderData = {
        packageGroupId: mockPackageGroup._id,
        packageItemId: mockPackageItemId,
        customerPhone: '+233551234567',
        quantity: 3
      };

      await orderService.createSingleOrder(orderData, mockTenantId, mockUserId);

      // Check that inventory was reserved
      const updatedPackageGroup = await Product.findById(mockPackageGroup._id);
      const packageItem = updatedPackageGroup.packageItems.id(mockPackageItemId);
      
      expect(packageItem.reservedInventory).toBe(3);
      expect(packageItem.inventory).toBe(100); // Inventory not reduced until processing
    });

    it('should throw error for insufficient inventory', async () => {
      const orderData = {
        packageGroupId: mockPackageGroup._id,
        packageItemId: mockPackageItemId,
        customerPhone: '+233551234567',
        quantity: 150 // More than available inventory
      };

      await expect(
        orderService.createSingleOrder(orderData, mockTenantId, mockUserId)
      ).rejects.toThrow('Insufficient inventory');
    });
  });

  describe('Bulk Order Creation', () => {
    it('should create a bulk order successfully', async () => {
      const bulkData = {
        packageGroupId: mockPackageGroup._id,
        packageItemId: mockPackageItemId,
        rawInput: '+233551234567:1GB\n+233552345678:1GB\n+233553456789:1GB'
      };

      const order = await orderService.createBulkOrder(bulkData, mockTenantId, mockUserId);

      expect(order).toBeDefined();
      expect(order.orderType).toBe('bulk');
      expect(order.items).toHaveLength(3);
      expect(order.bulkData.totalItems).toBe(3);
      expect(order.total).toBe(15.00); // 3 items × 5.00
    });

    it('should parse bulk input correctly', async () => {
      const service = orderService;
      const rawInput = '+233551234567:1GB\n+233552345678:2GB\n+233553456789:500MB';
      
      const parsedItems = service.parseBulkInput(rawInput);
      
      expect(parsedItems).toHaveLength(3);
      expect(parsedItems[0]).toEqual({
        phone: '+233551234567',
        bundleSize: { value: 1, unit: 'GB' }
      });
      expect(parsedItems[1]).toEqual({
        phone: '+233552345678',
        bundleSize: { value: 2, unit: 'GB' }
      });
      expect(parsedItems[2]).toEqual({
        phone: '+233553456789',
        bundleSize: { value: 500, unit: 'MB' }
      });
    });

    it('should ignore invalid bulk input lines', async () => {
      const service = orderService;
      const rawInput = '+233551234567:1GB\ninvalid-line\n+233552345678:2GB\n:missing-phone\nphone-without-bundle:';
      
      const parsedItems = service.parseBulkInput(rawInput);
      
      expect(parsedItems).toHaveLength(2);
      expect(parsedItems[0].phone).toBe('+233551234567');
      expect(parsedItems[1].phone).toBe('+233552345678');
    });
  });

  describe('Order Processing', () => {
    let testOrder;

    beforeEach(async () => {
      // Create a test order
      const orderData = {
        packageGroupId: mockPackageGroup._id,
        packageItemId: mockPackageItemId,
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

      // Check that inventory was reduced
      const updatedPackageGroup = await Product.findById(mockPackageGroup._id);
      const packageItem = updatedPackageGroup.packageItems.id(mockPackageItemId);
      
      expect(packageItem.inventory).toBe(98); // 100 - 2
      expect(packageItem.reservedInventory).toBe(0); // Released
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

      // Check that inventory was not reduced but reservation was released
      const updatedPackageGroup = await Product.findById(mockPackageGroup._id);
      const packageItem = updatedPackageGroup.packageItems.id(mockPackageItemId);
      
      expect(packageItem.inventory).toBe(100); // Not reduced
      expect(packageItem.reservedInventory).toBe(0); // Released

      // Restore original method
      orderService.processMobileBundle = originalMethod;
    });
  });

  describe('Order Cancellation', () => {
    let testOrder;

    beforeEach(async () => {
      // Create a test order
      const orderData = {
        packageGroupId: mockPackageGroup._id,
        packageItemId: mockPackageItemId,
        customerPhone: '+233551234567',
        quantity: 3
      };

      testOrder = await orderService.createSingleOrder(orderData, mockTenantId, mockUserId);
    });

    it('should cancel order and release inventory', async () => {
      const cancelledOrder = await orderService.cancelOrder(
        testOrder._id,
        mockTenantId,
        mockUserId,
        'Customer requested cancellation'
      );

      expect(cancelledOrder.status).toBe('cancelled');
      expect(cancelledOrder.notes).toBe('Customer requested cancellation');
      expect(cancelledOrder.items[0].processingStatus).toBe('cancelled');

      // Check that reserved inventory was released
      const updatedPackageGroup = await Product.findById(mockPackageGroup._id);
      const packageItem = updatedPackageGroup.packageItems.id(mockPackageItemId);
      
      expect(packageItem.reservedInventory).toBe(0);
      expect(packageItem.inventory).toBe(100); // Not reduced
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
        packageGroupId: mockPackageGroup._id,
        packageItemId: mockPackageItemId,
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
        packageGroupId: mockPackageGroup._id,
        packageItemId: mockPackageItemId,
        customerPhone: '+233551234567',
        quantity: 1
      }, mockTenantId, mockUserId);

      await orderService.createBulkOrder({
        packageGroupId: mockPackageGroup._id,
        packageItemId: mockPackageItemId,
        rawInput: '+233551234567:1GB\n+233552345678:1GB'
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
