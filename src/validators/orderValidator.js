// src/validators/orderValidator.js
import { body, param } from 'express-validator';

export const orderValidation = {
  createSingle: [
    body('packageGroupId').isMongoId().withMessage('Invalid package group ID'),
    body('packageItemId').notEmpty().withMessage('Package item ID is required'),
    body('customerPhone')
      .matches(/^\+?[\d\s-()]{10,}$/)
      .withMessage('Please enter a valid phone number'),
    body('bundleSize.value')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Bundle size must be a positive number'),
    body('bundleSize.unit')
      .optional()
      .isIn(['MB', 'GB'])
      .withMessage('Bundle unit must be MB or GB'),
    body('quantity')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Quantity must be at least 1')
  ],
  
  createBulk: [
    body('packageGroupId').isMongoId().withMessage('Invalid package group ID'),
    body('packageItemId').notEmpty().withMessage('Package item ID is required'),
    body('rawInput')
      .notEmpty()
      .withMessage('Bulk input data is required')
      .isLength({ min: 10 })
      .withMessage('Bulk input must contain valid data')
  ],
  
  cancel: [
    param('id').isMongoId().withMessage('Invalid order ID'),
    body('reason')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Reason must be less than 500 characters')
  ]
};
