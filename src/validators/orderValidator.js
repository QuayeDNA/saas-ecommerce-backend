// src/validators/orderValidator.js
import Joi from "joi";

const orderValidation = {
  createSingle: Joi.object({
    packageGroupId: Joi.string().required().hex().length(24),
    packageItemId: Joi.string().required().hex().length(24),
    customerPhone: Joi.string()
      .required()
      .pattern(/^\+?[\d\s-()]{10,}$/),
    bundleSize: Joi.object({
      value: Joi.number().min(0.1),
      unit: Joi.string().valid("MB", "GB"),
    }).optional(),
    quantity: Joi.number().integer().min(1).default(1),
    forceOverride: Joi.boolean().optional().default(false),
  }),

  createBulk: Joi.object({
    items: Joi.array()
      .items(
        Joi.string().min(6) // expects lines like '0542313561,10GB'
      )
      .min(1)
      .required(),
    packageId: Joi.string().required().hex().length(24),
    tenantId: Joi.string().required().hex().length(24).messages({
      "string.base": "tenantId must be a string",
      "string.hex": "tenantId must be a valid hex string",
      "string.length": "tenantId must be exactly 24 characters",
      "any.required": "tenantId is required",
    }),
    userId: Joi.string().required().hex().length(24),
    forceOverride: Joi.boolean().optional().default(false),
  }),

  cancel: Joi.object({
    reason: Joi.string().optional().max(500),
  }),

  report: Joi.object({
    description: Joi.string().optional().min(10).max(1000),
  }),
};

export { orderValidation };
