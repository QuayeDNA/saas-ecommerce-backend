# Order Management API - Updated Implementation

## Overview

The order management system has been completely refactored to work with the new Package Groups and Package Items structure instead of the legacy Product/Variants system. This document outlines the updated API endpoints and data models.

## Data Model Changes

### Before (Legacy)
- **Product** → contained variants
- **Variants** → individual sellable items
- Order items referenced `product` and `variant` IDs

### After (Updated)
- **PackageGroup** → container for related packages (e.g., "Daily Data Bundles")
- **PackageItem** → individual sellable items within a group
- Order items reference `packageGroup` and `packageItem` IDs

## API Endpoints

### 1. Create Single Order
**POST** `/api/orders/single`

Creates a single order for one customer.

**Request Body:**
```json
{
  "packageGroupId": "60f7b3b3e4b0a1b2c3d4e5f6",
  "packageItemId": "60f7b3b3e4b0a1b2c3d4e5f7",
  "customerPhone": "+233551234567",
  "bundleSize": {
    "value": 1,
    "unit": "GB"
  },
  "quantity": 1
}
```

**Response:**
```json
{
  "success": true,
  "order": {
    "_id": "60f7b3b3e4b0a1b2c3d4e5f8",
    "orderNumber": "ORD-20250105-A1B2C3",
    "orderType": "single",
    "status": "confirmed",
    "items": [
      {
        "packageGroup": "60f7b3b3e4b0a1b2c3d4e5f6",
        "packageItem": "60f7b3b3e4b0a1b2c3d4e5f7",
        "packageDetails": {
          "name": "1GB Daily",
          "code": "MTN-1GB-DAILY",
          "price": 5.00,
          "dataVolume": 1,
          "validity": 1,
          "provider": "MTN"
        },
        "quantity": 1,
        "unitPrice": 5.00,
        "totalPrice": 5.00,
        "customerPhone": "+233551234567",
        "processingStatus": "pending"
      }
    ],
    "total": 5.00,
    "createdAt": "2025-01-05T10:30:00.000Z"
  }
}
```

### 2. Create Bulk Order
**POST** `/api/orders/bulk`

Creates a bulk order for multiple customers.

**Request Body:**
```json
{
  "packageGroupId": "60f7b3b3e4b0a1b2c3d4e5f6",
  "packageItemId": "60f7b3b3e4b0a1b2c3d4e5f7",
  "rawInput": "+233551234567:1GB\n+233552345678:1GB\n+233553456789:2GB"
}
```

**Bulk Input Format:**
Each line should contain: `phone:bundleSize`
- `phone`: Customer phone number (format: `+233551234567`)
- `bundleSize`: Data volume with unit (format: `1GB`, `500MB`)

**Response:**
```json
{
  "success": true,
  "order": {
    "_id": "60f7b3b3e4b0a1b2c3d4e5f9",
    "orderNumber": "ORD-20250105-D4E5F6",
    "orderType": "bulk",
    "status": "confirmed",
    "items": [
      {
        "packageGroup": "60f7b3b3e4b0a1b2c3d4e5f6",
        "packageItem": "60f7b3b3e4b0a1b2c3d4e5f7",
        "customerPhone": "+233551234567",
        "bundleSize": { "value": 1, "unit": "GB" },
        "processingStatus": "pending"
      },
      // ... more items
    ],
    "bulkData": {
      "totalItems": 3,
      "successfulItems": 0,
      "failedItems": 0
    },
    "total": 15.00
  }
}
```

### 3. Get Orders
**GET** `/api/orders`

Retrieves orders with filtering and pagination.

**Query Parameters:**
- `status`: Filter by order status (`pending`, `confirmed`, `processing`, `completed`, `cancelled`)
- `orderType`: Filter by order type (`single`, `bulk`)
- `paymentStatus`: Filter by payment status (`pending`, `paid`, `failed`)
- `startDate`: Filter orders created after this date (ISO format)
- `endDate`: Filter orders created before this date (ISO format)
- `search`: Search in order number, customer info, or phone numbers
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)
- `sortBy`: Sort field (default: `createdAt`)
- `sortOrder`: Sort direction (`asc` or `desc`, default: `desc`)

**Response:**
```json
{
  "success": true,
  "orders": [
    {
      "_id": "60f7b3b3e4b0a1b2c3d4e5f8",
      "orderNumber": "ORD-20250105-A1B2C3",
      "orderType": "single",
      "status": "confirmed",
      "total": 5.00,
      "createdAt": "2025-01-05T10:30:00.000Z",
      "items": [/* order items */]
    }
  ],
  "pagination": {
    "total": 25,
    "page": 1,
    "pages": 3,
    "limit": 20
  }
}
```

### 4. Get Single Order
**GET** `/api/orders/:id`

Retrieves a specific order by ID.

**Response:**
```json
{
  "success": true,
  "order": {
    "_id": "60f7b3b3e4b0a1b2c3d4e5f8",
    "orderNumber": "ORD-20250105-A1B2C3",
    "orderType": "single",
    "status": "confirmed",
    "items": [/* populated order items */],
    "createdBy": {
      "_id": "60f7b3b3e4b0a1b2c3d4e5f1",
      "fullName": "John Doe",
      "email": "john@example.com"
    },
    "total": 5.00,
    "completionPercentage": 0,
    "createdAt": "2025-01-05T10:30:00.000Z"
  }
}
```

### 5. Process Order Item
**POST** `/api/orders/:orderId/items/:itemId/process`

Processes a single order item (delivers the mobile bundle).

**Response:**
```json
{
  "success": true,
  "message": "Order item processed successfully",
  "order": {
    "_id": "60f7b3b3e4b0a1b2c3d4e5f8",
    "status": "completed",
    "items": [
      {
        "_id": "60f7b3b3e4b0a1b2c3d4e5f9",
        "processingStatus": "completed",
        "processedAt": "2025-01-05T10:35:00.000Z"
      }
    ],
    "completionPercentage": 100
  }
}
```

### 6. Process Bulk Order
**POST** `/api/orders/:id/process-bulk`

Starts processing all pending items in a bulk order (background operation).

**Response:**
```json
{
  "success": true,
  "message": "Bulk order processing started"
}
```

### 7. Cancel Order
**POST** `/api/orders/:id/cancel`

Cancels an order and releases reserved inventory.

**Request Body:**
```json
{
  "reason": "Customer requested cancellation"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order cancelled successfully",
  "order": {
    "_id": "60f7b3b3e4b0a1b2c3d4e5f8",
    "status": "cancelled",
    "notes": "Customer requested cancellation",
    "items": [
      {
        "processingStatus": "cancelled"
      }
    ]
  }
}
```

### 8. Get Order Analytics
**GET** `/api/orders/analytics/summary`

Retrieves order analytics for a specific time period.

**Query Parameters:**
- `timeframe`: Time period (`7d`, `30d`, `90d`, default: `30d`)

**Response:**
```json
{
  "success": true,
  "analytics": {
    "totalOrders": 150,
    "completedOrders": 120,
    "pendingOrders": 25,
    "totalRevenue": 750.00,
    "bulkOrders": 45,
    "completionRate": 80,
    "timeframe": "30d"
  }
}
```

## Data Models

### Order Schema
```javascript
{
  orderNumber: String,          // Auto-generated: ORD-YYYYMMDD-XXXXXX
  orderType: String,            // 'single' | 'bulk' | 'regular'
  status: String,               // 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled' | 'failed'
  
  // Order items
  items: [{
    packageGroup: ObjectId,      // Reference to PackageGroup
    packageItem: ObjectId,       // Reference to PackageItem within the group
    packageDetails: {            // Snapshot of package details
      name: String,
      code: String,
      price: Number,
      dataVolume: Number,
      validity: Number,
      provider: String
    },
    quantity: Number,
    unitPrice: Number,
    totalPrice: Number,
    customerPhone: String,
    bundleSize: {
      value: Number,
      unit: String              // 'MB' | 'GB'
    },
    processingStatus: String,   // 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
    processingError: String,
    processedAt: Date,
    processedBy: ObjectId
  }],
  
  // Pricing
  subtotal: Number,
  tax: Number,
  discount: Number,
  total: Number,
  
  // Payment info
  paymentStatus: String,        // 'pending' | 'paid' | 'failed' | 'refunded'
  paymentMethod: String,        // 'cash' | 'card' | 'mobile_money' | 'wallet'
  
  // Bulk order specific
  bulkData: {
    rawInput: String,           // Original bulk input text
    totalItems: Number,
    successfulItems: Number,
    failedItems: Number
  },
  
  // Audit fields
  tenantId: ObjectId,
  createdBy: ObjectId,
  processedBy: ObjectId,
  
  // Timestamps
  createdAt: Date,
  updatedAt: Date
}
```

### PackageGroup Schema
```javascript
{
  name: String,                 // e.g., "Daily Data Bundles"
  description: String,
  provider: String,             // 'MTN' | 'TELECEL' | 'AT' | 'GLO'
  packageItems: [{
    name: String,               // e.g., "1GB Daily"
    code: String,               // e.g., "MTN-1GB-DAILY"
    price: Number,
    costPrice: Number,
    inventory: Number,          // Available stock
    reservedInventory: Number,  // Reserved for pending orders
    dataVolume: Number,         // in GB
    validity: Number,           // in days
    isActive: Boolean
  }],
  isActive: Boolean,
  tenantId: ObjectId,
  createdBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

## Inventory Management

### Inventory Reservation Flow
1. **Order Creation**: When an order is created, inventory is reserved
   - `reservedInventory` is increased
   - `inventory` remains unchanged
   - Available inventory = `inventory - reservedInventory`

2. **Order Processing**: When an order item is processed successfully
   - `reservedInventory` is decreased
   - `inventory` is decreased (actual consumption)

3. **Order Failure**: When processing fails
   - `reservedInventory` is decreased
   - `inventory` remains unchanged (no consumption)

4. **Order Cancellation**: When an order is cancelled
   - `reservedInventory` is decreased
   - `inventory` remains unchanged

### Inventory Validation
- Orders cannot be created if `availableInventory < requiredQuantity`
- Bulk orders validate total inventory requirement before creation
- Inventory is managed within database transactions for consistency

## Error Handling

### Common Error Responses

**Package Group Not Found:**
```json
{
  "success": false,
  "message": "Package group not found"
}
```

**Insufficient Inventory:**
```json
{
  "success": false,
  "message": "Insufficient inventory. Available: 5, Required: 10"
}
```

**Invalid Order Status:**
```json
{
  "success": false,
  "message": "Order cannot be cancelled in current status"
}
```

**Processing Error:**
```json
{
  "success": false,
  "message": "Network provider API error"
}
```

## Background Processing

### Bulk Order Processing
- Bulk orders are processed in background to avoid timeouts
- Items are processed in batches (default: 10 items per batch)
- Processing includes delays between batches to avoid overwhelming APIs
- Individual item failures don't stop the entire batch

### Order Status Updates
- Order status is automatically updated based on item processing status
- Status calculation rules:
  - All items `completed` → Order `completed`
  - All items `failed` → Order `failed`
  - Mix of `completed` and `failed` → Order `partially_completed`
  - Any item `processing` → Order `processing`

## Integration Notes

### Mobile Network APIs
- The `processMobileBundle()` method simulates mobile bundle delivery
- In production, replace with actual network provider API calls
- Handle network-specific error codes and responses
- Implement retry logic for failed API calls

### Database Transactions
- All inventory operations use MongoDB transactions
- Ensures data consistency across order and inventory updates
- Automatic rollback on failures

### Authentication & Authorization
- All endpoints require authentication
- Minimum role required: `agent`
- Orders are tenant-scoped for multi-tenancy support

## Testing

The system includes comprehensive integration tests covering:
- Single and bulk order creation
- Inventory reservation and release
- Order processing and failure handling
- Order cancellation
- Analytics calculation
- Order retrieval and filtering

Run tests with:
```bash
npm test -- order-integration.test.js
```

## Migration Guide

### From Legacy System
1. Update frontend to use `packageGroupId` and `packageItemId` instead of `productId` and `variantId`
2. Update API calls to use new field names
3. Update any direct database queries to use new schema
4. Test order creation and processing flows thoroughly

### Database Migration
```javascript
// Example migration script
db.orders.updateMany(
  { "items.product": { $exists: true } },
  { 
    $rename: { 
      "items.product": "items.packageGroup",
      "items.variant": "items.packageItem"
    }
  }
);
```
