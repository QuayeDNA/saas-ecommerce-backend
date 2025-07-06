// src/validators/walletValidator.js
import { body, param, query } from 'express-validator';

export const walletValidation = {
  // Validate top-up request
  topUpRequest: [
    body('amount')
      .notEmpty().withMessage('Amount is required')
      .isFloat({ min: 0.01 }).withMessage('Amount must be a positive number'),
    body('description')
      .notEmpty().withMessage('Description is required')
      .isString().withMessage('Description must be a string')
      .trim()
      .isLength({ min: 5, max: 200 }).withMessage('Description must be between 5 and 200 characters')
  ],
  
  // Validate admin top-up
  adminTopUp: [
    body('userId')
      .notEmpty().withMessage('User ID is required')
      .isMongoId().withMessage('Invalid user ID format'),
    body('amount')
      .notEmpty().withMessage('Amount is required')
      .isFloat({ min: 0.01 }).withMessage('Amount must be a positive number'),
    body('description')
      .optional()
      .isString().withMessage('Description must be a string')
      .trim()
  ],
  
  // Validate process top-up request
  processTopUpRequest: [
    param('transactionId')
      .notEmpty().withMessage('Transaction ID is required')
      .isMongoId().withMessage('Invalid transaction ID format'),
    body('approve')
      .notEmpty().withMessage('Approval decision is required')
      .isBoolean().withMessage('Approve must be a boolean')
  ],
  
  // Validate transaction history query
  transactionHistory: [
    query('page')
      .optional()
      .isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('type')
      .optional()
      .isIn(['credit', 'debit']).withMessage('Type must be either credit or debit'),
    query('startDate')
      .optional()
      .isISO8601().withMessage('Start date must be a valid date'),
    query('endDate')
      .optional()
      .isISO8601().withMessage('End date must be a valid date')
  ]
};
