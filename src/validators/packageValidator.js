// src/validators/packageValidator.js
import Joi from 'joi';

// Package validation schemas
const packageValidation = {
  create: Joi.object({
    name: Joi.string().required().trim().min(2).max(100),
    description: Joi.string().optional().trim().max(500),
    provider: Joi.string().required().valid('MTN', 'TELECEL', 'AT'),
    category: Joi.string().required().valid('daily', 'weekly', 'monthly', 'unlimited', 'custom')
  }),

  update: Joi.object({
    name: Joi.string().optional().trim().min(2).max(100),
    description: Joi.string().optional().trim().max(500),
    provider: Joi.string().optional().valid('MTN', 'TELECEL', 'AT'),
    category: Joi.string().optional().valid('daily', 'weekly', 'monthly', 'unlimited', 'custom'),
    isActive: Joi.boolean().optional()
  })
};

// Bundle validation schemas
const bundleValidation = {
  create: Joi.object({
    name: Joi.string().required().trim().min(2).max(100),
    description: Joi.string().optional().trim().max(500),
    packageId: Joi.string().required().hex().length(24),
    provider: Joi.string().required().valid('MTN', 'TELECEL', 'AT'),
    
    // Bundle Specifications
    dataVolume: Joi.number().required().min(0.1).max(1000),
    dataUnit: Joi.string().optional().valid('MB', 'GB').default('GB'),
    validity: Joi.number().required().min(1).max(365),
    validityType: Joi.string().optional().valid('hours', 'days', 'unlimited').default('days'),
    
    // Pricing
    price: Joi.number().required().min(0.01).max(10000),
    costPrice: Joi.number().optional().min(0).max(10000),
    currency: Joi.string().optional().default('GHS'),
    
    // Bundle Features
    features: Joi.array().items(Joi.string()).optional().default([]),
    bundleType: Joi.string().optional().valid('data_only', 'data_voice', 'data_sms', 'data_voice_sms').default('data_only'),
    
    // Status
    isActive: Joi.boolean().optional().default(true)
  }),

  update: Joi.object({
    name: Joi.string().optional().trim().min(2).max(100),
    description: Joi.string().optional().trim().max(500),
    packageId: Joi.string().optional().hex().length(24),
    provider: Joi.string().optional().valid('MTN', 'TELECEL', 'AT'),
    
    // Bundle Specifications
    dataVolume: Joi.number().optional().min(0.1).max(1000),
    dataUnit: Joi.string().optional().valid('MB', 'GB'),
    validity: Joi.number().optional().min(1).max(365),
    validityType: Joi.string().optional().valid('hours', 'days', 'unlimited'),
    
    // Pricing
    price: Joi.number().optional().min(0.01).max(10000),
    costPrice: Joi.number().optional().min(0).max(10000),
    currency: Joi.string().optional(),
    
    // Bundle Features
    features: Joi.array().items(Joi.string()).optional(),
    bundleType: Joi.string().optional().valid('data_only', 'data_voice', 'data_sms', 'data_voice_sms'),
    
    // Status
    isActive: Joi.boolean().optional()
  }),

  checkAvailability: Joi.object({
    walletBalance: Joi.number().required().min(0)
  })
};

export { packageValidation, bundleValidation };
