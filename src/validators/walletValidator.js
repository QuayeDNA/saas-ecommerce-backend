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
      .isIn(['credit', 'debit', 'instant_topup']).withMessage('Type must be credit, debit, or instant_topup'),
    query('startDate')
      .optional()
      .isISO8601().withMessage('Start date must be a valid date'),
    query('endDate')
      .optional()
      .isISO8601().withMessage('End date must be a valid date')
  ],

  // Validate instant topup
  instantTopup: [
    body('amount')
      .notEmpty().withMessage('Amount is required')
      .isFloat({ min: 1, max: 1000 }).withMessage('Amount must be between 1 and 1000'),
    body('phoneNumber')
      .notEmpty().withMessage('Phone number is required')
      .isString().withMessage('Phone number must be a string')
      .trim()
      .custom((value) => {
        const cleanPhone = value.replace(/\s+/g, '');
        const isSandbox = process.env.NODE_ENV !== 'production';
        
        // Sandbox: Allow MTN test numbers (46733123450-46733123459)
        if (isSandbox) {
          const sandboxRegex = /^46733123(45[0-9])$/;
          if (sandboxRegex.test(cleanPhone)) {
            return true;
          }
        }
        
        // Production: Ghana MTN numbers (024/054/055/059 + 7 digits)
        // Can start with +233, 233, or 0
        const ghanaRegex = /^(\+?233|0)[2459]\d{8}$/;
        if (ghanaRegex.test(cleanPhone)) {
          return true;
        }
        
        const envType = isSandbox ? 'sandbox' : 'production';
        throw new Error(
          `Invalid MTN phone number format for ${envType}. ` +
          (isSandbox 
            ? 'Sandbox: Use test numbers 46733123450-46733123459 or Ghana MTN numbers'
            : 'Production: Use Ghana MTN numbers (024/054/055/059xxxxxxxx)')
        );
      })
  ]
};