// src/validators/providerValidator.js
import { body, param } from 'express-validator';

export const providerValidation = {
  create: [
    body('name').trim().notEmpty().withMessage('Provider name is required'),
      body('code')
    .isIn(['MTN', 'TELECEL', 'AT', 'AFA'])
    .withMessage('Invalid provider code. Must be one of: MTN, TELECEL, AT'),
    body('country').optional().trim().notEmpty().withMessage('Country cannot be empty'),
    body('description').optional().trim(),
    body('logo').optional().isObject().withMessage('Logo must be an object'),
    body('logo.url').optional().isURL().withMessage('Logo URL must be valid'),
    body('logo.alt').optional().isString().withMessage('Logo alt text must be a string'),
    body('services').optional().isArray().withMessage('Services must be an array'),
    body('services.*').optional().isIn(['voice', 'data', 'sms', 'mobile_money']).withMessage('Invalid service type'),
    body('apiConfig').optional().isObject().withMessage('API config must be an object'),
    body('apiConfig.baseUrl').optional().isURL().withMessage('API base URL must be valid'),
    body('apiConfig.version').optional().isString().withMessage('API version must be a string'),
    body('apiConfig.timeout').optional().isNumeric().withMessage('API timeout must be a number'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
  ],
  
  update: [
    param('id').isMongoId().withMessage('Invalid provider ID'),
    body('name').optional().trim().notEmpty().withMessage('Provider name cannot be empty'),
    body('code').optional()
      .isIn(['MTN', 'TELECEL', 'AT', 'AFA'])
      .withMessage('Invalid provider code. Must be one of: MTN, TELECEL, AT, AFA'),
    body('country').optional().trim().notEmpty().withMessage('Country cannot be empty'),
    body('description').optional().trim(),
    body('logo').optional().isObject().withMessage('Logo must be an object'),
    body('logo.url').optional().isURL().withMessage('Logo URL must be valid'),
    body('logo.alt').optional().isString().withMessage('Logo alt text must be a string'),
    body('services').optional().isArray().withMessage('Services must be an array'),
    body('services.*').optional().isIn(['voice', 'data', 'sms', 'mobile_money']).withMessage('Invalid service type'),
    body('apiConfig').optional().isObject().withMessage('API config must be an object'),
    body('apiConfig.baseUrl').optional().isURL().withMessage('API base URL must be valid'),
    body('apiConfig.version').optional().isString().withMessage('API version must be a string'),
    body('apiConfig.timeout').optional().isNumeric().withMessage('API timeout must be a number'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
  ],

  getById: [
    param('id').isMongoId().withMessage('Invalid provider ID')
  ]
};