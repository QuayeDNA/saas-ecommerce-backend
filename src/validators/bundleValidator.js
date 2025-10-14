import Joi from 'joi';

const bundleSchema = Joi.object({
  name: Joi.string().required().min(2).max(100),
  description: Joi.string().optional().max(500),
  dataVolume: Joi.number().optional().min(0.1),
  dataUnit: Joi.string().valid('MB', 'GB', 'TB').optional(),
  validity: Joi.alternatives().try(
    Joi.number().min(1),
    Joi.string().valid('unlimited')
  ).optional(),
  validityUnit: Joi.string().valid('hours', 'days', 'weeks', 'months', 'unlimited').optional(),
  price: Joi.number().required().min(0),
  currency: Joi.string().default('GHS'),
  features: Joi.array().items(Joi.string()).optional(),
  isActive: Joi.boolean().default(true),
  packageId: Joi.string().required(),
  providerId: Joi.string().optional(),
  providerCode: Joi.string().optional(),
  bundleCode: Joi.string().optional().max(20),
  category: Joi.string().optional().max(50),
  tags: Joi.array().items(Joi.string()).optional(),
  // AFA-specific fields
  requiresGhanaCard: Joi.boolean().optional().default(false),
  afaRequirements: Joi.array().items(Joi.string()).optional().default([])
}).or('providerId', 'providerCode');

const bundleUpdateSchema = Joi.object({
  name: Joi.string().optional().min(2).max(100),
  description: Joi.string().optional().max(500),
  dataVolume: Joi.number().optional().min(0.1),
  dataUnit: Joi.string().valid('MB', 'GB', 'TB').optional(),
  validity: Joi.alternatives().try(
    Joi.number().min(1),
    Joi.string().valid('unlimited')
  ).optional(),
  validityUnit: Joi.string().valid('hours', 'days', 'weeks', 'months', 'unlimited').optional(),
  price: Joi.number().optional().min(0),
  currency: Joi.string().optional(),
  features: Joi.array().items(Joi.string()).optional(),
  isActive: Joi.boolean().optional(),
  packageId: Joi.string().optional(),
  providerId: Joi.string().optional(),
  providerCode: Joi.string().optional(),
  bundleCode: Joi.string().optional().max(20),
  category: Joi.string().optional().max(50),
  tags: Joi.array().items(Joi.string()).optional(),
  // AFA-specific fields
  requiresGhanaCard: Joi.boolean().optional(),
  afaRequirements: Joi.array().items(Joi.string()).optional()
});

const bulkBundleSchema = Joi.object({
  bundles: Joi.array().items(bundleSchema).required().min(1)
});

export const validateBundle = (req, res, next) => {
  const { error } = bundleSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message)
    });
  }
  next();
};

export const validateBundleUpdate = (req, res, next) => {
  const { error } = bundleUpdateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message)
    });
  }
  next();
};

export const validateBulkBundles = (req, res, next) => {
  const { error } = bulkBundleSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message)
    });
  }
  next();
}; 