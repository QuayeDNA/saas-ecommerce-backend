// src/routes/packageRoutes.js
import express from 'express';
import packageController from '../controllers/packageController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { packageValidation } from '../validators/packageValidator.js';

const router = express.Router();

// Create validation middlewares
const validateCreate = validate(packageValidation.createPackageGroup);
const validateUpdate = validate(packageValidation.updatePackageGroup);
const validateCreatePackageItem = validate(packageValidation.createPackageItem);
const validateUpdatePackageItem = validate(packageValidation.updatePackageItem);
const validateBulkInventory = validate(packageValidation.bulkInventory);

// Package group operations
router.post(
  '/',
  authenticate,
  authorize('agent'),
  validateCreate,
  packageController.createPackageGroup
);

router.get(
  '/',
  authenticate,
  authorize('agent'),
  packageController.getPackageGroups
);

router.put(
  '/:id',
  authenticate,
  authorize('agent'),
  validateUpdate,
  packageController.updatePackageGroup
);

router.delete(
  '/:id',
  authenticate,
  authorize('agent'),
  packageController.softDeletePackageGroup
);

router.post(
  '/:id/restore',
  authenticate,
  authorize('agent'),
  packageController.restorePackageGroup
);

// Package item operations
router.post(
  '/:id/items',
  authenticate,
  authorize('agent'),
  validateCreatePackageItem,
  packageController.addPackageItem
);

router.put(
  '/:id/items/:itemId',
  authenticate,
  authorize('agent'),
  validateUpdatePackageItem,
  packageController.updatePackageItem
);

router.delete(
  '/:id/items/:itemId',
  authenticate,
  authorize('agent'),
  packageController.deletePackageItem
);

// Inventory management
router.patch(
  '/inventory/bulk',
  authenticate,
  authorize('agent'),
  validateBulkInventory,
  packageController.bulkUpdateInventory
);

router.post(
  '/inventory/reserve',
  authenticate,
  authorize('agent'),
  packageController.reserveStock
);

router.post(
  '/inventory/release',
  authenticate,
  authorize('agent'),
  packageController.releaseStock
);

// Analytics and alerts
router.get(
  '/analytics',
  authenticate,
  authorize('agent'),
  packageController.getAnalytics
);

router.get(
  '/alerts/low-stock',
  authenticate,
  authorize('agent'),
  packageController.getLowStockAlerts
);

// Fetch all package items with their parent group, optionally filtered by provider
router.get(
  '/all-items',
  authenticate,
  authorize('agent'),
  packageController.getAllPackageItems
);

export default router;
