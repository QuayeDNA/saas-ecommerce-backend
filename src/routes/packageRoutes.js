// src/routes/packageRoutes.js
import express from "express";
import packageController from "../controllers/packageController.js";
import bundleController from "../controllers/bundleController.js";
import { authenticate, authorize } from "../middlewares/auth.js";
import validate from "../middlewares/validate.js";
import {
  packageValidation,
  bundleValidation,
} from "../validators/packageValidator.js";

const router = express.Router();

// Package routes
router.post(
  "/",
  authenticate,
  authorize("admin", "super_admin"),
  validate(packageValidation.create),
  packageController.createPackage
);

router.get("/", packageController.getPackages);

router.get("/:id", packageController.getPackage);

router.put(
  "/:id",
  authenticate,
  authorize("admin", "super_admin"),
  validate(packageValidation.update),
  packageController.updatePackage
);

router.delete(
  "/:id",
  authenticate,
  authorize("admin", "super_admin"),
  packageController.deletePackage
);

router.post(
  "/:id/restore",
  authenticate,
  authorize("admin", "super_admin"),
  packageController.restorePackage
);

// Package-specific routes
router.get("/provider/:provider", packageController.getPackagesByProvider);

router.get("/category/:category", packageController.getPackagesByCategory);

router.get("/stats/summary", packageController.getPackageStats);

// Bundle routes
router.post(
  "/bundles",
  authenticate,
  authorize("admin", "super_admin"),
  validate(bundleValidation.create),
  bundleController.createBundle
);

router.get(
  "/bundles",
  authenticate,
  authorize(
    "agent",
    "super_agent",
    "dealer",
    "super_dealer",
    "admin",
    "super_admin"
  ),
  bundleController.getAllBundles
);

router.get(
  "/bundles/:id",
  authenticate,
  authorize(
    "agent",
    "super_agent",
    "dealer",
    "super_dealer",
    "admin",
    "super_admin"
  ),
  bundleController.getBundleById
);

router.put(
  "/bundles/:id",
  authenticate,
  authorize("admin", "super_admin"),
  validate(bundleValidation.update),
  bundleController.updateBundle
);

router.delete(
  "/bundles/:id",
  authenticate,
  authorize("admin", "super_admin"),
  bundleController.deleteBundle
);

// Remove or comment out restoreBundle and category routes as they are not present in the new controller
// router.post(
//   '/bundles/:id/restore',
//   authenticate,
//   authorize('agent'),
//   bundleController.restoreBundle
// );

// router.get(
//   '/bundles/category/:category',
//   authenticate,
//   authorize('agent'),
//   bundleController.getBundlesByCategory
// );

router.get(
  "/bundles/provider/:providerId",
  authenticate,
  authorize(
    "agent",
    "super_agent",
    "dealer",
    "super_dealer",
    "admin",
    "super_admin"
  ),
  bundleController.getBundlesByProvider
);

router.get(
  "/bundles/package/:packageId",
  authenticate,
  authorize(
    "agent",
    "super_agent",
    "dealer",
    "super_dealer",
    "admin",
    "super_admin"
  ),
  bundleController.getBundlesByPackage
);

// Remove or comment out checkBundleAvailability as it is not present in the new controller
// router.post(
//   '/bundles/:id/check-availability',
//   authenticate,
//   authorize('agent'),
//   validate(bundleValidation.checkAvailability),
//   bundleController.checkBundleAvailability
// );

router.get(
  "/bundles/analytics/summary",
  authenticate,
  authorize("admin", "super_admin"),
  bundleController.getBundleAnalytics
);

// Public routes
router.get("/public", packageController.getPackages);

router.get("/public/:id", packageController.getPackage);

router.get(
  "/public/provider/:provider",
  packageController.getPackagesByProvider
);

router.get(
  "/public/category/:category",
  packageController.getPackagesByCategory
);

router.get("/public/bundles", bundleController.getAllBundles);

router.get("/public/bundles/:id", bundleController.getBundleById);

router.get(
  "/public/bundles/provider/:providerId",
  bundleController.getBundlesByProvider
);

router.get(
  "/public/bundles/package/:packageId",
  bundleController.getBundlesByPackage
);

export default router;
