// src/validators/productValidator.js
import { body, param } from 'express-validator';

export const productValidation = {
  create: [
    body('name').trim().notEmpty().withMessage('Product name is required'),
    body('category')
      .isIn(['data-bundle', 'voice-bundle', 'sms-bundle', 'combo-bundle', 'physical', 'digital', 'service'])
      .withMessage('Invalid product category'),
    body('provider')
      .optional()
      .isIn(['MTN', 'TELECEL', 'AT', 'Other'])
      .withMessage('Invalid provider'),
    body('variants').isArray({ min: 1 }).withMessage('At least one variant is required'),
    body('variants.*.name').notEmpty().withMessage('Variant name is required'),
    body('variants.*.price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('variants.*.inventory').optional().isInt({ min: 0 }),
    body('variants.*.sku').optional().isLength({ min: 3 }).withMessage('SKU must be at least 3 characters')
  ],
  
  update: [
    param('id').isMongoId().withMessage('Invalid product ID'),
    body('name').optional().trim().notEmpty(),
    body('category').optional().isIn(['data-bundle', 'voice-bundle', 'sms-bundle', 'combo-bundle', 'physical', 'digital', 'service']),
    body('provider').optional().isIn(['MTN', 'TELECEL', 'AT', 'Other'])
  ],
  
  bulkCreate: [
    body().custom((value) => {
      if (!value.products && !value.csvData) {
        throw new Error('Either products array or csvData is required');
      }
      if (value.products && !Array.isArray(value.products)) {
        throw new Error('Products must be an array');
      }
      if (value.products && value.products.length === 0) {
        throw new Error('Products array cannot be empty');
      }
      if (value.products && value.products.length > 100) {
        throw new Error('Cannot create more than 100 products at once');
      }
      return true;
    })
  ],
  
  bulkUpdate: [
    body('updates').isArray({ min: 1, max: 100 }).withMessage('Updates array is required (max 100 items)'),
    body('updates.*.productId').isMongoId().withMessage('Invalid product ID'),
    body('updates.*.updateData').isObject().withMessage('Update data is required')
  ],
  
  bulkDelete: [
    body('productIds').isArray({ min: 1, max: 100 }).withMessage('Product IDs array is required (max 100 items)'),
    body('productIds.*').isMongoId().withMessage('Invalid product ID')
  ],
  
  bulkInventory: [
    body('updates').isArray({ min: 1 }).withMessage('Updates array is required'),
    body('updates.*.productId').isMongoId().withMessage('Invalid product ID'),
    body('updates.*.variantId').notEmpty().withMessage('Variant ID is required'),
    body('updates.*.inventory').isInt({ min: 0 }).withMessage('Inventory must be a non-negative integer')
  ],
  
  createVariant: [
    param('id').isMongoId().withMessage('Invalid product ID'),
    body('name').notEmpty().withMessage('Variant name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('inventory').optional().isInt({ min: 0 }),
    body('sku').optional().isLength({ min: 3 }).withMessage('SKU must be at least 3 characters')
  ],
  
  updateVariant: [
    param('id').isMongoId().withMessage('Invalid product ID'),
    param('variantId').notEmpty().withMessage('Variant ID is required'),
    body('name').optional().notEmpty(),
    body('price').optional().isFloat({ min: 0 }),
    body('inventory').optional().isInt({ min: 0 })
  ]
};
