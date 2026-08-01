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

  // Validate Paystack initiate (frontend calls POST /wallet/paystack/initiate with only amount)
  paystackInitiate: [
    body('amount')
      .notEmpty().withMessage('Amount is required')
      .isFloat({ min: 0.01 }).withMessage('Amount must be a positive number')
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
  ],

  // Validate cancelling a Paystack checkout
  paystackCancel: [
    query('reference')
      .notEmpty().withMessage('Reference is required')
      .isString().withMessage('Reference must be a string')
  ],

  // ── MoMo Bridge — Instant Claim (no amount — relay returns the actual amount) ──
  momoConfig: [],

  momoVerify: [
    body('reference')
      .notEmpty().withMessage('Transaction reference is required')
      .isString().withMessage('Reference must be a string')
      .trim()
      .isLength({ min: 3, max: 100 }).withMessage('Reference must be between 3 and 100 characters'),
  ],

  // ── Cross-App Wallet Transfer (agent self-service) ─────────────────────────
  crossAppTransfer: [
    body('appId')
      .notEmpty().withMessage('Destination app is required')
      .isString().withMessage('Destination app must be a string')
      .trim(),
    body('identifier')
      .notEmpty().withMessage('Destination identifier is required')
      .isString().withMessage('Identifier must be a string')
      .trim()
      .isLength({ min: 3, max: 200 }).withMessage('Identifier must be between 3 and 200 characters'),
    body('pin')
      .notEmpty().withMessage('Security PIN is required')
      .isLength({ min: 4, max: 6 }).withMessage('PIN must be 4 to 6 digits')
      .matches(/^\d{4,6}$/).withMessage('PIN must contain only digits'),
    body('amount')
      .notEmpty().withMessage('Amount is required')
      .isFloat({ min: 0.01 }).withMessage('Amount must be a positive number'),
    body('note')
      .optional()
      .isString().withMessage('Note must be a string')
      .trim()
      .isLength({ max: 200 }).withMessage('Note must be at most 200 characters'),
  ],
};
