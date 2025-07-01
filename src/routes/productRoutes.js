// src/routes/productRoutes.js
import express from 'express';
import productController from '../controllers/productController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { productValidation } from '../validators/productValidator.js';

const router = express.Router();

// Create validation middlewares
const validateCreate = validate(productValidation.create);
const validateUpdate = validate(productValidation.update);
const validateBulkInventory = validate(productValidation.bulkInventory);
const validateCreateVariant = validate(productValidation.createVariant);
const validateUpdateVariant = validate(productValidation.updateVariant);
const validateBulkCreate = validate(productValidation.bulkCreate);
const validateBulkUpdate = validate(productValidation.bulkUpdate);
const validateBulkDelete = validate(productValidation.bulkDelete);

// Product CRUD operations
router.post(
  '/',
  authenticate,
  authorize('agent'),
  validateCreate,
  productController.createProduct
);

router.get(
  '/',
  authenticate,
  authorize('agent'),
  productController.getProducts
);

router.put(
  '/:id',
  authenticate,
  authorize('agent'),
  validateUpdate,
  productController.updateProduct
);

router.delete(
  '/:id',
  authenticate,
  authorize('agent'),
  productController.softDeleteProduct
);

router.post(
  '/:id/restore',
  authenticate,
  authorize('agent'),
  productController.restoreProduct
);

// Bulk operations
router.post(
  '/bulk/create',
  authenticate,
  authorize('agent'),
  validateBulkCreate,
  productController.bulkCreateProducts
);

router.patch(
  '/bulk/update',
  authenticate,
  authorize('agent'),
  validateBulkUpdate,
  productController.bulkUpdateProducts
);

router.delete(
  '/bulk/delete',
  authenticate,
  authorize('agent'),
  validateBulkDelete,
  productController.bulkDeleteProducts
);

router.get(
  '/bulk/template',
  authenticate,
  authorize('agent'),
  productController.getBulkImportTemplate
);

router.post(
  '/bulk/validate',
  authenticate,
  authorize('agent'),
  productController.validateBulkImport
);

// Inventory management
router.patch(
  '/inventory/bulk',
  authenticate,
  authorize('agent'),
  validateBulkInventory,
  productController.bulkUpdateInventory
);

router.post(
  '/inventory/reserve',
  authenticate,
  authorize('agent'),
  productController.reserveStock
);

router.post(
  '/inventory/release',
  authenticate,
  authorize('agent'),
  productController.releaseStock
);

// Analytics and alerts
router.get(
  '/analytics',
  authenticate,
  authorize('agent'),
  productController.getAnalytics
);

router.get(
  '/alerts/low-stock',
  authenticate,
  authorize('agent'),
  productController.getLowStockAlerts
);

// Variant management
router.post(
  '/:id/variants',
  authenticate,
  authorize('agent'),
  validateCreateVariant,
  productController.addVariant
);

router.put(
  '/:id/variants/:variantId',
  authenticate,
  authorize('agent'),
  validateUpdateVariant,
  productController.updateVariant
);

router.delete(
  '/:id/variants/:variantId',
  authenticate,
  authorize('agent'),
  productController.deleteVariant
);

export default router;
