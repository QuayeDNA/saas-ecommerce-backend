    // src/routes/storefrontRoutes.js
import express from 'express';
import storefrontController from '../controllers/storefrontController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { storefrontValidation } from '../validators/storefrontValidator.js';

const router = express.Router();

// Agent routes (protected)
router.post(
  '/',
  authenticate,
  authorize('agent'),
  validate(storefrontValidation.create),
  storefrontController.createStorefront
);

router.put(
  '/',
  authenticate,
  authorize('agent'),
  validate(storefrontValidation.update),
  storefrontController.updateStorefront
);

router.get(
  '/my-storefront',
  authenticate,
  authorize('agent'),
  storefrontController.getStorefront
);

router.get(
  '/analytics',
  authenticate,
  authorize('agent'),
  storefrontController.getStorefrontAnalytics
);

router.get(
  '/check-slug/:slug',
  authenticate,
  authorize('agent'),
  storefrontController.checkSlugAvailability
);

router.patch(
  '/toggle-status',
  authenticate,
  authorize('agent'),
  storefrontController.toggleStorefrontStatus
);

// Public routes (no authentication required)
router.get(
  '/public/:slug',
  storefrontController.getPublicStorefront
);

router.get(
  '/public/:slug/products',
  storefrontController.getStorefrontProducts
);

router.post(
  '/public/:slug/orders',
  validate(storefrontValidation.createOrder),
  storefrontController.createStorefrontOrder
);

export default router;
