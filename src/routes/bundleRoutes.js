import express from "express";
import { authenticate, authorize } from "../middlewares/auth.js";
import {
  validateBundle,
  validateBundleUpdate,
} from "../validators/bundleValidator.js";
import bundleController from "../controllers/bundleController.js";

const router = express.Router();

// Public routes
router.get("/", bundleController.getAllBundles);
router.get("/:id", bundleController.getBundleById);
router.get("/provider/:providerId", bundleController.getBundlesByProvider);
router.get("/package/:packageId", bundleController.getBundlesByPackage);

// Protected routes (admin only)
router.use(authenticate);

// CRUD operations
router.post("/", validateBundle, bundleController.createBundle);
router.put("/:id", validateBundleUpdate, bundleController.updateBundle);
router.delete("/:id", bundleController.deleteBundle);

// Bulk operations
router.post("/bulk", bundleController.createBulkBundles);
router.put("/bulk/update", bundleController.updateBulkBundles);
router.delete("/bulk/delete", bundleController.deleteBulkBundles);

// Analytics
router.get("/analytics/overview", bundleController.getBundleAnalytics);
router.get(
  "/analytics/provider/:providerId",
  bundleController.getProviderBundleAnalytics
);

// Pricing management routes (super admin only)
router.get(
  "/:id/pricing",
  authorize("super_admin"),
  bundleController.getBundlePricing
);
router.put(
  "/:id/pricing",
  authorize("super_admin"),
  bundleController.updateBundlePricing
);
router.post(
  "/pricing/bulk-update",
  authorize("super_admin"),
  bundleController.bulkUpdatePricing
);

export default router;
