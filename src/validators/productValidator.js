import { body, param } from 'express-validator';

export const productValidation = {
  create: [
    body('name').trim().notEmpty().withMessage('Product name is required'),
    body('category')
      .isIn(['data-bundle', 'voice-bundle', 'sms-bundle', 'combo-bundle', 'physical', 'digital', 'service'])
      .withMessage('Invalid product category'),
    body('provider')
      .optional()
      .isIn(['MTN', 'Vodafone', 'AirtelTigo', 'Glo', 'Other'])
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
    body('provider').optional().isIn(['MTN', 'Vodafone', 'AirtelTigo', 'Glo', 'Other']),
    body('variants').optional().isArray({ min: 1 }),
    body('variants.*.name').optional().notEmpty(),
    body('variants.*.price').optional().isFloat({ min: 0 }),
    body('variants.*.inventory').optional().isInt({ min: 0 })
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
