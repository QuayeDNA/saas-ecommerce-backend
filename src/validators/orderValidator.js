// src/validators/orderValidator.js
import Joi from 'joi';

const orderValidation = {
  createSingle: Joi.object({
    bundleId: Joi.string().required().hex().length(24),
    customerPhone: Joi.string().required().pattern(/^\+?[\d\s-()]{10,}$/),
    bundleSize: Joi.object({
      value: Joi.number().min(0.1),
      unit: Joi.string().valid('MB', 'GB')
    }).optional(),
    quantity: Joi.number().integer().min(1).default(1)
  }),

  createBulk: Joi.object({
    bundleId: Joi.string().required().hex().length(24),
    bulkData: Joi.string().required().min(1),
    delimiter: Joi.string().optional()
  }),

  cancel: Joi.object({
    reason: Joi.string().optional().max(500)
  })
};

export { orderValidation };
