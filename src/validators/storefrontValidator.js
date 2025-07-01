// src/validators/storefrontValidator.js
import { body, param } from 'express-validator';

export const storefrontValidation = {
  create: [
    body('name').trim().notEmpty().withMessage('Storefront name is required'),
    body('description').optional().trim().isLength({ max: 500 }),
    body('slug')
      .optional()
      .matches(/^[a-z0-9-]+$/)
      .withMessage('Slug can only contain lowercase letters, numbers, and hyphens'),
    body('theme.primaryColor').optional().matches(/^#[0-9A-F]{6}$/i),
    body('contactInfo.email').optional().isEmail(),
    body('contactInfo.phone').optional().isMobilePhone(),
    body('features.showPrices').optional().isBoolean(),
    body('features.allowOrders').optional().isBoolean()
  ],
  
  update: [
    body('name').optional().trim().notEmpty(),
    body('description').optional().trim().isLength({ max: 500 }),
    body('slug')
      .optional()
      .matches(/^[a-z0-9-]+$/)
      .withMessage('Slug can only contain lowercase letters, numbers, and hyphens'),
    body('theme.primaryColor').optional().matches(/^#[0-9A-F]{6}$/i),
    body('contactInfo.email').optional().isEmail(),
    body('contactInfo.phone').optional().isMobilePhone()
  ],
  
  createOrder: [
    body('customerInfo.name').trim().notEmpty().withMessage('Customer name is required'),
    body('customerInfo.phone')
      .matches(/^\+?[\d\s-()]{10,}$/)
      .withMessage('Valid phone number is required'),
    body('customerInfo.email').optional().isEmail(),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.productId').isMongoId().withMessage('Invalid product ID'),
    body('items.*.variantId').notEmpty().withMessage('Variant ID is required'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('items.*.customerPhone')
      .optional()
      .matches(/^\+?[\d\s-()]{10,}$/)
      .withMessage('Valid phone number is required for mobile bundles')
  ]
};
