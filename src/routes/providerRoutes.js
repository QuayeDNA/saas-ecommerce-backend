// src/routes/providerRoutes.js
import express from 'express';
import providerController from '../controllers/providerController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { providerValidation } from '../validators/providerValidator.js';

const router = express.Router();

// Create validation middlewares
const validateCreate = validate(providerValidation.create);
const validateUpdate = validate(providerValidation.update);
const validateGetById = validate(providerValidation.getById);

// PUBLIC ROUTES (no authentication required)
router.get(
  '/public',
  providerController.getPublicProviders
);

// PROTECTED ROUTES (authentication required)
router.post(
  '/',
  authenticate,
  authorize(['super_admin']), // Only super admins can create providers
  validateCreate,
  providerController.createProvider
);

router.get(
  '/',
  authenticate,
  // All authenticated users can view providers
  providerController.getProviders
);

router.get(
  '/analytics',
  authenticate,
  authorize(['super_admin']),
  providerController.getProviderAnalytics
);

router.get(
  '/:id',
  authenticate,
  validateGetById,
  // All authenticated users can view individual providers
  providerController.getProviderById
);

router.put(
  '/:id',
  authenticate,
  authorize(['super_admin']), // Only super admins can update providers
  validateUpdate,
  providerController.updateProvider
);

router.delete(
  '/:id',
  authenticate,
  authorize(['super_admin']), // Only super admins can delete providers
  validateGetById,
  providerController.softDeleteProvider
);

router.post(
  '/:id/restore',
  authenticate,
  authorize(['super_admin']), // Only super admins can restore providers
  validateGetById,
  providerController.restoreProvider
);

export default router;