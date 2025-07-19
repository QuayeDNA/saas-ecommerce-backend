// src/validators/orderValidator.js
import Joi from 'joi';

const orderValidation = {
  createSingle: Joi.object({
    packageGroupId: Joi.string().required().hex().length(24),
    packageItemId: Joi.string().required().hex().length(24),
    customerPhone: Joi.string().required().pattern(/^\+?[\d\s-()]{10,}$/),
    bundleSize: Joi.object({
      value: Joi.number().min(0.1),
      unit: Joi.string().valid('MB', 'GB')
    }).optional(),
    quantity: Joi.number().integer().min(1).default(1)
  }),

  createBulk: Joi.object({
    items: Joi.array().items(
      Joi.string().min(6) // expects lines like '0542313561,10GB'
    ).min(1).required(),
    packageId: Joi.string().required().hex().length(24),
    tenantId: Joi.string().required().hex().length(24),
    userId: Joi.string().required().hex().length(24)
  }),

  cancel: Joi.object({
    reason: Joi.string().optional().max(500)
  })
};

export { orderValidation };
