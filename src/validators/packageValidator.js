// src/validators/packageValidator.js
import { body, param } from 'express-validator';

export const packageValidation = {
  createPackageGroup: [
    body('name').trim().notEmpty().withMessage('Package group name is required'),
    body('provider')
      .isIn(['MTN', 'TELECEL', 'AT', 'GLO'])
      .withMessage('Invalid provider'),
    body('packageItems').optional().isArray().withMessage('Package items must be an array'),
    body('packageItems.*.name').optional().notEmpty().withMessage('Package item name is required'),
    body('packageItems.*.price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('packageItems.*.dataVolume').optional().isFloat({ min: 0 }).withMessage('Data volume must be a positive number'),
    body('packageItems.*.validity').optional().isInt({ min: 1 }).withMessage('Validity must be at least 1 day')
  ],
  
  updatePackageGroup: [
    param('id').isMongoId().withMessage('Invalid package group ID'),
    body('name').optional().trim().notEmpty(),
    body('provider').optional().isIn(['MTN', 'TELECEL', 'AT', 'GLO']),
    body('isActive').optional().isBoolean()
  ],
  
  createPackageItem: [
    param('id').isMongoId().withMessage('Invalid package group ID'),
    body('name').notEmpty().withMessage('Package item name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('dataVolume').isFloat({ min: 0 }).withMessage('Data volume must be a positive number'),
    body('validity').isInt({ min: 1 }).withMessage('Validity must be at least 1 day'),
    body('inventory').optional().isInt({ min: 0 }).withMessage('Inventory must be a non-negative integer'),
    body('code').optional().isString().isLength({ min: 3 }).withMessage('Code must be at least 3 characters')
  ],
  
  updatePackageItem: [
    param('id').isMongoId().withMessage('Invalid package group ID'),
    param('itemId').isMongoId().withMessage('Invalid package item ID'),
    body('name').optional().notEmpty(),
    body('price').optional().isFloat({ min: 0 }),
    body('dataVolume').optional().isFloat({ min: 0 }),
    body('validity').optional().isInt({ min: 1 }),
    body('inventory').optional().isInt({ min: 0 }),
    body('isActive').optional().isBoolean()
  ],
  
  bulkInventory: [
    body('updates').isArray({ min: 1 }).withMessage('Updates array is required'),
    body('updates.*.packageGroupId').isMongoId().withMessage('Invalid package group ID'),
    body('updates.*.itemId').isMongoId().withMessage('Invalid package item ID'),
    body('updates.*.inventory').isInt({ min: 0 }).withMessage('Inventory must be a non-negative integer')
  ]
};
